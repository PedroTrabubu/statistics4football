"""Estadisticas agregadas por equipo a lo largo de una temporada :
% over/under, % ambos anotan, % porteria a cero, forma
local/visitante/total.

A diferencia del resto de `app/stats/` (point-in-time, pensado para
alimentar el modelo de prediccion para UN partido concreto), esto agrega
TODOS los partidos historicos de una temporada para un equipo: es para
explorar tendencias reales, no para el motor de prediccion.
"""

from dataclasses import dataclass, field

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db.models import Match, MatchStatus, Season, Team, TeamMatchStats


@dataclass
class SplitStats:
    matches_played: int = 0
    wins: int = 0
    draws: int = 0
    losses: int = 0
    goals_for: int = 0
    goals_against: int = 0
    over_1_5: int = 0
    over_2_5: int = 0
    over_3_5: int = 0
    btts: int = 0
    clean_sheets: int = 0
    failed_to_score: int = 0

    # Corners: no todos los partidos historicos lo traen (ver
    # historical_backfill.py), asi que se promedia sobre
    # matches_with_corners, no sobre matches_played (mismo criterio que
    # XgForm/DisciplineForm: nunca inflar/diluir una media con partidos sin
    # dato real).
    matches_with_corners: int = 0
    corners_for: int = 0
    corners_against: int = 0

    @property
    def points(self) -> int:
        return self.wins * 3 + self.draws

    def _pct(self, count: int) -> float | None:
        if self.matches_played == 0:
            return None
        return round(100 * count / self.matches_played, 1)

    @property
    def points_per_game(self) -> float | None:
        return None if self.matches_played == 0 else round(self.points / self.matches_played, 2)

    @property
    def goals_for_avg(self) -> float | None:
        return None if self.matches_played == 0 else round(self.goals_for / self.matches_played, 2)

    @property
    def goals_against_avg(self) -> float | None:
        return None if self.matches_played == 0 else round(self.goals_against / self.matches_played, 2)

    @property
    def over_1_5_pct(self) -> float | None:
        return self._pct(self.over_1_5)

    @property
    def over_2_5_pct(self) -> float | None:
        return self._pct(self.over_2_5)

    @property
    def over_3_5_pct(self) -> float | None:
        return self._pct(self.over_3_5)

    @property
    def btts_pct(self) -> float | None:
        return self._pct(self.btts)

    @property
    def clean_sheet_pct(self) -> float | None:
        return self._pct(self.clean_sheets)

    @property
    def failed_to_score_pct(self) -> float | None:
        return self._pct(self.failed_to_score)

    @property
    def corners_for_avg(self) -> float | None:
        return None if self.matches_with_corners == 0 else round(self.corners_for / self.matches_with_corners, 2)

    @property
    def corners_against_avg(self) -> float | None:
        return (
            None
            if self.matches_with_corners == 0
            else round(self.corners_against / self.matches_with_corners, 2)
        )


@dataclass
class TeamSeasonStats:
    team_id: int
    team_name: str
    season: str
    overall: SplitStats = field(default_factory=SplitStats)
    home: SplitStats = field(default_factory=SplitStats)
    away: SplitStats = field(default_factory=SplitStats)


def _add_match(split: SplitStats, goals_for: int, goals_against: int) -> None:
    split.matches_played += 1
    split.goals_for += goals_for
    split.goals_against += goals_against

    if goals_for > goals_against:
        split.wins += 1
    elif goals_for == goals_against:
        split.draws += 1
    else:
        split.losses += 1

    total_goals = goals_for + goals_against
    if total_goals > 1.5:
        split.over_1_5 += 1
    if total_goals > 2.5:
        split.over_2_5 += 1
    if total_goals > 3.5:
        split.over_3_5 += 1
    if goals_for > 0 and goals_against > 0:
        split.btts += 1
    if goals_against == 0:
        split.clean_sheets += 1
    if goals_for == 0:
        split.failed_to_score += 1


def _add_corners(split: SplitStats, corners_for: int, corners_against: int) -> None:
    split.matches_with_corners += 1
    split.corners_for += corners_for
    split.corners_against += corners_against


def compute_team_season_stats(db: Session, team: Team, season: Season) -> TeamSeasonStats:
    matches = (
        db.query(Match)
        .filter(
            Match.season_id == season.id,
            Match.status == MatchStatus.HISTORICAL,
            or_(Match.home_team_id == team.id, Match.away_team_id == team.id),
        )
        .all()
    )

    match_ids = [m.id for m in matches]
    corners_by_match: dict[int, TeamMatchStats] = {
        row.match_id: row
        for row in db.query(TeamMatchStats).filter(
            TeamMatchStats.team_id == team.id,
            TeamMatchStats.match_id.in_(match_ids),
        )
    }

    stats = TeamSeasonStats(team_id=team.id, team_name=team.name, season=season.name)
    for match in matches:
        if match.home_goals is None or match.away_goals is None:
            continue
        is_home = match.home_team_id == team.id
        goals_for = match.home_goals if is_home else match.away_goals
        goals_against = match.away_goals if is_home else match.home_goals

        _add_match(stats.overall, goals_for, goals_against)
        split = stats.home if is_home else stats.away
        _add_match(split, goals_for, goals_against)

        team_stats = corners_by_match.get(match.id)
        if team_stats is not None and team_stats.corners_for is not None:
            _add_corners(stats.overall, team_stats.corners_for, team_stats.corners_against or 0)
            _add_corners(split, team_stats.corners_for, team_stats.corners_against or 0)

    return stats


def get_team_season_stats(
    db: Session, team: Team, season_name: str | None = None
) -> TeamSeasonStats | None:
    """Stats de un equipo para una temporada (la mas reciente con partidos
    jugados en su liga, si no se especifica). None si esa temporada no
    existe o el equipo no jugo ningun partido en ella."""
    if season_name is None:
        season = latest_season_with_history(db, team.league_id)
    else:
        season = db.query(Season).filter_by(league_id=team.league_id, name=season_name).one_or_none()

    if season is None:
        return None

    stats = compute_team_season_stats(db, team, season)
    return stats if stats.overall.matches_played > 0 else None


def latest_season_with_history(db: Session, league_id: int) -> Season | None:
    return (
        db.query(Season)
        .join(Match, Match.season_id == Season.id)
        .filter(Season.league_id == league_id, Match.status == MatchStatus.HISTORICAL)
        .order_by(Season.name.desc())
        .distinct()
        .first()
    )


def list_seasons_with_history(db: Session, league_id: int) -> list[str]:
    rows = (
        db.query(Season.name)
        .join(Match, Match.season_id == Season.id)
        .filter(Season.league_id == league_id, Match.status == MatchStatus.HISTORICAL)
        .distinct()
        .order_by(Season.name.desc())
        .all()
    )
    return [row[0] for row in rows]


def compute_league_season_stats(
    db: Session, league_id: int, season_name: str | None = None
) -> list[TeamSeasonStats]:
    """Tabla de estadisticas de todos los equipos de una liga para una
    temporada (la mas reciente con partidos jugados, si no se especifica).
    Equipos sin ningun partido jugado en esa temporada (recien ascendidos
    para la temporada siguiente, o ya no en la liga) se omiten."""
    if season_name is None:
        season = latest_season_with_history(db, league_id)
    else:
        season = db.query(Season).filter_by(league_id=league_id, name=season_name).one_or_none()

    if season is None:
        return []

    teams = db.query(Team).filter_by(league_id=league_id).order_by(Team.name).all()
    stats = [compute_team_season_stats(db, team, season) for team in teams]
    return [s for s in stats if s.overall.matches_played > 0]
