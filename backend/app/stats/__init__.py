"""Features point-in-time por partido: forma, H2H, xG rolling, Elo pre-partido.

Todas las funciones de este paquete solo usan datos anteriores a la fecha del
partido consultado (nunca el resultado del propio partido ni partidos
posteriores), para poder reutilizarse igual en backtesting que en partidos
futuros reales.
"""

from app.stats.elo import get_elo_at
from app.stats.features import MatchFeatures, compute_match_features
from app.stats.form import TeamForm, compute_team_form
from app.stats.h2h import HeadToHead, compute_h2h
from app.stats.xg import XgForm, compute_xg_form

__all__ = [
    "HeadToHead",
    "MatchFeatures",
    "TeamForm",
    "XgForm",
    "compute_h2h",
    "compute_match_features",
    "compute_team_form",
    "compute_xg_form",
    "get_elo_at",
]
