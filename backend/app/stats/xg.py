"""Media movil de xG (a favor/en contra) de un equipo, point-in-time.

Solo si esta al dia: si el ultimo partido jugado del equipo en una liga con
xG no lo tiene (la fuente aun no lo ha publicado, o esta caida), no se da
media. Una media de partidos mas antiguos se mostraria como si fuera la
actual.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.db.models import Match, MatchStatus, TeamMatchStats


@dataclass
class XgForm:
    matches_with_data: int
    avg_xg_for: float | None
    avg_xg_against: float | None


def _no_data() -> XgForm:
    return XgForm(matches_with_data=0, avg_xg_for=None, avg_xg_against=None)


def xg_up_to_date(db: Session, team_id: int, before_date: datetime, exclude_league_ids: Sequence[int] = ()) -> bool:
    """Si el ultimo partido jugado del equipo antes de esa fecha, en una liga
    con xG (alguno de sus partidos lo tiene), tiene su xG. Sin partidos en
    esas ligas no falta nada."""
    xg_leagues = [
        league_id
        for (league_id,) in db.query(Match.league_id)
        .join(TeamMatchStats, TeamMatchStats.match_id == Match.id)
        .filter(TeamMatchStats.xg.is_not(None))
        .distinct()
    ]
    latest = (
        db.query(TeamMatchStats.xg)
        .select_from(Match)
        .outerjoin(TeamMatchStats, and_(TeamMatchStats.match_id == Match.id, TeamMatchStats.team_id == team_id))
        .filter(
            or_(Match.home_team_id == team_id, Match.away_team_id == team_id),
            Match.status == MatchStatus.HISTORICAL,
            Match.date < before_date,
            Match.league_id.in_(xg_leagues),
            Match.league_id.notin_(exclude_league_ids),
        )
        .order_by(Match.date.desc())
        .first()
    )
    return latest is None or latest.xg is not None


def compute_xg_form(
    db: Session, team_id: int, before_date: datetime, num_matches: int = 5, exclude_league_ids: Sequence[int] = ()
) -> XgForm:
    if not xg_up_to_date(db, team_id, before_date, exclude_league_ids):
        return _no_data()

    rows = (
        db.query(TeamMatchStats)
        .join(Match, Match.id == TeamMatchStats.match_id)
        .filter(
            TeamMatchStats.team_id == team_id,
            Match.status == MatchStatus.HISTORICAL,
            Match.date < before_date,
            TeamMatchStats.xg.is_not(None),
            Match.league_id.notin_(exclude_league_ids),
        )
        .order_by(Match.date.desc())
        .limit(num_matches)
        .all()
    )

    if not rows:
        return _no_data()

    avg_xg_for = sum(r.xg for r in rows) / len(rows)
    xga_values = [r.xga for r in rows if r.xga is not None]
    avg_xg_against = sum(xga_values) / len(xga_values) if xga_values else None

    return XgForm(
        matches_with_data=len(rows),
        avg_xg_for=avg_xg_for,
        avg_xg_against=avg_xg_against,
    )
