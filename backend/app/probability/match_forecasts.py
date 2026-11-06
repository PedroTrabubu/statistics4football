"""Duelo de corners y predictor de estadisticas de la ficha, guardados por
partido (tabla `match_forecasts`): la ficha solo lee y Aciertos tiene su
historico. Los modelos: corner_duel.py y stats_predictor.py.

- `generate_match_forecasts`: incremental, como los porcentajes de resultado
  (result_predictions.py). Reconstruye en walk-forward los partidos jugados
  sin fila y escribe la de los programados hasta su inicio; desde el inicio,
  una fila no se toca. Cada partido, con los jugados antes en su liga, de su
  temporada y la anterior (los de GET /matches/{id}/history).
- `refresh_match_forecasts`: lo mismo, con registro en `ingestion_runs`.
- `match_forecasts` y `league_season_duels`: solo leen (la API).

Solo en las ligas de la web (settings.leagues): las de contexto solo estan
para el historial de los equipos de Champions. El duelo, en todas ellas; el
predictor, en todas menos la Champions (no se evaluo alli y la ficha no lo
ensena).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import insert, update
from sqlalchemy.orm import Session

from app.core.competitions import CHAMPIONS_LEAGUE
from app.core.config import get_settings
from app.db.models import IngestionRun, IngestionStatus, League, Match, MatchForecast, MatchStatus, Season, TeamMatchStats
from app.probability.corner_duel import DuelForecast, StatHistory, corner_duel_forecast
from app.probability.stats_predictor import CAP, STAT_KEYS, StatForecast, predict_stats

CORNER_DUEL = "corner_duel"
STATS_PREDICTOR = "stats_predictor"
CORNER_DUEL_VERSION = "corner_duel_v1"
# MODEL de la ampliacion 2 del protocolo (v1: el publicado, cada equipo en su campo).
STATS_VERSION = "stats_predictor_v2"
KIND_RECONSTRUCTED = "reconstructed"
KIND_FROZEN = "frozen"
REFRESH_SOURCE = "match_forecasts.refresh"
# Partidos de la liga que ve cada uno: su temporada y la anterior, como la ficha.
HISTORY_SEASONS = 2
# La columna de team_match_stats de cada estadistica.
COLUMN = {"corners": "corners_for"}
EPOCH = datetime(1970, 1, 1)
VALUE_FIELDS = ("home", "away", "p_home", "p_draw", "p_away", "home_matches", "away_matches", "scope",
                "referee_factor", "referee_matches", "league_home", "league_away")  # fmt: skip


def _days(d: datetime) -> float:
    return (d - EPOCH).total_seconds() / 86400


def _duel_values(f: DuelForecast | None) -> dict:
    out = dict.fromkeys(VALUE_FIELDS)
    if f is not None:
        out |= {"home": f.home_expected, "away": f.away_expected, "p_home": f.home, "p_draw": f.draw, "p_away": f.away,
                "home_matches": f.home_matches, "away_matches": f.away_matches, "scope": "venue"}  # fmt: skip
    return out


def _stat_values(f: StatForecast | None) -> dict:
    out = dict.fromkeys(VALUE_FIELDS)
    if f is not None:
        out |= {"home": f.home, "away": f.away, "home_matches": f.home_matches, "away_matches": f.away_matches,
                "scope": f.scope, "league_home": f.league_home, "league_away": f.league_away}  # fmt: skip
        if f.referee is not None:
            out |= {"referee_factor": f.referee.factor, "referee_matches": f.referee.matches}
    return out


# --- Generacion ---------------------------------------------------------------


@dataclass
class GenerationSummary:
    reconstructed: int = 0  # partidos
    frozen: int = 0
    no_data: int = 0  # filas sin datos para el modelo


@dataclass
class _Row:
    id: int
    date: datetime
    status: MatchStatus
    season_id: int
    home_id: int
    away_id: int
    referee: str | None


def _league_matches(db: Session, league_id: int) -> tuple[list[_Row], dict[tuple[int, int], tuple]]:
    matches = [
        _Row(m.id, m.date, m.status, m.season_id, m.home_team_id, m.away_team_id, m.referee)
        for m in db.query(Match.id, Match.date, Match.status, Match.season_id, Match.home_team_id,
                          Match.away_team_id, Match.referee).filter(Match.league_id == league_id)  # fmt: skip
    ]
    columns = [getattr(TeamMatchStats, COLUMN.get(key, key)) for key in STAT_KEYS]
    stats = {
        (match_id, team_id): values
        for match_id, team_id, *values in db.query(TeamMatchStats.match_id, TeamMatchStats.team_id, *columns)
        .join(Match, Match.id == TeamMatchStats.match_id)
        .filter(Match.league_id == league_id)
    }
    return matches, stats


def _histories(played: list[_Row], stats: dict[tuple[int, int], tuple]) -> dict[str, StatHistory]:
    """Cada estadistica de los partidos jugados de una ventana, con sus fechas."""
    empty = (None,) * len(STAT_KEYS)
    home = [stats.get((m.id, m.home_id), empty) for m in played]
    away = [stats.get((m.id, m.away_id), empty) for m in played]
    days = [_days(m.date) for m in played]
    value = lambda v: math.nan if v is None else float(v)  # noqa: E731
    return {
        key: StatHistory(days, [m.home_id for m in played], [m.away_id for m in played],
                         [value(h[i]) for h in home], [value(a[i]) for a in away], [m.referee for m in played],
                         CAP.get(key, math.inf))  # fmt: skip
        for i, key in enumerate(STAT_KEYS)
    }


def generate_match_forecasts(db: Session, now: datetime | None = None, leagues: list[str] | None = None) -> GenerationSummary:
    now = now or datetime.utcnow()
    existing: dict[tuple[int, str, str], tuple[int, datetime]] = {
        (match_id, model, stat): (row_id, kickoff)
        for row_id, match_id, model, stat, kickoff in db.query(
            MatchForecast.id, MatchForecast.match_id, MatchForecast.model, MatchForecast.stat, MatchForecast.kickoff
        )
    }
    query = db.query(League).filter(League.code.in_(leagues or get_settings().leagues))
    summary = GenerationSummary()
    inserts: list[dict] = []
    updates: list[dict] = []

    def kind_for(m: _Row, model: str, stat: str) -> str | None:
        """Lo que toca escribir de esa fila (None: nada)."""
        old = existing.get((m.id, model, stat))
        if m.status == MatchStatus.HISTORICAL:
            return KIND_RECONSTRUCTED if old is None else None
        if m.status == MatchStatus.SCHEDULED and m.date > now and (old is None or old[1] > now):
            return KIND_FROZEN
        return None

    def write(m: _Row, model: str, stat: str, version: str, kind: str, values: dict) -> None:
        row = {"match_id": m.id, "model": model, "stat": stat, "version": version, "kind": kind, "kickoff": m.date,
               "generated_at": now} | values  # fmt: skip
        old = existing.get((m.id, model, stat))
        (inserts if old is None else updates).append(row if old is None else row | {"id": old[0]})
        if values["home"] is None:
            summary.no_data += 1

    for league in query.order_by(League.code):
        models = [CORNER_DUEL] if league.code == CHAMPIONS_LEAGUE else [CORNER_DUEL, STATS_PREDICTOR]
        seasons = db.query(Season).filter(Season.league_id == league.id).order_by(Season.name).all()
        matches, stats = _league_matches(db, league.id)
        for i, season in enumerate(seasons):
            todo = []
            for m in matches:
                if m.season_id != season.id:
                    continue
                kinds = {
                    model: {stat: k for stat in (["corners"] if model == CORNER_DUEL else STAT_KEYS)
                            if (k := kind_for(m, model, stat))}  # fmt: skip
                    for model in models
                }
                if any(kinds.values()):
                    todo.append((m, kinds))
            if not todo:
                continue
            window = {s.id for s in seasons[max(0, i - HISTORY_SEASONS + 1) : i + 1]}
            played = [m for m in matches if m.season_id in window and m.status == MatchStatus.HISTORICAL]
            # Los corners, con el mismo recorte que el duelo: su historial sirve a los dos.
            histories = _histories(played, stats)

            for m, kinds in todo:
                at = _days(m.date)
                if kinds.get(CORNER_DUEL):
                    duel = corner_duel_forecast(histories["corners"].before(at), m.home_id, m.away_id)
                    write(m, CORNER_DUEL, "corners", CORNER_DUEL_VERSION, kinds[CORNER_DUEL]["corners"], _duel_values(duel))
                if kinds.get(STATS_PREDICTOR):
                    forecasts = predict_stats(histories, at, m.home_id, m.away_id, m.referee)
                    for stat, kind in kinds[STATS_PREDICTOR].items():
                        write(m, STATS_PREDICTOR, stat, STATS_VERSION, kind, _stat_values(forecasts[stat]))
                if m.status == MatchStatus.HISTORICAL:
                    summary.reconstructed += 1
                else:
                    summary.frozen += 1

    if inserts:
        db.execute(insert(MatchForecast), inserts)
    if updates:
        db.execute(update(MatchForecast), updates)
    db.flush()
    return summary


def refresh_match_forecasts(db: Session, leagues: list[str] | None = None) -> IngestionRun:
    """`generate_match_forecasts` con su registro. Si falla, deja el registro
    como fallido y relanza el error (el paso del programador sale con aviso)."""
    run = IngestionRun(source=REFRESH_SOURCE, status=IngestionStatus.RUNNING)
    db.add(run)
    db.commit()
    try:
        summary = generate_match_forecasts(db, leagues=leagues)
        run.status = IngestionStatus.SUCCESS
        run.rows_ingested = summary.reconstructed + summary.frozen
        run.notes = (
            f"{summary.reconstructed} partidos reconstruidos, {summary.frozen} antes del inicio, "
            f"{summary.no_data} filas sin datos para el modelo"
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


# --- Lectura (API) ------------------------------------------------------------


def _duel_out(row: MatchForecast | None) -> dict | None:
    if row is None or row.p_home is None:
        return None
    return {"home_expected": row.home, "away_expected": row.away, "home": row.p_home, "draw": row.p_draw,
            "away": row.p_away, "home_matches": row.home_matches, "away_matches": row.away_matches}  # fmt: skip


def _stat_out(row: MatchForecast | None) -> dict | None:
    if row is None or row.home is None:
        return None
    referee = None if row.referee_factor is None else {"factor": row.referee_factor, "matches": row.referee_matches}
    return {"home": row.home, "away": row.away, "home_matches": row.home_matches, "away_matches": row.away_matches,
            "scope": row.scope, "referee": referee}  # fmt: skip


def match_forecasts(db: Session, match: Match) -> dict:
    """Lo guardado del partido. `stats` None: sin predictor (la Champions) o
    aun sin calcular; dentro, None por estadistica sin datos."""
    rows = db.query(MatchForecast).filter_by(match_id=match.id).all()
    if not rows:
        return {"match_id": match.id, "status": "not_generated", "kind": None, "generated_at": None, "duel": None,
                "stats": None}  # fmt: skip
    duel = next((r for r in rows if r.model == CORNER_DUEL), None)
    stats = {r.stat: r for r in rows if r.model == STATS_PREDICTOR}
    return {
        "match_id": match.id,
        "status": "ok",
        "kind": rows[0].kind,
        "generated_at": max(r.generated_at for r in rows),
        "duel": _duel_out(duel),
        "stats": {key: _stat_out(stats.get(key)) for key in STAT_KEYS} if stats else None,
    }


def league_season_duels(db: Session, league_id: int, season_name: str) -> list[dict]:
    """El duelo de cada partido de una liga y temporada que lo tenga."""
    rows = (
        db.query(MatchForecast)
        .join(Match, Match.id == MatchForecast.match_id)
        .join(Season, Season.id == Match.season_id)
        .filter(Match.league_id == league_id, Season.name == season_name, MatchForecast.model == CORNER_DUEL)
        .all()
    )
    return [{"match_id": r.match_id} | duel for r in rows if (duel := _duel_out(r))]
