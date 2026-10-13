"""Calendario y árbitros desde la API pública de ESPN (sin clave ni documentación).

Cubre dos huecos de las otras fuentes:

- **Árbitros.** El CSV de Football-Data.co.uk solo los trae en la Premier, y
  football-data.org solo en la temporada en curso. ESPN da el árbitro de cada
  partido de todas nuestras ligas, también de temporadas pasadas (en el
  resumen del partido: una petición por partido).
- **Calendario de LaLiga Hypermotion.** football-data.org no la da en su plan
  gratuito y el fixtures.csv solo trae la próxima jornada. ESPN tiene la
  temporada entera; las fechas lejanas son provisionales (`timeValid` falso)
  y se guardan a las 00:00 UTC, la convención de "hora por confirmar".

Resultados, estadísticas y cuotas siguen viniendo de Football-Data.co.uk:
aquí no se crea ningún partido jugado ni se toca un marcador, y no se cambia
un árbitro que ya haya traído otra fuente. Solo cuentan los partidos de liga
regular: los playoffs de ascenso repiten emparejamientos de la liga.

Lo que ya no cambia (días de temporadas cerradas, árbitros encontrados) se
guarda en `data/espn_cache/`: el histórico son miles de peticiones, y así la
carga se puede cortar y retomar.
"""

import json
import logging
import time
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy.orm import Session

from app.core.config import PROJECT_ROOT
from app.db.models import IngestionRun, IngestionStatus, League, Match, MatchStatus, Season
from app.ingestion.fixtures_backfill import referee_short_name
from app.ingestion.football_data_client import LEAGUE_CODE_MAP
from app.ingestion.matchdays import refresh_estimated_matchdays
from app.ingestion.soccerdata_client import LEAGUE_DICT
from app.ingestion.team_names import TeamResolver, normalize

logger = logging.getLogger(__name__)

ESPN_API = "https://site.api.espn.com/apis/site/v2/sports/soccer"
CACHE_DIR = PROJECT_ROOT / "data" / "espn_cache"
MADRID = ZoneInfo("Europe/Madrid")

_PAUSE_SECONDS = 0.25
_RETRY_WAITS = (2, 10, 30)
# La fase de la liga regular se llama "regular-season" o "2022-23-laliga",
# según la temporada; los playoffs, "promotion-semifinals", "promotion-finals"...
_PLAYOFF_WORDS = ("promotion", "relegation", "playoff")
# El marcador de un día trae el calendario de su temporada: un día de octubre
# cae siempre dentro (el de julio puede devolver la temporada anterior).
_SEASON_ANCHOR = "1015"
# Un partido terminado de ESPN y el nuestro son el mismo si están a menos de
# esto (aplazamientos aparte, la fecha coincide).
_MAX_DATE_GAP = timedelta(days=3)


def espn_code(league_code: str) -> str | None:
    return LEAGUE_DICT.get(league_code, {}).get("ESPN")


def season_start_year(season_name: str) -> int:
    """"2627" -> 2026."""
    return 2000 + int(season_name[:2])


def _season_name(start_year: int) -> str:
    return f"{start_year % 100:02d}{(start_year + 1) % 100:02d}"


def _parse_utc(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).replace(tzinfo=None)


@dataclass(frozen=True)
class EspnEvent:
    id: str
    kickoff: str  # ISO UTC, como lo da ESPN
    time_known: bool
    home_names: tuple[str, ...]
    away_names: tuple[str, ...]
    completed: bool
    stage: str = ""

    @property
    def is_league_match(self) -> bool:
        return not any(word in self.stage for word in _PLAYOFF_WORDS)

    @property
    def kickoff_utc(self) -> datetime:
        return _parse_utc(self.kickoff)

    @property
    def stored_kickoff(self) -> datetime:
        """La fecha a guardar: la hora real, o el día (en Madrid) a las 00:00
        si aún no está fijada."""
        if self.time_known:
            return self.kickoff_utc
        local_day = self.kickoff_utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(MADRID).date()
        return datetime.combine(local_day, datetime.min.time())


