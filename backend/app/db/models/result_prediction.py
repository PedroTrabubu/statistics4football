from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ResultPrediction(Base):
    """Porcentajes de resultado de un partido (app/probability/result_predictions.py).

    Una fila por partido y version del modelo, escrita por
    scripts/refresh_result_predictions.py:
    - "reconstructed": partido ya jugado sin prediccion previa, reconstruida en
      walk-forward con datos anteriores a su dia;
    - "frozen": generada antes del inicio. Hasta el inicio se reescribe en cada
      generacion; desde `kickoff` no se toca nunca.
    Probabilidades None: sin datos suficientes para el modelo.
    """

    __tablename__ = "result_predictions"
    __table_args__ = (UniqueConstraint("match_id", "version", name="uq_result_prediction_match_version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), index=True)
    version: Mapped[str] = mapped_column(String(32))

    p_home: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_draw: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_away: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Logits sin calibrar: la temperatura de los dias siguientes se ajusta con ellos.
    score_home: Mapped[float | None] = mapped_column(Float, nullable=True)
    score_draw: Mapped[float | None] = mapped_column(Float, nullable=True)
    score_away: Mapped[float | None] = mapped_column(Float, nullable=True)
    temperature: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Menos partidos de Elo de los dos equipos (por debajo del minimo: "sin datos suficientes").
    elo_matches: Mapped[int | None] = mapped_column(Integer, nullable=True)

    kind: Mapped[str] = mapped_column(String(16))
    kickoff: Mapped[datetime] = mapped_column(DateTime)  # hora del partido al generar
    generated_at: Mapped[datetime] = mapped_column(DateTime)  # hora de congelacion
