"""Cliente minimo para la API v4 de football-data.org: partidos de la
temporada en curso de una competicion (jugados y por jugar).

Tier gratuito: ~10 req/min. No hace falta paralelismo aqui (solo consultamos
un puñado de competiciones cada vez), asi que un client sincrono con backoff
simple ante 429 es suficiente.
"""

import logging
import time

import httpx

from app.core.config import Settings

logger = logging.getLogger(__name__)

BASE_URL = "https://api.football-data.org/v4"

# Codigo canonico de liga (soccerdata, usado en `leagues.code`) -> codigo de
# competicion de football-data.org.
LEAGUE_CODE_MAP: dict[str, str] = {
    "ENG-Premier League": "PL",
    "ESP-La Liga": "PD",
}



class FootballDataClient:
    def __init__(self, settings: Settings):
        if not settings.football_data_org_api_key:
            raise ValueError("FOOTBALL_DATA_ORG_API_KEY no configurada en .env")
        self._client = httpx.Client(
            base_url=BASE_URL,
            headers={"X-Auth-Token": settings.football_data_org_api_key},
            timeout=30,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "FootballDataClient":
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def _get(self, path: str, params: dict | None = None) -> dict:
        for attempt in range(3):
            response = self._client.get(path, params=params)
            if response.status_code == 429:
                wait_seconds = int(response.headers.get("Retry-After", "60"))
                logger.warning("football-data.org rate limit alcanzado, esperando %ds", wait_seconds)
                time.sleep(wait_seconds)
                continue
            response.raise_for_status()
            return response.json()
        raise RuntimeError(f"football-data.org: rate limit persistente en {path}")

    def get_season_matches(self, competition_code: str) -> list[dict]:
        """Todos los partidos de la temporada en curso de la competicion,
        jugados (FINISHED, con marcador) y por jugar (SCHEDULED/TIMED/...).
        Sin filtro de `status`, football-data.org devuelve por defecto solo
        la temporada activa (`currentSeason`)."""
        data = self._get(f"/competitions/{competition_code}/matches")
        return data.get("matches", [])