def _team_names(team: dict) -> tuple[str, ...]:
    names = [team.get("displayName"), team.get("shortDisplayName"), team.get("name")]
    return tuple(dict.fromkeys(n for n in names if n))


def _parse_event(raw: dict) -> EspnEvent:
    competition = raw["competitions"][0]
    teams = {c["homeAway"]: c["team"] for c in competition["competitors"]}
    return EspnEvent(
        id=str(raw["id"]),
        kickoff=raw["date"],
        time_known=bool(competition.get("timeValid", True)),
        home_names=_team_names(teams["home"]),
        away_names=_team_names(teams["away"]),
        completed=bool(raw["status"]["type"].get("completed")),
        stage=raw.get("season", {}).get("slug") or "",
    )


class _JsonLinesCache:
    """Diccionario clave -> valor que se va añadiendo a un fichero .jsonl."""

    def __init__(self, path: Path):
        self._path = path
        self._data: dict[str, object] = {}
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    row = json.loads(line)
                    self._data[row["key"]] = row["value"]

    def __contains__(self, key: str) -> bool:
        return key in self._data

    def get(self, key: str) -> object:
        return self._data[key]

    def put(self, key: str, value: object) -> None:
        self._data[key] = value
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._path.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"key": key, "value": value}, ensure_ascii=False) + "\n")


class EspnClient:
    def __init__(self, cache_dir: Path = CACHE_DIR):
        self._http = httpx.Client(timeout=30, follow_redirects=True)
        self._cache_dir = cache_dir
        self._caches: dict[str, _JsonLinesCache] = {}
        self._last_request = 0.0
        self.requests = 0

    def __enter__(self) -> "EspnClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self._http.close()

    def _cache(self, name: str) -> _JsonLinesCache:
        if name not in self._caches:
            self._caches[name] = _JsonLinesCache(self._cache_dir / f"{name}.jsonl")
        return self._caches[name]

    def _get(self, path: str, params: dict[str, str]) -> dict:
        error: Exception | None = None
        for wait in (*_RETRY_WAITS, None):
            pause = _PAUSE_SECONDS - (time.monotonic() - self._last_request)
            if pause > 0:
                time.sleep(pause)
            self._last_request = time.monotonic()
            self.requests += 1
            try:
                response = self._http.get(f"{ESPN_API}/{path}", params=params)
            except httpx.TransportError as exc:
                error = exc
            else:
                if response.status_code == 200:
                    return response.json()
                error = ConnectionError(f"ESPN respondió {response.status_code} a {response.url}")
                if response.status_code != 429 and response.status_code < 500:
                    raise error
            if wait is None:
                break
            logger.warning("%s; reintento en %ss", error, wait)
            time.sleep(wait)
        raise ConnectionError(str(error))

    def season_days(self, league: str, start_year: int) -> list[date]:
        """Los días con partido de la temporada, según ESPN."""
        data = self._get(f"{league}/scoreboard", {"dates": f"{start_year}{_SEASON_ANCHOR}"})
        info = data["leagues"][0]
        if info["season"]["year"] != start_year:
            raise ValueError(f"ESPN {league}: pedida la temporada {start_year}, llega la {info['season']['year']}")
        return sorted({_parse_utc(day).date() for day in info.get("calendar", [])})

    def day_events(self, league: str, day: date, cacheable: bool) -> list[EspnEvent]:
        """Los partidos de liga regular de ese día. `cacheable`: el día ya no
        va a cambiar (temporada cerrada). Se guardan todos, playoffs incluidos,
        para que la caché no dependa de este filtro."""
        cache, key = self._cache(f"days_{league}"), day.isoformat()
        if key in cache:
            events = [
                EspnEvent(**{**e, "home_names": tuple(e["home_names"]), "away_names": tuple(e["away_names"])})
                for e in cache.get(key)
            ]
        else:
            data = self._get(f"{league}/scoreboard", {"dates": day.strftime("%Y%m%d")})
            events = [_parse_event(raw) for raw in data.get("events", [])]
            if cacheable:
                cache.put(key, [asdict(e) for e in events])
        return [e for e in events if e.is_league_match]

    def referee(self, league: str, event_id: str, cacheable: bool) -> str | None:
        """Nombre completo del árbitro principal, o None si ESPN no lo da.
        `cacheable`: si no lo da, ya no lo va a dar (temporada cerrada). Uno
        encontrado se guarda siempre."""
        cache = self._cache(f"referees_{league}")
        if event_id in cache:
            return cache.get(event_id)
        data = self._get(f"{league}/summary", {"event": event_id})
        officials = sorted(data.get("gameInfo", {}).get("officials") or [], key=lambda o: o.get("order", 99))
        name = next((o.get("displayName") or o.get("fullName") for o in officials if o.get("displayName") or o.get("fullName")), None)
        if name or cacheable:
            cache.put(event_id, name)
        return name


