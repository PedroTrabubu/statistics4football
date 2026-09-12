import pytest

from app.probability.market import (
    bookmaker_agreement,
    implied_probabilities_multiplicative,
    implied_probabilities_shin,
    overround,
)


def test_overround_fair_market_is_zero():
    assert overround([2.0, 2.0]) == pytest.approx(0.0, abs=1e-9)


def test_overround_detects_margin():
    # 1/1.9 + 1/2.1 + 1/4.0 > 1
    assert overround([1.9, 2.1, 4.0]) > 0


def test_multiplicative_sums_to_one_and_is_symmetric():
    probs = implied_probabilities_multiplicative([1.9, 2.1, 4.0])
    assert sum(probs) == pytest.approx(1.0)
    # cuota mas baja -> probabilidad mas alta
    assert probs[0] > probs[1] > probs[2]


def test_shin_sums_to_one():
    probs = implied_probabilities_shin([1.9, 2.1, 4.0])
    assert sum(probs) == pytest.approx(1.0, abs=1e-6)
    assert all(0 < p < 1 for p in probs)


def test_shin_matches_multiplicative_when_no_margin():
    probs_shin = implied_probabilities_shin([2.0, 2.0])
    probs_mult = implied_probabilities_multiplicative([2.0, 2.0])
    assert probs_shin[0] == pytest.approx(probs_mult[0], abs=1e-6)
    assert probs_shin[1] == pytest.approx(probs_mult[1], abs=1e-6)


def test_bookmaker_agreement_identical_odds_is_perfect():
    assert bookmaker_agreement([2.0, 2.0, 2.0]) == pytest.approx(1.0)


def test_bookmaker_agreement_lower_when_spread():
    tight = bookmaker_agreement([2.0, 2.02, 1.98])
    wide = bookmaker_agreement([1.5, 2.5, 3.5])
    assert tight > wide


def test_bookmaker_agreement_neutral_with_single_quote():
    assert bookmaker_agreement([2.0]) == 0.5
