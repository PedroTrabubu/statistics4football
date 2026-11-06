"""Duelo de corners: probabilidad de que cada equipo saque mas corners que el
otro (protocolo: docs/DUELO_CORNERES_MODELO_PROTOCOLO.md).

Port de frontend/src/lib/cornerDuel.ts, que se queda para los scripts del
protocolo: las mismas cuentas y constantes (tests/test_match_forecasts.py lo
comprueba con cifras sacadas de alli). La web ya no lo calcula: lee lo que
guarda app/probability/match_forecasts.py.

Solo con los partidos anteriores al partido: medias de corners a favor y en
contra por campo, con mas peso a los recientes y encogidas hacia la liga;
corners de cada equipo binomiales negativos e independientes. Funciones puras.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

# Un partido extremo (18-0) cuenta como 14-0 al estimar medias.
CORNER_CAP = 14
# Peso exp(-0.0018 x dias): el decaimiento de Dixon-Coles en la web.
DECAY_PER_DAY = 0.0018
# Encogimiento hacia la liga, en partidos: el del modelo de conteos de las combinadas.
SHRINK_MATCHES = 5
MAX_CORNERS = 40


@dataclass(frozen=True)
class Samples:
    """Partidos anteriores con la estadistica de los dos equipos, alineados.
    `home`/`away` ya recortados; `raw_*`, sin recortar (la media simple de la
    liga, base del protocolo del predictor)."""

    home_id: np.ndarray
    away_id: np.ndarray
    home: np.ndarray
    away: np.ndarray
    raw_home: np.ndarray
    raw_away: np.ndarray
    referee: np.ndarray
    weight: np.ndarray


class StatHistory:
    """Partidos jugados de una ventana con una estadistica, por fecha, para
    sacar los anteriores a cada partido. `days`: fecha en dias (float); los
    valores None o NaN no cuentan para esta estadistica."""

    def __init__(self, days, home_id, away_id, home, away, referee, cap: float = math.inf):
        home = np.asarray(home, dtype=float)
        away = np.asarray(away, dtype=float)
        keep = ~np.isnan(home) & ~np.isnan(away)
        order = np.argsort(np.asarray(days, dtype=float)[keep], kind="stable")
        self.days = np.asarray(days, dtype=float)[keep][order]
        self.home_id = np.asarray(home_id)[keep][order]
        self.away_id = np.asarray(away_id)[keep][order]
        self.raw_home = home[keep][order]
        self.raw_away = away[keep][order]
        self.home = np.minimum(self.raw_home, cap)
        self.away = np.minimum(self.raw_away, cap)
        self.referee = np.asarray(referee, dtype=object)[keep][order]

    def before(self, at: float, decay: float = DECAY_PER_DAY) -> Samples:
        """Los partidos estrictamente anteriores a `at`, con su peso."""
        k = int(np.searchsorted(self.days, at, side="left"))
        return Samples(
            home_id=self.home_id[:k],
            away_id=self.away_id[:k],
            home=self.home[:k],
            away=self.away[:k],
            raw_home=self.raw_home[:k],
            raw_away=self.raw_away[:k],
            referee=self.referee[:k],
            weight=np.exp(-decay * (at - self.days[:k])),
        )


@dataclass(frozen=True)
class DuelForecast:
    # Corners esperados de cada equipo.
    home_expected: float
    away_expected: float
    # El local saca mas / los mismos / el visitante saca mas. Suman 1.
    home: float
    draw: float
    away: float
    # Partidos con corners del local en casa y del visitante fuera (la muestra).
    home_matches: int
    away_matches: int


def shrunk(weight: np.ndarray, value: np.ndarray, rows: np.ndarray, prior: float, k: float) -> float:
    """Media ponderada de `value` en `rows`, encogida `k` partidos hacia `prior`."""
    return float(((weight * value)[rows].sum() + k * prior) / (weight[rows].sum() + k))


def league_means(s: Samples) -> tuple[float, float, float] | None:
    """Peso total y medias ponderadas de la liga en cada campo; None sin datos."""
    total = float(s.weight.sum())
    if total == 0:
        return None
    return total, float((s.weight * s.home).sum() / total), float((s.weight * s.away).sum() / total)


def count_pmf(mean: float, alpha: float) -> np.ndarray:
    """Probabilidades de 0..MAX corners: binomial negativa (var = mu + alpha mu^2)
    o Poisson si alpha ~ 0."""
    k = np.arange(1, MAX_CORNERS + 1)
    if alpha < 1e-6:
        first = math.exp(-mean)
        steps = mean / k
    else:
        r = 1 / alpha
        q = mean / (r + mean)
        first = (r / (r + mean)) ** r
        steps = (k - 1 + r) * q / k
    pmf = np.concatenate([[first], first * np.cumprod(steps)])
    return pmf / pmf.sum()


def duel_probabilities(home_pmf: np.ndarray, away_pmf: np.ndarray) -> tuple[float, float, float]:
    """P(local saca mas), P(mismos), P(visitante saca mas) con dos distribuciones independientes."""
    below = np.concatenate([[0.0], np.cumsum(away_pmf)[:-1]])
    home = float((home_pmf * below).sum())
    draw = float((home_pmf * away_pmf).sum())
    return home, draw, max(0.0, 1 - home - draw)


def corner_duel_forecast(s: Samples, home_id: int, away_id: int) -> DuelForecast | None:
    """Pronostico del duelo de corners de un partido con sus partidos anteriores
    (`StatHistory.before`, sin decaimiento propio). None sin datos de la liga."""
    means = league_means(s)
    if means is None:
        return None
    total, league_home, league_away = means
    if league_home <= 0 or league_away <= 0:
        return None

    # Dispersion comun por momentos: var = mu + alpha mu^2 (cada lado con su media).
    variance = float((s.weight * ((s.home - league_home) ** 2 + (s.away - league_away) ** 2)).sum() / (2 * total))
    mean_both = (league_home + league_away) / 2
    alpha = max(0.0, (variance - mean_both) / mean_both**2)

    home_at_home = s.home_id == home_id
    away_away = s.away_id == away_id
    home_for = shrunk(s.weight, s.home, home_at_home, league_home, SHRINK_MATCHES)
    home_against = shrunk(s.weight, s.away, home_at_home, league_away, SHRINK_MATCHES)
    away_for = shrunk(s.weight, s.away, away_away, league_away, SHRINK_MATCHES)
    away_against = shrunk(s.weight, s.home, away_away, league_home, SHRINK_MATCHES)

    home_expected = home_for * away_against / league_home
    away_expected = away_for * home_against / league_away
    home, draw, away = duel_probabilities(count_pmf(home_expected, alpha), count_pmf(away_expected, alpha))
    return DuelForecast(
        home_expected=home_expected,
        away_expected=away_expected,
        home=home,
        draw=draw,
        away=away,
        home_matches=int(home_at_home.sum()),
        away_matches=int(away_away.sum()),
    )
