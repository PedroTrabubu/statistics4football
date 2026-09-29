from sqlalchemy import Float, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class TeamMatchStats(Base):
    """Stats de un equipo en un partido concreto (Understat/FBref)."""

    __tablename__ = "team_match_stats"

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), index=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)

    xg: Mapped[float | None] = mapped_column(Float, nullable=True)
    xga: Mapped[float | None] = mapped_column(Float, nullable=True)
    shots: Mapped[int | None] = mapped_column(Integer, nullable=True)
    shots_on_target: Mapped[int | None] = mapped_column(Integer, nullable=True)
    possession: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Corners/tarjetas/faltas: football-data.co.uk las trae en el mismo CSV
    # que resultados y cuotas (columnas HC/AC, HY/AY, HR/AR, HF/AF), asi que
    # se rellenan directamente en historical_backfill.py, sin fuente nueva.
    corners_for: Mapped[int | None] = mapped_column(Integer, nullable=True)
    corners_against: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fouls: Mapped[int | None] = mapped_column(Integer, nullable=True)
    yellow_cards: Mapped[int | None] = mapped_column(Integer, nullable=True)
    red_cards: Mapped[int | None] = mapped_column(Integer, nullable=True)

    elo_pre: Mapped[float | None] = mapped_column(Float, nullable=True)
    elo_post: Mapped[float | None] = mapped_column(Float, nullable=True)

    match: Mapped["Match"] = relationship(back_populates="team_stats")
