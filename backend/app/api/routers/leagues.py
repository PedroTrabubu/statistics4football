from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.models import League
from app.db.session import get_db
from app.schemas.league import LeagueOut
from app.schemas.season_stats import TeamSeasonStatsOut
from app.stats.season_stats import compute_league_season_stats, list_seasons_with_history

router = APIRouter(prefix="/leagues", tags=["leagues"])


@router.get("", response_model=list[LeagueOut])
def list_leagues(db: Session = Depends(get_db)) -> list[League]:
    return db.query(League).order_by(League.name).all()


@router.get("/{league_id}/seasons", response_model=list[str])
def list_league_seasons(league_id: int, db: Session = Depends(get_db)) -> list[str]:
    """Temporadas con partidos ya jugados (mas reciente primero)."""
    return list_seasons_with_history(db, league_id)


@router.get("/{league_id}/season-stats", response_model=list[TeamSeasonStatsOut])
def get_league_season_stats(
    league_id: int,
    season: str | None = None,
    db: Session = Depends(get_db),
) -> list[TeamSeasonStatsOut]:
    """Estadisticas reales por equipo (over/under, BTTS, porteria a cero,
    forma local/visitante) para una temporada. Sin `season`, usa la mas
    reciente con partidos jugados."""
    return compute_league_season_stats(db, league_id, season_name=season)
