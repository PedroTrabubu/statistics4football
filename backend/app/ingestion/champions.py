"""Champions League desde ESPN: calendario, resultados, estadísticas y árbitro.

Football-Data.co.uk (resultados, estadísticas y cuotas de las demás ligas) no
cubre la Champions, así que aquí ESPN es la única fuente: crea los partidos,
pone el marcador y rellena córners, tarjetas, faltas, tiros y árbitro (el
resumen de cada partido). No hay cuotas de mercado ("Market Average"/"Max").

Diferencias con una liga:
- Los equipos vienen de ligas distintas. Los que ya están en la base (los de
  nuestras ligas) son el mismo equipo; los demás se crean con la Champions
  como liga.
- Fase de liga (jornadas 1-8) y eliminatorias. Cada partido de una
  eliminatoria a doble partido es un partido independiente; las eliminatorias
  siguen la numeración de jornadas: playoff 9-10, octavos 11-12, cuartos
  13-14, semifinales 15-16 y final 17. La fase y la ida/vuelta quedan en
  source_ids ("stage", "leg").
- El marcador guardado es el de los 90 minutos (las dos partes), como en las
  ligas: la prórroga y los penaltis no cuentan para los mercados. Las
  estadísticas de ESPN sí incluyen la prórroga.
- Un partido se identifica por su id de ESPN, no por local y visitante: dos
  equipos pueden repetir cruce en la misma temporada (fase de liga y
  eliminatoria).

El calendario de ESPN para la Champions va por fases, no por días, y su
marcador no acepta rangos: se pide día a día dentro de cada fase. Los días
cerrados y los resúmenes de partidos terminados se guardan en data/espn_cache/.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from app.core.competitions import CHAMPIONS_LEAGUE, CHAMPIONS_LEAGUE_PHASE_MATCHDAYS
from app.db.models import IngestionRun, IngestionStatus, League, Match, MatchStatus, Season, Team
from app.ingestion.espn import EspnClient, RefereeNames, _parse_utc, _resolve, _team_names, season_start_year
from app.ingestion.espn_stats import parse_boxscore
from app.ingestion.historical_backfill import _upsert_team_match_stats
from app.ingestion.team_names import TeamResolver

logger = logging.getLogger(__name__)

LEAGUE_CODE = CHAMPIONS_LEAGUE
LEAGUE_NAME = "Champions League"
ESPN_LEAGUE = "uefa.champions"
LEAGUE_PHASE = "league-phase"
LEAGUE_PHASE_MATCHDAYS = CHAMPIONS_LEAGUE_PHASE_MATCHDAYS
# Jornada de la ida de cada eliminatoria (la vuelta, la siguiente). La final es a partido único.
KNOCKOUT_MATCHDAY = {
    "knockout-round-playoffs": 9,
    "round-of-16": 11,
    "quarterfinals": 13,
    "semifinals": 15,
    "final": 17,
}
# Un día cerrado (todos sus partidos terminados hace días) ya no cambia; los
# demás se vuelven a pedir pasado este tiempo.
_DAY_REFRESH = timedelta(hours=20)
_CLOSED_AFTER = timedelta(days=2)


def parse_event(raw: dict) -> dict:
    """Lo que hace falta de un partido del marcador de ESPN."""
    competition = raw["competitions"][0]
    sides = {}
    for c in competition["competitors"]:
        score = c.get("score")
        sides[c["homeAway"]] = {
            "names": list(_team_names(c["team"])),
            "score": int(score) if score not in (None, "") else None,
            "shootout": c.get("shootoutScore"),
        }
    status = raw["status"]["type"]
    return {
        "id": str(raw["id"]),
        "date": raw["date"],
        "time_valid": bool(competition.get("timeValid", True)),
        "stage": raw.get("season", {}).get("slug") or "",
        "leg": (competition.get("leg") or {}).get("value"),
        "status": status.get("name", ""),
        "completed": bool(status.get("completed")),
        "home": sides["home"],
        "away": sides["away"],
    }


def parse_summary(summary: dict) -> dict:
    """Goles por parte (1ª, 2ª y, si hubo, prórroga), árbitro y estadísticas del resumen de ESPN."""
    lines: dict[str, list[int]] = {}
    for c in (summary.get("header", {}).get("competitions") or [{}])[0].get("competitors") or []:
        try:
            lines[c["homeAway"]] = [int(float(ls.get("displayValue", ls.get("value")))) for ls in c.get("linescores") or []]
        except (TypeError, ValueError):
            lines[c["homeAway"]] = []
    officials = sorted(summary.get("gameInfo", {}).get("officials") or [], key=lambda o: o.get("order", 99))
    referee = next((o.get("displayName") or o.get("fullName") for o in officials if o.get("displayName") or o.get("fullName")), None)
    return {"lines": lines, "referee": referee, "box": parse_boxscore(summary)}


def ninety_minutes(event: dict, lines: dict[str, list[int]]) -> tuple[int | None, int | None, int | None, int | None]:
    """(goles local, goles visitante, al descanso local, al descanso visitante)
    a los 90 minutos. Las partes de ESPN solo valen si cuadran con el marcador
    (sin prórroga, suman lo mismo; con prórroga, no más). Si no (visto en la
    final 25/26: partes 0+2 con 1 gol), el marcador de ESPN y sin descanso."""
    home, away = lines.get("home") or [], lines.get("away") or []
    score = (event["home"]["score"], event["away"]["score"])
    if len(home) >= 2 and len(away) >= 2 and min(home[:2] + away[:2]) >= 0 and None not in score:
        regular = (sum(home[:2]), sum(away[:2]))
        extra_time = event["status"] != "STATUS_FULL_TIME"
        if regular == score or (extra_time and regular[0] <= score[0] and regular[1] <= score[1]):
            return regular[0], regular[1], home[0], away[0]
    return score[0], score[1], None, None


def matchday_of(stage: str, leg: int | None) -> int | None:
    """Jornada de un partido de eliminatoria; None en la fase de liga (se numera aparte)."""
    first = KNOCKOUT_MATCHDAY.get(stage)
    if first is None:
        return None
    return first + (leg - 1 if leg in (1, 2) and stage != "final" else 0)


def league_phase_matchdays(matches: list[Match]) -> dict[int, int]:
    """Jornada (1-8) de los partidos de la fase de liga: cada equipo juega uno
    por jornada, así que la de un partido es la siguiente de sus dos equipos."""
    played: dict[int, int] = defaultdict(int)
    out: dict[int, int] = {}
    for m in sorted(matches, key=lambda m: (m.date, m.id or 0)):
        n = max(played[m.home_team_id], played[m.away_team_id]) + 1
        played[m.home_team_id] = played[m.away_team_id] = n
        out[m.id] = min(n, LEAGUE_PHASE_MATCHDAYS)
    return out


def _season_days(client: EspnClient, start_year: int) -> list[date]:
    """Días de las fases de la temporada (el calendario de ESPN da su inicio y su fin)."""
    data = client._get(f"{ESPN_LEAGUE}/scoreboard", {"dates": f"{start_year}1015"})
    info = data["leagues"][0]
    if info["season"]["year"] != start_year:
        raise ValueError(f"ESPN Champions: pedida la temporada {start_year}, llega la {info['season']['year']}")
    days: set[date] = set()
    for block in info.get("calendar") or []:
        for entry in block.get("entries") or []:
            day, end = _parse_utc(entry["startDate"]).date(), _parse_utc(entry["endDate"]).date()
            while day <= end:
                days.add(day)
                day += timedelta(days=1)
    return sorted(days)


def _day_events(client: EspnClient, day: date, now: datetime) -> list[dict]:
    cache, key = client._cache(f"days_{ESPN_LEAGUE}"), day.isoformat()
    if key in cache:
        cached = cache.get(key)
        if cached.get("closed") or now - datetime.fromisoformat(cached["fetched"]) < _DAY_REFRESH:
            return cached["events"]
    data = client._get(f"{ESPN_LEAGUE}/scoreboard", {"dates": day.strftime("%Y%m%d")})
    events = [parse_event(raw) for raw in data.get("events", [])]
    closed = day < (now - _CLOSED_AFTER).date() and all(e["completed"] for e in events)
    cache.put(key, {"fetched": now.isoformat(timespec="seconds"), "closed": closed, "events": events})
    return events


def _summary(client: EspnClient, event_id: str) -> dict:
    """Resumen de un partido terminado. Se guarda en cuanto trae estadísticas."""
    cache = client._cache(f"summaries_{ESPN_LEAGUE}")
    if event_id in cache:
        return cache.get(event_id)
    summary = parse_summary(client._get(f"{ESPN_LEAGUE}/summary", {"event": event_id}))
    if summary["box"] is not None:
        cache.put(event_id, summary)
    return summary


def _stored_kickoff(event: dict) -> datetime:
    kickoff = _parse_utc(event["date"])
    return kickoff if event["time_valid"] else datetime.combine(kickoff.date(), datetime.min.time())


def _get_or_create_league(db: Session) -> League:
    league = db.query(League).filter_by(code=LEAGUE_CODE).one_or_none()
    if league is None:
        league = League(code=LEAGUE_CODE, name=LEAGUE_NAME, country="Europa")
        db.add(league)
        db.flush()
    return league


def _get_or_create_season(db: Session, league: League, name: str) -> Season:
    season = db.query(Season).filter_by(league_id=league.id, name=name).one_or_none()
    if season is None:
        season = Season(league_id=league.id, name=name)
        db.add(season)
        db.flush()
    return season


def sync_champions(db: Session, seasons: list[str], now: datetime | None = None) -> IngestionRun:
    """Calendario, resultados, estadísticas y árbitros de la Champions en `seasons` ("2526")."""
    now = now or datetime.utcnow()
    run = IngestionRun(source="espn.champions", status=IngestionStatus.RUNNING)
    db.add(run)
    db.commit()

    counts: dict[str, int] = defaultdict(int)
    new_teams: set[str] = set()
    try:
        league = _get_or_create_league(db)
        resolver = TeamResolver(db)
        created: dict[str, Team] = {}
        # Con los árbitros de todas las ligas: uno de LaLiga en Champions sale con el mismo nombre.
        referees = RefereeNames({r for (r,) in db.query(Match.referee).filter(Match.referee.isnot(None)).distinct()})

        def team_for(names: list[str]) -> Team:
            team = _resolve(resolver, tuple(names)) or created.get(names[0])
            if team is None:
                # Equipo de otra liga: se crea con la Champions como liga.
                team = Team(name=names[0], league_id=league.id)
                db.add(team)
                db.flush()
                created[names[0]] = team
                new_teams.add(names[0])
            return team

        with EspnClient() as client:
            for season_name in seasons:
                season = _get_or_create_season(db, league, season_name)
                matches = db.query(Match).filter(Match.season_id == season.id).all()
                by_event = {(m.source_ids or {}).get("espn_event_id"): m for m in matches}

                for day in _season_days(client, season_start_year(season_name)):
                    for event in _day_events(client, day, now):
                        home, away = team_for(event["home"]["names"]), team_for(event["away"]["names"])
                        match = by_event.get(event["id"])
                        if match is None:
                            match = Match(league_id=league.id, season_id=season.id, home_team_id=home.id, away_team_id=away.id)
                            db.add(match)
                            by_event[event["id"]] = match
                            counts["creados"] += 1
                        match.home_team_id, match.away_team_id = home.id, away.id
                        match.date = _stored_kickoff(event)
                        match.source_ids = {"espn_event_id": event["id"], "stage": event["stage"], "leg": event["leg"]}
                        match.matchday = matchday_of(event["stage"], event["leg"])
                        match.matchday_estimated = False
                        if not event["completed"]:
                            match.status = MatchStatus.SCHEDULED
                            continue
                        if match.status != MatchStatus.HISTORICAL:
                            counts["resultados"] += 1
                        match.status = MatchStatus.HISTORICAL

                        summary = _summary(client, event["id"])
                        match.home_goals, match.away_goals, match.home_ht_goals, match.away_ht_goals = ninety_minutes(
                            event, summary["lines"]
                        )
                        if match.home_ht_goals is None:
                            counts["sin_partes"] += 1
                        if summary["referee"]:
                            match.referee = referees.canonical(summary["referee"])
                        box = summary["box"]
                        if box:
                            db.flush()
                            for side, team, other in (("home", home, "away"), ("away", away, "home")):
                                _upsert_team_match_stats(
                                    db,
                                    match.id,
                                    team.id,
                                    corners_against=box[other].get("corners_for"),
                                    **box[side],
                                )
                        else:
                            counts["sin_estadisticas"] += 1

                db.flush()
                phase = [m for m in by_event.values() if (m.source_ids or {}).get("stage") == LEAGUE_PHASE]
                phase_matchdays = league_phase_matchdays(phase)
                for m in phase:
                    m.matchday = phase_matchdays[m.id]
                db.commit()
                logger.info("Champions %s: %s (peticiones=%d)", season_name, dict(counts), client.requests)
            counts["peticiones"] = client.requests

        run.status = IngestionStatus.SUCCESS
        run.rows_ingested = counts["creados"] + counts["resultados"]
        notes = " ".join(f"{k}={v}" for k, v in counts.items())
        if new_teams:
            notes += f" equipos_nuevos={sorted(new_teams)}"
        run.notes = notes[:2000]
        run.finished_at = datetime.utcnow()
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        run.status = IngestionStatus.FAILED
        run.notes = str(exc)[:2000]
        run.finished_at = datetime.utcnow()
        db.commit()
        raise
    return run
