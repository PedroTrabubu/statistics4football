"""Wrapper fino sobre soccerdata.

Fija el directorio de cache de soccerdata (SOCCERDATA_DIR) ANTES de importar
la libreria, porque soccerdata lee esa variable de entorno una sola vez al
importarse (en su modulo _config). Este modulo debe ser el punto unico de
entrada para importar soccerdata en el resto de la app.
"""

import os

from app.core.config import get_settings

_settings = get_settings()
os.environ.setdefault("SOCCERDATA_DIR", _settings.soccerdata_dir)

import soccerdata as sd  # noqa: E402  (import tardio: depende del os.environ de arriba)


def get_match_history_reader(
    leagues: list[str], seasons: list[str] | str | None = None
) -> sd.MatchHistory:
    """Lector de Football-Data.co.uk: resultados + cuotas de cierre historicas."""
    return sd.MatchHistory(leagues=leagues, seasons=seasons)


def get_understat_reader(
    leagues: list[str], seasons: list[str] | str | None = None
) -> sd.Understat:
    """Lector de Understat: xG por partido y equipo."""
    return sd.Understat(leagues=leagues, seasons=seasons)


def get_clubelo_reader() -> sd.ClubElo:
    """Lector de Club Elo: rating de fuerza de equipo por fecha (no filtra por liga)."""
    return sd.ClubElo()
