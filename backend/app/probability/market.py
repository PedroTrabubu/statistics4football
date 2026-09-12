"""Vig-stripping: probabilidad implicita real de un conjunto de cuotas,
quitando el margen de la casa (overround).

Dos metodos:
- multiplicativo: normaliza 1/odds para que sume 1. Simple, pero reparte el
  margen por igual entre favoritos y no-favoritos (sesgo conocido:
  favorite-longshot bias).
- Shin (1993): asume una fraccion `z` de "dinero informado" y reparte el
  margen de forma no lineal, mas fiel a como se mueve el mercado real.
  Es el metodo por defecto que usa el motor de EV.
"""

import math

from scipy.optimize import brentq


def overround(odds: list[float]) -> float:
    """Margen de la casa: cuanto suman las probabilidades implicitas por encima de 1."""
    return sum(1 / o for o in odds) - 1


def implied_probabilities_multiplicative(odds: list[float]) -> list[float]:
    inv = [1 / o for o in odds]
    total = sum(inv)
    return [x / total for x in inv]


def implied_probabilities_shin(odds: list[float]) -> list[float]:
    """Probabilidades "reales" segun el modelo de Shin (1993).

    Resuelve z en (0, 1) tal que las probabilidades resultantes sumen 1:
        p_i = (sqrt(z^2 + 4*(1-z)*pi_i^2/S) - z) / (2*(1-z))
    donde pi_i = 1/odds_i y S = sum(pi_i).

    Si no se puede resolver (mercado sin margen o degenerado), cae al metodo
    multiplicativo.
    """
    pis = [1 / o for o in odds]
    total = sum(pis)

    def probs_for_z(z: float) -> list[float]:
        if z <= 0:
            return [pi / math.sqrt(total) for pi in pis]
        return [
            (math.sqrt(z**2 + 4 * (1 - z) * (pi**2) / total) - z) / (2 * (1 - z)) for pi in pis
        ]

    def objective(z: float) -> float:
        return sum(probs_for_z(z)) - 1

    try:
        low, high = 0.0, 0.999999
        if objective(low) * objective(high) > 0:
            return implied_probabilities_multiplicative(odds)
        z = brentq(objective, low, high, xtol=1e-12, maxiter=200)
        return probs_for_z(z)
    except (ValueError, ZeroDivisionError):
        return implied_probabilities_multiplicative(odds)


def bookmaker_agreement(odds_list: list[float], max_cv: float = 0.15) -> float:
    """Nivel de acuerdo (0-1) entre varias casas para la misma seleccion.

    Coeficiente de variacion bajo (casas parecidas) -> acuerdo alto -> mas
    confianza en que el precio de mercado es "real" y no ruido de una sola
    casa. Con menos de 2 cuotas no hay con que comparar -> valor neutro 0.5.
    """
    if len(odds_list) < 2:
        return 0.5
    mean = sum(odds_list) / len(odds_list)
    if mean == 0:
        return 0.5
    variance = sum((o - mean) ** 2 for o in odds_list) / len(odds_list)
    cv = (variance**0.5) / mean
    return max(0.0, 1 - min(1.0, cv / max_cv))
