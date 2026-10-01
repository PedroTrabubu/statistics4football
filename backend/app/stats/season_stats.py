"""Estadisticas agregadas por equipo a lo largo de una temporada: % over/under, % ambos anotan, % porteria a cero, forma
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

    # Descanso y tarjetas: mismo criterio que los corners, se promedian solo
    # sobre los partidos que traen ese dato.
    matches_with_ht: int = 0
    ht_over_0_5: int = 0
    ht_wins: int = 0

    matches_with_cards: int = 0
    yellow_for: int = 0
    yellow_against: int = 0

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


    @property
    def ht_over_0_5_pct(self) -> float | None:
        return None if self.matches_with_ht == 0 else round(100 * self.ht_over_0_5 / self.matches_with_ht, 1)

    @property
    def ht_win_pct(self) -> float | None:
        return None if self.matches_with_ht == 0 else round(100 * self.ht_wins / self.matches_with_ht, 1)

    @property
    def yellow_for_avg(self) -> float | None:
        return None if self.matches_with_cards == 0 else round(self.yellow_for / self.matches_with_cards, 2)

    @property
    def yellow_against_avg(self) -> float | None:
        return None if self.matches_with_cards == 0 else round(self.yellow_against / self.matches_with_cards, 2)


RECENT_MATCHES = 5


@dataclass
class TeamSeasonStats:
    team_id: int
    team_name: str
    season: str
    overall: SplitStats = field(default_factory=SplitStats)
    home: SplitStats = field(default_factory=SplitStats)
    away: SplitStats = field(default_factory=SplitStats)
    # Ultimos RECENT_MATCHES partidos de la temporada (local o visitante).
    last5: SplitStats = field(default_factory=SplitStats)
    # Resultados de esos partidos, del mas antiguo al mas reciente: "W"/"D"/"L".
    form: list[str] = field(default_factory=list)


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


def _add_half_time(split: SplitStats, ht_for: int, ht_against: int) -> None:
    split.matches_with_ht += 1
    if ht_for + ht_against > 0:
        split.ht_over_0_5 += 1
    if ht_for > ht_against:
        split.ht_wins += 1


def _add_cards(split: SplitStats, yellow_for: int, yellow_against: int) -> None:
    split.matches_with_cards += 1
    split.yellow_for += yellow_for
    split.yellow_against += yellow_against


def _result_letter(goals_for: int, goals_against: int) -> str:
    if goals_for > goals_against:
        return "W"
    return "D" if goals_for == goals_against else "L"


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

    matches = sorted(
        (m for m in matches if m.home_goals is not None and m.away_goals is not None),
        key=lambda m: m.date,
    )
    recent_ids = {m.id for m in matches[-RECENT_MATCHES:]}

    # Filas de ambos equipos: las tarjetas en contra salen de la fila del rival.
    match_ids = [m.id for m in matches]
    rows_by_match: dict[tuple[int, int], TeamMatchStats] = {
        (row.match_id, row.team_id): row
        for row in db.query(TeamMatchStats).filter(TeamMatchStats.match_id.in_(match_ids))
    }

    stats = TeamSeasonStats(team_id=team.id, team_name=team.name, season=season.name)
    for match in matches:
        is_home = match.home_team_id == team.id
        goals_for = match.home_goals if is_home else match.away_goals
        goals_against = match.away_goals if is_home else match.home_goals
        opponent_id = match.away_team_id if is_home else match.home_team_id

        splits = [stats.overall, stats.home if is_home else stats.away]
        if match.id in recent_ids:
            splits.append(stats.last5)
            stats.form.append(_result_letter(goals_for, goals_against))

        own = rows_by_match.get((match.id, team.id))
        opponent = rows_by_match.get((match.id, opponent_id))
        has_ht = match.home_ht_goals is not None and match.away_ht_goals is not None

        for split in splits:
            _add_match(split, goals_for, goals_against)
            if own is not None and own.corners_for is not None:
                _add_corners(split, own.corners_for, own.corners_against or 0)
            if has_ht:
                ht_for = match.home_ht_goals if is_home else match.away_ht_goals
                ht_against = match.away_ht_goals if is_home else match.home_ht_goals
                _add_half_time(split, ht_for, ht_against)
            if (
                own is not None
                and opponent is not None
                and own.yellow_cards is not None
                and opponent.yellow_cards is not None
            ):
                _add_cards(split, own.yellow_cards, opponent.yellow_cards)

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
