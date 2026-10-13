"""Árbitros designados antes del partido, de las fuentes oficiales.

football-data.org rellena el árbitro al jugarse el partido y ESPN días
después, así que para los próximos partidos hacía falta el CSV manual. Estas
fuentes publican la designación en cuanto sale (comprobado el 2026-10-10):

- LaLiga y LaLiga Hypermotion: API pública de laliga.com, la que usa su web.
  La clave de suscripción es pública y va en la configuración de cada página
  (runtimeConfig.backendSubscription): se lee de ahí en cada pasada (si no se
  puede, se usa LALIGA_SUBSCRIPTION_KEY del .env, si está). Refleja
  las designaciones del CTA, que la RFEF publica como imagen (sin texto que
  leer) la víspera de cada día de partido.
- Premier League: API oficial de premierleague.com: partidos de la jornada y
  /officials de cada uno ("Referee").
- Ligue 1: API oficial de ligue1.com: calendario por jornadas y ficha de cada
  partido (officials, tipo 1 = árbitro principal).
- La API de laliga.com también trae la Premier y la Ligue 1: es la segunda
  fuente de esas dos ligas y sirve para contrastar. Si discrepan, manda la
  oficial y queda un aviso.

Los nombres se pasan al formato de la base ("J Sánchez Martínez") con el
mismo emparejador que ESPN (RefereeNames): un árbitro que ya existe conserva
su nombre; uno nuevo queda como inicial + apellidos y se lista en la pasada.

Solo se tocan partidos por jugar (el designado sustituye al que hubiera) y
jugados sin árbitro. data/arbitros_manual.csv se aplica después y siempre
prevalece.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import IngestionRun, IngestionStatus, League, Match, MatchStatus
from app.ingestion.espn import RefereeNames
from app.ingestion.team_names import TeamResolver

logger = logging.getLogger(__name__)

LALIGA_PAGE = "https://www.laliga.com/laliga-easports/calendario"
LALIGA_API = "https://apim.laliga.com/public-service/api/v1"
LALIGA_SUBSCRIPTIONS = {
    "ESP-La Liga": "laliga-easports-{year}",
    "ESP-La Liga 2": "laliga-hypermotion-{year}",
    "ENG-Premier League": "english-premier-league-{year}",
    "FRA-Ligue 1": "french-ligue-1-{year}",
}
LALIGA_MAIN_REFEREE_ROLE = 5  # "Árbitro Principal"

PREMIER_API = "https://sdp-prem-prod.premier-league-prod.pulselive.com/api"
PREMIER_COMPETITION = 8
LIGUE1_API = "https://ma-api.ligue1.fr"
LIGUE1_CHAMPIONSHIP = 1
LIGUE1_MAIN_REFEREE = 1

# Fuentes de cada liga, de más a menos fiable.
SOURCES_BY_LEAGUE = {
    "ESP-La Liga": ("laliga",),
    "ESP-La Liga 2": ("laliga",),
    "ENG-Premier League": ("premierleague", "laliga"),
    "FRA-Ligue 1": ("ligue1", "laliga"),
}

# Ventana de partidos que interesan: los próximos días y los últimos (un
# partido recién jugado aún sin árbitro).
AHEAD = timedelta(days=5)
BEHIND = timedelta(days=3)
DATE_TOLERANCE = timedelta(days=2)

_PAUSE_SECONDS = 0.4
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
)
_PARTICLES = {"de", "del", "la", "las", "los", "y", "i", "da", "do", "dos", "van", "von"}


@dataclass(frozen=True)
class Designation:
    source: str  # "laliga" | "premierleague" | "ligue1"
    league_code: str
    kickoff: datetime  # UTC sin zona
    home_names: tuple[str, ...]
    away_names: tuple[str, ...]
    referee: str  # nombre completo, como "José María Sánchez Martínez"


def _utc(iso: str) -> datetime:
    moment = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return moment.astimezone(timezone.utc).replace(tzinfo=None) if moment.tzinfo else moment


def tidy_name(name: str) -> str:
    """"Eric WATTELLIER" -> "Eric Wattellier"; "Florian GONCALVES DE ARAUJO" ->
    "Florian Goncalves de Araujo". Solo toca las palabras en mayúsculas."""
    words = []
    for i, word in enumerate(name.split()):
        if len(word) > 1 and word.isupper():
            word = word.lower() if i > 0 and word.lower() in _PARTICLES else word.capitalize()
            word = re.sub(r"-(\w)", lambda m: "-" + m.group(1).upper(), word)
        words.append(word)
    return " ".join(words)


def laliga_person_name(person: dict) -> str | None:
    """Nombre completo de una persona de la API de laliga.com: el más largo de
    "name" y "nickname" (a veces uno es solo los apellidos, "Gordillo
    Escamilla", o el otro lleva el segundo apellido). Nombre y apellidos por
    separado no sirven: vienen mal partidos ("Marta Huerta" + "de Aza")."""
    names = [(person.get(k) or "").strip() for k in ("name", "nickname")]
    full = max(names, key=len)
    return full or None


class _Http:
    def __init__(self, headers: dict[str, str] | None = None) -> None:
        self._http = httpx.Client(timeout=30, follow_redirects=True, headers={"User-Agent": _UA, **(headers or {})})
        self._last = 0.0
        self.requests = 0

    def get(self, url: str, params: dict | None = None) -> httpx.Response:
        pause = _PAUSE_SECONDS - (time.monotonic() - self._last)
        if pause > 0:
            time.sleep(pause)
        self._last = time.monotonic()
        self.requests += 1
        response = self._http.get(url, params=params)
        if response.status_code != 200:
            raise ConnectionError(f"{response.status_code} en {response.url}")
        return response

    def close(self) -> None:
        self._http.close()


class LaLigaApi(_Http):
    def __init__(self, fallback_key: str | None = None) -> None:
        super().__init__({"Origin": "https://www.laliga.com", "Referer": "https://www.laliga.com/"})
        self._key: str | None = None
        # Por si un día no se puede leer de la página. No va en el código: el
        # repositorio es público.
        self._fallback = get_settings().laliga_subscription_key if fallback_key is None else fallback_key

    def key(self) -> str:
        if self._key is None:
            try:
                html = self.get(LALIGA_PAGE).text
                match = re.search(r'"backendSubscription":"([0-9a-f]{32})"', html)
                self._key = match.group(1) if match else self._fallback
            except ConnectionError:
                self._key = self._fallback
            if not self._key:
                self._key = None
                raise ConnectionError(f"sin clave de suscripción: no está en {LALIGA_PAGE} ni en LALIGA_SUBSCRIPTION_KEY")
        return self._key

    def _api(self, path: str, **params) -> dict:
        query = {"contentLanguage": "es", "countryCode": "ES", "subscription-key": self.key(), **params}
        return self.get(f"{LALIGA_API}{path}", query).json()

    def current_week(self, slug: str) -> int | None:
        data = self._api(f"/subscriptions/{slug}")
        sub = data.get("subscription", data)
        return (sub.get("current_gameweek") or {}).get("week")

    def designations(self, league_code: str, year: int) -> list[Designation]:
        slug = LALIGA_SUBSCRIPTIONS[league_code].format(year=year)
        week = self.current_week(slug)
        if week is None:
            return []
        out = []
        for w in (week, week + 1):
            for m in self._api("/matches", subscriptionSlug=slug, week=w, limit=100).get("matches", []):
                referee = next(
                    (
                        laliga_person_name(p.get("person") or {})
                        for p in m.get("persons_role") or []
                        if (p.get("role") or {}).get("id") == LALIGA_MAIN_REFEREE_ROLE
                    ),
                    None,
                )
                if not referee or not m.get("date"):
                    continue
                teams = []
                for side in ("home_team", "away_team"):
                    t = m.get(side) or {}
                    teams.append(tuple(n for n in (t.get("nickname"), t.get("name"), t.get("boundname"), t.get("shortname")) if n))
                out.append(Designation("laliga", league_code, _utc(m["date"]), teams[0], teams[1], referee))
        return out


class PremierLeagueApi(_Http):
    def __init__(self) -> None:
        super().__init__({"Origin": "https://www.premierleague.com", "Referer": "https://www.premierleague.com/"})

    def designations(self, year: int, weeks: Iterable[int]) -> list[Designation]:
        out = []
        for week in sorted(set(weeks)):
            matches = self.get(
                f"{PREMIER_API}/v2/matches",
                {"competition": PREMIER_COMPETITION, "season": year, "matchweek": week},
            ).json().get("data", [])
            for m in matches:
                zone = ZoneInfo(m.get("kickoffTimezoneString") or "Europe/London")
                kickoff = datetime.fromisoformat(m["kickoff"]).replace(tzinfo=zone)
                officials = self.get(f"{PREMIER_API}/v1/matches/{m['matchId']}/officials").json()
                referee = next(
                    (
                        (o.get("official") or {}).get("name")
                        for o in officials.get("matchOfficials") or []
                        if o.get("type") == "Referee"
                    ),
                    None,
                )
                if not referee:
                    continue
                home, away = m.get("homeTeam") or {}, m.get("awayTeam") or {}
                out.append(
                    Designation(
                        "premierleague",
                        "ENG-Premier League",
                        kickoff.astimezone(timezone.utc).replace(tzinfo=None),
                        tuple(n for n in (home.get("name"), home.get("shortName")) if n),
                        tuple(n for n in (away.get("name"), away.get("shortName")) if n),
                        referee,
                    )
                )
        return out


class Ligue1Api(_Http):
    def __init__(self) -> None:
        super().__init__({"Origin": "https://ligue1.com", "Referer": "https://ligue1.com/"})

    def designations(self, year: int, start: datetime, end: datetime) -> list[Designation]:
        calendar = self.get(
            f"{LIGUE1_API}/championship-calendar/{LIGUE1_CHAMPIONSHIP}", {"season": year}
        ).json().get("gameWeeks", {})
        out = []
        for week in calendar.values():
            if _utc(week["endDate"]) < start or _utc(week["startDate"]) > end:
                continue
            for match_id in week.get("matchesIds", []):
                m = self.get(f"{LIGUE1_API}/championship-match/{match_id}").json()
                referee = next(
                    (o.get("name") for o in m.get("officials") or [] if o.get("type") == LIGUE1_MAIN_REFEREE), None
                )
                if not referee or not m.get("date"):
                    continue
                teams = []
                for side in ("home", "away"):
                    club = (m.get(side) or {}).get("clubIdentity") or {}
                    teams.append(
                        tuple(n for n in (club.get("name"), club.get("shortName"), club.get("officialName"), club.get("displayName")) if n)
                    )
                out.append(Designation("ligue1", "FRA-Ligue 1", _utc(m["date"]), teams[0], teams[1], tidy_name(referee)))
        return out


# --- cruce y aplicación ----------------------------------------------------------


def _resolve(resolver: TeamResolver, names: tuple[str, ...]):
    for name in names:
        team = resolver.resolve(name)
        if team is not None:
            return team
    return None


def _find_match(db: Session, league_id: int, resolver: TeamResolver, d: Designation, unresolved: set[str]) -> Match | None:
    home, away = _resolve(resolver, d.home_names), _resolve(resolver, d.away_names)
    if home is None or away is None:
        unresolved.update(d.home_names[:1] if home is None else ())
        unresolved.update(d.away_names[:1] if away is None else ())
        return None
    candidates = (
        db.query(Match)
        .filter(
            Match.league_id == league_id,
            Match.home_team_id == home.id,
            Match.away_team_id == away.id,
            Match.date.between(d.kickoff - DATE_TOLERANCE, d.kickoff + DATE_TOLERANCE),
        )
        .all()
    )
    return min(candidates, key=lambda m: abs(m.date - d.kickoff)) if candidates else None


def existing_referees(db: Session, country: str) -> set[str]:
    return {
        r
        for (r,) in db.query(Match.referee)
        .join(League, League.id == Match.league_id)
        .filter(League.code.like(f"{country}-%"), Match.referee.isnot(None))
        .distinct()
    }


@dataclass
class ApplyResult:
    updated: int = 0
    unchanged: int = 0
    skipped_played: int = 0  # jugados que ya tienen árbitro: no se tocan
    unmatched: int = 0
    conflicts: list[str] | None = None
    new_names: list[str] | None = None
    unresolved: set[str] | None = None


def apply_designations(db: Session, designations: list[Designation], resolver: TeamResolver | None = None) -> ApplyResult:
    """Pone el árbitro designado en cada partido, en el formato de la base.
    Por partido manda la primera fuente de SOURCES_BY_LEAGUE que lo tenga."""
    resolver = resolver or TeamResolver(db)
    result = ApplyResult(conflicts=[], new_names=[], unresolved=set())
    leagues = {lg.code: lg for lg in db.query(League).all()}
    names: dict[str, RefereeNames] = {}
    known: dict[str, set[str]] = {}
    by_match: dict[int, list[tuple[Designation, str]]] = defaultdict(list)
    for d in designations:
        league = leagues.get(d.league_code)
        if league is None:
            continue
        match = _find_match(db, league.id, resolver, d, result.unresolved)
        if match is None:
            result.unmatched += 1
            continue
        country = d.league_code.split("-")[0]
        if country not in names:
            known[country] = existing_referees(db, country)
            names[country] = RefereeNames(known[country])
        by_match[match.id].append((d, names[country].canonical(d.referee)))

    for match_id, found in by_match.items():
        match = db.get(Match, match_id)
        order = SOURCES_BY_LEAGUE.get(found[0][0].league_code, ())
        found.sort(key=lambda f: order.index(f[0].source) if f[0].source in order else len(order))
        chosen_designation, chosen = found[0]
        others = {name for d, name in found[1:] if name != chosen}
        if others:
            result.conflicts.append(
                f"{match.date:%d/%m} {chosen_designation.home_names[0]} - {chosen_designation.away_names[0]}: "
                f"{chosen} ({chosen_designation.source}) frente a {', '.join(sorted(others))}"
            )
        if match.status == MatchStatus.HISTORICAL and match.referee:
            result.skipped_played += 1
            continue
        if match.referee == chosen:
            result.unchanged += 1
            continue
        country = chosen_designation.league_code.split("-")[0]
        if chosen not in known[country]:
            result.new_names.append(f"{chosen} ({chosen_designation.referee})")
            known[country].add(chosen)
        match.referee = chosen
        result.updated += 1
    db.flush()
    return result


def collect_designations(
    db: Session,
    leagues: list[str],
    season_year: int,
    now: datetime,
    errors: list[str],
) -> tuple[list[Designation], int]:
    """Designaciones de todas las fuentes de esas ligas para los partidos de la
    ventana. Una fuente que falla se anota y no para las demás."""
    start, end = now - BEHIND, now + AHEAD
    targets = (
        db.query(Match, League.code)
        .join(League, League.id == Match.league_id)
        .filter(League.code.in_(leagues), Match.date.between(start, end))
        .all()
    )
    weeks_by_league: dict[str, set[int]] = defaultdict(set)
    for match, code in targets:
        if match.matchday:
            weeks_by_league[code].add(match.matchday)
    out: list[Designation] = []
    requests = 0
    laliga, premier, ligue1 = LaLigaApi(), PremierLeagueApi(), Ligue1Api()
    try:
        for code in leagues:
            for source in SOURCES_BY_LEAGUE.get(code, ()):
                try:
                    if source == "laliga":
                        out += laliga.designations(code, season_year)
                    elif source == "premierleague" and weeks_by_league[code]:
                        out += premier.designations(season_year, weeks_by_league[code])
                    elif source == "ligue1":
                        out += ligue1.designations(season_year, start, end)
                except Exception as exc:  # noqa: BLE001  (una fuente caída no para las demás)
                    errors.append(f"{source} {code}: {type(exc).__name__}: {exc}"[:300])
                    logger.warning("Designaciones %s %s: %s", source, code, exc)
    finally:
        requests = laliga.requests + premier.requests + ligue1.requests
        for client in (laliga, premier, ligue1):
            client.close()
    return [d for d in out if start <= d.kickoff <= end], requests


def sync_designations(db: Session, leagues: list[str], season_year: int, now: datetime | None = None) -> IngestionRun:
    """Una pasada: recoge las designaciones y las aplica. Queda en
    ingestion_runs ("designations.sync") con lo que ha hecho."""
    now = now or datetime.now(timezone.utc).replace(tzinfo=None)
    run = IngestionRun(source="designations.sync", status=IngestionStatus.RUNNING)
    db.add(run)
    db.commit()
    errors: list[str] = []
    try:
        designations, requests = collect_designations(db, leagues, season_year, now, errors)
        result = apply_designations(db, designations)
        db.commit()
        by_source: dict[str, int] = defaultdict(int)
        for d in designations:
            by_source[d.source] += 1
        notes = {
            "designaciones": dict(by_source),
            "actualizados": result.updated,
            "sin_cambios": result.unchanged,
            "jugados_con_arbitro": result.skipped_played,
            "sin_partido": result.unmatched,
            "peticiones": requests,
        }
        if result.new_names:
            notes["arbitros_nuevos"] = result.new_names
        if result.conflicts:
            notes["discrepancias"] = result.conflicts
        if result.unresolved:
            notes["equipos_sin_resolver"] = sorted(result.unresolved)
        if errors:
            notes["errores"] = errors
        run.status = IngestionStatus.SUCCESS if not errors or designations else IngestionStatus.FAILED
        run.rows_ingested = result.updated
        run.notes = json.dumps(notes, ensure_ascii=False)[:2000]
        run.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
        logger.info("Designaciones: %s", run.notes)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        run.status = IngestionStatus.FAILED
        run.notes = str(exc)[:2000]
        run.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
        raise
    return run
