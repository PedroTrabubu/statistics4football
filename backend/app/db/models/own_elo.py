from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class OwnEloPre(Base):
    """Elo propio de un equipo ANTES de un partido (ver app/stats/own_elo.py).

    Una fila por partido y equipo, escrita por scripts/refresh_own_elo.py:
    - partido jugado (`is_final`): se escribe una vez y no se recalcula;
    - partido programado: provisional, con el rating del momento; se reescribe
      en cada generacion y pasa a final cuando el partido se juega.
    """

    __tablename__ = "own_elo_pre"
    __table_args__ = (UniqueConstraint("match_id", "team_id", name="uq_own_elo_pre_match_team"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), index=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"))

    elo: Mapped[float] = mapped_column(Float)
    # Partidos jugados del equipo con los que se ha calculado `elo`.
    matches_rated: Mapped[int] = mapped_column(Integer)
    is_final: Mapped[bool] = mapped_column(Boolean)
    version: Mapped[str] = mapped_column(String(32))
    generated_at: Mapped[datetime] = mapped_column(DateTime)
    # Ultimo partido cuyo resultado entra en `elo` (la ficha: "Elo calculado hasta").
    computed_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
