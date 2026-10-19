"""Datos del pick del partido desde la base: los partidos de una liga con sus
estadisticas y el Dixon-Coles de cada dia. Lo usan el informe historico
(scripts/report_match_pick.py) y el endpoint de los partidos por jugar."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session, joinedload, selectinload

from app.picks.match_pick import MatchData, Picked, walk_forward
from app.db.models import Match, MatchStatus, Season
from app.probability.engine import get_cached_league_model

# Calentamiento: los recuentos y las frecuencias empiezan aqui.
FIRST_SEASON = "2324"


def _stats(match: Match) -> dict[str, tuple[int | None, int | None]]:
    by_team = {s.team_id: s for s in match.team_stats}
    home, away = by_team.get(match.home_team_id), by_team.get(match.away_team_id)

    def pair(get) -> tuple[int | None, int | None]:
        return (get(home) if home else None, get(away) if away else None)

    def cards(s) -> int | None:
        # Tarjetas = amarillas + rojas, como en la web (markets.ts).
        return None if s.yellow_cards is None or s.red_cards is None else s.yellow_cards + s.red_cards

    return {
        "corners": pair(lambda s: s.corners_for),
        "cards": pair(cards),
        "fouls": pair(lambda s: s.fouls),
        "shots": pair(lambda s: s.shots),
        "sot": pair(lambda s: s.shots_on_target),
    }


def to_match_data(m: Match) -> MatchData:
    played = m.status == MatchStatus.HISTORICAL
    return MatchData(
        match_id=m.id,
        league=m.league.code,
        season=m.season.name,
        date=m.date,
        home_id=m.home_team_id,
        away_id=m.away_team_id,
        home_team=m.home_team.name,
        away_team=m.away_team.name,
        referee=m.referee,
        home_goals=m.home_goals if played else None,
        away_goals=m.away_goals if played else None,
        stats=_stats(m) if played else {},
    )


def load_league(db: Session, league_id: int, extra_ids: set[int] | None = None) -> tuple[list[MatchData], list[str]]:
    """Partidos jugados de la liga desde FIRST_SEASON (y los por jugar de `extra_ids`)."""
    query = (
        db.query(Match)
        .join(Season, Season.id == Match.season_id)
        .filter(Match.league_id == league_id, Season.name >= FIRST_SEASON)
        .options(
            joinedload(Match.league),
            joinedload(Match.season),
            joinedload(Match.home_team),
            joinedload(Match.away_team),
            selectinload(Match.team_stats),
        )
    )
    rows = [m for m in query.all() if m.status == MatchStatus.HISTORICAL or m.id in (extra_ids or set())]
    data = [to_match_data(m) for m in rows]
    return data, sorted({m.season for m in data})


def run(db: Session, league_id: int, targets: set[int]) -> list[Picked]:
    """Pick de cada partido objetivo, con lo anterior a su dia."""
    history, seasons = load_league(db, league_id, targets)

    def goals_for_day(day: str):
        model = get_cached_league_model(db, league_id, as_of_date=datetime.fromisoformat(day))

        def matrix(m: MatchData):
            return model.score_matrix(m.home_id, m.away_id) if model is not None else None

        return matrix

    return walk_forward(history, targets, goals_for_day, seasons)
