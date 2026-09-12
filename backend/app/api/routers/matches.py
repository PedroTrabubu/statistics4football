from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.models import Match, MatchStatus, Season
from app.db.session import get_db
from app.probability.engine import generate_predictions_for_match, get_cached_league_model
from app.schemas.match import MatchOut, match_to_out
from app.schemas.prediction import PredictionOut
from app.schemas.stats import MatchFeaturesOut
from app.stats.features import compute_match_features

router = APIRouter(prefix="/matches", tags=["matches"])


def _get_match_or_404(db: Session, match_id: int) -> Match:
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found")
    return match


@router.get("", response_model=list[MatchOut])
def list_matches(
    league_id: int | None = None,
    season: str | None = None,
    status: MatchStatus | None = None,
    team_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> list[MatchOut]:
    query = db.query(Match)
    if league_id is not None:
        query = query.filter(Match.league_id == league_id)
    if season is not None:
        query = query.join(Season, Season.id == Match.season_id).filter(Season.name == season)
    if status is not None:
        query = query.filter(Match.status == status)
    if team_id is not None:
        query = query.filter(or_(Match.home_team_id == team_id, Match.away_team_id == team_id))
    if date_from is not None:
        query = query.filter(Match.date >= date_from)
    if date_to is not None:
        query = query.filter(Match.date <= date_to)

    matches = query.order_by(Match.date.desc()).offset(offset).limit(limit).all()
    return [match_to_out(m) for m in matches]


@router.get("/{match_id}", response_model=MatchOut)
def get_match(match_id: int, db: Session = Depends(get_db)) -> MatchOut:
    return match_to_out(_get_match_or_404(db, match_id))


@router.get("/{match_id}/stats", response_model=MatchFeaturesOut)
def get_match_stats(
    match_id: int,
    num_matches: int = Query(5, ge=1, le=20),
    db: Session = Depends(get_db),
) -> MatchFeaturesOut:
    match = _get_match_or_404(db, match_id)
    features = compute_match_features(db, match, num_matches=num_matches)
    return MatchFeaturesOut.model_validate(features)


@router.get("/{match_id}/predictions", response_model=list[PredictionOut])
def get_match_predictions(
    match_id: int,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> list[PredictionOut]:
    """Genera (o regenera) las predicciones de EV para este partido al vuelo.

    El modelo de la liga se cachea en memoria por dia (ver
    `get_cached_league_model`), asi que solo el primer partido consultado
    ese dia para esa liga paga el coste de ajustar Dixon-Coles.
    """
    match = _get_match_or_404(db, match_id)
    model = get_cached_league_model(db, match.league_id, as_of_date=match.date)
    predictions = generate_predictions_for_match(db, match, model, settings.ev_threshold)
    db.commit()
    return predictions
