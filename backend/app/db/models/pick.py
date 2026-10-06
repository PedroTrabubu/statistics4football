from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class PickCombo(Base):
    """Una combinada de la seccion Picks (docs/PICKS_PROTOCOLO.md).

    source: "backtest" (combinadas del test fuera de muestra) o "live"
    (proxima jornada, regeneradas por scripts/refresh_picks.py).
    scope: "todas", el codigo de una liga, o "mismo_partido".
    kind: nivel ("segura", "media", "alta", "bomba") o "mismo_partido".
    """

    __tablename__ = "pick_combos"

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(16), index=True)
    window: Mapped[str] = mapped_column(String(10), index=True)  # martes de la jornada (YYYY-MM-DD)
    scope: Mapped[str] = mapped_column(String(32), index=True)
    kind: Mapped[str] = mapped_column(String(16), index=True)
    prob: Mapped[float] = mapped_column(Float)
    odds: Mapped[float] = mapped_column(Float)
    odds_kind: Mapped[str] = mapped_column(String(16))  # real | estimada
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    legs: Mapped[list["PickLeg"]] = relationship(
        back_populates="combo", cascade="all, delete-orphan", order_by="PickLeg.id"
    )


class PickLeg(Base):
    __tablename__ = "pick_legs"

    id: Mapped[int] = mapped_column(primary_key=True)
    combo_id: Mapped[int] = mapped_column(ForeignKey("pick_combos.id", ondelete="CASCADE"), index=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), index=True)
    market: Mapped[str] = mapped_column(String(32))
    selection: Mapped[str] = mapped_column(String(16))
    line: Mapped[float | None] = mapped_column(Float, nullable=True)
    family: Mapped[str] = mapped_column(String(32))
    prob: Mapped[float] = mapped_column(Float)
    odds: Mapped[float] = mapped_column(Float)
    odds_kind: Mapped[str] = mapped_column(String(16))  # real | derivada | estimada

    combo: Mapped["PickCombo"] = relationship(back_populates="legs")
    match: Mapped["Match"] = relationship()
