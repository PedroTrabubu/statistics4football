from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class League(Base):
    __tablename__ = "leagues"

    id: Mapped[int] = mapped_column(primary_key=True)
    # ID canonico de soccerdata, ej. "ENG-Premier League"
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    country: Mapped[str | None] = mapped_column(String(64), nullable=True)

    teams: Mapped[list["Team"]] = relationship(back_populates="league")
    seasons: Mapped[list["Season"]] = relationship(back_populates="league")
    matches: Mapped[list["Match"]] = relationship(back_populates="league")
