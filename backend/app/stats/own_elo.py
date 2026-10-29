"""Elo propio: el rating de cada equipo ANTES de cada partido, calculado con los
resultados de la BD. Es el Elo evaluado en
docs/EXPERIMENTO_ESTADISTICAS_1X2_PROTOCOLO.md; las reglas (fijas, ver
docs/ELO_PROPIO.md) no se cambian sin cambiar `VERSION`:

- K = 20 y ventaja local de 65 puntos; resultado 1 / 0,5 / 0, sin margen de goles.
- Solo ligas nacionales: la Champions no entra (mezcla ligas cuyos ratings no
  son comparables).
- Por dias naturales: todos los partidos de un dia salen con el rating del
  final del dia anterior y se actualizan juntos al acabar el dia.
- Continuidad entre temporadas: el rating sigue tal cual, sin regresion a la media.
- Primer partido de un equipo en la BD: arranca en el percentil 25 de los
  equipos de su liga (1500 si hay menos de 6, como en la primera temporada de
  la BD). Un equipo que cambia de liga dentro de la BD (LaLiga <-> LaLiga 2)
  conserva su rating.

El calculo es puro (`run_elo`); `generate_own_elo` lo persiste en
`own_elo_pre` y la ficha solo lee esa tabla (`match_elo`).
"""

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime
from itertools import groupby

import numpy as np
from sqlalchemy.orm import Session

from app.core.competitions import CHAMPIONS_LEAGUE
from app.db.models import IngestionRun, IngestionStatus, League, Match, MatchStatus, OwnEloPre, Season

K = 20.0
HOME_ADVANTAGE = 65.0
INITIAL_RATING = 1500.0
NEWCOMER_PERCENTILE = 25
MIN_TEAMS_FOR_PRIOR = 6
# Historial suficiente para mostrarlo: el umbral de muestra baja de la web
# (frontend/src/lib/sampleLevel.ts).
MIN_MATCHES = 10
VERSION = "elo_propio_k20_h65_v1"
REFRESH_SOURCE = "own_elo.refresh"

MISSING_CHAMPIONS = "champions"
MISSING_HISTORY = "insufficient_history"
MISSING_NOT_GENERATED = "not_generated"


@dataclass(frozen=True)
class EloMatch:
    match_id: int
    league: str
    date: datetime
    home_team_id: int
    away_team_id: int
    home_goals: int
    away_goals: int


@dataclass(frozen=True)
class PreMatchElo:
    elo: float
    matches_rated: int
    # Ultimo partido cuyo resultado entra en el rating ("calculado hasta").
    until: datetime | None = None


@dataclass
class EloState:
    ratings: dict[int, float] = field(default_factory=dict)
    league_of: dict[int, str] = field(default_factory=dict)
    matches_rated: dict[int, int] = field(default_factory=dict)
    last_played: datetime | None = None

    def starting_rating(self, league: str) -> float:
        same = [self.ratings[t] for t, lg in self.league_of.items() if lg == league]
        return float(np.percentile(same, NEWCOMER_PERCENTILE)) if len(same) >= MIN_TEAMS_FOR_PRIOR else INITIAL_RATING

    def enter(self, team_id: int, league: str) -> None:
        if team_id not in self.ratings:
            self.ratings[team_id] = self.starting_rating(league)
        self.league_of[team_id] = league

    def pre(self, team_id: int) -> PreMatchElo:
        return PreMatchElo(self.ratings[team_id], self.matches_rated.get(team_id, 0), self.last_played)


def expected_home_score(elo_home: float, elo_away: float) -> float:
    return 1 / (1 + 10 ** (-(elo_home + HOME_ADVANTAGE - elo_away) / 400))


