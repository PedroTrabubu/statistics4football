"""Metricas de los porcentajes de resultado (docs/RESULTADOS_PROTOCOLO.md).

`P`: (n, 3) con local, empate y visitante; `y`: 0 local, 1 empate, 2 visitante.
"""

from __future__ import annotations

import math

import numpy as np

from app.analysis.stats import calibration
from app.probability.result_model import HIGH_CONFIDENCE, double_chance

CALIBRATION_EDGES = tuple(round(0.1 * i, 1) for i in range(11))
COVERAGE_THRESHOLDS = (0.5, 0.6, 0.7, 0.8, 0.9)
EPS = 1e-12


def log_loss_per_match(P: np.ndarray, y: np.ndarray) -> np.ndarray:
    return -np.log(np.clip(P[np.arange(len(y)), y], EPS, 1))


def rps_per_match(P: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Ranked probability score con el orden local, empate, visitante."""
    Y = np.eye(3)[y]
    return 0.5 * ((np.cumsum(P, axis=1)[:, :2] - np.cumsum(Y, axis=1)[:, :2]) ** 2).sum(axis=1)


def double_chance_outcomes(y: np.ndarray) -> np.ndarray:
    """(n, 3): si se cumplio 1X, X2 y 12."""
    return np.column_stack([y != 2, y != 0, y != 1]).astype(float)


def brier_dc_per_match(P: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Brier medio de los tres sucesos de doble oportunidad."""
    return ((double_chance(P) - double_chance_outcomes(y)) ** 2).mean(axis=1)


def top_hit(P: np.ndarray, y: np.ndarray) -> np.ndarray:
    return (P.argmax(axis=1) == y).astype(float)


def best_dc_hit(P: np.ndarray, y: np.ndarray) -> np.ndarray:
    """La mejor doble oportunidad excluye el resultado menos probable."""
    return (P.argmin(axis=1) != y).astype(float)


def calibration_bins(P: np.ndarray, y: np.ndarray) -> list:
    """Tramos de 0,1 sobre las tres probabilidades 1X2 de cada partido."""
    return calibration(P.ravel(), np.eye(3)[y].ravel(), CALIBRATION_EDGES)


def ece(P: np.ndarray, y: np.ndarray) -> float:
    bins = calibration_bins(P, y)
    total = sum(b.n for b in bins)
    return sum(b.n * abs(b.mean_p - b.observed) for b in bins) / total if total else math.nan


def wilson(hits: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return math.nan, math.nan
    p = hits / n
    d = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / d
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return centre - half, centre + half


def coverage_accuracy(p_best: np.ndarray, hit: np.ndarray, thresholds=COVERAGE_THRESHOLDS) -> list[dict]:
    """Para cada umbral: partidos con probabilidad >= umbral, cobertura y acierto."""
    out = []
    for t in thresholds:
        mask = p_best >= t
        n = int(mask.sum())
        hits = int(hit[mask].sum())
        out.append({"umbral": t, "n": n, "cobertura": n / len(p_best) if len(p_best) else math.nan,
                    "acierto": hits / n if n else math.nan, "wilson": wilson(hits, n)})  # fmt: skip
    return out


def high_confidence(P: np.ndarray, y: np.ndarray, threshold: float = HIGH_CONFIDENCE) -> dict:
    """Nivel Alta confianza del resultado mas probable y de la mejor doble
    oportunidad: cobertura y acierto observado (con Wilson), y lo mismo del resto."""
    out = {}
    for name, p_best, hit in (
        ("resultado", P.max(axis=1), top_hit(P, y)),
        ("doble", double_chance(P).max(axis=1), best_dc_hit(P, y)),
    ):
        level = {}
        for label, mask in (("alta", p_best >= threshold), ("resto", p_best < threshold)):
            n, hits = int(mask.sum()), int(hit[mask].sum())
            level[label] = {"n": n, "cobertura": n / len(y) if len(y) else math.nan,
                            "acierto": hits / n if n else math.nan, "wilson": wilson(hits, n)}  # fmt: skip
        out[name] = level
    return out
