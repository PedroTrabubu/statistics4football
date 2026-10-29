"""Porcentajes de resultado de la ficha, sin mercado (docs/RESULTADOS_PROTOCOLO.md):
`elo_dc_v1`, la media 50/50 del Elo propio calibrado y de Dixon-Coles mensual
calibrado. Si Dixon-Coles falta en una liga o partido (`dc_monthly.py`), solo
Elo, y la fila lo dice (`elo_calibrado_v1`, la version anterior).

- `generate_result_predictions`: incremental. Reconstruye en walk-forward los
  partidos jugados que no tienen prediccion y escribe la de los programados
  hasta su inicio; desde el inicio, una fila no se toca. Despues guarda el
  resumen (acierto por liga, calibracion, Alta confianza) en
  data/model_cache/result_summary.json.
- `refresh_result_predictions`: lo mismo, con registro en `ingestion_runs`.
- `match_result_probabilities`, `league_season_result_probabilities` y
  `read_summary`: solo leen (la API).
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from datetime import datetime

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from app.core.competitions import CHAMPIONS_LEAGUE
from app.core.config import PROJECT_ROOT
from app.db.models import IngestionRun, IngestionStatus, League, Match, MatchStatus, OwnEloPre, ResultPrediction, Season
from app.probability.dc_monthly import load_dc_monthly
from app.probability.result_metrics import best_dc_hit, calibration_bins, top_hit, wilson
from app.probability.result_model import (
    COLS_ELO,
    WARMUP_SEASONS,
    build_features,
    double_chance,
    load_inputs,
    softmax,
    temperature_walk_forward,
    walk_forward,
)
from app.stats.own_elo import MIN_MATCHES

MODEL_VERSION = "elo_dc_v1"
# Solo Elo: la version anterior y el respaldo cuando falta Dixon-Coles.
ELO_VERSION = "elo_calibrado_v1"
# Las 6 ligas nacionales con ficha, las del protocolo. La Champions queda fuera ("sin calibrar").
LEAGUES = ["ENG-Premier League", "ESP-La Liga", "ESP-La Liga 2", "FRA-Ligue 1", "GER-Bundesliga", "ITA-Serie A"]
DEV_SEASONS = ["2223", "2324", "2425", "2526"]
REFRESH_SOURCE = "result_predictions.refresh"
KIND_RECONSTRUCTED = "reconstructed"
KIND_FROZEN = "frozen"
HIGH_CONFIDENCE_BINS = ((0.80, 0.85), (0.85, 1.0))
# Tramos de calibracion con menos probabilidades: la web avisa de "pocas muestras".
LOW_SAMPLE_BIN = 100
SUMMARY_PATH = PROJECT_ROOT / "data" / "model_cache" / "result_summary.json"


# --- Generacion ---------------------------------------------------------------


@dataclass
class GenerationSummary:
    reconstructed: int = 0
    frozen: int = 0
    insufficient: int = 0
    elo_only: int = 0  # sin Dixon-Coles: solo Elo


def _chunks(ids: list[int], size: int = 500):
    for start in range(0, len(ids), size):
        yield ids[start : start + size]


def _elo_matches(db: Session, ids: list[int]) -> dict[int, int]:
    """Menos partidos de Elo de los dos equipos de cada partido."""
    out: dict[int, int] = {}
    for chunk in _chunks(ids):
        for match_id, n in db.query(OwnEloPre.match_id, OwnEloPre.matches_rated).filter(OwnEloPre.match_id.in_(chunk)):
            out[match_id] = min(out.get(match_id, n), n)
    return out


def _dc_calibrated(df: pd.DataFrame, dc: dict[int, tuple[float, float, float]]) -> pd.DataFrame:
    """Dixon-Coles mensual de una liga con temperatura dia a dia (la misma regla
    que el Elo), indexado por partido."""
    rows = df[df.match_id.isin(dc.keys()) & ~df.season.isin(WARMUP_SEASONS)][["match_id", "day", "res"]].copy()
    if rows.empty:
        return pd.DataFrame(columns=["p_home", "p_draw", "p_away"])
    rows[["dc_h", "dc_d", "dc_a"]] = [dc[m] for m in rows.match_id]
    return temperature_walk_forward(rows, ["dc_h", "dc_d", "dc_a"]).set_index("match_id")


def generate_result_predictions(
    db: Session, now: datetime | None = None, leagues: list[str] | None = None, write_summary: bool = True
) -> GenerationSummary:
    now = now or datetime.utcnow()
    leagues = leagues or LEAGUES
    inputs = load_inputs(db, leagues, with_market=False)
    features = build_features(inputs, {})
    kickoff = {m.match_id: m.date for m in inputs.matches}
    ids = list(kickoff)
    existing: dict[int, ResultPrediction] = {}
    for chunk in _chunks(ids):  # una fila por partido, de cualquier version
        for r in db.query(ResultPrediction).filter(ResultPrediction.match_id.in_(chunk)):
            existing[r.match_id] = r
    elo_n = _elo_matches(db, ids)
    dc = load_dc_monthly(leagues)
    summary = GenerationSummary()

    for league in leagues:
        df = features[features.league == league]
        if df.empty:
            continue
        played = df.res >= 0
        missing = df[played & ~df.match_id.isin(existing)]
        is_open = df.match_id.map(lambda mid: kickoff[mid] > now and (mid not in existing or existing[mid].kickoff > now))
        upcoming = df[~played & is_open]
        targets = pd.concat([missing, upcoming])
        targets = targets[targets.elo.notna()]  # sin Elo todavia: en la siguiente pasada
        if targets.empty:
            continue

        stored = df[played & df.match_id.isin(existing)]
        history = pd.DataFrame(
            [
                {"day": r.day, "match_id": r.match_id, "res": r.res, "score_home": existing[r.match_id].score_home,
                 "score_draw": existing[r.match_id].score_draw, "score_away": existing[r.match_id].score_away}  # fmt: skip
                for r in stored.itertuples()
                if existing[r.match_id].score_home is not None
            ],
            columns=["day", "match_id", "res", "score_home", "score_draw", "score_away"],
        )
        preds = walk_forward(
            df, COLS_ELO, predict_unplayed=True, days=set(targets.day), history=history if len(history) else None,
            with_scores=True,
        ).set_index("match_id")  # fmt: skip
        dc_cal = _dc_calibrated(df, dc)

        for r in targets.itertuples():
            row = existing.get(r.match_id)
            if row is None:
                row = ResultPrediction(match_id=r.match_id)
                db.add(row)
                existing[r.match_id] = row
            p = preds.loc[r.match_id] if r.match_id in preds.index else None
            mixed = p is not None and r.match_id in dc_cal.index
            row.version = MODEL_VERSION if mixed else ELO_VERSION
            if p is None:
                row.p_home = row.p_draw = row.p_away = None
            else:
                probs = np.array([p.p_home, p.p_draw, p.p_away])
                if mixed:
                    probs = (probs + dc_cal.loc[r.match_id, ["p_home", "p_draw", "p_away"]].to_numpy(float)) / 2
                else:
                    summary.elo_only += 1
                row.p_home, row.p_draw, row.p_away = (float(x) for x in probs)
            row.score_home, row.score_draw, row.score_away = (
                (None, None, None) if p is None else (p.score_home, p.score_draw, p.score_away)
            )
            row.temperature = None if p is None else float(p["T"])
            row.elo_matches = elo_n.get(r.match_id)
            row.kind = KIND_RECONSTRUCTED if r.res >= 0 else KIND_FROZEN
            row.kickoff, row.generated_at = kickoff[r.match_id], now
            if p is None:
                summary.insufficient += 1
            elif r.res >= 0:
                summary.reconstructed += 1
            else:
                summary.frozen += 1
    db.flush()
    if write_summary:
        write_summary_file(compute_summary(db, now, features, dc))
    return summary


def refresh_result_predictions(db: Session, leagues: list[str] | None = None) -> IngestionRun:
    """`generate_result_predictions` con su registro. Si falla, deja el registro
    como fallido y relanza el error (el paso del programador sale con aviso)."""
    run = IngestionRun(source=REFRESH_SOURCE, status=IngestionStatus.RUNNING)
    db.add(run)
    db.commit()
    try:
        summary = generate_result_predictions(db, leagues=leagues)
        run.status = IngestionStatus.SUCCESS
        run.rows_ingested = summary.reconstructed + summary.frozen + summary.insufficient
        run.notes = (
            f"{MODEL_VERSION}: {summary.reconstructed} reconstruidas, {summary.frozen} antes del inicio, "
            f"{summary.insufficient} sin datos suficientes, {summary.elo_only} solo con Elo (sin Dixon-Coles)"
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


# --- Resumen (acierto y calibracion) -----------------------------------------


def _rate(hits: int, n: int) -> dict:
    low, high = wilson(hits, n)
    return {"n": n, "hits": hits, "rate": hits / n if n else None,
            "low": None if math.isnan(low) else low, "high": None if math.isnan(high) else high}  # fmt: skip


def _calibration(P: np.ndarray, y: np.ndarray) -> list[dict]:
    out = []
    for b in calibration_bins(P, y):
        low, high = wilson(round(b.observed * b.n), b.n)
        out.append({"low": b.low, "high": b.high, "n": b.n, "mean_p": b.mean_p, "observed": b.observed,
                    "ci_low": low, "ci_high": high})  # fmt: skip
    return out


def _high_confidence(P: np.ndarray, y: np.ndarray) -> dict:
    pdc, hit = double_chance(P).max(axis=1), best_dc_hit(P, y)
    out = {"coverage": float((pdc >= HIGH_CONFIDENCE_BINS[0][0]).mean()) if len(y) else None, "n_matches": len(y)}
    for key, (low, high) in zip(("bin_80_85", "bin_85"), HIGH_CONFIDENCE_BINS, strict=True):
        mask = (pdc >= low) & ((pdc <= high) if high >= 1 else (pdc < high))
        out[key] = _rate(int(hit[mask].sum()), int(mask.sum()))
    return out


def compute_summary(
    db: Session, now: datetime, features: pd.DataFrame, dc: dict[int, tuple[float, float, float]]
) -> dict:
    """Las cifras del modelo actual sobre todos los partidos jugados con
    prediccion (la misma poblacion que las tablas del protocolo). Las filas
    guardadas de partidos ya empezados no se reescriben: la media se reconstruye
    aqui con su Elo calibrado (logits y temperatura guardados) y Dixon-Coles
    calibrado; donde falta Dixon-Coles, solo Elo."""
    dc_cal = pd.concat([_dc_calibrated(features[features.league == code], dc) for code in features.league.unique()])
    rows = (
        db.query(ResultPrediction, Match.home_goals, Match.away_goals, League.code, Season.name)
        .join(Match, Match.id == ResultPrediction.match_id)
        .join(League, League.id == Match.league_id)
        .join(Season, Season.id == Match.season_id)
        .filter(
            ResultPrediction.score_home.is_not(None),
            Match.status == MatchStatus.HISTORICAL,
            Match.home_goals.is_not(None),
        )
        .all()
    )
    elo = softmax(np.array([[r.score_home, r.score_draw, r.score_away] for r, *_ in rows]).reshape(-1, 3)
                  / np.array([[r.temperature] for r, *_ in rows]).reshape(-1, 1))
    P = np.array([
        (e + dc_cal.loc[r.match_id, ["p_home", "p_draw", "p_away"]].to_numpy(float)) / 2 if r.match_id in dc_cal.index else e
        for e, (r, *_) in zip(elo, rows, strict=True)
    ]).reshape(-1, 3)  # fmt: skip
    y = np.array([0 if hg > ag else 1 if hg == ag else 2 for _, hg, ag, _, _ in rows], dtype=int)
    leagues = np.array([code for *_, code, _ in rows])
    seasons = np.array([season for *_, season in rows])
    current = max(set(seasons) - set(DEV_SEASONS), default=None)
    dev, cur = np.isin(seasons, DEV_SEASONS), seasons == current

    by_league = {}
    for code in sorted(set(leagues)):
        m = leagues == code
        by_league[code] = {
            "league": code,
            "seasons": sorted(set(seasons[m])),
            "top": _rate(int(top_hit(P[m], y[m]).sum()), int(m.sum())),
            "double": _rate(int(best_dc_hit(P[m], y[m]).sum()), int(m.sum())),
            "always_1x": _rate(int((y[m] != 2).sum()), int(m.sum())),
        }
    return {
        "version": MODEL_VERSION,
        "generated_at": now.isoformat(),
        "dev_seasons": DEV_SEASONS,
        "current_season": current,
        "low_sample_bin": LOW_SAMPLE_BIN,
        "calibration_dev": _calibration(P[dev], y[dev]),
        "calibration_current": _calibration(P[cur], y[cur]) if current else [],
        "high_confidence_dev": _high_confidence(P[dev], y[dev]),
        "high_confidence_current": _high_confidence(P[cur], y[cur]) if current else None,
        "leagues": by_league,
    }


def write_summary_file(summary: dict) -> None:
    SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = SUMMARY_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(summary, indent=1), encoding="utf-8")
    os.replace(tmp, SUMMARY_PATH)


# --- Lectura (API) ------------------------------------------------------------

_summary_cache: dict = {"mtime": None, "data": None}


def read_summary(league_code: str | None) -> dict | None:
    """El resumen guardado, con el acierto de esa liga. Se relee solo si cambia el fichero."""
    try:
        key = (str(SUMMARY_PATH), SUMMARY_PATH.stat().st_mtime)
    except FileNotFoundError:
        return None
    if _summary_cache["mtime"] != key:
        _summary_cache["data"] = json.loads(SUMMARY_PATH.read_text(encoding="utf-8"))
        _summary_cache["mtime"] = key
    data = dict(_summary_cache["data"])
    data["league"] = data.pop("leagues", {}).get(league_code)
    return data


def _prediction(match: Match, code: str, row: ResultPrediction | None) -> dict:
    out = {"match_id": match.id, "version": row.version if row else MODEL_VERSION, "kind": None, "kickoff": None, "generated_at": None,
           "p_home": None, "p_draw": None, "p_away": None}  # fmt: skip
    if code == CHAMPIONS_LEAGUE:
        return out | {"status": "champions"}
    if code not in LEAGUES:
        return out | {"status": "not_available"}
    if row is None:
        return out | {"status": "not_generated"}
    out |= {"kind": row.kind, "kickoff": row.kickoff, "generated_at": row.generated_at}
    if row.p_home is None or row.elo_matches is None or row.elo_matches < MIN_MATCHES:
        return out | {"status": "insufficient_history"}
    return out | {"status": "ok", "p_home": row.p_home, "p_draw": row.p_draw, "p_away": row.p_away}


def match_result_probabilities(db: Session, match: Match) -> dict:
    code = db.query(League.code).filter(League.id == match.league_id).scalar()
    row = db.query(ResultPrediction).filter_by(match_id=match.id).order_by(ResultPrediction.generated_at.desc()).first()
    return {"prediction": _prediction(match, code, row), "summary": read_summary(code)}


def league_season_result_probabilities(db: Session, league_id: int, season_name: str) -> dict:
    """Todos los partidos de una liga y temporada, para el export estatico (un
    fichero por liga y temporada)."""
    code = db.query(League.code).filter(League.id == league_id).scalar()
    matches = (
        db.query(Match)
        .join(Season, Season.id == Match.season_id)
        .filter(Match.league_id == league_id, Season.name == season_name)
        .order_by(Match.date.asc(), Match.id.asc())
        .all()
    )
    rows: dict[int, ResultPrediction] = {}
    for chunk in _chunks([m.id for m in matches]):
        for r in db.query(ResultPrediction).filter(ResultPrediction.match_id.in_(chunk)):
            rows[r.match_id] = r
    return {"summary": read_summary(code), "predictions": [_prediction(m, code, rows.get(m.id)) for m in matches]}
