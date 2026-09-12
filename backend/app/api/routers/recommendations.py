from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.models import Match, ModelPrediction, RiskLevel
from app.db.session import get_db
from app.schemas.prediction import RecommendationOut, recommendation_to_out

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


@router.get("", response_model=list[RecommendationOut])
def list_recommendations(
    league_id: int | None = None,
    market: str | None = None,
    risk_level: RiskLevel | None = None,
    min_ev: float | None = None,
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
) -> list[RecommendationOut]:
    """Recomendaciones ya calculadas y guardadas (ver /matches/{id}/predictions
    o scripts/generate_predictions.py para generarlas). Nunca se devuelve el
    EV solo: siempre viene con confidence/risk_level."""
    query = (
        db.query(ModelPrediction)
        .join(Match, Match.id == ModelPrediction.match_id)
        .filter(ModelPrediction.is_recommended.is_(True))
    )
    if league_id is not None:
        query = query.filter(Match.league_id == league_id)
    if market is not None:
        query = query.filter(ModelPrediction.market == market)
    if risk_level is not None:
        query = query.filter(ModelPrediction.risk_level == risk_level)
    if min_ev is not None:
        query = query.filter(ModelPrediction.ev >= min_ev)

    predictions = query.order_by(ModelPrediction.ev.desc()).limit(limit).all()
    return [recommendation_to_out(p) for p in predictions]
