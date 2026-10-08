"""Wrapper fino sobre soccerdata.

Fija el directorio de cache de soccerdata (SOCCERDATA_DIR) ANTES de importar
la libreria, porque soccerdata lee esa variable de entorno una sola vez al
importarse (en su modulo _config). Este modulo debe ser el punto unico de
entrada para importar soccerdata en el resto de la app.
"""

import json
import logging
import os
import time
from pathlib import Path

from app.core.config import get_settings

_settings = get_settings()
os.environ.setdefault("SOCCERDATA_DIR", _settings.soccerdata_dir)

# Ligas que soccerdata no trae de serie. Se registran en su league_dict.json
# (dentro de la caché, que no está en git) antes de importar la librería,
# porque soccerdata lo lee al importarse.
CUSTOM_LEAGUES: dict[str, dict[str, str]] = {
    # LaLiga Hypermotion (Segunda División). Termina en junio por los playoffs de ascenso.
    "ESP-La Liga 2": {"MatchHistory": "SP2", "ClubElo": "ESP_2", "season_start": "Aug", "season_end": "Jun"},
}


def _register_custom_leagues() -> None:
    path = Path(os.environ["SOCCERDATA_DIR"]) / "config" / "league_dict.json"
    current: dict = {}
    if path.exists():
        try:
            current = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            current = {}
    merged = {**current, **CUSTOM_LEAGUES}
    if merged != current:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")


_register_custom_leagues()

import httpx  # noqa: E402
import soccerdata as sd  # noqa: E402  (import tardio: depende del os.environ de arriba)
from soccerdata._config import LEAGUE_DICT  # noqa: E402

logger = logging.getLogger(__name__)

_UTF8_BOM = "﻿".encode("utf-8")
# soccerdata lee los CSV de MatchHistory anteriores a 2024-25 como latin-1
# (ver soccerdata/match_history.py::_parse_csv).
_FIRST_UTF8_SEASON = 2425


def _fix_match_history_encoding() -> None:
    """Football-Data.co.uk re-publica a veces CSV antiguos en UTF-8 con BOM
    (visto: E0_2122.csv). soccerdata los lee como latin-1, el BOM acaba
    pegado al nombre de la primera columna ("Div"), la liga no se reconoce
    y la temporada entera se descarta sin error. Se reescriben en latin-1
    en la cache antes de leerlos."""
    cache_dir = Path(os.environ["SOCCERDATA_DIR"]) / "data" / "MatchHistory"
    if not cache_dir.is_dir():
        return
    for path in cache_dir.glob("*_*.csv"):
        season = path.stem.rsplit("_", 1)[-1]
        if not season.isdigit() or int(season) >= _FIRST_UTF8_SEASON:
            continue
        raw = path.read_bytes()
        if raw.startswith(_UTF8_BOM):
            text = raw.decode("utf-8-sig")
            path.write_bytes(text.encode("latin-1", errors="replace"))
            logger.info("MatchHistory: %s convertido de UTF-8 con BOM a latin-1", path.name)


MATCH_HISTORY_URL = "https://football-data.co.uk/mmz4281/{season}/{code}.csv"
# Pausa entre descargas: el servidor limita las peticiones seguidas.
_DOWNLOAD_PAUSE_SECONDS = 3


class _CachedMatchHistory(sd.MatchHistory):
    """MatchHistory que solo lee de su caché.

    Desde que Football-Data.co.uk cambió de servidor (octubre de 2026), responde
    503 a todas las peticiones del cliente HTTP de soccerdata, aunque acepta
    las normales. Los CSV los descarga `_download_match_history`, y soccerdata
    se limita a leerlos y normalizarlos."""

    @classmethod
    def _all_leagues(cls) -> dict[str, str]:
        # soccerdata busca las ligas de cada fuente por el nombre de la clase.
        return sd.MatchHistory._all_leagues()

    def get(self, url, filepath=None, max_age=None, no_cache=False, var=None):
        return super().get(url, filepath, max_age=None, no_cache=False, var=var)


def _download_match_history(reader: _CachedMatchHistory) -> None:
    """Descarga los CSV que faltan en la caché y, siempre, los de temporadas
    en curso (cambian cada jornada). Si falla la de una temporada en curso ya
    cacheada se sigue con la copia anterior; si falta un CSV, es un error."""
    pending = [
        (code, season, reader.data_dir / f"{code}_{season}.csv")
        for code in reader._selected_leagues.values()
        for season in reader.seasons
    ]
    pending = [
        (code, season, path)
        for code, season, path in pending
        if not path.exists() or not reader._is_complete(code, season)
    ]
    if not pending:
        return

    reader.data_dir.mkdir(parents=True, exist_ok=True)
    with httpx.Client(follow_redirects=True, timeout=30) as client:
        for i, (code, season, path) in enumerate(pending):
            if i:
                time.sleep(_DOWNLOAD_PAUSE_SECONDS)
            url = MATCH_HISTORY_URL.format(season=season, code=code)
            try:
                content = fetch_football_data_csv(client, url)
            except ConnectionError as exc:
                if path.exists():
                    logger.warning("MatchHistory: %s; se usa la copia en caché", exc)
                    continue
                raise
            path.write_bytes(content)
            logger.info("MatchHistory: descargado %s", path.name)


def fetch_football_data_csv(client: httpx.Client, url: str) -> bytes:
    """Un CSV de Football-Data.co.uk, comprobando que lo es (si el servidor
    está saturado devuelve una página HTML)."""
    try:
        response = client.get(url)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ConnectionError(f"No se pudo descargar {url}: {exc}") from exc
    if not response.content.removeprefix(_UTF8_BOM).startswith(b"Div"):
        raise ConnectionError(f"No se pudo descargar {url}: la respuesta no es un CSV de Football-Data.co.uk")
    return response.content


def get_match_history_reader(
    leagues: list[str], seasons: list[str] | str | None = None
) -> sd.MatchHistory:
    """Lector de Football-Data.co.uk: resultados + cuotas de cierre historicas."""
    reader = _CachedMatchHistory(leagues=leagues, seasons=seasons)
    _download_match_history(reader)
    _fix_match_history_encoding()
    return reader


def get_understat_reader(
    leagues: list[str], seasons: list[str] | str | None = None
) -> sd.Understat:
    """Lector de Understat: xG por partido y equipo."""
    return sd.Understat(leagues=leagues, seasons=seasons)


def leagues_with_source(leagues: list[str], source: str) -> list[str]:
    """Las ligas de la lista que esa fuente cubre (p. ej. Understat no tiene LaLiga Hypermotion)."""
    return [league for league in leagues if source in LEAGUE_DICT.get(league, {})]


def get_clubelo_reader() -> sd.ClubElo:
    """Lector de Club Elo: rating de fuerza de equipo por fecha (no filtra por liga)."""
    return sd.ClubElo()
