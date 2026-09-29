import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class RiskLevel(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ModelPrediction(Base):
    """Salida del motor de probabilidades/EV para un partido+mercado+seleccion.

    Nunca se expone el EV solo: siempre va acompanado de confidence/risk_level.

    `prob_market_implied`/`ev` quedan a None cuando el partido aun no tiene
    cuotas ingeridas (p.ej. fixtures futuros via football-data.org): en ese
    caso `prob_model` es una probabilidad real calculada sobre estadisticas
    historicas (Dixon-Coles), sin comparacion contra mercado.
    """

    __tablename__ = "model_predictions"

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), index=True)

    model_version: Mapped[str] = mapped_column(String(32))
    market: Mapped[str] = mapped_column(String(32), index=True)
    selection: Mapped[str] = mapped_column(String(32))

    prob_market_implied: Mapped[float | None] = mapped_column(Float, nullable=True)
    prob_model: Mapped[float] = mapped_column(Float)
    ev: Mapped[float | None] = mapped_column(Float, nullable=True, index=True)

    # 0-1: que tan fiable consideramos la estimacion (tamano de muestra,
    # acuerdo entre casas, varianza del modelo...).
    confidence: Mapped[float] = mapped_column(Float)
    risk_level: Mapped[RiskLevel] = mapped_column(Enum(RiskLevel, native_enum=False))

    # Partidos historicos que respaldan la estimacion para este par de
    # equipos (ver engine.py: min(matches_played) de local/visitante). Se
    # expone tal cual en la API para no depender solo de `confidence` (que
    # satura en 1.0 en cuanto hay bastante historico, aunque sea de hace
    # varias temporadas): el principio del producto es mostrar siempre el
    # tamano de muestra, no solo un score derivado.
    matches_used: Mapped[int] = mapped_column(Integer, default=0)

    is_recommended: Mapped[bool] = mapped_column(default=False, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    match: Mapped["Match"] = relationship(back_populates="predictions")
