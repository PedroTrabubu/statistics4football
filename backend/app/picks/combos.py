"""Construccion de combinadas (reglas fijadas en docs/PICKS_PROTOCOLO.md)."""

import math
from collections import defaultdict
from dataclasses import dataclass
from itertools import combinations

import numpy as np

from app.picks.legs import SAME_MATCH_MARGIN, Leg, MatchDistributions, joint_probability


@dataclass(frozen=True)
class Tier:
    key: str
    label: str
    lo: float
    hi: float
    max_legs: int


# Version 2 del protocolo: menos patas, menos margen acumulado.
TIERS = [
    Tier("segura", "Segura", 1.40, 1.65, 2),
    # v4: nivel intermedio con ~65% de acierto prometido.
    Tier("fiable", "Fiable", 1.45, 1.60, 2),
    Tier("media", "Media", 1.85, 2.15, 3),
    Tier("alta", "Alta", 3.00, 5.00, 4),
    Tier("bomba", "Bomba", 8.00, 15.00, 5),
]
LOG_ODDS_STEP = 0.0005
MIN_LEGS = 2
SAME_MATCH_MIN_PROB = 0.70
SAME_MATCH_MAX_LEGS = 3


@dataclass
class Combo:
    kind: str  # tier key o "mismo_partido"
    legs: list[Leg]
    prob: float
    odds: float

    @property
    def odds_kind(self) -> str:
        if self.kind == "mismo_partido":
            return "estimada"
        return "estimada" if any(l.odds_kind == "estimada" for l in self.legs) else "real"


def _bucket(odds: float) -> int:
    return round(math.log(odds) / LOG_ODDS_STEP)


def build_tier_combo(legs: list[Leg], tier: Tier) -> Combo | None:
    """La combinada de mayor probabilidad conjunta con la cuota dentro del
    rango del nivel: una pata por partido, entre 2 y tier.max_legs patas.

    Programacion dinamica exacta sobre (n de patas, log-cuota discretizada):
    dp[k, b] = mayor suma de log-probabilidades con k patas y log-cuota b."""
    lo_b, hi_b = math.ceil(math.log(tier.lo) / LOG_ODDS_STEP), math.floor(math.log(tier.hi) / LOG_ODDS_STEP)
    by_match: dict[int, list[Leg]] = defaultdict(list)
    for leg in legs:
        if _bucket(leg.odds) <= hi_b:
            by_match[leg.match_id].append(leg)
    groups = list(by_match.values())
    if len(groups) < MIN_LEGS:
        return None

    # Margen de estados alrededor del rango: el redondeo de cada pata puede
    # desplazar la suma hasta medio paso; la cuota exacta se comprueba al final.
    k_max = tier.max_legs
    slack = k_max
    width = hi_b + slack + 1
    dp = np.full((k_max + 1, width), -np.inf)
    dp[0, 0] = 0.0
    choices = []
    for group in groups:
        new = dp.copy()
        choice = np.full((k_max + 1, width), -1, dtype=np.int32)
        for j, leg in enumerate(group):
            b = _bucket(leg.odds)
            cand = np.full_like(dp, -np.inf)
            cand[1:, b:] = dp[:-1, : width - b] + math.log(leg.prob)
            better = cand > new
            new[better] = cand[better]
            choice[better] = j
        dp = new
        choices.append(choice)

    # Estados candidatos de mejor a peor; el primero cuya cuota exacta cae en el rango.
    lo_s = max(lo_b - slack, 0)
    window = dp[MIN_LEGS:, lo_s:]
    order = np.argsort(window, axis=None)[::-1]
    chosen: list[Leg] = []
    for flat in order:
        if not np.isfinite(window.flat[flat]):
            return None
        k, b = np.unravel_index(flat, window.shape)
        k, b = int(k) + MIN_LEGS, int(b) + lo_s
        chosen = []
        for group, choice in zip(reversed(groups), reversed(choices), strict=True):
            j = choice[k, b]
            if j >= 0:
                leg = group[j]
                chosen.append(leg)
                k, b = k - 1, b - _bucket(leg.odds)
        if tier.lo <= math.prod(l.odds for l in chosen) <= tier.hi:
            break
    else:
        return None
    chosen.reverse()
    return Combo(
        kind=tier.key,
        legs=chosen,
        prob=math.prod(l.prob for l in chosen),
        odds=round(math.prod(l.odds for l in chosen), 2),
    )


def build_same_match_combo(dist: MatchDistributions, legs: list[Leg]) -> Combo | None:
    """2-3 patas de familias distintas con probabilidad conjunta >= 0.70; entre
    las validas, la de mayor cuota (menor probabilidad); a igualdad, menos patas."""
    # La probabilidad conjunta nunca supera la de su pata menos probable.
    legs = [l for l in legs if l.prob >= SAME_MATCH_MIN_PROB]
    best: tuple | None = None
    for size in range(2, SAME_MATCH_MAX_LEGS + 1):
        for combo in combinations(legs, size):
            if len({l.family for l in combo}) < size:
                continue
            p = joint_probability(dist, list(combo))
            if p < SAME_MATCH_MIN_PROB:
                continue
            key = (p, size)
            if best is None or key < best[0]:
                best = (key, list(combo), p)
    if best is None:
        return None
    _, chosen, p = best
    return Combo(kind="mismo_partido", legs=chosen, prob=p, odds=round(1 / (p * SAME_MATCH_MARGIN), 2))
