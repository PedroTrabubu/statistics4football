from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.models import Team
from app.db.session import get_db
from app.schemas.season_stats import TeamSeasonStatsOut
from app.schemas.team import TeamOut
from app.stats.season_stats import get_team_season_stats

router = APIRouter(prefix="/teams", tags=["teams"])


@router.get("", response_model=list[TeamOut])
def list_teams(league_id: int | None = None, db: Session = Depends(get_db)) -> list[Team]:
    query = db.query(Team)
    if league_id is not None:
        query = query.filter(Team.league_id == league_id)
    return query.order_by(Team.name).all()


@router.get("/{team_id}/season-stats", response_model=TeamSeasonStatsOut)
def get_team_season_stats_endpoint(
    team_id: int,
    season: str | None = None,
    db: Session = Depends(get_db),
) -> TeamSeasonStatsOut:
    """Estadisticas reales del equipo (over/under, BTTS, porteria a cero,
    forma local/visitante) para una temporada. Sin `season`, usa la mas
    reciente con partidos jugados."""
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")

    stats = get_team_season_stats(db, team, season_name=season)
    if stats is None:
        raise HTTPException(status_code=404, detail="No season stats available")
    return stats