def run_elo(played: Iterable[EloMatch]) -> tuple[dict[tuple[int, int], PreMatchElo], EloState]:
    """Rating previo de cada equipo en cada partido jugado, {(match_id, team_id): ...},
    y el estado tras el ultimo dia."""
    state = EloState()
    pre: dict[tuple[int, int], PreMatchElo] = {}
    ordered = sorted(played, key=lambda m: (m.date, m.match_id))
    for _day, group in groupby(ordered, key=lambda m: m.date.date()):
        day = list(group)
        for m in day:
            for team_id in (m.home_team_id, m.away_team_id):
                state.enter(team_id, m.league)
                pre[(m.match_id, team_id)] = state.pre(team_id)
        for m in day:
            score = 1.0 if m.home_goals > m.away_goals else 0.5 if m.home_goals == m.away_goals else 0.0
            delta = K * (score - expected_home_score(state.ratings[m.home_team_id], state.ratings[m.away_team_id]))
            state.ratings[m.home_team_id] += delta
            state.ratings[m.away_team_id] -= delta
            for team_id in (m.home_team_id, m.away_team_id):
                state.matches_rated[team_id] = state.matches_rated.get(team_id, 0) + 1
        state.last_played = day[-1].date
    return pre, state


# --- Persistencia --------------------------------------------------------------


@dataclass
class GenerationSummary:
    final_written: int = 0
    provisional_written: int = 0
    unchanged: int = 0
    # Filas finales que hoy saldrian distintas (un resultado anterior corregido
    # en la BD): se dejan como estaban, congeladas.
    discrepancies: int = 0


def _domestic_league_codes(db: Session) -> dict[int, str]:
    return {lg.id: lg.code for lg in db.query(League).filter(League.code != CHAMPIONS_LEAGUE)}


def generate_own_elo(db: Session, now: datetime | None = None) -> GenerationSummary:
    """Escribe lo que falta en `own_elo_pre`: filas finales de los partidos
    jugados que aun no la tienen (o la tenian provisional) y filas provisionales,
    con el rating actual, de los programados. Las finales ya escritas no se tocan."""
    now = now or datetime.utcnow()
    leagues = _domestic_league_codes(db)
    matches = db.query(Match).filter(Match.league_id.in_(leagues)).all()
    played = [
        EloMatch(m.id, leagues[m.league_id], m.date, m.home_team_id, m.away_team_id, m.home_goals, m.away_goals)
        for m in matches
        if m.status == MatchStatus.HISTORICAL and m.home_goals is not None and m.away_goals is not None
    ]
    pre, state = run_elo(played)

    provisional: dict[tuple[int, int], PreMatchElo] = {}
    for m in matches:
        if m.status != MatchStatus.SCHEDULED:
            continue
        for team_id in (m.home_team_id, m.away_team_id):
            known = team_id in state.ratings
            rating = state.ratings[team_id] if known else state.starting_rating(leagues[m.league_id])
            provisional[(m.id, team_id)] = PreMatchElo(rating, state.matches_rated.get(team_id, 0), state.last_played)

    existing = {(r.match_id, r.team_id): r for r in db.query(OwnEloPre)}
    summary = GenerationSummary()

    def write(key: tuple[int, int], value: PreMatchElo, is_final: bool) -> None:
        row = existing.get(key)
        if row is None:
            row = OwnEloPre(match_id=key[0], team_id=key[1])
            db.add(row)
        row.elo, row.matches_rated, row.is_final = value.elo, value.matches_rated, is_final
        row.computed_until = value.until
        row.version, row.generated_at = VERSION, now

    for key, value in pre.items():
        row = existing.get(key)
        if row is not None and row.is_final:
            same = abs(row.elo - value.elo) < 1e-6 and row.matches_rated == value.matches_rated
            summary.unchanged += same
            summary.discrepancies += not same
            if same and row.computed_until is None:  # filas anteriores a la columna: solo la fecha
                row.computed_until = value.until
            continue
        write(key, value, is_final=True)
        summary.final_written += 1

    for key, value in provisional.items():
        row = existing.get(key)
        if row is not None and row.is_final:
            continue
        write(key, value, is_final=False)
        summary.provisional_written += 1

    db.flush()
    return summary