_PARTICLES = {"de", "del", "la", "las", "los", "y", "i"}


def _referee_tokens(name: str) -> tuple[str, list[str]]:
    """"R de Burgos Bengoetxea" -> ("r", ["burgos", "bengoetxea"])."""
    words = normalize(name).split()
    return (words[0][:1] if words else ""), [w for w in words[1:] if w not in _PARTICLES]


def _contains(longer: list[str], shorter: list[str]) -> bool:
    n = len(shorter)
    return 0 < n <= len(longer) and any(longer[i : i + n] == shorter for i in range(len(longer) - n + 1))


class RefereeNames:
    """Pone el nombre de ESPN en el formato de los que ya hay en las ligas del
    país ("Ricardo De Burgos Bengoetxea" -> "R de Burgos"), para que un árbitro
    no quede partido en dos, ni entre fuentes ni entre LaLiga y la Hypermotion.
    Es el mismo si coincide la inicial y los apellidos de uno van seguidos
    dentro de los del otro; si encaja con más de uno, se deja el de ESPN."""

    def __init__(self, existing: set[str]):
        self._known = set(existing)
        self._resolved: dict[str, str] = {}

    def canonical(self, full_name: str) -> str:
        if full_name in self._resolved:
            return self._resolved[full_name]
        short = referee_short_name(full_name)
        initial, tokens = _referee_tokens(short)
        candidates = set()
        for known in self._known:
            known_initial, known_tokens = _referee_tokens(known)
            if known_initial == initial and (_contains(tokens, known_tokens) or _contains(known_tokens, tokens)):
                candidates.add(known)
        name = candidates.pop() if len(candidates) == 1 else short
        self._known.add(name)
        self._resolved[full_name] = name
        return name


def _resolve(resolver: TeamResolver, names: tuple[str, ...]):
    for name in names:
        team = resolver.resolve(name)
        if team is not None:
            return team
    return None


