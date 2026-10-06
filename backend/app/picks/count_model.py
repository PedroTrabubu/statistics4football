"""Modelo de conteos por equipo (corners y amarillas) para los picks.

Para cada partido y estadistica se predice lo que saca cada equipo con una
regresion de Poisson sobre tasas point-in-time encogidas hacia la media de la
liga, y una dispersion binomial negativa estimada por momentos. Parametros
fijados en docs/PICKS_PROTOCOLO.md.
"""

import math
from collections import deque
from dataclasses import dataclass

import numpy as np
from scipy.optimize import minimize
from scipy.stats import nbinom, poisson

VENUE_WINDOW = 10
ALL_WINDOW = 20
SHRINK_MATCHES = 5
LEAGUE_PRIOR_WINDOW = 760
MAX_COUNT = 30

STATS = ("corners", "yellow")
SIDES = ("home", "away")
N_FEATURES = 4


def _shrunk_mean(values: list[float], prior: float) -> float:
    return (sum(values) + SHRINK_MATCHES * prior) / (len(values) + SHRINK_MATCHES)


class CountTracker:
    """Historial de una estadistica por equipo, alimentado en orden cronologico
    (features() antes de add(), como PatternTracker)."""

    def __init__(self) -> None:
        # (equipo, campo) -> deque de (a favor, en contra); campo: home|away|all
        self.hist: dict[tuple[int, str], deque] = {}
        # Partidos de la liga: (local, visitante)
        self.league: deque = deque(maxlen=LEAGUE_PRIOR_WINDOW)

    def _values(self, team_id: int, venue: str, idx: int) -> list[float]:
        return [v[idx] for v in self.hist.get((team_id, venue), [])]

    def _prior(self, side: str) -> float:
        """Media de la liga de lo que saca el local ("home") o el visitante ("away")."""
        if not self.league:
            return 5.0
        idx = 0 if side == "home" else 1
        return sum(m[idx] for m in self.league) / len(self.league)

    def features(self, home_id: int, away_id: int) -> dict[str, list[float]]:
        """{"home": [4 logs], "away": [4 logs]}: features para lo que saca cada equipo."""
        p_home, p_away = self._prior("home"), self._prior("away")
        p_all = (p_home + p_away) / 2
        home = [
            _shrunk_mean(self._values(home_id, "home", 0), p_home),  # el local saca en casa
            _shrunk_mean(self._values(away_id, "away", 1), p_home),  # el visitante concede fuera
            _shrunk_mean(self._values(home_id, "all", 0), p_all),
            _shrunk_mean(self._values(away_id, "all", 1), p_all),
        ]
        away = [
            _shrunk_mean(self._values(away_id, "away", 0), p_away),
            _shrunk_mean(self._values(home_id, "home", 1), p_away),
            _shrunk_mean(self._values(away_id, "all", 0), p_all),
            _shrunk_mean(self._values(home_id, "all", 1), p_all),
        ]
        return {"home": [math.log(max(x, 0.05)) for x in home], "away": [math.log(max(x, 0.05)) for x in away]}

    def add(self, home_id: int, away_id: int, home_value: float, away_value: float) -> None:
        for key, value, maxlen in (
            ((home_id, "home"), (home_value, away_value), VENUE_WINDOW),
            ((away_id, "away"), (away_value, home_value), VENUE_WINDOW),
            ((home_id, "all"), (home_value, away_value), ALL_WINDOW),
            ((away_id, "all"), (away_value, home_value), ALL_WINDOW),
        ):
            self.hist.setdefault(key, deque(maxlen=maxlen)).append(value)
        self.league.append((home_value, away_value))


@dataclass
class CountModel:
    """Poisson log-lineal + dispersion NB (alpha: var = mu + alpha * mu^2)."""

    coef: np.ndarray  # [intercepto, w1..w4]
    alpha: float

    def mean(self, x: list[float]) -> float:
        return float(math.exp(self.coef[0] + np.dot(self.coef[1:], x)))

    def pmf(self, x: list[float]) -> np.ndarray:
        mu = self.mean(x)
        k = np.arange(MAX_COUNT + 1)
        if self.alpha < 1e-6:
            p = poisson.pmf(k, mu)
        else:
            n = 1 / self.alpha
            p = nbinom.pmf(k, n, n / (n + mu))
        return p / p.sum()

    def to_dict(self) -> dict:
        return {"coef": self.coef.tolist(), "alpha": self.alpha}

    @classmethod
    def from_dict(cls, d: dict) -> "CountModel":
        return cls(coef=np.array(d["coef"]), alpha=d["alpha"])


def fit_count_model(X: np.ndarray, y: np.ndarray, l2: float = 1.0) -> CountModel:
    Z = np.column_stack([np.ones(len(X)), X])

    def nll(w: np.ndarray) -> tuple[float, np.ndarray]:
        eta = Z @ w
        mu = np.exp(eta)
        loss = np.sum(mu - y * eta) + 0.5 * l2 * np.sum(w[1:] ** 2)
        grad = Z.T @ (mu - y)
        grad[1:] += l2 * w[1:]
        return loss, grad

    w0 = np.zeros(Z.shape[1])
    w0[0] = math.log(max(y.mean(), 0.1))
    res = minimize(nll, w0, jac=True, method="L-BFGS-B")
    mu = np.exp(Z @ res.x)
    alpha = max(0.0, float(np.mean((y - mu) ** 2 - mu) / np.mean(mu**2)))
    return CountModel(coef=res.x, alpha=alpha)
