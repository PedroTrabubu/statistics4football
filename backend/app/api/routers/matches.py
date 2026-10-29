from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Query as SAQuery
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.competitions import CHAMPIONS_LEAGUE
from app.core.config import Settings, get_settings
from app.db.models import Match, MatchStatus, Season
from app.db.session import get_db
from app.probability.engine import generate_predictions_for_match, get_cached_league_model
from app.probability.result_predictions import match_result_probabilities
from app.schemas.match import (
    MatchHistoryOut,
    MatchOut,
    MatchRecentOut,
    MatchRefereeStatsOut,
    match_to_out,
    match_to_result_out,
)
from app.schemas.prediction import PredictionOut
from app.schemas.result import MatchResultProbabilitiesOut
from app.schemas.stats import MatchFeaturesOut
from app.stats.features import compute_match_features, excluded_leagues

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
    matchday: int | None = None,
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
    if matchday is not None:
        query = query.filter(Match.matchday == matchday)
    if status is not None:
        query = query.filter(Match.status == status)
    if team_id is not None:
        query = query.filter(or_(Match.home_team_id == team_id, Match.away_team_id == team_id))
    if date_from is not None:
        query = query.filter(Match.date >= date_from)
    if date_to is not None:
        query = query.filter(Match.date <= date_to)

    # Proximos partidos: los mas cercanos primero (lo util al mirar "que se
    # juega pronto"). Historico/sin filtro: los mas recientes primero.
    order = Match.date.asc() if status == MatchStatus.SCHEDULED else Match.date.desc()
    matches = query.order_by(order).offset(offset).limit(limit).all()
    return [match_to_out(m) for m in matches]


@router.get("/{match_id}", response_model=MatchOut)
def get_match(match_id: int, db: Session = Depends(get_db)) -> MatchOut:
    return match_to_out(_get_match_or_404(db, match_id))


