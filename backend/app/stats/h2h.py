"""Historial de enfrentamientos directos entre dos equipos, point-in-time."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.db.models import Match, MatchStatus


@dataclass
class HeadToHead:
    matches_played: int
    team_a_wins: int
    team_b_wins: int
    draws: int
    team_a_goals: int
    team_b_goals: int


def compute_h2h(
    db: Session,
    team_a_id: int,
    team_b_id: int,
    before_date: datetime,
    num_matches: int = 5,
) -> HeadToHead:
    matches = (
        db.query(Match)
        .filter(
            Match.status == MatchStatus.HISTORICAL,
            Match.date < before_date,
            or_(
                and_(Match.home_team_id == team_a_id, Match.away_team_id == team_b_id),
                and_(Match.home_team_id == team_b_id, Match.away_team_id == team_a_id),
            ),
        )
        .order_by(Match.date.desc())
        .limit(num_matches)
        .all()
    )

    team_a_wins = team_b_wins = draws = team_a_goals = team_b_goals = 0
    for match in matches:
        if match.home_goals is None or match.away_goals is None:
            continue

        a_is_home = match.home_team_id == team_a_id
        a_goals = match.home_goals if a_is_home else match.away_goals
        b_goals = match.away_goals if a_is_home else match.home_goals

        team_a_goals += a_goals
        team_b_goals += b_goals

        if a_goals > b_goals:
            team_a_wins += 1
        elif a_goals < b_goals:
            team_b_wins += 1
        else:
            draws += 1

    return HeadToHead(
        matches_played=len(matches),
        team_a_wins=team_a_wins,
        team_b_wins=team_b_wins,
        draws=draws,
        team_a_goals=team_a_goals,
        team_b_goals=team_b_goals,
    )
