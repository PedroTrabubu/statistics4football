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

    active_leagues: str = "ENG-Premier League,ESP-La Liga,ESP-La Liga 2,FRA-Ligue 1,GER-Bundesliga,ITA-Serie A,INT-Champions League"
    # Ligas en las que Picks está validado. Una liga nueva
    # se carga y se ve en la web, pero no entra aquí hasta pasar su backtest.
    validated_leagues: str = "ENG-Premier League,ESP-La Liga,ESP-La Liga 2"
    # Ligas de Alta probabilidad: las validadas y las que solo pasaron la
    # prueba de ese modelo (ampliacion de docs/LIGAS_NUEVAS.md). Picks no las usa.
    high_probability_leagues: str = "ENG-Premier League,ESP-La Liga,ESP-La Liga 2,ITA-Serie A"
    # Ligas de contexto: solo sus resultados y estadísticas (Football-Data), para
    # el historial de los equipos de Champions. No salen en la web ni en los
    # picks, ni tienen calendario, árbitros, xG ni cuotas de Pinnacle.
    context_leagues: str = "POR-Primeira Liga,NED-Eredivisie,BEL-Pro League,TUR-Super Lig,GRE-Super League"

    soccerdata_dir: str = str(PROJECT_ROOT / "data" / "soccerdata_cache")

    football_data_org_api_key: str = ""
    api_football_rapidapi_key: str = ""
    the_odds_api_key: str = ""
    # Respaldo de la clave pública de laliga.com (designaciones arbitrales),
    # solo si no se puede leer de su web. Ver app/ingestion/designations.py.
    laliga_subscription_key: str = ""

    ev_threshold: float = 0.05

    log_level: str = "INFO"

    @property
    def leagues(self) -> list[str]:
        return [league.strip() for league in self.active_leagues.split(",") if league.strip()]

    @property
    def model_leagues(self) -> list[str]:
        return [league.strip() for league in self.validated_leagues.split(",") if league.strip()]

    @property
    def pattern_leagues(self) -> list[str]:
        return [league.strip() for league in self.high_probability_leagues.split(",") if league.strip()]

    @property
    def context(self) -> list[str]:
        return [league.strip() for league in self.context_leagues.split(",") if league.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
