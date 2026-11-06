from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MatchForecast(Base):
    """Duelo de corners y predictor de estadisticas de un partido
    (app/probability/match_forecasts.py).

    Una fila por partido, modelo ("corner_duel" | "stats_predictor") y
    estadistica, escrita por scripts/refresh_match_forecasts.py:
    - "reconstructed": partido ya jugado sin fila previa, reconstruida en
      walk-forward con los partidos anteriores;
    - "frozen": generada antes del inicio. Hasta el inicio se reescribe en cada
      generacion; desde `kickoff` no se toca nunca.
    Valores None: sin datos para el modelo (o, en tarjetas, sin arbitro).
    """

    __tablename__ = "match_forecasts"
    __table_args__ = (UniqueConstraint("match_id", "model", "stat", name="uq_match_forecast_match_model_stat"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id"), index=True)
    model: Mapped[str] = mapped_column(String(16))
    stat: Mapped[str] = mapped_column(String(16))
    version: Mapped[str] = mapped_column(String(32))

    # Valor esperado de cada equipo (en el duelo, sus corners).
    home: Mapped[float | None] = mapped_column(Float, nullable=True)
    away: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Solo el duelo: el local saca mas / los mismos / el visitante saca mas.
    p_home: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_draw: Mapped[float | None] = mapped_column(Float, nullable=True)
    p_away: Mapped[float | None] = mapped_column(Float, nullable=True)
    # La muestra: partidos de cada equipo; `scope` "venue" (en su campo) o "all".
    home_matches: Mapped[int | None] = mapped_column(Integer, nullable=True)
    away_matches: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scope: Mapped[str | None] = mapped_column(String(8), nullable=True)
    # Tarjetas: factor del arbitro y sus partidos anteriores.
    referee_factor: Mapped[float | None] = mapped_column(Float, nullable=True)
    referee_matches: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Media simple de la liga en cada campo: la base del error medio del protocolo.
    league_home: Mapped[float | None] = mapped_column(Float, nullable=True)
    league_away: Mapped[float | None] = mapped_column(Float, nullable=True)

    kind: Mapped[str] = mapped_column(String(16))
    kickoff: Mapped[datetime] = mapped_column(DateTime)  # hora del partido al generar
    generated_at: Mapped[datetime] = mapped_column(DateTime)  # hora de congelacion
