from datetime import datetime

from pydantic import BaseModel


class PickLegOut(BaseModel):
    match_id: int
    date: datetime
    league_code: str
    home_team: str
    away_team: str
    market: str
    selection: str
    line: float | None
    family: str
    prob: float
    odds: float
    odds_kind: str  # real | derivada | estimada
    outcome: str  # won | lost | pending
    # Dato real con el que se resuelve la pata (goles, corners o amarillas
    # "local-visitante"); None si el partido no se ha jugado.
    actual: str | None


class PickComboOut(BaseModel):
    id: int
    source: str
    window: str
    scope: str
    kind: str
    prob: float
    odds: float
    odds_kind: str
    outcome: str
    legs: list[PickLegOut]


class PicksUpcomingOut(BaseModel):
    window: str | None
    combos: list[PickComboOut]


class PickKindSummary(BaseModel):
    kind: str
    total: int
    won: int
    lost: int
    pending: int
    hit_rate: float | None
    # Probabilidad media que el modelo daba a esas combinadas: si el acierto
    # queda muy por debajo, el modelo esta sobreconfiado.
    predicted_hit_rate: float | None
    avg_odds: float | None
    # ROI con la cuota mostrada (estimada en casi todas las combinadas).
    roi_shown_odds: float | None


class PicksHistoryOut(BaseModel):
    summary: list[PickKindSummary]
    combos: list[PickComboOut]
