import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class RiskLevel(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ModelPrediction(Base):
    """Salida del motor de probabilidades/EV para un partido+mercado+seleccion.

    Nunca se expone el EV solo: siempre va acompanado de confidence/risk_level.
    """

    __tablename__ = "model_predictions"

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), index=True)

    model_version: Mapped[str] = mapped_column(String(32))
    market: Mapped[str] = mapped_column(String(32), index=True)
    selection: Mapped[str] = mapped_column(String(32))

    prob_market_implied: Mapped[float] = mapped_column(Float)
    prob_model: Mapped[float] = mapped_column(Float)
    ev: Mapped[float] = mapped_column(Float, index=True)

    # 0-1: que tan fiable consideramos la estimacion (tamano de muestra,
    # acuerdo entre casas, varianza del modelo...).
    confidence: Mapped[float] = mapped_column(Float)
    risk_level: Mapped[RiskLevel] = mapped_column(Enum(RiskLevel, native_enum=False))

    is_recommended: Mapped[bool] = mapped_column(default=False, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    match: Mapped["Match"] = relationship(back_populates="predictions")