def refresh_own_elo(db: Session) -> IngestionRun:
    """`generate_own_elo` con su registro en `ingestion_runs`. Si falla, deja
    el registro como fallido y relanza el error (el paso del programador sale
    con aviso)."""
    run = IngestionRun(source=REFRESH_SOURCE, status=IngestionStatus.RUNNING)
    db.add(run)
    db.commit()
    try:
        summary = generate_own_elo(db)
        run.status = IngestionStatus.SUCCESS
        run.rows_ingested = summary.final_written + summary.provisional_written
        run.notes = (
            f"{VERSION}: {summary.final_written} finales nuevas, {summary.provisional_written} provisionales, "
            f"{summary.unchanged} finales sin cambios, {summary.discrepancies} discrepancias"
        )
        run.finished_at = datetime.utcnow()
        db.commit()
    except Exception as exc:
        db.rollback()
        run = db.get(IngestionRun, run.id)
        run.status = IngestionStatus.FAILED
        run.notes = str(exc)[:2000]
        run.finished_at = datetime.utcnow()
        db.commit()
        raise
    return run


# --- Lectura (ficha y liga/temporada) -----------------------------------------


@dataclass
class EloSide:
    elo: float | None  # rating previo al partido; None cuando se muestra "—"
    matches_rated: int | None  # None: sin fila
    missing: str | None  # motivo del "—"


@dataclass
class MatchElo:
    match_id: int
    min_matches: int
    home: EloSide
    away: EloSide
    computed_until: datetime | None  # ultimo resultado incluido ("Elo calculado hasta")


def _side(row: OwnEloPre | None, champions: bool) -> EloSide:
    if champions:
        return EloSide(None, None, MISSING_CHAMPIONS)
    if row is None:
        return EloSide(None, None, MISSING_NOT_GENERATED)
    if row.matches_rated < MIN_MATCHES:
        return EloSide(None, row.matches_rated, MISSING_HISTORY)
    return EloSide(row.elo, row.matches_rated, None)


def _build(match: Match, champions: bool, rows: dict[int, OwnEloPre]) -> MatchElo:
    until = [r.computed_until for r in rows.values() if r.computed_until is not None]
    return MatchElo(
        match_id=match.id,
        min_matches=MIN_MATCHES,
        home=_side(rows.get(match.home_team_id), champions),
        away=_side(rows.get(match.away_team_id), champions),
        computed_until=None if champions or not until else max(until),
    )


def _champions_ids(db: Session) -> set[int]:
    return {league_id for (league_id,) in db.query(League.id).filter(League.code == CHAMPIONS_LEAGUE)}


def match_elo(db: Session, match: Match) -> MatchElo:
    rows = {r.team_id: r for r in db.query(OwnEloPre).filter(OwnEloPre.match_id == match.id)}
    return _build(match, match.league_id in _champions_ids(db), rows)


def league_season_elo(db: Session, league_id: int, season_name: str) -> list[MatchElo]:
    """Todos los partidos de una liga y temporada, para el export estatico (un
    fichero por liga y temporada)."""
    matches = (
        db.query(Match)
        .join(Season, Season.id == Match.season_id)
        .filter(Match.league_id == league_id, Season.name == season_name)
        .order_by(Match.date.asc(), Match.id.asc())
        .all()
    )
    rows: dict[int, dict[int, OwnEloPre]] = {}
    ids = [m.id for m in matches]
    for start in range(0, len(ids), 500):  # limite de variables de SQLite
        for r in db.query(OwnEloPre).filter(OwnEloPre.match_id.in_(ids[start : start + 500])):
            rows.setdefault(r.match_id, {})[r.team_id] = r
    champions = league_id in _champions_ids(db)
    return [_build(m, champions, rows.get(m.id, {})) for m in matches]
