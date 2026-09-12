from pydantic import BaseModel, ConfigDict


class TeamFormOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    matches_played: int
    points: int
    wins: int
    draws: int
    losses: int
    goals_for: int
    goals_against: int
    points_per_game: float | None
    goal_difference: int


class HeadToHeadOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    matches_played: int
    team_a_wins: int
    team_b_wins: int
    draws: int
    team_a_goals: int
    team_b_goals: int


class XgFormOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    matches_with_data: int
    avg_xg_for: float | None
    avg_xg_against: float | None


class MatchFeaturesOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    home_form: TeamFormOut
    away_form: TeamFormOut
    h2h: HeadToHeadOut
    home_xg_form: XgFormOut
    away_xg_form: XgFormOut
    home_elo: float | None
    away_elo: float | None
