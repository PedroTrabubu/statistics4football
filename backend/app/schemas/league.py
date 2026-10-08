from pydantic import BaseModel, ConfigDict


class LeagueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    country: str | None = None
    # Picks y Recomendaciones validados en esta liga (VALIDATED_LEAGUES).
    validated: bool = False

