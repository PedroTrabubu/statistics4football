from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.models import Team
from app.db.session import get_db
from app.schemas.team import TeamOut

router = APIRouter(prefix="/teams", tags=["teams"])


@router.get("", response_model=list[TeamOut])
def list_teams(league_id: int | None = None, db: Session = Depends(get_db)) -> list[Team]:
    query = db.query(Team)
    if league_id is not None:
        query = query.filter(Team.league_id == league_id)
    return query.order_by(Team.name).all()
