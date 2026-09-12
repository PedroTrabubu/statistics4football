from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class MatchOdds(Base):
    """Una cuota de una casa de apuestas para un mercado/seleccion concretos.

    market: "1x2" | "over_under_2.5" | "btts" | "asian_handicap" | ...
    selection: "home" | "draw" | "away" | "over" | "under" | "yes" | "no" | ...
    """

    __tablename__ = "match_odds"

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), index=True)

    bookmaker: Mapped[str] = mapped_column(String(64))
    market: Mapped[str] = mapped_column(String(32), index=True)
    selection: Mapped[str] = mapped_column(String(32))
    odds: Mapped[float] = mapped_column(Float)

    # Linea del mercado cuando aplica: total de goles (2.5) o handicap (-0.5, +1...).
    # None para mercados sin linea (1x2, btts).
    line: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Momento en que se capturo la cuota (para distinguir cierre historico
    # de snapshots pre-partido de partidos futuros).
    snapshot_time: Mapped[datetime] = mapped_column(DateTime, index=True)

    match: Mapped["Match"] = relationship(back_populates="odds")
