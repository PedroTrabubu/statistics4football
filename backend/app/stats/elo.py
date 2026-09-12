"""Elo point-in-time: el rating de un equipo tal como estaba en una fecha dada.

No calcula nada aqui: solo consulta la serie temporal cruda que dejo la
ingesta de ClubElo (`elo_ratings`), buscando el ultimo valor conocido antes
de la fecha pedida.
"""

from datetime import date, datetime

from sqlalchemy.orm import Session

from app.db.models import EloRating


def get_elo_at(db: Session, team_id: int, as_of: datetime | date) -> float | None:
    as_of_date = as_of.date() if isinstance(as_of, datetime) else as_of
    row = (
        db.query(EloRating)
        .filter(EloRating.team_id == team_id, EloRating.date <= as_of_date)
        .order_by(EloRating.date.desc())
        .first()
    )
    return row.elo if row is not None else None
