import pytest

from app.db.models import RiskLevel
from app.probability.ev import (
    build_recommendation,
    compute_confidence,
    compute_ev,
    compute_risk_level,
)


def test_ev_break_even_at_fair_odds():
    assert compute_ev(0.5, 2.0) == pytest.approx(0.0)


def test_ev_positive_value():
    assert compute_ev(0.6, 2.0) == pytest.approx(0.2)


def test_ev_negative_value():
    assert compute_ev(0.4, 2.0) == pytest.approx(-0.2)


def test_confidence_full_data_full_agreement():
    assert compute_confidence(matches_used=20, bookmaker_agreement=1.0) == pytest.approx(1.0)


def test_confidence_no_data_no_agreement_info():
    assert compute_confidence(matches_used=0, bookmaker_agreement=None) == pytest.approx(0.0)


def test_confidence_partial_data_neutral_agreement():
    conf = compute_confidence(matches_used=10, bookmaker_agreement=0.5)
    assert conf == pytest.approx(0.5 * 0.5 + 0.5 * 0.5)


def test_risk_level_low_confidence_low_odds():
    assert compute_risk_level(confidence=0.8, odds=1.8) == RiskLevel.LOW


def test_risk_level_bumped_for_high_odds():
    assert compute_risk_level(confidence=0.8, odds=7.0) == RiskLevel.MEDIUM


def test_risk_level_always_high_for_very_long_odds():
    assert compute_risk_level(confidence=0.9, odds=15.0) == RiskLevel.HIGH


def test_risk_level_high_for_low_confidence():
    assert compute_risk_level(confidence=0.1, odds=2.0) == RiskLevel.HIGH


def test_build_recommendation_flags_value_bet():
    rec = build_recommendation(
        prob_model=0.55,
        prob_market_implied=0.45,
        odds=2.2,
        ev_threshold=0.05,
        matches_used=20,
        bookmaker_agreement=0.9,
    )
    assert rec.ev == pytest.approx(0.55 * 2.2 - 1)
    assert rec.is_recommended is True
    assert rec.risk_level == RiskLevel.LOW


def test_build_recommendation_rejects_low_confidence_even_with_good_ev():
    rec = build_recommendation(
        prob_model=0.55,
        prob_market_implied=0.45,
        odds=2.2,
        ev_threshold=0.05,
        matches_used=0,
        bookmaker_agreement=0.0,
    )
    assert rec.ev > rec.ev * 0  # ev sigue siendo positivo
    assert rec.confidence < 0.3
    assert rec.is_recommended is False
