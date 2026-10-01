from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.db.models import ModelPrediction


class PredictionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    market: str
    selection: str
    prob_market_implied: float | None
    prob_model: float
    ev: float | None
    confidence: float
    risk_level: str
    is_recommended: bool
    matches_used: int


class RecommendationOut(BaseModel):
    match_id: int
    date: datetime
    league_code: str
    home_team: str
    away_team: str
    market: str
    selection: str
    prob_market_implied: float | None
    prob_model: float
    ev: float | None
    confidence: float
    risk_level: str
    matches_used: int


def recommendation_to_out(pred: ModelPrediction) -> RecommendationOut:
    match = pred.match
    return RecommendationOut(
        match_id=match.id,
        date=match.date,
        league_code=match.league.code,
        home_team=match.home_team.name,
        away_team=match.away_team.name,
        market=pred.market,
        selection=pred.selection,
        prob_market_implied=pred.prob_market_implied,
        prob_model=pred.prob_model,
        ev=pred.ev,
        confidence=pred.confidence,
        risk_level=pred.risk_level.value,
        matches_used=pred.matches_used,
    )


class RecommendationHistoryOut(BaseModel):
    match_id: int
    date: datetime
    league_code: str
    home_team: str
    away_team: str
    home_goals: int
    away_goals: int
    market: str
    selection: str
    prob_market_implied: float | None
    prob_model: float
    ev: float | None
    matches_used: int
    # "won" | "lost" | "pending" (pendiente = no se pudo resolver, p.ej.
    # handicap asiatico con push — nunca se oculta, se marca como tal).
    outcome: str
    # PnL a stake=1 unidad, recuperando la cuota real del EV guardado. None
    # si esta pendiente. Es la metrica que importa de verdad en una
    # estrategia de valor — el % de acierto solo, aislado, engaña: una
    # seleccion de baja probabilidad (visitante 15%) se espera que falle la
    # mayoria de las veces aunque tenga EV positivo real.
    pnl_units: float | None


class RecommendationHistoryBreakdown(BaseModel):
    key: str
    total: int
    won: int
    lost: int
    pending: int
    hit_rate: float | None
    # Media de la probabilidad de mercado de las selecciones resueltas.
    market_expected_hit_rate: float | None
    # Selecciones con cuota real: el ROI se calcula solo sobre estas.
    with_odds: int
    pnl_units: float
    roi: float | None


class RecommendationHistorySummary(BaseModel):
    total: int
    won: int
    lost: int
    pending: int
    hit_rate: float | None
    # Media de la probabilidad de mercado de las selecciones resueltas.
    market_expected_hit_rate: float | None
    # Selecciones con cuota real: el ROI se calcula solo sobre estas.
    with_odds: int
    pnl_units: float
    roi: float | None


class RecommendationHistoryListOut(BaseModel):
    summary: RecommendationHistorySummary
    by_market: list[RecommendationHistoryBreakdown]
    items: list[RecommendationHistoryOut]


def recommendation_history_to_out(pred: ModelPrediction, won: bool | None, pnl_units: float | None) -> RecommendationHistoryOut:
    match = pred.match
    outcome = "pending" if won is None else ("won" if won else "lost")
    return RecommendationHistoryOut(
        match_id=match.id,
        date=match.date,
        league_code=match.league.code,
        home_team=match.home_team.name,
        away_team=match.away_team.name,
        home_goals=match.home_goals or 0,
        away_goals=match.away_goals or 0,
        market=pred.market,
        selection=pred.selection,
        prob_market_implied=pred.prob_market_implied,
        prob_model=pred.prob_model,
        ev=pred.ev,
        matches_used=pred.matches_used,
        outcome=outcome,
        pnl_units=pnl_units,
    )
