from datetime import datetime

from pydantic import BaseModel

from app.db.models import Match


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
    )
