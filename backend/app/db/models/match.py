import enum
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class MatchStatus(str, enum.Enum):
    HISTORICAL = "historical"
    SCHEDULED = "scheduled"


class Match(Base):
    __tablename__ = "matches"

    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id"), index=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), index=True)

    date: Mapped[datetime] = mapped_column(DateTime, index=True)
    home_team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    away_team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)

    home_goals: Mapped[int | None] = mapped_column(Integer, nullable=True)
    away_goals: Mapped[int | None] = mapped_column(Integer, nullable=True)

    status: Mapped[MatchStatus] = mapped_column(
        Enum(MatchStatus, native_enum=False), default=MatchStatus.SCHEDULED, index=True
    )

    # IDs originales en cada fuente (soccerdata game id, football-data.org id,
    # API-Football fixture id...) para poder cruzar/reconciliar sin ambiguedad.
    source_ids: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    league: Mapped["League"] = relationship(back_populates="matches")
    season: Mapped["Season"] = relationship(back_populates="matches")
    home_team: Mapped["Team"] = relationship(foreign_keys=[home_team_id])
    away_team: Mapped["Team"] = relationship(foreign_keys=[away_team_id])

    odds: Mapped[list["MatchOdds"]] = relationship(back_populates="match")
    team_stats: Mapped[list["TeamMatchStats"]] = relationship(back_populates="match")
    predictions: Mapped[list["ModelPrediction"]] = relationship(back_populates="match")
