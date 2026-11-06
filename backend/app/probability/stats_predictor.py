"""Predictor de estadisticas: lo que se espera que saque cada equipo en un
partido (protocolo: docs/PREDICTOR_ESTADISTICAS_PROTOCOLO.md).

Port de frontend/src/lib/statsPredictor.ts (solo lo que usa MODEL), que se
queda para los scripts del protocolo: las mismas cuentas y la misma
configuracion. La web ya no lo calcula: lee lo que guarda
app/probability/match_forecasts.py.

Parte del metodo de los corners esperados del duelo (corner_duel.py): solo con
los partidos anteriores al partido, medias a favor y en contra, con mas peso a
los recientes y encogidas hacia la liga. Cada estadistica, con la
configuracion elegida en la ampliacion 2 (MODEL) y, en las tarjetas, el
arbitro. Funciones puras.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np

from app.probability.corner_duel import (
    CORNER_CAP,
    DECAY_PER_DAY,
    SHRINK_MATCHES,
    Samples,
    StatHistory,
    league_means,
    shrunk,
)

# En el orden de la tabla del partido.
STAT_KEYS = ("xg", "shots", "shots_on_target", "corners", "fouls", "yellow_cards", "red_cards")
CARD_KEYS = ("yellow_cards", "red_cards")
# Recorte al estimar medias: solo los corners, como en el duelo.
CAP = {"corners": CORNER_CAP}


@dataclass(frozen=True)
class ModelSettings:
    """`venue`: cada equipo solo en su campo (el modelo publicado). `pooled`:
    todos sus partidos, cada cifra relativa a la media de la liga en su campo.
    `blend`: la media de las dos. `decay`: peso exp(-decay x dias). `shrink`:
    partidos de encogimiento hacia la liga."""

    structure: str
    decay: float
    shrink: float


@dataclass(frozen=True)
class RefereeSettings:
    """R1 ("raw"): sus tarjetas por partido frente a la liga. R2 ("adjusted"):
    lo que hubo en sus partidos frente a lo que el modelo de equipos esperaba
    en ellos. `shrink`: partidos de encogimiento hacia 1."""

    method: str
    shrink: float


@dataclass(frozen=True)
class CardSettings:
    base: ModelSettings
    referee: RefereeSettings | None


# El modelo de cada estadistica: el elegido con la validacion (22/23-24/25) de
# la ampliacion 2 del protocolo y confirmado en su test. Las tarjetas, con el
# factor del arbitro: sin arbitro designado no se estiman.
MODEL: dict[str, CardSettings] = {
    "xg": CardSettings(ModelSettings("pooled", 0.0036, 5), None),
    "shots": CardSettings(ModelSettings("pooled", 0.0036, 5), None),
    "shots_on_target": CardSettings(ModelSettings("pooled", 0.0036, 5), None),
    "corners": CardSettings(ModelSettings("pooled", 0.0036, 10), None),
    "fouls": CardSettings(ModelSettings("pooled", 0.0036, 5), None),
    "yellow_cards": CardSettings(ModelSettings("pooled", 0.0036, 20), RefereeSettings("adjusted", 20)),
    "red_cards": CardSettings(ModelSettings("venue", 0.0036, 2), RefereeSettings("adjusted", 5)),
}
# Las que pasan la regla de decision de su test (las que ensena la web).
SHOWN = ("xg", "shots", "shots_on_target", "corners", "fouls", "yellow_cards")


@dataclass(frozen=True)
class RefereeFactor:
    factor: float
    # Partidos anteriores del arbitro con esa estadistica (la muestra).
    matches: int


@dataclass(frozen=True)
class StatForecast:
    # Valor esperado de cada equipo.
    home: float
    away: float
    # Partidos con la estadistica del local en casa y del visitante fuera (la
    # muestra); con `scope` "all", todos los de cada equipo.
    home_matches: int
    away_matches: int
    scope: str
    # Media simple de la liga en cada campo, sin pesos ni recorte: la base
    # "liga" del protocolo para el error medio. No entra en la estimacion.
    league_home: float
    league_away: float
    referee: RefereeFactor | None = None


def stat_forecast_with(s: Samples, home_id: int, away_id: int, settings: ModelSettings) -> StatForecast | None:
    """Valor esperado de una estadistica para cada equipo, con sus partidos
    anteriores (`StatHistory.before` con `settings.decay`). None sin datos de
    la liga (por ejemplo, xG en una liga sin xG)."""
    means = league_means(s)
    if means is None:
        return None
    _, league_home, league_away = means
    if league_home <= 0 or league_away <= 0:
        return None
    k = settings.shrink
    plain = {"league_home": float(s.raw_home.mean()), "league_away": float(s.raw_away.mean())}

    # Por campo: las mismas cuentas que el duelo.
    home_at_home = s.home_id == home_id
    away_away = s.away_id == away_id
    venue_home = (shrunk(s.weight, s.home, home_at_home, league_home, k)
                  * shrunk(s.weight, s.home, away_away, league_home, k) / league_home)  # fmt: skip
    venue_away = (shrunk(s.weight, s.away, away_away, league_away, k)
                  * shrunk(s.weight, s.away, home_at_home, league_away, k) / league_away)  # fmt: skip
    if settings.structure == "venue":
        return StatForecast(venue_home, venue_away, int(home_at_home.sum()), int(away_away.sum()), "venue", **plain)

    # Todos sus partidos: ataque y defensa como proporcion de la media de la liga en cada campo.
    def ratios(team: int) -> tuple[float, float, int]:
        h = s.home_id == team
        a = (s.away_id == team) & ~h
        attack = (s.weight * s.home / league_home)[h].sum() + (s.weight * s.away / league_away)[a].sum()
        defence = (s.weight * s.away / league_away)[h].sum() + (s.weight * s.home / league_home)[a].sum()
        weight = s.weight[h].sum() + s.weight[a].sum()
        return float((attack + k) / (weight + k)), float((defence + k) / (weight + k)), int(h.sum() + a.sum())

    h_attack, h_defence, h_matches = ratios(home_id)
    a_attack, a_defence, a_matches = ratios(away_id)
    home = league_home * h_attack * a_defence
    away = league_away * a_attack * h_defence
    if settings.structure == "blend":
        home, away = (venue_home + home) / 2, (venue_away + away) / 2
    return StatForecast(home, away, h_matches, a_matches, "all", **plain)


def referee_factor(s: Samples, referee: str | None, settings: RefereeSettings) -> RefereeFactor | None:
    """Factor del arbitro del partido para una estadistica de tarjetas, con sus
    partidos anteriores en la liga (`StatHistory.before` con DECAY_PER_DAY,
    como en la web). None sin arbitro designado o sin datos de la liga; factor
    1 si no tiene partidos."""
    if not referee:
        return None
    means = league_means(s)
    if means is None:
        return None
    _, league_home, league_away = means
    per_match = league_home + league_away
    if league_home <= 0 or league_away <= 0:
        return None

    own = s.referee == referee
    observed = float((s.weight * (s.home + s.away))[own].sum())
    k = settings.shrink
    if settings.method == "raw":
        weight = float(s.weight[own].sum())
        return RefereeFactor((observed + k * per_match) / (weight + k) / per_match, int(own.sum()))

    # R2: lo que esperaba el modelo de equipos en cada partido del arbitro, con
    # las fuerzas de los equipos (cada uno en su campo) de los mismos partidos anteriores.
    teams, index = np.unique(np.concatenate([s.home_id, s.away_id]), return_inverse=True)
    hi, ai = index[: len(s.home_id)], index[len(s.home_id) :]

    def sums(idx: np.ndarray, values: np.ndarray) -> np.ndarray:
        return np.bincount(idx, weights=values, minlength=len(teams))

    h_weight, h_for, h_against = sums(hi, s.weight), sums(hi, s.weight * s.home), sums(hi, s.weight * s.away)
    a_weight, a_for, a_against = sums(ai, s.weight), sums(ai, s.weight * s.away), sums(ai, s.weight * s.home)

    def shr(total: np.ndarray, weight: np.ndarray, prior: float) -> np.ndarray:
        return (total + SHRINK_MATCHES * prior) / (weight + SHRINK_MATCHES)

    h, a = hi[own], ai[own]
    home = shr(h_for[h], h_weight[h], league_home) * shr(a_against[a], a_weight[a], league_home) / league_home
    away = shr(a_for[a], a_weight[a], league_away) * shr(h_against[h], h_weight[h], league_away) / league_away
    expected = float((s.weight[own] * (home + away)).sum())
    return RefereeFactor((observed + k * per_match) / (expected + k * per_match), int(own.sum()))


def cards_forecast_with(
    base: Samples, ref: Samples, home_id: int, away_id: int, referee: str | None, settings: CardSettings
) -> StatForecast | None:
    """Tarjetas esperadas de cada equipo: el modelo de equipos (`base`, con el
    decaimiento de `settings.base`) por el factor del arbitro (`ref`, con
    DECAY_PER_DAY). None si pide arbitro y no hay designado, o sin datos."""
    factor = referee_factor(ref, referee, settings.referee) if settings.referee else None
    if settings.referee and factor is None:
        return None
    forecast = stat_forecast_with(base, home_id, away_id, settings.base)
    if forecast is None:
        return None
    scale = factor.factor if factor else 1.0
    return replace(forecast, home=forecast.home * scale, away=forecast.away * scale, referee=factor)


def predict_stats(
    histories: dict[str, StatHistory], at: float, home_id: int, away_id: int, referee: str | None
) -> dict[str, StatForecast | None]:
    """Todas las estadisticas de un partido, cada una con su modelo (MODEL)."""
    out: dict[str, StatForecast | None] = {}
    for key in STAT_KEYS:
        settings = MODEL[key]
        history = histories[key]
        base = history.before(at, settings.base.decay)
        if settings.referee:
            ref = history.before(at, DECAY_PER_DAY)
            out[key] = cards_forecast_with(base, ref, home_id, away_id, referee, settings)
        else:
            out[key] = stat_forecast_with(base, home_id, away_id, settings.base)
    return out
