"""Porcentajes de resultado (app/probability/result_predictions.py)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class ResultProbabilitiesOut(BaseModel):
    match_id: int
    # ok | sin datos suficientes | Champions (sin calibrar) | liga sin modelo | aun sin calcular
    status: Literal["ok", "insufficient_history", "champions", "not_available", "not_generated"]
    version: str
    # "reconstructed": reconstruida con datos anteriores; "frozen": congelada antes del partido.
    kind: Literal["reconstructed", "frozen"] | None
    kickoff: datetime | None
    generated_at: datetime | None
    p_home: float | None
    p_draw: float | None
    p_away: float | None


class RateOut(BaseModel):
    n: int
    hits: int
    rate: float | None
    low: float | None  # IC 95 % de Wilson
    high: float | None


class CalibrationBinOut(BaseModel):
    low: float
    high: float
    n: int
    mean_p: float
    observed: float
    ci_low: float
    ci_high: float


class HighConfidenceOut(BaseModel):
    coverage: float | None
    n_matches: int
    bin_80_85: RateOut
    bin_85: RateOut


class LeagueAccuracyOut(BaseModel):
    league: str
    seasons: list[str]
    top: RateOut
    double: RateOut
    always_1x: RateOut


class ResultSummaryOut(BaseModel):
    version: str
    generated_at: datetime
    dev_seasons: list[str]
    current_season: str | None
    low_sample_bin: int
    calibration_dev: list[CalibrationBinOut]
    calibration_current: list[CalibrationBinOut]
    high_confidence_dev: HighConfidenceOut
    high_confidence_current: HighConfidenceOut | None
    league: LeagueAccuracyOut | None


class MatchResultProbabilitiesOut(BaseModel):
    prediction: ResultProbabilitiesOut
    summary: ResultSummaryOut | None


class LeagueResultProbabilitiesOut(BaseModel):
    summary: ResultSummaryOut | None
    predictions: list[ResultProbabilitiesOut]
