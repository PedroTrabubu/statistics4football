"""Indice de predecibilidad (protocolo pre-registrado: docs/PREDECIBILIDAD_PROTOCOLO.md).

Walk-forward de una regresion ridge sobre las variables de cada partido (las
exporta frontend/scripts/export-predictability.ts), indice = percentil de la
prediccion entre las del entrenamiento, bandas por terciles y metricas con
remuestreo por partidos. Funciones puras: todo sale de las filas que se pasan.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import numpy as np

LAMBDA = 10.0
MIN_TRAIN = 300
BAND_EDGES = (100 / 3, 200 / 3)
BANDS = ("alta", "media", "baja")
MIN_BAND = 30
SEED = 20261014
REPS = 2000
VARIANT_B = ("n_alta", "sample_min", "rival_backed", "history_min")


@dataclass(frozen=True)
class MatchRow:
    match_id: int
    league: str
    season: str
    date: str
    picks: int
    hits: int
    expected: float
    excess: float | None
    features: dict[str, float | None]

    @property
    def day(self) -> str:
        return self.date[:10]


@dataclass(frozen=True)
class Model:
    features: tuple[str, ...]
    mean: np.ndarray
    scale: np.ndarray
    coef: np.ndarray
    intercept: float
    reference: np.ndarray  # predicciones sobre su entrenamiento, ordenadas

    def to_json(self) -> dict:
        return {
            "features": list(self.features),
            "mean": self.mean.tolist(),
            "scale": self.scale.tolist(),
            "coef": self.coef.tolist(),
            "intercept": self.intercept,
            "reference": self.reference.tolist(),
        }


def _vector(row: MatchRow, features: Sequence[str]) -> np.ndarray:
    return np.array([np.nan if row.features[f] is None else row.features[f] for f in features], dtype=float)


def fit(
    rows: Sequence[MatchRow],
    features: Sequence[str],
    lam: float = LAMBDA,
    vectors: dict[int, np.ndarray] | None = None,
) -> Model:
    """Ridge sobre variables estandarizadas; lo que falta, la media del entrenamiento.
    `vectors`: cache de las variables de cada partido (el walk-forward reentrena mucho)."""
    if vectors is None:
        vectors = {}
    for r in rows:
        if r.match_id not in vectors:
            vectors[r.match_id] = _vector(r, features)
    x = np.stack([vectors[r.match_id] for r in rows])
    y = np.array([r.excess for r in rows], dtype=float)
    mean = np.nanmean(x, axis=0)
    mean = np.where(np.isnan(mean), 0.0, mean)
    x = np.where(np.isnan(x), mean, x)
    scale = x.std(axis=0)
    scale = np.where(scale > 0, scale, 1.0)
    z = (x - mean) / scale
    intercept = float(y.mean())
    coef = np.linalg.solve(z.T @ z + lam * np.eye(len(features)), z.T @ (y - intercept))
    reference = np.sort(z @ coef + intercept)
    return Model(tuple(features), mean, scale, coef, intercept, reference)


def predict(model: Model, row: MatchRow) -> float:
    x = _vector(row, model.features)
    z = np.where(np.isnan(x), 0.0, (x - model.mean) / model.scale)
    return float(model.intercept + z @ model.coef)


def percentile(value: float, reference: np.ndarray) -> float:
    """0-100; los empates cuentan la mitad (igual que percentileOf en la web)."""
    if len(reference) == 0:
        return 50.0
    below = np.searchsorted(reference, value, side="left")
    equal = np.searchsorted(reference, value, side="right") - below
    return float(100 * (below + equal / 2) / len(reference))


def band(index: float) -> str:
    return "alta" if index >= BAND_EDGES[1] else "media" if index >= BAND_EDGES[0] else "baja"


@dataclass(frozen=True)
class Scored:
    row: MatchRow
    score: float  # prediccion (o valor de la linea base)
    index: float
    band: str


Scorer = Callable[[Sequence[MatchRow]], Callable[[MatchRow], tuple[float, np.ndarray]]]


def model_scorer(features: Sequence[str]) -> Scorer:
    """Entrena con `train` y puntua con la prediccion del modelo."""

    vectors: dict[int, np.ndarray] = {}

    def train(rows: Sequence[MatchRow]):
        model = fit(rows, features, vectors=vectors)
        return lambda row: (predict(model, row), model.reference)

    return train


def feature_scorer(name: str) -> Scorer:
    """Linea base: el valor de una variable, con su percentil entre el entrenamiento."""

    def train(rows: Sequence[MatchRow]):
        reference = np.sort(np.array([r.features[name] or 0.0 for r in rows], dtype=float))
        return lambda row: (float(row.features[name] or 0.0), reference)

    return train


def walk_forward(rows: Sequence[MatchRow], scorer: Scorer, min_train: int = MIN_TRAIN) -> list[Scored]:
    """Cada dia se entrena con los partidos (con objetivo) de dias anteriores y se
    puntuan los de ese dia. Sin `min_train` partidos de entrenamiento, sin indice."""
    usable = sorted((r for r in rows if r.excess is not None), key=lambda r: (r.date, r.match_id))
    scored: list[Scored] = []
    days = sorted({r.day for r in usable})
    start = 0
    for day in days:
        while start < len(usable) and usable[start].day < day:
            start += 1
        train = usable[:start]
        if len(train) < min_train:
            continue
        score = scorer(train)
        for row in (r for r in usable[start:] if r.day == day):
            value, reference = score(row)
            index = percentile(value, reference)
            scored.append(Scored(row, value, index, band(index)))
    return scored


# --- Metricas ---------------------------------------------------------------------


def _band_mean(values: np.ndarray, bands: np.ndarray, name: str) -> float:
    picked = values[bands == name]
    return float(picked.mean()) if len(picked) else math.nan


def separation(scored: Sequence[Scored], reps: int = REPS, seed: int = SEED) -> tuple[float, float, float]:
    """Exceso medio de la banda Alta menos el de la Baja, con intervalo del 95 %
    remuestreando partidos (un partido = una fila)."""
    excess = np.array([s.row.excess for s in scored], dtype=float)
    bands = np.array([s.band for s in scored])
    point = _band_mean(excess, bands, "alta") - _band_mean(excess, bands, "baja")
    if math.isnan(point):
        return math.nan, math.nan, math.nan
    rng = np.random.default_rng(seed)
    diffs = []
    for _ in range(reps):
        i = rng.integers(0, len(scored), len(scored))
        diffs.append(_band_mean(excess[i], bands[i], "alta") - _band_mean(excess[i], bands[i], "baja"))
    low, high = np.nanpercentile(diffs, [2.5, 97.5])
    return float(point), float(low), float(high)


def paired_gain(
    a: Sequence[Scored], b: Sequence[Scored], reps: int = REPS, seed: int = SEED
) -> tuple[float, float, float]:
    """Separacion de `a` menos la de `b` en los mismos partidos, remuestreados a la vez."""
    by_id = {s.row.match_id: s for s in b}
    pairs = [(s, by_id[s.row.match_id]) for s in a if s.row.match_id in by_id]
    excess = np.array([s.row.excess for s, _ in pairs], dtype=float)
    band_a = np.array([s.band for s, _ in pairs])
    band_b = np.array([t.band for _, t in pairs])

    def gain(i: np.ndarray) -> float:
        sep_a = _band_mean(excess[i], band_a[i], "alta") - _band_mean(excess[i], band_a[i], "baja")
        sep_b = _band_mean(excess[i], band_b[i], "alta") - _band_mean(excess[i], band_b[i], "baja")
        return sep_a - (0.0 if math.isnan(sep_b) else sep_b)

    point = gain(np.arange(len(pairs)))
    rng = np.random.default_rng(seed)
    draws = [gain(rng.integers(0, len(pairs), len(pairs))) for _ in range(reps)]
    low, high = np.nanpercentile(draws, [2.5, 97.5])
    return float(point), float(low), float(high)


def spearman(x: Sequence[float], y: Sequence[float]) -> float:
    def ranks(v: Sequence[float]) -> np.ndarray:
        arr = np.asarray(v, dtype=float)
        order = arr.argsort(kind="mergesort")
        r = np.empty(len(arr))
        r[order] = np.arange(len(arr))
        for value in np.unique(arr):  # empates: rango medio
            tied = arr == value
            r[tied] = r[tied].mean()
        return r

    if len(x) < 3:
        return math.nan
    rx, ry = ranks(x), ranks(y)
    if rx.std() == 0 or ry.std() == 0:
        return math.nan
    return float(np.corrcoef(rx, ry)[0, 1])


@dataclass(frozen=True)
class CalibrationBin:
    n: int
    predicted: float
    observed: float


def calibration(scored: Sequence[Scored], bins: int = 5) -> list[CalibrationBin]:
    """Por quintiles de la prediccion: exceso predicho medio frente al observado."""
    ordered = sorted(scored, key=lambda s: s.score)
    out = []
    for chunk in np.array_split(np.arange(len(ordered)), bins):
        if len(chunk) == 0:
            continue
        rows = [ordered[i] for i in chunk]
        out.append(
            CalibrationBin(
                n=len(rows),
                predicted=float(np.mean([s.score for s in rows])),
                observed=float(np.mean([s.row.excess for s in rows])),
            )
        )
    return out


@dataclass(frozen=True)
class BandStats:
    matches: int
    picks: int
    hit_rate: float
    base: float
    edge: float  # acierto - base, en tanto por uno
    low: float
    high: float

    @property
    def insufficient(self) -> bool:
        return self.matches < MIN_BAND


def band_stats(scored: Sequence[Scored], bootstrap) -> BandStats | None:
    """Acierto de todos los picks de esos partidos frente a la base de la liga,
    con el intervalo de `bootstrap` (app.analysis.stats.bootstrap_mean_diff)."""
    rows = [s.row for s in scored if s.row.picks > 0]
    if not rows:
        return None
    ids: list[int] = []
    hits: list[float] = []
    base: list[float] = []
    for r in rows:
        ids += [r.match_id] * r.picks
        hits += [1.0] * r.hits + [0.0] * (r.picks - r.hits)
        base += [r.expected / r.picks] * r.picks
    edge, low, high = bootstrap(ids, hits, base)
    picks = len(ids)
    return BandStats(
        matches=len(rows),
        picks=picks,
        hit_rate=sum(hits) / picks,
        base=sum(base) / picks,
        edge=edge,
        low=low,
        high=high,
    )
