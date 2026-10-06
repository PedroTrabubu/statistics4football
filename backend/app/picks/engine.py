"""Distribuciones de un partido para los picks y parametros congelados.

Compartido por el backtest (scripts/backtest_picks.py) y la web
(scripts/refresh_picks.py), para que ambos usen exactamente el mismo calculo.
"""

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

from app.picks.count_model import SIDES, STATS, CountModel
from app.picks.legs import MAX_GOALS, MIN_PROB, LegKey, MatchDistributions
from app.probability.market import implied_probabilities_shin
from app.probability.pattern_model import market_implied_goals, poisson_matrix

PARAMS_PATH = Path(__file__).with_name("picks_params.json")

# Seleccion del modelo de patrones -> pata de los picks (v3, opcion B).
PATTERN_TO_LEG: dict[str, LegKey] = {
    "home": ("1x2", "home", None),
    "draw": ("1x2", "draw", None),
    "away": ("1x2", "away", None),
    "1X": ("double_chance", "1X", None),
    "X2": ("double_chance", "X2", None),
    "12": ("double_chance", "12", None),
    "over_1.5": ("goals_over_under", "over", 1.5),
    "under_1.5": ("goals_over_under", "under", 1.5),
    "over_2.5": ("goals_over_under", "over", 2.5),
    "under_2.5": ("goals_over_under", "under", 2.5),
    "over_3.5": ("goals_over_under", "over", 3.5),
    "under_3.5": ("goals_over_under", "under", 3.5),
    "btts_yes": ("btts", "yes", None),
    "btts_no": ("btts", "no", None),
    "home_scores": ("team_goals_over", "home", 0.5),
    "away_scores": ("team_goals_over", "away", 0.5),
}


def window_key(date: datetime) -> str:
    """Jornada = ventana de martes a lunes (se identifica por su martes)."""
    tuesday = (date - timedelta(days=(date.weekday() - 1) % 7)).date()
    return tuesday.isoformat()


def market_goals(odds: dict[str, float]) -> tuple[float, float] | None:
    """(lambda, mu) implicitos en las cuotas medias pre-partido; None sin 1X2."""
    if not all(k in odds for k in ("home", "draw", "away")):
        return None
    p_home, _, p_away = implied_probabilities_shin([odds["home"], odds["draw"], odds["away"]])
    p_over = None
    if "over_2.5" in odds and "under_2.5" in odds:
        p_over, _ = implied_probabilities_shin([odds["over_2.5"], odds["under_2.5"]])
    return market_implied_goals(p_home, p_away, p_over)


@dataclass
class PicksParams:
    models: dict[tuple[str, str], CountModel]  # (stat, side)
    excluded_families: list[str]
    trained_on: list[str]
    # v3 (docs/PICKS_PROTOCOLO.md): suelo de las patas de las combinadas por
    # nivel y si sus patas de goles usan el modelo de patrones.
    tier_min_prob: float = MIN_PROB
    use_pattern_probs: bool = False

    def distributions(
        self,
        match_id: int,
        odds: dict[str, float],
        features: dict[str, dict[str, list[float]]],
        goals_lambda_mu: tuple[float, float] | None,
    ) -> MatchDistributions:
        """features: {"corners": {"home": [...], "away": [...]}, "yellow": {...}}."""
        counts = {
            stat: np.outer(
                self.models[(stat, "home")].pmf(features[stat]["home"]),
                self.models[(stat, "away")].pmf(features[stat]["away"]),
            )
            for stat in STATS
        }
        goals = poisson_matrix(*goals_lambda_mu, max_goals=MAX_GOALS) if goals_lambda_mu else None
        return MatchDistributions(
            match_id=match_id, goals=goals, corners=counts["corners"], yellow=counts["yellow"], real_odds=odds
        )

    def to_json(self) -> str:
        return json.dumps(
            {
                "trained_on": self.trained_on,
                "excluded_families": self.excluded_families,
                "tier_min_prob": self.tier_min_prob,
                "use_pattern_probs": self.use_pattern_probs,
                "models": {f"{stat}:{side}": m.to_dict() for (stat, side), m in self.models.items()},
            },
            indent=2,
        )


def load_params(path: Path = PARAMS_PATH) -> PicksParams | None:
    if not path.exists():
        return None
    raw = json.loads(path.read_text(encoding="utf-8"))
    return PicksParams(
        models={tuple(k.split(":")): CountModel.from_dict(v) for k, v in raw["models"].items()},
        excluded_families=raw["excluded_families"],
        trained_on=raw["trained_on"],
        tier_min_prob=raw.get("tier_min_prob", MIN_PROB),
        use_pattern_probs=raw.get("use_pattern_probs", False),
    )


__all__ = ["PATTERN_TO_LEG", "SIDES", "STATS", "PicksParams", "load_params", "market_goals", "window_key"]
