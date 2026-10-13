"""Utilidades estadisticas de los informes (funciones puras).

El remuestreo es por partidos: los picks o sucesos de un mismo partido no son
independientes (si hay muchos goles se cumplen a la vez "mas de 2.5" y "ambos
marcan"), asi que se remuestrean partidos enteros con reemplazo. Semilla fija:
el mismo informe da siempre el mismo intervalo.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

SEED = 20261009
REPS = 2000
CALIBRATION_EDGES = (0.0, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0)
EPS = 1e-12


def _per_match(match_ids: Sequence[int], *columns: Sequence[float]) -> list[np.ndarray]:
    """Suma cada columna por partido; devuelve [n por partido, suma col1, ...]."""
    _, idx = np.unique(np.asarray(match_ids), return_inverse=True)
    out = [np.bincount(idx).astype(float)]
    out += [np.bincount(idx, weights=np.asarray(col, dtype=float)) for col in columns]
    return out


def bootstrap_mean_diff(
    match_ids: Sequence[int],
    a: Sequence[float],
    b: Sequence[float],
    reps: int = REPS,
    seed: int = SEED,
) -> tuple[float, float, float]:
    """Diferencia de medias (a - b) sobre las mismas filas e intervalo al 95 %
    remuestreando partidos: (diferencia, inferior, superior)."""
    if len(a) == 0:
        return math.nan, math.nan, math.nan
    n, sum_a, sum_b = _per_match(match_ids, a, b)
    point = (sum_a.sum() - sum_b.sum()) / n.sum()
    rng = np.random.default_rng(seed)
    draws = rng.integers(0, len(n), size=(reps, len(n)))
    diffs = (sum_a[draws].sum(axis=1) - sum_b[draws].sum(axis=1)) / n[draws].sum(axis=1)
    low, high = np.percentile(diffs, [2.5, 97.5])
    return float(point), float(low), float(high)


@dataclass(frozen=True)
class CalibrationBin:
    low: float
    high: float
    n: int
    mean_p: float
    observed: float


def calibration(probs: Sequence[float], outcomes: Sequence[float], edges: Sequence[float] = CALIBRATION_EDGES) -> list[CalibrationBin]:
    """Probabilidad media frente a frecuencia observada por tramos (el ultimo
    tramo incluye el 1)."""
    p = np.asarray(probs, dtype=float)
    y = np.asarray(outcomes, dtype=float)
    bins = []
    for i, (low, high) in enumerate(zip(edges[:-1], edges[1:], strict=True)):
        last = i == len(edges) - 2
        mask = (p >= low) & ((p <= high) if last else (p < high))
        if mask.any():
            bins.append(CalibrationBin(low, high, int(mask.sum()), float(p[mask].mean()), float(y[mask].mean())))
    return bins


def log_loss(p_realized: Sequence[float]) -> float:
    """-media de log(probabilidad que se dio a lo que paso)."""
    p = np.clip(np.asarray(p_realized, dtype=float), EPS, 1.0)
    return float(-np.log(p).mean()) if len(p) else math.nan


def neg_log(p: float) -> float:
    return -math.log(max(p, EPS))


def fmt_pct(x: float | None, digits: int = 1) -> str:
    return "—" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{100 * x:.{digits}f} %"


def fmt_pts(x: float | None, digits: int = 1) -> str:
    return "—" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{100 * x:+.{digits}f}"
