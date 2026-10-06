"""Catalogo de patas de los picks: probabilidad, cuota y resolucion.

Cada pata es un suceso sobre uno de tres "componentes" del partido:
- goals: marcador (rejilla 11x11 de la matriz de goles),
- corners: corners de local y visitante (rejilla de conteos),
- yellow: amarillas de local y visitante.

La probabilidad conjunta de varias patas del mismo partido se calcula sobre la
rejilla de su componente (asi "gana el local" y "mas de 2.5" se combinan bien)
y se multiplica entre componentes, que se suponen independientes.
"""

from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from app.picks.count_model import MAX_COUNT

EST_MARGIN = 1.07  # margen supuesto para cuotas estimadas de una pata
SAME_MATCH_MARGIN = 1.10  # margen supuesto para combinadas del mismo partido
MIN_PROB = 0.55

# Selecciones que la casa no permite en combinadas (Winamax no acepta "1 o 2,
# sin empate" en combinadas): nunca se proponen.
UNAVAILABLE: frozenset[tuple[str, str, float | None]] = frozenset({("double_chance", "12", None)})
MIN_ODDS = 1.05
MAX_GOALS = 10

FAMILIES = (
    "resultado",
    "goles_totales",
    "goles_equipo",
    "corners_totales",
    "corners_equipo",
    "amarillas_totales",
    "amarillas_equipo",
)

Event = Callable[[np.ndarray, np.ndarray], np.ndarray]  # (local, visitante) -> bool


@dataclass(frozen=True)
class LegDef:
    market: str
    selection: str
    line: float | None
    family: str
    component: str  # goals | corners | yellow
    event: Event = field(compare=False)


def _ou(component: str, market: str, family: str, lines: list[float]) -> list[LegDef]:
    out = []
    for line in lines:
        out.append(LegDef(market, "over", line, family, component, lambda h, a, l=line: h + a > l))
        out.append(LegDef(market, "under", line, family, component, lambda h, a, l=line: h + a < l))
    return out


def _team_over(component: str, market: str, family: str, home_lines: list[float], away_lines: list[float]) -> list[LegDef]:
    out = [LegDef(market, "home", l, family, component, lambda h, a, l=l: h > l) for l in home_lines]
    out += [LegDef(market, "away", l, family, component, lambda h, a, l=l: a > l) for l in away_lines]
    return out


LEG_DEFS: list[LegDef] = [
    LegDef("1x2", "home", None, "resultado", "goals", lambda h, a: h > a),
    LegDef("1x2", "draw", None, "resultado", "goals", lambda h, a: h == a),
    LegDef("1x2", "away", None, "resultado", "goals", lambda h, a: h < a),
    LegDef("double_chance", "1X", None, "resultado", "goals", lambda h, a: h >= a),
    LegDef("double_chance", "X2", None, "resultado", "goals", lambda h, a: h <= a),
    LegDef("double_chance", "12", None, "resultado", "goals", lambda h, a: h != a),
    *_ou("goals", "goals_over_under", "goles_totales", [1.5, 2.5, 3.5]),
    LegDef("btts", "yes", None, "goles_equipo", "goals", lambda h, a: (h > 0) & (a > 0)),
    LegDef("btts", "no", None, "goles_equipo", "goals", lambda h, a: ~((h > 0) & (a > 0))),
    *_team_over("goals", "team_goals_over", "goles_equipo", [0.5, 1.5], [0.5, 1.5]),
    *_ou("corners", "corners_over_under", "corners_totales", [7.5, 8.5, 9.5, 10.5, 11.5]),
    *_team_over("corners", "team_corners_over", "corners_equipo", [3.5, 4.5, 5.5], [2.5, 3.5, 4.5]),
    *_ou("yellow", "yellow_over_under", "amarillas_totales", [2.5, 3.5, 4.5, 5.5, 6.5]),
    *_team_over("yellow", "team_yellow_over", "amarillas_equipo", [0.5, 1.5, 2.5], [0.5, 1.5, 2.5]),
]
LEG_DEF_BY_KEY = {(d.market, d.selection, d.line): d for d in LEG_DEFS}


def _grid(n: int) -> tuple[np.ndarray, np.ndarray]:
    return np.meshgrid(np.arange(n + 1), np.arange(n + 1), indexing="ij")


