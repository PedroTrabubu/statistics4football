"""Deriva probabilidades de mercado (1X2, over/under, BTTS, hancicap
asiatico) a partir de la matriz de marcadores del modelo Dixon-Coles."""

import math

import numpy as np


def probabilities_1x2(matrix: np.ndarray) -> dict[str, float]:
    home = float(np.tril(matrix, -1).sum())
    draw = float(np.trace(matrix))
    away = float(np.triu(matrix, 1).sum())
    return {"home": home, "draw": draw, "away": away}


def probabilities_over_under(matrix: np.ndarray, line: float) -> dict[str, float]:
    max_goals = matrix.shape[0] - 1
    over = 0.0
    for i in range(max_goals + 1):
        for j in range(max_goals + 1):
            if i + j > line:
                over += matrix[i, j]
    return {"over": float(over), "under": float(1 - over)}


def probabilities_btts(matrix: np.ndarray) -> dict[str, float]:
    yes = float(matrix[1:, 1:].sum())
    return {"yes": yes, "no": float(1 - yes)}


def _settle_ah_half_line(matrix: np.ndarray, line: float) -> tuple[float, float, float]:
    max_goals = matrix.shape[0] - 1
    home_cover = away_cover = push = 0.0
    for i in range(max_goals + 1):
        for j in range(max_goals + 1):
            p = matrix[i, j]
            adjusted = (i + line) - j
            if adjusted > 0:
                home_cover += p
            elif adjusted < 0:
                away_cover += p
            else:
                push += p
    return home_cover, away_cover, push


def probabilities_asian_handicap(matrix: np.ndarray, line: float) -> dict[str, float]:
    """Probabilidad de que cada lado "cubra" el hancicap `line` (perspectiva local).

    Las lineas de cuarto (p.ej. -0.25, -0.75) se resuelven como el mercado
    real: mitad de la apuesta en cada una de las dos lineas medias vecinas.
    `push` es la probabilidad de empate a handicap (se devuelve el stake).
    """
    is_quarter = abs((line * 2) - round(line * 2)) > 1e-9
    if is_quarter:
        lower = math.floor(line * 2) / 2
        upper = lower + 0.5
        h1, a1, p1 = _settle_ah_half_line(matrix, lower)
        h2, a2, p2 = _settle_ah_half_line(matrix, upper)
        home_cover, away_cover, push = (h1 + h2) / 2, (a1 + a2) / 2, (p1 + p2) / 2
    else:
        home_cover, away_cover, push = _settle_ah_half_line(matrix, line)

    return {"home": home_cover, "away": away_cover, "push": push}
