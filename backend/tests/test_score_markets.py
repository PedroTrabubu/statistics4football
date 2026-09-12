import numpy as np
import pytest

from app.probability.score_markets import (
    probabilities_1x2,
    probabilities_asian_handicap,
    probabilities_btts,
    probabilities_over_under,
)


def _concentrated_matrix(home_goals: int, away_goals: int, max_goals: int = 5) -> np.ndarray:
    matrix = np.zeros((max_goals + 1, max_goals + 1))
    matrix[home_goals, away_goals] = 1.0
    return matrix


def test_1x2_home_win():
    matrix = _concentrated_matrix(1, 0)
    probs = probabilities_1x2(matrix)
    assert probs == {"home": pytest.approx(1.0), "draw": pytest.approx(0.0), "away": pytest.approx(0.0)}


def test_1x2_draw():
    matrix = _concentrated_matrix(2, 2)
    probs = probabilities_1x2(matrix)
    assert probs["draw"] == pytest.approx(1.0)


def test_over_under_boundary():
    matrix = _concentrated_matrix(1, 0)  # total=1, < 2.5
    probs = probabilities_over_under(matrix, 2.5)
    assert probs["under"] == pytest.approx(1.0)
    assert probs["over"] == pytest.approx(0.0)


def test_btts_no_when_one_side_blank():
    matrix = _concentrated_matrix(2, 0)
    assert probabilities_btts(matrix)["yes"] == pytest.approx(0.0)
    assert probabilities_btts(matrix)["no"] == pytest.approx(1.0)


def test_btts_yes_when_both_score():
    matrix = _concentrated_matrix(2, 1)
    assert probabilities_btts(matrix)["yes"] == pytest.approx(1.0)


def test_asian_handicap_half_line_home_covers():
    matrix = _concentrated_matrix(1, 0)
    probs = probabilities_asian_handicap(matrix, -0.5)  # home favorito por 0.5
    assert probs["home"] == pytest.approx(1.0)
    assert probs["away"] == pytest.approx(0.0)


def test_asian_handicap_half_line_away_covers():
    matrix = _concentrated_matrix(1, 0)
    probs = probabilities_asian_handicap(matrix, -1.5)  # home tendria que ganar por 2+
    assert probs["away"] == pytest.approx(1.0)


def test_asian_handicap_full_line_can_push():
    matrix = _concentrated_matrix(1, 0)
    probs = probabilities_asian_handicap(matrix, -1.0)  # 1-0 exacto con -1 -> empate a handicap
    assert probs["push"] == pytest.approx(1.0)
    assert probs["home"] == pytest.approx(0.0)
    assert probs["away"] == pytest.approx(0.0)


def test_asian_handicap_quarter_line_splits_between_neighbours():
    matrix = _concentrated_matrix(1, 0)
    # -0.75 = mitad en -0.5 (home cubre, prob 1) y mitad en -1.0 (empate a handicap, prob 1)
    probs = probabilities_asian_handicap(matrix, -0.75)
    assert probs["home"] == pytest.approx(0.5)
    assert probs["push"] == pytest.approx(0.5)
    assert probs["away"] == pytest.approx(0.0)
