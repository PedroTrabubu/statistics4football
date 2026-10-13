"""Margen y probabilidades sin margen de un mercado completo (funciones puras).

Metodos para quitar el margen (overround):
- "proportional": 1/cuota normalizado para que sume 1. Reparte el margen en
  proporcion a cada probabilidad, asi que deja a los favoritos algo por debajo
  de lo real (sesgo favorito-sorpresa).
- "power": p_i = (1/cuota_i)^k con k tal que sumen 1. Quita mas margen a las
  sorpresas que a los favoritos.
- "shin": el de app/probability/market.py, el mismo con el que la web quita el
  margen a "Market Average".

Predeterminado: "shin" (DEFAULT_METHOD), por coherencia con la web. En
Pinnacle, con ~2-3 % de margen, los tres dan casi lo mismo; la diferencia
crece con el margen y con las cuotas muy desiguales (lineas alternativas).
Los picks son favoritos, asi que el metodo proporcional los haria parecer
mejores frente al mercado de lo que son: se informa como sensibilidad.

Lineas especiales de totales y handicaps (ver line_kind):
- media linea (2.5): dos resultados, sin devolucion;
- linea entera (2.0): si cae justo en la linea se devuelve la apuesta. Las
  cuotas de las dos selecciones solo dicen la probabilidad de cada una *si no
  hay devolucion*; la de acertar es esa por (1 - P(devolucion)), y
  P(devolucion) no sale de las cuotas (hace falta un modelo).
- cuarto de linea (2.25 = mitad a 2.0 y mitad a 2.5): sus cuotas mezclan dos
  apuestas y no dan la probabilidad de ningun suceso concreto. Para comparar
  con un pick o con un suceso se excluyen.
"""

from __future__ import annotations

from typing import Literal

from scipy.optimize import brentq

from app.probability.market import implied_probabilities_shin

Method = Literal["proportional", "power", "shin"]
DEFAULT_METHOD: Method = "shin"
LineKind = Literal["half", "integer", "quarter"]


def overround(odds: list[float]) -> float:
    """Margen del mercado completo: suma de 1/cuota menos 1 (0.03 = 3 %)."""
    _check(odds)
    return sum(1 / o for o in odds) - 1


def _check(odds: list[float]) -> None:
    if len(odds) < 2:
        raise ValueError("un mercado necesita al menos dos selecciones")
    if any(o <= 1 for o in odds):
        raise ValueError(f"cuota decimal no valida en {odds}")


def devig_proportional(odds: list[float]) -> list[float]:
    _check(odds)
    inv = [1 / o for o in odds]
    total = sum(inv)
    return [x / total for x in inv]


def devig_power(odds: list[float]) -> list[float]:
    _check(odds)
    inv = [1 / o for o in odds]

    def excess(k: float) -> float:
        return sum(x**k for x in inv) - 1

    try:
        k = brentq(excess, 0.05, 20.0, xtol=1e-12, maxiter=200)
    except ValueError:
        return devig_proportional(odds)
    probs = [x**k for x in inv]
    total = sum(probs)
    return [p / total for p in probs]


def devig_shin(odds: list[float]) -> list[float]:
    _check(odds)
    return implied_probabilities_shin(odds)


def devig(odds: list[float], method: Method = DEFAULT_METHOD) -> list[float]:
    """Probabilidades sin margen de un mercado completo y excluyente (1X2,
    mas/menos, si/no), en el mismo orden que las cuotas."""
    if method == "proportional":
        return devig_proportional(odds)
    if method == "power":
        return devig_power(odds)
    if method == "shin":
        return devig_shin(odds)
    raise ValueError(f"metodo desconocido: {method}")


def line_kind(line: float) -> LineKind:
    """2.5 -> "half"; 2.0 -> "integer"; 2.25 o 2.75 -> "quarter"."""
    frac = round(abs(line) % 1, 4)
    if frac == 0.5:
        return "half"
    if frac == 0.0:
        return "integer"
    if frac in (0.25, 0.75):
        return "quarter"
    raise ValueError(f"linea no reconocida: {line}")


def split_quarter(line: float) -> tuple[float, float]:
    """2.25 -> (2.0, 2.5); -0.75 -> (-1.0, -0.5)."""
    if line_kind(line) != "quarter":
        raise ValueError(f"{line} no es un cuarto de linea")
    return line - 0.25, line + 0.25


def settle_total(value: float, line: float, side: Literal["over", "under"]) -> float:
    """Resultado de una apuesta a mas/menos de `line` con `value` en el partido,
    en fraccion de lo apostado: 1 gana, 0.5 medio gana, 0 devolucion, -0.5
    medio pierde, -1 pierde. Vale para medias lineas, enteras y cuartos."""
    if line_kind(line) == "quarter":
        low, high = split_quarter(line)
        return (settle_total(value, low, side) + settle_total(value, high, side)) / 2
    diff = value - line if side == "over" else line - value
    return 1.0 if diff > 0 else -1.0 if diff < 0 else 0.0


def win_probability_with_push(p_no_push: float, p_push: float) -> tuple[float, float, float]:
    """Linea entera: de la probabilidad de ganar si no hay devolucion (la que
    dan las cuotas sin margen) y la de devolucion (de un modelo), las
    probabilidades de ganar, devolver y perder."""
    if not 0 <= p_push < 1 or not 0 <= p_no_push <= 1:
        raise ValueError("probabilidades fuera de rango")
    win = p_no_push * (1 - p_push)
    return win, p_push, 1 - win - p_push


def conditional_on_no_push(p_win: float, p_push: float) -> float:
    """La de ganar si no hay devolucion, para comparar un modelo con las cuotas
    de una linea entera: P(gana) / (1 - P(devolucion))."""
    if not 0 <= p_push < 1:
        raise ValueError("probabilidad de devolucion fuera de rango")
    return p_win / (1 - p_push)


def double_chance_from_1x2(p_home: float, p_draw: float, p_away: float) -> dict[str, float]:
    """Doble oportunidad a partir del 1X2 sin margen: el mismo suceso, sin el
    margen extra del mercado de doble oportunidad."""
    return {"home_draw": p_home + p_draw, "draw_away": p_draw + p_away, "home_away": p_home + p_away}
