"""Wrapper fino sobre soccerdata.

Fija el directorio de cache de soccerdata (SOCCERDATA_DIR) ANTES de importar
la libreria, porque soccerdata lee esa variable de entorno una sola vez al
importarse (en su modulo _config). Este modulo debe ser el punto unico de
entrada para importar soccerdata en el resto de la app.
"""

import logging
import os
from pathlib import Path

from app.core.config import get_settings

_settings = get_settings()
os.environ.setdefault("SOCCERDATA_DIR", _settings.soccerdata_dir)

import soccerdata as sd  # noqa: E402  (import tardio: depende del os.environ de arriba)


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


def get_match_history_reader(
    leagues: list[str], seasons: list[str] | str | None = None
) -> sd.MatchHistory:
    """Lector de Football-Data.co.uk: resultados + cuotas de cierre historicas."""
    _fix_match_history_encoding()
    return sd.MatchHistory(leagues=leagues, seasons=seasons)


def get_understat_reader(
    leagues: list[str], seasons: list[str] | str | None = None
) -> sd.Understat:
    """Lector de Understat: xG por partido y equipo."""
    return sd.Understat(leagues=leagues, seasons=seasons)


def get_clubelo_reader() -> sd.ClubElo:
    """Lector de Club Elo: rating de fuerza de equipo por fecha (no filtra por liga)."""
    return sd.ClubElo()
