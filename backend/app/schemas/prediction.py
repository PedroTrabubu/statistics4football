from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.db.models import ModelPrediction


class PredictionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    market: str
    selection: str
    prob_market_implied: float
    prob_model: float
    ev: float
    confidence: float
    risk_level: str
    is_recommended: bool


class RecommendationOut(BaseModel):
    match_id: int
    date: datetime
    league_code: str
    home_team: str
    away_team: str
    market: str
    selection: str
    prob_market_implied: float
    prob_model: float
    ev: float
    confidence: float
    risk_level: str


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
    )
