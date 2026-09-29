"""App settings, cargadas desde variables de entorno / .env."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = f"sqlite:///{PROJECT_ROOT / 'data' / 'stadistics4bet.db'}"

    active_leagues: str = "ENG-Premier League,ESP-La Liga"

    soccerdata_dir: str = str(PROJECT_ROOT / "data" / "soccerdata_cache")

    football_data_org_api_key: str = ""
    api_football_rapidapi_key: str = ""
    the_odds_api_key: str = ""

    ev_threshold: float = 0.05

    log_level: str = "INFO"

    @property
    def leagues(self) -> list[str]:
        return [league.strip() for league in self.active_leagues.split(",") if league.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
