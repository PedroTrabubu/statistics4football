"""Duelo de corners y predictor de estadisticas guardados (app/probability/match_forecasts.py)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class DuelForecastOut(BaseModel):
    # Corners esperados de cada equipo.
    home_expected: float
    away_expected: float
    # El local saca mas / los mismos / el visitante saca mas. Suman 1.
    home: float
    draw: float
    away: float
    # Partidos con corners del local en casa y del visitante fuera (la muestra).
    home_matches: int
    away_matches: int


class RefereeFactorOut(BaseModel):
    factor: float
    matches: int


class StatForecastOut(BaseModel):
    home: float
    away: float
    home_matches: int
    away_matches: int
    # "venue": cada equipo en su campo; "all": todos sus partidos.
    scope: Literal["venue", "all"]
    referee: RefereeFactorOut | None


class MatchForecastsOut(BaseModel):
    match_id: int
    status: Literal["ok", "not_generated"]
    # "reconstructed": reconstruida con datos anteriores; "frozen": congelada antes del partido.
    kind: Literal["reconstructed", "frozen"] | None
    generated_at: datetime | None
    duel: DuelForecastOut | None
    # None: sin predictor (la Champions) o aun sin calcular; dentro, None sin datos.
    stats: dict[str, StatForecastOut | None] | None


class LeagueDuelOut(DuelForecastOut):
    match_id: int