GRIDS = {"goals": _grid(MAX_GOALS), "corners": _grid(MAX_COUNT), "yellow": _grid(MAX_COUNT)}
MASKS = {(d.market, d.selection, d.line): d.event(*GRIDS[d.component]) for d in LEG_DEFS}


@dataclass
class Leg:
    match_id: int
    market: str
    selection: str
    line: float | None
    family: str
    component: str
    prob: float
    odds: float
    odds_kind: str  # real | derivada | estimada

    @property
    def key(self) -> tuple[str, str, float | None]:
        return (self.market, self.selection, self.line)


@dataclass
class MatchDistributions:
    """Distribuciones de un partido: matriz de goles (o None sin cuotas) y
    matrices conjuntas de corners y amarillas (local x visitante)."""

    match_id: int
    goals: np.ndarray | None
    corners: np.ndarray
    yellow: np.ndarray
    real_odds: dict[str, float]  # "home"/"draw"/"away"/"over_2.5"/"under_2.5"

    def grid(self, component: str) -> np.ndarray | None:
        return {"goals": self.goals, "corners": self.corners, "yellow": self.yellow}[component]


def _real_odds(d: LegDef, odds: dict[str, float]) -> tuple[float, str] | None:
    if d.market == "1x2" and d.selection in odds:
        return odds[d.selection], "real"
    if d.market == "goals_over_under" and d.line == 2.5 and f"{d.selection}_2.5" in odds:
        return odds[f"{d.selection}_2.5"], "real"
    if d.market == "double_chance" and all(k in odds for k in ("home", "draw", "away")):
        pair = {"1X": ("home", "draw"), "X2": ("away", "draw"), "12": ("home", "away")}[d.selection]
        return 1 / (1 / odds[pair[0]] + 1 / odds[pair[1]]), "derivada"
    return None


LegKey = tuple[str, str, float | None]


def match_legs(
    dist: MatchDistributions,
    excluded_families: set[str] = frozenset(),
    min_prob: float = MIN_PROB,
    prob_overrides: dict[LegKey, float] | None = None,
) -> list[Leg]:
    """Patas candidatas de un partido (p >= min_prob, cuota >= MIN_ODDS).

    prob_overrides sustituye la probabilidad de algunas patas (p. ej. por la del
    modelo de patrones), pero la cuota estimada sigue saliendo de la
    probabilidad de la distribucion (mercado), para no inventar valor."""
    legs = []
    for d in LEG_DEFS:
        grid = dist.grid(d.component)
        if grid is None or d.family in excluded_families:
            continue
        key = (d.market, d.selection, d.line)
        if key in UNAVAILABLE:
            continue
        p_dist = float(grid[MASKS[key]].sum())
        p = prob_overrides.get(key, p_dist) if prob_overrides else p_dist
        if p < min_prob:
            continue
        real = _real_odds(d, dist.real_odds)
        odds, kind = real if real else (1 / (p_dist * EST_MARGIN), "estimada")
        if odds < MIN_ODDS:
            continue
        legs.append(Leg(dist.match_id, d.market, d.selection, d.line, d.family, d.component, p, round(odds, 3), kind))
    return legs


def joint_probability(dist: MatchDistributions, legs: list[Leg]) -> float:
    """Probabilidad de que acierten todas las patas (mismo partido)."""
    p = 1.0
    for component in ("goals", "corners", "yellow"):
        comp_legs = [l for l in legs if l.component == component]
        if not comp_legs:
            continue
        mask = np.logical_and.reduce([MASKS[l.key] for l in comp_legs])
        p *= float(dist.grid(component)[mask].sum())
    return p


def resolve_leg(
    market: str,
    selection: str,
    line: float | None,
    goals: tuple[int, int] | None,
    corners: tuple[int, int] | None,
    yellow: tuple[int, int] | None,
) -> bool | None:
    """True/False si se puede resolver con el resultado real, None si falta el dato."""
    d = LEG_DEF_BY_KEY.get((market, selection, line))
    if d is None:
        return None
    values = {"goals": goals, "corners": corners, "yellow": yellow}[d.component]
    if values is None or values[0] is None or values[1] is None:
        return None
    return bool(d.event(np.array(values[0]), np.array(values[1])))
