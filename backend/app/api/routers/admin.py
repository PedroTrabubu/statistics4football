from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.models import Match
from app.db.session import get_db
from app.probability.engine import generate_predictions_for_match, get_cached_league_model

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/predictions/generate")
def generate_predictions(
    league_id: int,
    date_from: datetime,
    date_to: datetime,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Genera/actualiza predicciones para todos los partidos de una liga en
    un rango de fechas. Util para partidos futuros en cuanto haya ingesta de
    football-data.org/API-Football, o para recalcular tras cambiar el motor."""
    matches = (
        db.query(Match)
        .filter(Match.league_id == league_id, Match.date >= date_from, Match.date <= date_to)
        .all()
    )
    if not matches:
        raise HTTPException(status_code=404, detail="No matches in the given range")

    model = get_cached_league_model(db, league_id, as_of_date=date_to)
    count = 0
    for match in matches:
        generate_predictions_for_match(db, match, model, settings.ev_threshold)
        count += 1
    db.commit()

    return {"matches_processed": count}
