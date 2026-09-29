"""Media movil de corners y tarjetas de un equipo, point-in-time.

Mismo patron que xg.py: se apoya en TeamMatchStats, que ahora se rellena
directamente desde el CSV de MatchHistory (ver historical_backfill.py) sin
necesitar una fuente de datos nueva.
"""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from app.db.models import Match, MatchStatus, TeamMatchStats


@dataclass
class DisciplineForm:
    matches_with_data: int
    avg_corners_for: float | None
    avg_corners_against: float | None
    avg_yellow_cards: float | None
    avg_red_cards: float | None


def compute_discipline_form(
    db: Session, team_id: int, before_date: datetime, num_matches: int = 5
) -> DisciplineForm:
    rows = (
        db.query(TeamMatchStats)
        .join(Match, Match.id == TeamMatchStats.match_id)
        .filter(
            TeamMatchStats.team_id == team_id,
            Match.status == MatchStatus.HISTORICAL,
            Match.date < before_date,
            TeamMatchStats.corners_for.is_not(None),
        )
        .order_by(Match.date.desc())
        .limit(num_matches)
        .all()
    )

    if not rows:
        return DisciplineForm(
            matches_with_data=0,
            avg_corners_for=None,
            avg_corners_against=None,
            avg_yellow_cards=None,
            avg_red_cards=None,
        )

    corners_against = [r.corners_against for r in rows if r.corners_against is not None]
    yellow = [r.yellow_cards for r in rows if r.yellow_cards is not None]
    red = [r.red_cards for r in rows if r.red_cards is not None]

    return DisciplineForm(
        matches_with_data=len(rows),
        avg_corners_for=sum(r.corners_for for r in rows) / len(rows),
        avg_corners_against=(sum(corners_against) / len(corners_against)) if corners_against else None,
        avg_yellow_cards=(sum(yellow) / len(yellow)) if yellow else None,
        avg_red_cards=(sum(red) / len(red)) if red else None,
    )
