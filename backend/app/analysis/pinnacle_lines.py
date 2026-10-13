"""Evaluacion por linea: en cada linea que ofrece Pinnacle (no solo la del
pick), probabilidad del modelo frente a la de Pinnacle sin margen, con
log-loss, calibracion y CLV.

- Lineas enteras (2.0): si cae justo en la linea es devolucion. Las cuotas
  solo dicen la probabilidad si no hay devolucion, asi que se compara con esa
  (la del modelo se condiciona igual) y las devoluciones no puntuan.
- Cuartos de linea (2.25): se excluyen y se cuentan.
- Tarjetas: excluidas (definicion distinta a la nuestra, ver pinnacle_picks).
- Handicaps: no se evaluan (ningun pick los usa).

Modelos: Dixon-Coles (goles, partido entero) y el modelo de conteos de las
combinadas (corners). La primera parte no tiene modelo: solo calibracion de
Pinnacle. CLV del modelo: en la seleccion en la que el modelo veia mas
diferencia con la apertura, cuanto se movio el mercado hasta el cierre (si
se mueve hacia el modelo, el modelo anticipaba informacion).
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from app.analysis.books import THREE_WAY, TWO_WAY, Book, MarketKey, market_probabilities
from app.analysis.stats import bootstrap_mean_diff, calibration, neg_log
from app.probability.devig import DEFAULT_METHOD, Method, conditional_on_no_push, line_kind

MODEL_MARKETS = {"total", "team_total", "btts", "team_to_score", "moneyline"}


@dataclass(frozen=True)
class MatchResultData:
    """Lo que hace falta del partido para resolver cada mercado."""

    home_goals: int
    away_goals: int
    home_ht_goals: int | None = None
    away_ht_goals: int | None = None
    home_corners: int | None = None
    away_corners: int | None = None


@dataclass(frozen=True)
class ModelDists:
    """Distribuciones conjuntas local x visitante del modelo (None si no hay)."""

    goals: np.ndarray | None = None
    corners: np.ndarray | None = None


ModelProvider = Callable[[int], ModelDists | None]


@dataclass(frozen=True)
class LineEvent:
    match_id: int
    group: str  # "goles total", "córners del equipo"...
    key: MarketKey
    realized: str  # seleccion que paso (las devoluciones no llegan aqui)
    p_close: dict[str, float]
    p_open: dict[str, float] | None
    p_model: dict[str, float] | None


def _counts(result: MatchResultData, units: str, period: int) -> tuple[int, int] | None:
    if units == "goals":
        if period == 0:
            return result.home_goals, result.away_goals
        if result.home_ht_goals is None or result.away_ht_goals is None:
            return None
        return result.home_ht_goals, result.away_ht_goals
    if units == "corners" and period == 0 and result.home_corners is not None and result.away_corners is not None:
        return result.home_corners, result.away_corners
    return None


def realized_selection(key: MarketKey, result: MatchResultData) -> str | None:
    """La seleccion ganadora del mercado, o None si es devolucion o no hay dato."""
    units, period, market, team, line = key
    counts = _counts(result, units, period)
    if counts is None:
        return None
    home, away = counts
    if market == "moneyline":
        return "home" if home > away else "away" if away > home else "draw"
    if market == "btts":
        return "yes" if home > 0 and away > 0 else "no"
    if market == "team_to_score":
        goals = home if team == "home" else away
        return "yes" if goals > 0 else "no"
    if market in ("total", "team_total") and line is not None:
        value = home + away if market == "total" else (home if team == "home" else away)
        return "over" if value > line else "under" if value < line else None
    return None


def _model_probs(key: MarketKey, dists: ModelDists | None) -> dict[str, float] | None:
    """Probabilidades del modelo para el mismo mercado (condicionadas a que no
    haya devolucion en las lineas enteras)."""
    units, period, market, team, line = key
    if dists is None or period != 0 or market not in MODEL_MARKETS:
        return None
    grid = dists.goals if units == "goals" else dists.corners if units == "corners" else None
    if grid is None:
        return None
    i, j = np.meshgrid(np.arange(grid.shape[0]), np.arange(grid.shape[1]), indexing="ij")
    p = lambda mask: float(grid[mask].sum())  # noqa: E731
    if market == "moneyline":
        return {"home": p(i > j), "draw": p(i == j), "away": p(i < j)}
    if market == "btts":
        yes = p((i > 0) & (j > 0))
        return {"yes": yes, "no": 1 - yes}
    if market == "team_to_score":
        yes = p((i if team == "home" else j) > 0)
        return {"yes": yes, "no": 1 - yes}
    value = i + j if market == "total" else (i if team == "home" else j)
    over, push = p(value > line), p(value == line)
    if push >= 1:
        return None
    over = conditional_on_no_push(over, push)
    return {"over": over, "under": 1 - over}


GROUP_LABEL = {
    ("goals", 0, "moneyline"): "1X2",
    ("goals", 0, "total"): "goles del partido",
    ("goals", 1, "total"): "goles 1ª parte",
    ("goals", 0, "team_total"): "goles del equipo",
    ("goals", 1, "team_total"): "goles del equipo 1ª parte",
    ("goals", 0, "btts"): "ambos marcan",
    ("goals", 1, "btts"): "ambos marcan 1ª parte",
    ("goals", 0, "team_to_score"): "marca el equipo",
    ("goals", 1, "team_to_score"): "marca el equipo 1ª parte",
    ("corners", 0, "total"): "córners del partido",
    ("corners", 0, "team_total"): "córners del equipo",
}


@dataclass
class LineEvents:
    events: list[LineEvent]
    excluded: Counter  # motivo -> mercados


def line_events(
    closing: dict[int, Book],
    opening: dict[int, Book],
    results: dict[int, MatchResultData],
    model: ModelProvider | None = None,
    method: Method = DEFAULT_METHOD,
) -> LineEvents:
    """Un suceso por partido y mercado completo de cierre (cada linea cuenta)."""
    events: list[LineEvent] = []
    excluded: Counter = Counter()
    for match_id, book in closing.items():
        result = results.get(match_id)
        if result is None:
            excluded["partido sin resultado"] += len(book.markets)
            continue
        dists = model(match_id) if model else None
        for key in book.markets:
            units, period, market, _, line = key
            if units == "bookings":
                excluded["tarjetas: no comparables"] += 1
                continue
            if market not in TWO_WAY and market not in THREE_WAY:
                excluded[f"{market}: no se evalúa"] += 1
                continue
            if market == "draw_no_bet":
                excluded["empate no apuesta: no se evalúa"] += 1
                continue
            if line is not None and line_kind(line) == "quarter":
                excluded["cuarto de línea"] += 1
                continue
            label = GROUP_LABEL.get((units, period, market))
            if label is None:
                excluded[f"{units} {market} periodo {period}: no se evalúa"] += 1
                continue
            p_close = market_probabilities(book, key, method)
            if p_close is None:
                excluded["mercado incompleto"] += 1
                continue
            realized = realized_selection(key, result)
            if realized is None:
                excluded["devolución o sin dato del partido"] += 1
                continue
            opened = opening.get(match_id)
            events.append(
                LineEvent(
                    match_id=match_id,
                    group=label,
                    key=key,
                    realized=realized,
                    p_close=p_close,
                    p_open=market_probabilities(opened, key, method) if opened else None,
                    p_model=_model_probs(key, dists),
                )
            )
    return LineEvents(events, excluded)


@dataclass(frozen=True)
class LineSummary:
    group: str
    n: int
    matches: int
    logloss_pinnacle: float
    n_model: int
    logloss_model: float | None
    logloss_pinnacle_same: float | None  # Pinnacle en los mismos sucesos que el modelo
    diff: tuple[float, float, float] | None  # modelo - Pinnacle, con IC (negativo: mejor el modelo)
    clv_n: int
    clv: tuple[float, float, float] | None  # movimiento hacia la seleccion del modelo, con IC


def summarize_lines(events: list[LineEvent]) -> LineSummary | None:
    if not events:
        return None
    ll_pin = [neg_log(e.p_close[e.realized]) for e in events]
    with_model = [e for e in events if e.p_model is not None]
    diff = None
    ll_model = ll_same = None
    if with_model:
        a = [neg_log(e.p_model[e.realized]) for e in with_model]
        b = [neg_log(e.p_close[e.realized]) for e in with_model]
        ll_model, ll_same = sum(a) / len(a), sum(b) / len(b)
        diff = bootstrap_mean_diff([e.match_id for e in with_model], a, b)
    clv_rows = []
    for e in with_model:
        if e.p_open is None:
            continue
        pick = max(e.p_model, key=lambda s: e.p_model[s] - e.p_open[s])
        clv_rows.append((e.match_id, e.p_close[pick] - e.p_open[pick]))
    clv = None
    if clv_rows:
        ids, moves = zip(*clv_rows, strict=True)
        clv = bootstrap_mean_diff(list(ids), list(moves), [0.0] * len(moves))
    return LineSummary(
        group=events[0].group,
        n=len(events),
        matches=len({e.match_id for e in events}),
        logloss_pinnacle=sum(ll_pin) / len(ll_pin),
        n_model=len(with_model),
        logloss_model=ll_model,
        logloss_pinnacle_same=ll_same,
        diff=diff,
        clv_n=len(clv_rows),
        clv=clv,
    )


DECILES = tuple(i / 10 for i in range(11))


def market_calibration(events: list[LineEvent], which: str = "close"):
    """Calibracion por deciles de todas las selecciones (Pinnacle al cierre o
    el modelo)."""
    probs, outcomes = [], []
    for e in events:
        source = e.p_close if which == "close" else e.p_model
        if source is None:
            continue
        for selection, p in source.items():
            probs.append(p)
            outcomes.append(1.0 if selection == e.realized else 0.0)
    return calibration(probs, outcomes, DECILES)
