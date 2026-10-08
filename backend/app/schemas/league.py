from datetime import datetime

from pydantic import BaseModel, ConfigDict


class LeagueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    country: str | None = None
    # Picks y Recomendaciones validados en esta liga (VALIDATED_LEAGUES).
    validated: bool = False


class MatchdayOut(BaseModel):
    matchday: int
    start: datetime
    end: datetime
    played: int
    total: int


class LeagueMatchdaysOut(BaseModel):
    seasons: list[str]  # temporadas con partidos, la más reciente primero
    season: str | None
    current: int | None  # la jornada que se muestra por defecto
    # Jornadas deducidas de las fechas (la fuente no las da): ver app/ingestion/matchdays.py.
    estimated: bool
    matchdays: list[MatchdayOut]
