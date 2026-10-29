"""Dixon-Coles mensual para los porcentajes de resultado (`elo_dc_v1`, ver
docs/RESULTADOS_PROTOCOLO.md): por liga, un ajuste de `fit_league_model` con
lo anterior al primer partido de cada mes, el mismo del backtest.

Cache por liga en data/model_cache/result_dc_monthly/<liga>.csv (match_id,
dc_h, dc_d, dc_a, final):
- partidos jugados: se calculan una vez (final = 1) y no se tocan;
- programados: se reescriben en cada pasada. Si su mes ya empezo, con el ajuste
  fijo de ese mes; si no, con todo lo jugado hasta ahora.
Si una liga falla, se quitan sus programados de la cache (esa liga usa solo
Elo) y la pasada queda como fallida en `ingestion_runs`.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime

import pandas as pd
from sqlalchemy.orm import Session

from app.core.config import PROJECT_ROOT
from app.db.models import IngestionRun, IngestionStatus, League, Match, MatchStatus, Season
from app.probability.engine import fit_league_model
from app.probability.score_markets import probabilities_1x2

logger = logging.getLogger(__name__)

DC_DIR = PROJECT_ROOT / "data" / "model_cache" / "result_dc_monthly"
REFRESH_SOURCE = "dixon_coles.monthly"
WARMUP_SEASON = "2021"
COLUMNS = ["match_id", "dc_h", "dc_d", "dc_a", "final"]


def _path(code: str):
    return DC_DIR / f"{code}.csv"


def _read(code: str) -> pd.DataFrame:
    path = _path(code)
    return pd.read_csv(path) if path.exists() else pd.DataFrame(columns=COLUMNS)


def _write(code: str, df: pd.DataFrame) -> None:
    DC_DIR.mkdir(parents=True, exist_ok=True)
    tmp = _path(code).with_suffix(".tmp")
    df[COLUMNS].to_csv(tmp, index=False)
    os.replace(tmp, _path(code))


def _league_rows(db: Session, league: League, now: datetime) -> tuple[pd.DataFrame, int, int]:
    """La cache nueva de una liga: (filas, jugados nuevos, programados)."""
    cache = _read(league.code)
    finals = cache[cache.final == 1]
    done = set(finals.match_id)
    matches = (
        db.query(Match)
        .join(Season, Season.id == Match.season_id)
        .filter(Match.league_id == league.id, Season.name != WARMUP_SEASON)
        .filter(Match.status.in_([MatchStatus.HISTORICAL, MatchStatus.SCHEDULED]))
        .all()
    )
    played = [m for m in matches if m.status == MatchStatus.HISTORICAL and m.home_goals is not None]
    upcoming = [m for m in matches if m.status == MatchStatus.SCHEDULED]
    # Corte de cada mes: su primer partido (jugado o por jugar).
    first_of_month: dict[tuple[int, int], datetime] = {}
    for m in played + upcoming:
        key = (m.date.year, m.date.month)
        first_of_month[key] = min(first_of_month.get(key, m.date), m.date)

    fits = {}

    def probs(m: Match, cutoff: datetime) -> dict:
        if cutoff not in fits:
            fits[cutoff] = fit_league_model(db, league.id, before_date=cutoff)
        p = probabilities_1x2(fits[cutoff].score_matrix(m.home_team_id, m.away_team_id))
        return {"match_id": m.id, "dc_h": p["home"], "dc_d": p["draw"], "dc_a": p["away"]}

    new_finals = [
        probs(m, first_of_month[(m.date.year, m.date.month)]) | {"final": 1} for m in played if m.id not in done
    ]
    provisional = []
    for m in upcoming:
        cutoff = first_of_month[(m.date.year, m.date.month)]
        provisional.append(probs(m, cutoff if cutoff <= now else now) | {"final": 0})
    rows = pd.concat([finals, pd.DataFrame(new_finals + provisional, columns=COLUMNS)], ignore_index=True)
    return rows, len(new_finals), len(provisional)


def refresh_dc_monthly(db: Session, leagues: list[str], now: datetime | None = None) -> IngestionRun:
    """Actualiza la cache de cada liga. Si alguna falla, deja la pasada como
    fallida y relanza el error al final (el paso del programador sale con aviso)."""
    now = now or datetime.utcnow()
    run = IngestionRun(source=REFRESH_SOURCE, status=IngestionStatus.RUNNING)
    db.add(run)
    db.commit()
    notes, failed = [], []
    for league in db.query(League).filter(League.code.in_(leagues)).order_by(League.code):
        try:
            rows, n_new, n_open = _league_rows(db, league, now)
            _write(league.code, rows)
            notes.append(f"{league.code}: {n_new} jugados nuevos, {n_open} programados")
        except Exception as exc:  # noqa: BLE001  (una liga caida no frena las demas)
            db.rollback()
            logger.exception("Dixon-Coles mensual %s", league.code)
            cache = _read(league.code)
            _write(league.code, cache[cache.final == 1])  # sin programados: esa liga usa solo Elo
            failed.append(league.code)
            notes.append(f"{league.code}: FALLO {type(exc).__name__}: {exc}")
    run = db.get(IngestionRun, run.id)
    run.status = IngestionStatus.FAILED if failed else IngestionStatus.SUCCESS
    run.notes = "; ".join(notes)[:2000]
    run.finished_at = datetime.utcnow()
    db.commit()
    if failed:
        raise RuntimeError(f"Dixon-Coles mensual fallo en: {', '.join(failed)} (esas ligas usan solo Elo)")
    return run


def load_dc_monthly(leagues: list[str]) -> dict[int, tuple[float, float, float]]:
    out = {}
    for code in leagues:
        for r in _read(code).itertuples():
            out[int(r.match_id)] = (r.dc_h, r.dc_d, r.dc_a)
    return out
