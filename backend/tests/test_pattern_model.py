"""Tests del modelo de patrones: point-in-time, mercado implicito y logistica."""

import numpy as np
import pytest

from app.probability.pattern_model import (
    PatternTracker,
    fit_logistic,
    market_implied_goals,
    poisson_matrix,
    selection_probs_from_matrix,
)


def test_features_do_not_see_the_match_being_predicted():
    tracker = PatternTracker()
    before = tracker.features(1, 2)
    tracker.add(1, 2, 3, 0)
    after = tracker.features(1, 2)

    # Sin historial: solo el prior neutro.
    assert before["home"]["pat_venue"] == pytest.approx(0.5)
    # Tras un 3-0, el patron de victoria local sube, pero solo despues de add().
    assert after["home"]["pat_venue"] > before["home"]["pat_venue"]


def test_venue_pattern_uses_only_home_matches_of_home_team():
    tracker = PatternTracker()
    # Equipo 1 gana siempre en casa y pierde siempre fuera.
    for _ in range(6):
        tracker.add(1, 3, 2, 0)
        tracker.add(4, 1, 2, 0)

    feats = tracker.features(1, 2)["home"]
    # Por campo: 6 de 6 victorias en casa (las derrotas fuera no cuentan).
    # General: 6 de 12. Por eso el patron por campo es claramente mayor.
    assert feats["pat_venue"] > feats["pat_all"] + 0.2


def test_selection_probs_are_consistent():
    p = selection_probs_from_matrix(poisson_matrix(1.6, 1.1))
    assert p["home"] + p["draw"] + p["away"] == pytest.approx(1.0)
    assert p["1X"] == pytest.approx(p["home"] + p["draw"])
    assert p["over_2.5"] + p["under_2.5"] == pytest.approx(1.0)
    assert p["over_1.5"] > p["over_2.5"] > p["over_3.5"]


def test_market_implied_goals_reproduces_market_probabilities():
    target = selection_probs_from_matrix(poisson_matrix(1.8, 0.9))
    lam, mu = market_implied_goals(target["home"], target["away"], target["over_2.5"])
    assert lam == pytest.approx(1.8, abs=0.02)
    assert mu == pytest.approx(0.9, abs=0.02)


def test_logistic_recovers_signal():
    rng = np.random.default_rng(0)
    x = rng.normal(size=(4000, 2))
    p = 1 / (1 + np.exp(-(0.3 + 1.5 * x[:, 0])))
    y = (rng.random(4000) < p).astype(float)

    model = fit_logistic(x, y)

    # La feature informativa pesa mucho mas que la de ruido.
    assert abs(model.coef[1]) > 5 * abs(model.coef[2])
