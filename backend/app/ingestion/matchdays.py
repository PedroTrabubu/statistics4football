"""Jornada de cada partido.

- **Exacta:** la de football-data.org, en las ligas y temporadas de su plan
  gratuito (Premier, LaLiga y Ligue 1 desde la 23/24).
- **Deducida de las fechas** en el resto (LaLiga Hypermotion y temporadas
  anteriores), marcada con `matchday_estimated`:
  1. Los partidos se agrupan en bloques de fin de semana (viernes a lunes) o
     entre semana (martes a jueves), en hora de Madrid.
  2. Dos bloques seguidos sin equipos en común que juntos caben en una jornada
     son la misma, partida entre fin de semana y entre semana.
  3. Los bloques con al menos media jornada son jornadas, numeradas en orden.
     Si un equipo sale dos veces en un bloque, cuenta el partido más cercano a
     su fecha central.
  4. Cada partido suelto (aplazado o adelantado) va a la jornada que les falte
     a los dos equipos con la fecha central más cercana.

  Comparada con las jornadas exactas de football-data.org (Premier, LaLiga y
  Ligue 1, de 23/24 a 26/27), acierta el 98.1% de 4.264 partidos, y el 100%
  en 10 de las 12 temporadas. Falla cuando la liga juega dos jornadas en orden
  inverso (LaLiga 25/26: 95%) o aplaza media jornada (Premier 23/24, jornada 29
  por la FA Cup: 84%). En la temporada en curso, un partido adelantado a una
  jornada futura queda en la siguiente hasta que se juega esa jornada; por eso
  las deducidas se recalculan en cada ingesta.
"""

import logging
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import League, Match, Season
from app.ingestion.football_data_client import LEAGUE_CODE_MAP, FootballDataClient
from app.ingestion.team_names import TeamResolver

logger = logging.getLogger(__name__)

MADRID = ZoneInfo("Europe/Madrid")
UTC = ZoneInfo("UTC")
FIRST_SEASON_START_YEAR = 2020
# El plan gratuito permite 10 peticiones por minuto.
REQUEST_PAUSE_SECONDS = 7


def _slot(kickoff_utc: datetime) -> tuple[date, str]:
    local = kickoff_utc.replace(tzinfo=UTC).astimezone(MADRID)
    weekday = local.weekday()  # lunes = 0
    if weekday in (1, 2, 3):
        return (local - timedelta(days=weekday - 1)).date(), "entre_semana"
    days_since_friday = {4: 0, 5: 1, 6: 2, 0: 3}[weekday]
    return (local - timedelta(days=days_since_friday)).date(), "fin_de_semana"


def _teams(matches: list[Match]) -> set[int]:
    return {team for m in matches for team in (m.home_team_id, m.away_team_id)}


def _fill_free_rounds(
    matches: list[Match],
    assigned: dict[int, int],
    total_rounds: int,
    centers: dict[int, datetime] | None = None,
) -> None:
    """Los partidos sin jornada van a una que les falte a los dos equipos: la de
    fecha más cercana (`centers`, la mediana de cada jornada) o, sin fechas, la
    primera. Se colocan primero los que tienen menos opciones.

    Si no les falta ninguna en común (a uno le falta la a y al otro la b),
    se intercambian a y b en la cadena de partidos que sale del segundo equipo
    (cadena de Kempe): así le queda libre la a sin que ningún equipo juegue dos
    veces en una jornada. Si tampoco así, el partido va a la primera jornada que
    le falte al local."""
    centers = centers or {}
    by_id = {m.id: m for m in matches}
    slot: dict[int, dict[int, int]] = defaultdict(dict)  # equipo -> jornada -> partido
    for match_id, r in assigned.items():
        m = by_id[match_id]
        slot[m.home_team_id][r] = match_id
        slot[m.away_team_id][r] = match_id

    def free(team: int) -> list[int]:
        return [r for r in range(1, total_rounds + 1) if r not in slot[team]]

    def place(m: Match, r: int) -> None:
        assigned[m.id] = r
        slot[m.home_team_id][r] = m.id
        slot[m.away_team_id][r] = m.id

    def kempe(start: int, avoid: int, a: int, b: int) -> bool:
        path, team, color = [], start, a
        while color in slot[team]:
            match = by_id[slot[team][color]]
            path.append(match)
            team = match.away_team_id if match.home_team_id == team else match.home_team_id
            if team == avoid:
                return False
            color = b if color == a else a
        for match in path:
            old = assigned[match.id]
            del slot[match.home_team_id][old], slot[match.away_team_id][old]
        for match in path:
            place(match, b if assigned[match.id] == a else a)
        return True

    def common_free(m: Match) -> list[int]:
        away_free = free(m.away_team_id)
        return [r for r in free(m.home_team_id) if r in away_free]

    def closeness(m: Match, r: int) -> tuple:
        return (abs(m.date - centers[r]), r) if r in centers else (timedelta.max, r)

    pending = [m for m in matches if m.id not in assigned]
    while pending:
        options = {m.id: common_free(m) for m in pending}
        placeable = [m for m in pending if options[m.id]]
        if not placeable:
            break
        m = min(placeable, key=lambda m: (len(options[m.id]), m.date, m.id))
        place(m, min(options[m.id], key=lambda r: closeness(m, r)))
        pending.remove(m)

    for m in sorted(pending, key=lambda m: (m.date, m.id)):
        home_free, away_free = free(m.home_team_id), free(m.away_team_id)
        common = [r for r in home_free if r in away_free]
        if common:
            place(m, min(common, key=lambda r: closeness(m, r)))
            continue
        swapped = next(
            (a for a in home_free for b in away_free if kempe(m.away_team_id, m.home_team_id, a, b)),
            None,
        )
        if swapped is not None:
            place(m, swapped)
        elif home_free:
            assigned[m.id] = home_free[0]


