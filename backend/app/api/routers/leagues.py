from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.config import Settings, get_settings
from app.db.models import League, Match, MatchStatus, Season
from app.db.session import get_db
from app.schemas.league import LeagueOut
from app.schemas.match import MatchResultOut, match_to_result_out
from app.schemas.season_stats import TeamSeasonStatsOut
from app.stats.season_stats import (
    compute_league_season_stats,
    latest_season_with_history,
    list_seasons_with_history,
)

router = APIRouter(prefix="/leagues", tags=["leagues"])


@router.get("", response_model=list[LeagueOut])
def list_leagues(db: Session = Depends(get_db), settings: Settings = Depends(get_settings)) -> list[LeagueOut]:
    return [
        LeagueOut.model_validate(league).model_copy(update={"validated": league.code in settings.model_leagues})
        for league in db.query(League).order_by(League.name)
    ]


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


@router.get("/{league_id}/results", response_model=list[MatchResultOut])
def list_league_results(
    league_id: int,
    season: str | None = None,
    db: Session = Depends(get_db),
) -> list[MatchResultOut]:
    """Todos los partidos ya jugados de una temporada (la mas reciente con
    partidos jugados, si no se especifica), mas recientes primero, con los
    goles al descanso, el arbitro y las stats de cada equipo (corners,
    tarjetas, faltas, tiros). Sin paginar: el frontend calcula sobre ellos
    los mercados por equipo, y una temporada son como mucho ~380."""
    if season is None:
        latest = latest_season_with_history(db, league_id)
        if latest is None:
            return []
        season = latest.name

    matches = (
        db.query(Match)
        .join(Season, Season.id == Match.season_id)
        .filter(
            Match.league_id == league_id,
            Season.name == season,
            Match.status == MatchStatus.HISTORICAL,
        )
        .options(
            joinedload(Match.league),
            joinedload(Match.season),
            joinedload(Match.home_team),
            joinedload(Match.away_team),
            selectinload(Match.team_stats),
        )
        .order_by(Match.date.desc())
        .all()
    )
    return [match_to_result_out(m) for m in matches]
