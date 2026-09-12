"""Forma reciente de un equipo, calculada point-in-time (solo partidos
anteriores a una fecha dada, nunca el propio partido ni partidos futuros)."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db.models import Match, MatchStatus


@dataclass
class TeamForm:
    matches_played: int
    points: int
    wins: int
    draws: int
    losses: int
    goals_for: int
    goals_against: int

    @property
    def points_per_game(self) -> float | None:
        if self.matches_played == 0:
            return None
        return self.points / self.matches_played

    @property
    def goal_difference(self) -> int:
        return self.goals_for - self.goals_against


def _recent_matches(
    db: Session, team_id: int, before_date: datetime, num_matches: int
) -> list[Match]:
    return (
        db.query(Match)
        .filter(
            Match.status == MatchStatus.HISTORICAL,
            Match.date < before_date,
            or_(Match.home_team_id == team_id, Match.away_team_id == team_id),
        )
        .order_by(Match.date.desc())
        .limit(num_matches)
        .all()
    )


def compute_team_form(
    db: Session, team_id: int, before_date: datetime, num_matches: int = 5
) -> TeamForm:
    matches = _recent_matches(db, team_id, before_date, num_matches)

    points = wins = draws = losses = goals_for = goals_against = 0
    for match in matches:
        is_home = match.home_team_id == team_id
        gf = match.home_goals if is_home else match.away_goals
        ga = match.away_goals if is_home else match.home_goals
        if gf is None or ga is None:
            continue

        goals_for += gf
        goals_against += ga

        if gf > ga:
            wins += 1
            points += 3
        elif gf == ga:
            draws += 1
            points += 1
        else:
            losses += 1

    return TeamForm(
        matches_played=len(matches),
        points=points,
        wins=wins,
        draws=draws,
        losses=losses,
        goals_for=goals_for,
        goals_against=goals_against,
    )
