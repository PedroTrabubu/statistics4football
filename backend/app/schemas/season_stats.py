from pydantic import BaseModel, ConfigDict


class SplitStatsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    matches_played: int
    wins: int
    draws: int
    losses: int
    points: int
    points_per_game: float | None
    goals_for: int
    goals_against: int
    goals_for_avg: float | None
    goals_against_avg: float | None
    over_1_5_pct: float | None
    over_2_5_pct: float | None
    over_3_5_pct: float | None
    btts_pct: float | None
    clean_sheet_pct: float | None
    failed_to_score_pct: float | None
    matches_with_corners: int
    corners_for_avg: float | None
    corners_against_avg: float | None


class TeamSeasonStatsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    team_id: int
    team_name: str
    season: str
    overall: SplitStatsOut
    home: SplitStatsOut
    away: SplitStatsOut
