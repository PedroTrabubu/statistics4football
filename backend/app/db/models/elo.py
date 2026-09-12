from datetime import date as date_type

from sqlalchemy import Date, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class EloRating(Base):
    """Serie temporal de rating Elo por equipo (Club Elo)."""

    __tablename__ = "elo_ratings"

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    date: Mapped[date_type] = mapped_column(Date, index=True)
    elo: Mapped[float] = mapped_column(Float)
