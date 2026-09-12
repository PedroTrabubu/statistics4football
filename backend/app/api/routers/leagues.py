from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.models import League
from app.db.session import get_db
from app.schemas.league import LeagueOut

router = APIRouter(prefix="/leagues", tags=["leagues"])


@router.get("", response_model=list[LeagueOut])
def list_leagues(db: Session = Depends(get_db)) -> list[League]:
    return db.query(League).order_by(League.name).all()
