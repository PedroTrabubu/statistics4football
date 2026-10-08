from datetime import datetime

from pydantic import BaseModel

from app.db.models import Match, TeamMatchStats


class MatchOut(BaseModel):
    id: int
    date: datetime
    status: str
    league_id: int
    league_code: str
    season: str
    home_team_id: int
    away_team_id: int
    home_team: str
    away_team: str
    home_goals: int | None
    away_goals: int | None
    home_ht_goals: int | None = None
    away_ht_goals: int | None = None
    referee: str | None = None
    matchday: int | None = None
    # Jornada deducida de las fechas, no dada por la fuente (ver app/ingestion/matchdays.py).
    matchday_estimated: bool = False


class TeamMatchStatsOut(BaseModel):
    corners: int | None
    yellow_cards: int | None
    red_cards: int | None
    fouls: int | None
    shots: int | None
    shots_on_target: int | None


class MatchResultOut(MatchOut):
    """Partido jugado + stats de cada equipo (corners, tarjetas, faltas,
    tiros), para los mercados por equipo del frontend."""

    home_stats: TeamMatchStatsOut | None
    away_stats: TeamMatchStatsOut | None


class MatchRefereeStatsOut(BaseModel):
    referee: str | None
    referee_scope: str
    referee_matches: list[MatchResultOut]
    home_matches: list[MatchResultOut]
    away_matches: list[MatchResultOut]


def match_to_out(match: Match) -> MatchOut:
    return MatchOut(
        id=match.id,
        date=match.date,
        status=match.status.value,
        league_id=match.league_id,
        league_code=match.league.code,
        season=match.season.name,
        home_team_id=match.home_team_id,
        away_team_id=match.away_team_id,
        home_team=match.home_team.name,
        away_team=match.away_team.name,
        home_goals=match.home_goals,
        away_goals=match.away_goals,
        home_ht_goals=match.home_ht_goals,
        away_ht_goals=match.away_ht_goals,
        referee=match.referee,
        matchday=match.matchday,
        matchday_estimated=match.matchday_estimated,
    )


def _stats_out(stats: TeamMatchStats | None) -> TeamMatchStatsOut | None:
    if stats is None:
        return None
    return TeamMatchStatsOut(
        corners=stats.corners_for,
        yellow_cards=stats.yellow_cards,
        red_cards=stats.red_cards,
        fouls=stats.fouls,
        shots=stats.shots,
        shots_on_target=stats.shots_on_target,
    )


def match_to_result_out(match: Match) -> MatchResultOut:
    by_team = {s.team_id: s for s in match.team_stats}
    return MatchResultOut(
        **match_to_out(match).model_dump(),
        home_stats=_stats_out(by_team.get(match.home_team_id)),
        away_stats=_stats_out(by_team.get(match.away_team_id)),
    )