def _median(values: list[datetime]) -> datetime:
    ordered = sorted(values)
    return ordered[len(ordered) // 2]


def derive_matchdays(matches: list[Match], exact: dict[int, int] | None = None) -> dict[int, int]:
    """{match_id: jornada} de una temporada de una liga. Con `exact`, solo se
    completan los partidos que faltan, respetando esas jornadas."""
    if not matches:
        return {}
    per_round = len(_teams(matches)) // 2
    total_rounds = 2 * (len(_teams(matches)) - 1)
    if exact:
        assigned = dict(exact)
        _fill_free_rounds(matches, assigned, max(total_rounds, *assigned.values()))
        return assigned

    slots: dict[tuple[date, str], list[Match]] = defaultdict(list)
    for m in matches:
        slots[_slot(m.date)].append(m)
    blocks: list[list[Match]] = []
    for key in sorted(slots):
        block = slots[key]
        if blocks and not _teams(blocks[-1]) & _teams(block) and len(blocks[-1]) + len(block) <= per_round:
            blocks[-1] = blocks[-1] + block
        else:
            blocks.append(block)
    rounds = [block for block in blocks if 2 * len(block) >= per_round]

    assigned: dict[int, int] = {}
    centers: dict[int, datetime] = {}
    for number, block in enumerate(rounds, start=1):
        center = centers[number] = _median([m.date for m in block])
        seen: set[int] = set()
        # Un equipo dos veces en el bloque: cuenta el partido más cercano al
        # centro del bloque, y el otro queda suelto.
        for m in sorted(block, key=lambda m: abs(m.date - center)):
            if m.home_team_id in seen or m.away_team_id in seen:
                continue
            seen |= {m.home_team_id, m.away_team_id}
            assigned[m.id] = number
    _fill_free_rounds(matches, assigned, max(total_rounds, len(rounds)), centers)
    return assigned


def refresh_estimated_matchdays(db: Session) -> int:
    """Recalcula las jornadas deducidas de todas las temporadas. Devuelve
    cuántos partidos han cambiado de jornada."""
    changed = 0
    for season in db.query(Season):
        matches = db.query(Match).filter(Match.season_id == season.id).all()
        exact = {m.id: m.matchday for m in matches if m.matchday is not None and not m.matchday_estimated}
        if len(exact) == len(matches):
            continue
        derived = derive_matchdays(matches, exact or None)
        for m in matches:
            if m.id in exact:
                continue
            matchday = derived.get(m.id)
            if m.matchday != matchday or not m.matchday_estimated:
                m.matchday = matchday
                m.matchday_estimated = True
                changed += 1
    db.flush()
    return changed


def _season_name(start_year: int) -> str:
    return f"{start_year % 100:02d}{(start_year + 1) % 100:02d}"


def backfill_exact_matchdays(db: Session, settings: Settings, leagues: list[str], current_start_year: int) -> dict:
    """Jornadas exactas de football-data.org para las temporadas pasadas que da
    su plan gratuito (la temporada en curso ya la trae `sync_current_season_matches`).
    No crea partidos ni equipos: solo rellena la jornada de los que ya existen."""
    resolver = TeamResolver(db)
    summary: dict[str, dict] = {}
    with FootballDataClient(settings) as client:
        first_request = True
        for code in leagues:
            competition = LEAGUE_CODE_MAP.get(code)
            league = db.query(League).filter_by(code=code).one_or_none()
            if competition is None or league is None:
                continue
            for start_year in range(FIRST_SEASON_START_YEAR, current_start_year):
                if not first_request:
                    time.sleep(REQUEST_PAUSE_SECONDS)
                first_request = False
                season_name = _season_name(start_year)
                try:
                    rows = client.get_season_matches(competition, start_year)
                except httpx.HTTPStatusError as exc:
                    summary[f"{code} {season_name}"] = {"error": exc.response.status_code}
                    continue
                season = db.query(Season).filter_by(league_id=league.id, name=season_name).one_or_none()
                by_teams = {
                    (m.home_team_id, m.away_team_id): m
                    for m in db.query(Match).filter(Match.season_id == (season.id if season else -1))
                }
                updated = missing = 0
                for row in rows:
                    home = resolver.resolve(row["homeTeam"]["name"])
                    away = resolver.resolve(row["awayTeam"]["name"])
                    match = by_teams.get((home.id, away.id)) if home and away else None
                    if match is None or row.get("matchday") is None:
                        missing += 1
                        continue
                    match.matchday = row["matchday"]
                    match.matchday_estimated = False
                    updated += 1
                db.commit()
                summary[f"{code} {season_name}"] = {"con_jornada": updated, "sin_partido": missing}
    summary["equipos_no_resueltos"] = sorted(resolver.unresolved)
    return summary