def sync_espn(
    db: Session,
    leagues: list[str],
    seasons: list[str],
    current_season: str,
    now: datetime | None = None,
    referee_ahead: timedelta = timedelta(days=4),
) -> IngestionRun:
    """Árbitros que faltan en `seasons` y, en la temporada en curso de las ligas
    sin football-data.org, su calendario.

    Solo se piden a ESPN los días que hacen falta: los de partidos sin árbitro
    (ya jugados, o por jugar en los próximos `referee_ahead`) y, para el
    calendario, los que quedan de temporada."""
    now = now or datetime.utcnow()
    run = IngestionRun(source="espn.sync", status=IngestionStatus.RUNNING)
    db.add(run)
    db.commit()

    counts: dict[str, int] = defaultdict(int)
    unresolved: set[str] = set()
    names_by_country: dict[str, RefereeNames] = {}
    try:
        resolver = TeamResolver(db)
        with EspnClient() as client:
            for league_code in leagues:
                code = espn_code(league_code)
                league = db.query(League).filter_by(code=league_code).one_or_none()
                if code is None or league is None:
                    continue
                country = league_code.split("-")[0]
                if country not in names_by_country:
                    existing = {
                        r
                        for (r,) in db.query(Match.referee)
                        .join(League, League.id == Match.league_id)
                        .filter(League.code.like(f"{country}-%"), Match.referee.isnot(None))
                        .distinct()
                    }
                    names_by_country[country] = RefereeNames(existing)
                referees = names_by_country[country]

                for season_name in seasons:
                    season = db.query(Season).filter_by(league_id=league.id, name=season_name).one_or_none()
                    if season is None:
                        continue
                    is_current = season_name == current_season
                    builds_calendar = is_current and league_code not in LEAGUE_CODE_MAP
                    matches = db.query(Match).filter(Match.season_id == season.id).all()
                    by_teams = {(m.home_team_id, m.away_team_id): m for m in matches}

                    def needs_referee(m: Match) -> bool:
                        if m.referee is not None:
                            return False
                        return m.status == MatchStatus.HISTORICAL or now <= m.date <= now + referee_ahead

                    days = {m.date.date() for m in matches if needs_referee(m)}
                    if builds_calendar:
                        start_year = season_start_year(season_name)
                        days |= {d for d in client.season_days(code, start_year) if d >= now.date() - timedelta(days=3)}
                    if not days:
                        continue

                    for day in sorted(days):
                        for event in client.day_events(code, day, cacheable=not is_current):
                            home = _resolve(resolver, event.home_names)
                            away = _resolve(resolver, event.away_names)
                            if home is None or away is None:
                                unresolved.update(event.home_names[:1] if home is None else ())
                                unresolved.update(event.away_names[:1] if away is None else ())
                                continue
                            match = by_teams.get((home.id, away.id))

                            if match is None:
                                if builds_calendar and not event.completed:
                                    match = Match(
                                        league_id=league.id,
                                        season_id=season.id,
                                        home_team_id=home.id,
                                        away_team_id=away.id,
                                        date=event.stored_kickoff,
                                        status=MatchStatus.SCHEDULED,
                                        source_ids={"espn_event_id": event.id},
                                    )
                                    db.add(match)
                                    by_teams[(home.id, away.id)] = match
                                    counts["creados"] += 1
                                continue

                            if match.status == MatchStatus.HISTORICAL and abs(match.date - event.kickoff_utc) > _MAX_DATE_GAP:
                                counts["fecha_distinta"] += 1
                                continue
                            if (match.source_ids or {}).get("espn_event_id") != event.id:
                                match.source_ids = {**(match.source_ids or {}), "espn_event_id": event.id}

                            if builds_calendar and match.status == MatchStatus.SCHEDULED:
                                # Una hora provisional de ESPN no pisa una ya fijada
                                # (la del fixtures.csv, por ejemplo).
                                time_unknown = match.date.time() == datetime.min.time()
                                if (event.time_known or time_unknown) and match.date != event.stored_kickoff:
                                    match.date = event.stored_kickoff
                                    counts["fechas_cambiadas"] += 1

                            if needs_referee(match):
                                name = client.referee(code, event.id, cacheable=event.completed and not is_current)
                                if name:
                                    match.referee = referees.canonical(name)
                                    counts["arbitros"] += 1
                                else:
                                    counts["sin_arbitro_en_espn"] += 1
                    db.commit()
                    logger.info("ESPN %s %s: %s (peticiones=%d)", league_code, season_name, dict(counts), client.requests)

            if counts["creados"] or counts["fechas_cambiadas"]:
                refresh_estimated_matchdays(db)
            counts["peticiones"] = client.requests

        db.commit()
        run.status = IngestionStatus.SUCCESS
        run.rows_ingested = counts["arbitros"] + counts["creados"]
        notes = " ".join(f"{k}={v}" for k, v in counts.items())
        if unresolved:
            notes += f" equipos_sin_resolver={sorted(unresolved)}"
        run.notes = notes[:2000]
        run.finished_at = datetime.utcnow()
        db.commit()
        logger.info("ESPN: %s", run.notes)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        run.status = IngestionStatus.FAILED
        run.notes = str(exc)[:2000]
        run.finished_at = datetime.utcnow()
        db.commit()
        raise

    return run
