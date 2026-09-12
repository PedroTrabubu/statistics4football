from datetime import date as date_type

from sqlalchemy import Date, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Season(Base):
    __tablename__ = "seasons"

    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id"))
    # Codigo de temporada tal como lo usa soccerdata, ej. "2425"
    name: Mapped[str] = mapped_column(String(16))
    start_date: Mapped[date_type | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date_type | None] = mapped_column(Date, nullable=True)

    league: Mapped["League"] = relationship(back_populates="seasons")
    matches: Mapped[list["Match"]] = relationship(back_populates="season")
