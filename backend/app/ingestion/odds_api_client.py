"""Cliente minimo para la API v4 de the-odds-api.com: cuotas pre-partido
reales para partidos futuros (h2h + totals en el tier gratuito; btts/
double_chance requieren plan de pago, no se piden aqui).

Tier gratuito: 500 creditos/mes. Coste por llamada = nº mercados x nº
regiones (GET /sports no gasta credito). Con h2h+totals x 1 region = 2
creditos por liga por refresco.
"""

import logging

import httpx

from app.core.config import Settings

logger = logging.getLogger(__name__)

BASE_URL = "https://api.the-odds-api.com/v4"

# Codigo canonico de liga (soccerdata, usado en `leagues.code`) -> sport key
# de the-odds-api.com.
LEAGUE_SPORT_KEY_MAP: dict[str, str] = {
    "ENG-Premier League": "soccer_epl",
    "ESP-La Liga": "soccer_spain_la_liga",
}

MARKETS = "h2h,totals"


class OddsApiClient:
    def __init__(self, settings: Settings, region: str = "uk"):
        if not settings.the_odds_api_key:
            raise ValueError("THE_ODDS_API_KEY no configurada en .env")
        self._api_key = settings.the_odds_api_key
        self._region = region
        self._client = httpx.Client(base_url=BASE_URL, timeout=30)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "OddsApiClient":
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def _get(self, path: str, params: dict) -> httpx.Response:
        response = self._client.get(path, params={**params, "apiKey": self._api_key})
        response.raise_for_status()
        remaining = response.headers.get("x-requests-remaining")
        if remaining is not None:
            logger.info("the-odds-api: creditos restantes este mes: %s", remaining)
        return response

    def list_sport_keys(self) -> set[str]:
        """GET /sports no consume credito: util para validar que un sport
        key sigue existiendo antes de gastar creditos en /odds."""
        response = self._get("/sports", {})
        return {s["key"] for s in response.json()}

    def get_odds(self, sport_key: str) -> list[dict]:
        """Cuotas h2h+totals de todos los partidos futuros de una liga, una
        fila por partido con las cuotas de cada casa anidadas."""
        response = self._get(
            f"/sports/{sport_key}/odds",
            {"regions": self._region, "markets": MARKETS, "oddsFormat": "decimal"},
        )
        return response.json()