@router.get("/{match_id}/result-probabilities", response_model=MatchResultProbabilitiesOut)
def get_match_result_probabilities(match_id: int, db: Session = Depends(get_db)) -> MatchResultProbabilitiesOut:
    """Porcentajes de resultado (1X2) ya guardados del partido, con el acierto
    historico de su liga. Solo lee (scripts/refresh_result_predictions.py los genera)."""
    match = _get_match_or_404(db, match_id)
    return MatchResultProbabilitiesOut.model_validate(match_result_probabilities(db, match))


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

    Con ENABLE_EV=false (modelo de valor retirado) responde 404.
    """
    if not settings.enable_ev:
        raise HTTPException(status_code=404, detail="Modelo de valor retirado (ENABLE_EV=false)")
    match = _get_match_or_404(db, match_id)
    model = get_cached_league_model(db, match.league_id, as_of_date=match.date)
    predictions = generate_predictions_for_match(db, match, model, settings.ev_threshold)
    db.commit()
    return predictions


def _played_before(db: Session, match: Match) -> SAQuery:
    """Partidos de la misma liga ya jugados antes de `match` (point-in-time:
    nunca el propio partido ni nada posterior), con lo necesario para
    `match_to_result_out` cargado de una vez."""
    return (
        db.query(Match)
        .filter(
            Match.league_id == match.league_id,
            Match.status == MatchStatus.HISTORICAL,
            Match.date < match.date,
        )
        .options(
            joinedload(Match.league),
            joinedload(Match.season),
            joinedload(Match.home_team),
            joinedload(Match.away_team),
            selectinload(Match.team_stats),
        )
        .order_by(Match.date.desc())
    )


# Temporadas de historial para los patrones: la del partido y la anterior.
HISTORY_SEASONS = 2


@router.get("/{match_id}/history", response_model=MatchHistoryOut)
def get_match_history(match_id: int, db: Session = Depends(get_db)) -> MatchHistoryOut:
    """Partidos de la liga ya jugados antes de este, de su temporada y de la
    anterior. Point-in-time como referee-stats: nunca el propio partido ni nada
    posterior. El frontend saca de aqui los patrones de cada equipo y la
    frecuencia de cada suceso en la liga."""
    match = _get_match_or_404(db, match_id)
    seasons = (
        db.query(Season)
        .filter(Season.league_id == match.league_id, Season.name <= match.season.name)
        .order_by(Season.name.desc())
        .limit(HISTORY_SEASONS)
        .all()
    )
    rows = _played_before(db, match).filter(Match.season_id.in_([s.id for s in seasons])).all()
    played = match_to_result_out(match) if match.status == MatchStatus.HISTORICAL else None
    context = []
    if match.league.code == CHAMPIONS_LEAGUE:
        context = (
            db.query(Match)
            .join(Season, Season.id == Match.season_id)
            .filter(
                Match.league_id != match.league_id,
                Match.status == MatchStatus.HISTORICAL,
                Match.date < match.date,
                Season.name.in_([s.name for s in seasons]),
                or_(
                    Match.home_team_id.in_([match.home_team_id, match.away_team_id]),
                    Match.away_team_id.in_([match.home_team_id, match.away_team_id]),
                ),
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
    return MatchHistoryOut(
        seasons=[s.name for s in seasons],
        matches=[match_to_result_out(m) for m in rows],
        played=played,
        context=[match_to_result_out(m) for m in context],
    )


# Enfrentamientos directos que se listan, de todas las temporadas.
RECENT_H2H = 10
# Ultimos partidos de cada equipo: el doble de los que se muestran, para que
# al filtrar los del local en casa (o los del visitante fuera) sigan saliendo.
RECENT_TEAM = 20


@router.get("/{match_id}/recent", response_model=MatchRecentOut)
def get_match_recent(match_id: int, db: Session = Depends(get_db)) -> MatchRecentOut:
    """Enfrentamientos directos previos y ultimos partidos de cada equipo, uno
    a uno. Point-in-time y con las competiciones de la forma reciente (en una
    liga, sin la Champions; ver `excluded_leagues`), en cualquier temporada."""
    match = _get_match_or_404(db, match_id)
    skip = excluded_leagues(db, match)

    def played_before() -> SAQuery:
        return (
            db.query(Match)
            .filter(
                Match.status == MatchStatus.HISTORICAL,
                Match.date < match.date,
                Match.league_id.notin_(skip),
            )
            .options(
                joinedload(Match.league),
                joinedload(Match.season),
                joinedload(Match.home_team),
                joinedload(Match.away_team),
                selectinload(Match.team_stats),
            )
            .order_by(Match.date.desc())
        )

    def team_matches(team_id: int) -> list:
        rows = (
            played_before()
            .filter(or_(Match.home_team_id == team_id, Match.away_team_id == team_id))
            .limit(RECENT_TEAM)
            .all()
        )
        return [match_to_result_out(m) for m in rows]

    pair = (match.home_team_id, match.away_team_id)
    h2h = (
        played_before()
        .filter(Match.home_team_id.in_(pair), Match.away_team_id.in_(pair))
        .limit(RECENT_H2H)
        .all()
    )
    return MatchRecentOut(
        h2h=[match_to_result_out(m) for m in h2h],
        home=team_matches(match.home_team_id),
        away=team_matches(match.away_team_id),
    )


@router.get("/{match_id}/referee-stats", response_model=MatchRefereeStatsOut)
def get_match_referee_stats(
    match_id: int,
    referee_scope: str = Query("season", pattern="^(season|all)$"),
    db: Session = Depends(get_db),
) -> MatchRefereeStatsOut:
    """Partidos previos del arbitro designado y de cada equipo, para comparar
    tarjetas/puntos de tarjeta. Los equipos, siempre en la temporada del
    partido; el arbitro, en esa temporada (`season`) o en todas las de la
    liga (`all`). El frontend calcula medias y porcentajes."""
    match = _get_match_or_404(db, match_id)

    def team_matches(team_id: int) -> list:
        rows = (
            _played_before(db, match)
            .filter(
                Match.season_id == match.season_id,
                or_(Match.home_team_id == team_id, Match.away_team_id == team_id),
            )
            .all()
        )
        return [match_to_result_out(m) for m in rows]

    referee_matches = []
    if match.referee:
        query = _played_before(db, match).filter(Match.referee == match.referee)
        if referee_scope == "season":
            query = query.filter(Match.season_id == match.season_id)
        referee_matches = [match_to_result_out(m) for m in query.all()]

    return MatchRefereeStatsOut(
        referee=match.referee,
        referee_scope=referee_scope,
        referee_matches=referee_matches,
        home_matches=team_matches(match.home_team_id),
        away_matches=team_matches(match.away_team_id),
    )
