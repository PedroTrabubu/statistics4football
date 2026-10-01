"""Orquestacion DB del modelo de patrones (estrategia "alta probabilidad").

Mismas features y misma regla que el backtest (scripts/backtest_pattern_model.py
y docs/MODELO_PATRONES.md): cuotas medias pre-partido, Dixon-Coles y patrones
de cada equipo con partidos anteriores a la fecha. Sin cuotas 1X2 no hay
probabilidad de mercado, asi que no se genera nada para ese partido.
"""

from datetime import datetime

from sqlalchemy.orm import Session

from app.db.models import Match, MatchOdds, MatchStatus, ModelPrediction
from app.probability.ev import compute_confidence, compute_ev, risk_level_from_confidence
from app.probability.pattern_model import (
    DB_SELECTION,
    MODEL_VERSION,
    SELECTION_KEYS,
    PatternModelParams,
    PatternTracker,
    choose_selection,
    market_probabilities,
    selection_probs_from_matrix,
)
from app.probability.poisson_model import DixonColesModel

REFERENCE_BOOKMAKER = "Market Average"  # pre-partido, igual que en el backtest

# Selecciones con cuota real en los datos (para EV/ROI). Doble oportunidad,
# otras lineas de goles, ambos marcan y marca equipo no tienen cuota propia:
# no se inventa un precio para ellas.
ODDS_KEY: dict[str, str] = {
    "home": "home",
    "draw": "draw",
    "away": "away",
    "over_2.5": "over_2.5",
    "under_2.5": "under_2.5",
}


def prematch_odds(db: Session, match_id: int) -> dict[str, float]:
    rows = (
        db.query(MatchOdds)
        .filter(
            MatchOdds.match_id == match_id,
            MatchOdds.bookmaker == REFERENCE_BOOKMAKER,
            MatchOdds.market.in_(["1x2", "over_under_2.5"]),
        )
        .all()
    )
    return {(r.selection if r.market == "1x2" else f"{r.selection}_2.5"): r.odds for r in rows}


def build_tracker(db: Session, league_id: int, before: datetime) -> PatternTracker:
    """Historial de patrones con todos los partidos jugados de la liga antes de `before`."""
    tracker = PatternTracker()
    matches = (
        db.query(Match)
        .filter(
            Match.league_id == league_id,
            Match.status == MatchStatus.HISTORICAL,
            Match.home_goals.is_not(None),
            Match.away_goals.is_not(None),
            Match.date < before,
        )
        .order_by(Match.date.asc(), Match.id.asc())
        .all()
    )
    for m in matches:
        tracker.add(m.home_team_id, m.away_team_id, m.home_goals, m.away_goals)
    return tracker


def build_prediction_rows(
    match_id: int,
    features: dict[str, dict[str, float]],
    odds: dict[str, float],
    params: PatternModelParams,
    matches_used: int,
) -> list[ModelPrediction]:
    """Una fila por seleccion; solo la elegida por la regla del protocolo
    queda con is_recommended."""
    probs = params.predict(features)
    p_mkt = {k: features[k]["mkt"] for k in SELECTION_KEYS}
    chosen = choose_selection(probs, p_mkt, params.tau, params.delta)
    confidence = compute_confidence(matches_used, bookmaker_agreement=None)

    rows = []
    for k in SELECTION_KEYS:
        market, selection = DB_SELECTION[k]
        price = odds.get(ODDS_KEY.get(k, ""))
        rows.append(
            ModelPrediction(
                match_id=match_id,
                model_version=MODEL_VERSION,
                market=market,
                selection=selection,
                prob_market_implied=p_mkt[k],
                prob_model=probs[k],
                ev=compute_ev(probs[k], price) if price else None,
                confidence=confidence,
                risk_level=risk_level_from_confidence(confidence),
                is_recommended=k == chosen,
                matches_used=matches_used,
            )
        )
    return rows


def generate_pattern_predictions_for_match(
    db: Session,
    match: Match,
    dc_model: DixonColesModel,
    tracker: PatternTracker,
    params: PatternModelParams,
) -> list[ModelPrediction]:
    """`tracker` debe contener solo partidos anteriores a `match` (ver build_tracker)."""
    db.query(ModelPrediction).filter_by(match_id=match.id, model_version=MODEL_VERSION).delete()

    odds = prematch_odds(db, match.id)
    p_mkt = market_probabilities(odds)
    if p_mkt is None:
        return []

    dc = selection_probs_from_matrix(dc_model.score_matrix(match.home_team_id, match.away_team_id))
    patterns = tracker.features(match.home_team_id, match.away_team_id)
    features = {
        k: {"mkt": p_mkt[k], "dc": dc[k], "patv": patterns[k]["pat_venue"], "pata": patterns[k]["pat_all"]}
        for k in SELECTION_KEYS
    }
    rows = build_prediction_rows(
        match.id, features, odds, params, tracker.matches_available(match.home_team_id, match.away_team_id)
    )
    db.add_all(rows)
    db.flush()
    return rows
