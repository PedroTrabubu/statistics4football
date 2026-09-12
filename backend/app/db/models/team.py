from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Nombre normalizado (post TEAMNAME_REPLACEMENTS de soccerdata)
    name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    league_id: Mapped[int | None] = mapped_column(ForeignKey("leagues.id"), nullable=True)

    league: Mapped["League"] = relationship(back_populates="teams")
