from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.config import Settings, get_settings
from app.db.models import League, Match, MatchStatus, Season
from app.db.session import get_db
from app.schemas.league import LeagueMatchdaysOut, LeagueOut, MatchdayOut
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


# Una jornada sigue siendo la actual hasta 2 días después de su fecha central.
CURRENT_MATCHDAY_GRACE = timedelta(days=2)


@router.get("/{league_id}/matchdays", response_model=LeagueMatchdaysOut)
def list_league_matchdays(league_id: int, season: str | None = None, db: Session = Depends(get_db)) -> LeagueMatchdaysOut:
    """Jornadas de una temporada (por defecto, la del próximo partido o la
    última) y cuál mostrar por defecto: la primera cuya fecha central no haya
    pasado hace más de 2 días. Así un aplazado de hace meses no la deja atrás."""
    seasons = [
        name
        for (name,) in db.query(Season.name)
        .join(Match, Match.season_id == Season.id)
        .filter(Season.league_id == league_id)
        .distinct()
        .order_by(Season.name.desc())
    ]
    now = datetime.utcnow()
    if season is None:
        upcoming = (
            db.query(Season.name)
            .join(Match, Match.season_id == Season.id)
            .filter(Season.league_id == league_id, Match.status == MatchStatus.SCHEDULED, Match.date >= now)
            .order_by(Match.date.asc())
            .first()
        )
        season = upcoming[0] if upcoming else (seasons[0] if seasons else None)

    matches = (
        db.query(Match.matchday, Match.date, Match.status, Match.matchday_estimated)
        .join(Season, Season.id == Match.season_id)
        .filter(Match.league_id == league_id, Season.name == season, Match.matchday.is_not(None))
        .all()
    )
    by_matchday: dict[int, list] = defaultdict(list)
    for row in matches:
        by_matchday[row.matchday].append(row)
    matchdays = [
        MatchdayOut(
            matchday=number,
            start=min(r.date for r in rows),
            end=max(r.date for r in rows),
            played=sum(r.status == MatchStatus.HISTORICAL for r in rows),
            total=len(rows),
        )
        for number, rows in sorted(by_matchday.items())
    ]
    centers = {number: sorted(r.date for r in rows)[len(rows) // 2] for number, rows in by_matchday.items()}
    current = next((n for n in sorted(centers) if centers[n] >= now - CURRENT_MATCHDAY_GRACE), None)
    if current is None and matchdays:
        current = matchdays[-1].matchday
    return LeagueMatchdaysOut(
        seasons=seasons,
        season=season,
        current=current,
        estimated=any(r.matchday_estimated for r in matches),
        matchdays=matchdays,
    )


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
