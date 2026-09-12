"""Media movil de xG (a favor/en contra) de un equipo, point-in-time."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from app.db.models import Match, MatchStatus, TeamMatchStats


@dataclass
class XgForm:
    matches_with_data: int
    avg_xg_for: float | None
    avg_xg_against: float | None


def compute_xg_form(
    db: Session, team_id: int, before_date: datetime, num_matches: int = 5
) -> XgForm:
    rows = (
        db.query(TeamMatchStats)
        .join(Match, Match.id == TeamMatchStats.match_id)
        .filter(
            TeamMatchStats.team_id == team_id,
            Match.status == MatchStatus.HISTORICAL,
            Match.date < before_date,
            TeamMatchStats.xg.is_not(None),
        )
        .order_by(Match.date.desc())
        .limit(num_matches)
        .all()
    )

    if not rows:
        return XgForm(matches_with_data=0, avg_xg_for=None, avg_xg_against=None)

    avg_xg_for = sum(r.xg for r in rows) / len(rows)
    xga_values = [r.xga for r in rows if r.xga is not None]
    avg_xg_against = sum(xga_values) / len(xga_values) if xga_values else None

    return XgForm(
        matches_with_data=len(rows),
        avg_xg_for=avg_xg_for,
        avg_xg_against=avg_xg_against,
    )
