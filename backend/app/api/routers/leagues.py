from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.competitions import CHAMPIONS_LEAGUE
from app.core.config import Settings, get_settings
from app.db.models import IngestionRun, League, Match, MatchOdds, MatchStatus, Season
from app.db.session import get_db
from app.probability.engine import INDIVIDUAL_BOOKMAKERS, REFERENCE_BOOKMAKER, _sane_price
from app.schemas.league import LeagueMatchdaysOut, LeagueOut, MatchdayOut
from app.schemas.match import (
    MarketOddsOut,
    MatchResultOut,
    UpcomingMatchOut,
    match_to_out,
    match_to_result_out,
)
from app.schemas.season_stats import TeamSeasonStatsOut
from app.schemas.result import LeagueResultProbabilitiesOut
from app.schemas.stats import MatchEloOut
from app.probability.result_predictions import league_season_result_probabilities
from app.stats.own_elo import league_season_elo
from app.stats.season_stats import (
    compute_league_season_stats,
    latest_season_with_history,
    list_seasons_with_history,
)

router = APIRouter(prefix="/leagues", tags=["leagues"])


@router.get("", response_model=list[LeagueOut])
def list_leagues(db: Session = Depends(get_db), settings: Settings = Depends(get_settings)) -> list[LeagueOut]:
    """Las ligas activas: las de contexto (solo para el historial de los equipos
    de Champions) no salen en la web."""
    return [
        LeagueOut.model_validate(league).model_copy(
            update={
                "validated": league.code in settings.model_leagues,
                "high_probability": league.code in settings.pattern_leagues,
            }
        )
        for league in db.query(League).filter(League.code.in_(settings.leagues)).order_by(League.name)
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


@router.get("/{league_id}/elo", response_model=list[MatchEloOut])
def list_league_elo(
    league_id: int,
    season: str | None = None,
    db: Session = Depends(get_db),
) -> list[MatchEloOut]:
    """Elo propio previo de cada partido de una temporada (la mas reciente con
    partidos jugados, si no se especifica), jugados y programados. Solo lee
    `own_elo_pre` (scripts/refresh_own_elo.py): el export estatico lo guarda
    en un fichero por liga y temporada."""
    if season is None:
        latest = latest_season_with_history(db, league_id)
        if latest is None:
            return []
        season = latest.name
    return [MatchEloOut.model_validate(e) for e in league_season_elo(db, league_id, season)]


@router.get("/{league_id}/result-probabilities", response_model=LeagueResultProbabilitiesOut)
def list_league_result_probabilities(
    league_id: int,
    season: str | None = None,
    db: Session = Depends(get_db),
) -> LeagueResultProbabilitiesOut:
    """Porcentajes de resultado de cada partido de una temporada (la mas reciente
    con partidos jugados, si no se especifica) y el resumen de la liga. Solo
    lee: el export estatico lo guarda en un fichero por liga y temporada."""
    if season is None:
        latest = latest_season_with_history(db, league_id)
        if latest is None:
            return LeagueResultProbabilitiesOut(summary=None, predictions=[])
        season = latest.name
    return LeagueResultProbabilitiesOut.model_validate(league_season_result_probabilities(db, league_id, season))


@router.get("/{league_id}/context-results", response_model=list[MatchResultOut])
def list_league_context_results(
    league_id: int,
    season: str | None = None,
    db: Session = Depends(get_db),
) -> list[MatchResultOut]:
    """Solo en la Champions: los partidos jugados de sus equipos en sus ligas
    (las de la web y las de contexto) en esa temporada, mas recientes primero.
    Para ver cada mercado de un equipo de Champions tambien en su liga. En el
    resto de ligas, vacio."""
    league = db.get(League, league_id)
    if league is None or league.code != CHAMPIONS_LEAGUE:
        return []
    if season is None:
        latest = latest_season_with_history(db, league_id)
        if latest is None:
            return []
        season = latest.name

    in_season = (
        db.query(Match.home_team_id, Match.away_team_id)
        .join(Season, Season.id == Match.season_id)
        .filter(Match.league_id == league_id, Season.name == season)
    )
    team_ids = {team_id for pair in in_season for team_id in pair}
    if not team_ids:
        return []
    matches = (
        db.query(Match)
        .join(Season, Season.id == Match.season_id)
        .filter(
            Match.league_id != league_id,
            Match.status == MatchStatus.HISTORICAL,
            Season.name == season,
            or_(Match.home_team_id.in_(team_ids), Match.away_team_id.in_(team_ids)),
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


# Mercados con cuota media para partidos por jugar (fixtures.csv y the-odds-api).
UPCOMING_ODDS_MARKETS = ("1x2", "over_under_2.5")
ODDS_API_RUN = "the_odds_api.prematch_odds"


@router.get("/{league_id}/upcoming", response_model=list[UpcomingMatchOut])
def list_league_upcoming(
    league_id: int,
    days: int = Query(7, ge=1, le=14),
    db: Session = Depends(get_db),
) -> list[UpcomingMatchOut]:
    """Partidos por jugar de los próximos `days` días, los más cercanos
    primero, con el árbitro si ya está designado y la "Market Average" de 1x2 y
    más/menos de 2,5 goles (la misma referencia de la web, sin Market Max ni
    casas concretas), con la fecha y la fuente de la toma."""
    now = datetime.utcnow()
    matches = (
        db.query(Match)
        .filter(
            Match.league_id == league_id,
            Match.status == MatchStatus.SCHEDULED,
            Match.date >= now - timedelta(hours=3),
            Match.date <= now + timedelta(days=days),
        )
        .options(
            joinedload(Match.league),
            joinedload(Match.season),
            joinedload(Match.home_team),
            joinedload(Match.away_team),
        )
        .order_by(Match.date.asc())
        .all()
    )
    odds_api_runs = [
        (run.started_at, run.finished_at or run.started_at)
        for run in db.query(IngestionRun).filter(IngestionRun.source == ODDS_API_RUN)
    ]

    # Una sola consulta: la media y las casas individuales (para sanearla).
    # Solo por partido: con mas filtros SQLite elige el indice de mercado y
    # recorre todas las cuotas historicas (un segundo en vez de milisegundos).
    wanted = {REFERENCE_BOOKMAKER, *INDIVIDUAL_BOOKMAKERS}
    odds_by_match: dict[int, list[MatchOdds]] = defaultdict(list)
    if matches:
        for row in db.query(MatchOdds).filter(MatchOdds.match_id.in_([m.id for m in matches])):
            if row.bookmaker in wanted and row.market in UPCOMING_ODDS_MARKETS:
                odds_by_match[row.match_id].append(row)

    out = []
    for match in matches:
        own = odds_by_match[match.id]
        rows = [r for r in own if r.bookmaker == REFERENCE_BOOKMAKER]
        item = UpcomingMatchOut(**match_to_out(match).model_dump())
        if rows:
            taken = max(r.snapshot_time for r in rows)
            individual: dict[tuple[str, str], list[float]] = defaultdict(list)
            for o in own:
                if o.bookmaker != REFERENCE_BOOKMAKER:
                    individual[(o.market, o.selection)].append(o.odds)
            # El mismo saneado que el motor: un agregado disparado respecto a
            # las casas individuales no se muestra tal cual.
            item.odds = [
                MarketOddsOut(
                    market=r.market,
                    selection=r.selection,
                    line=r.line,
                    odds=_sane_price(r.odds, individual[(r.market, r.selection)]),
                )
                for r in rows
            ]
            item.odds_taken_at = taken
            from_odds_api = any(start <= taken <= end for start, end in odds_api_runs)
            item.odds_source = "the-odds-api.com" if from_odds_api else "Football-Data.co.uk"
        out.append(item)
    return out
