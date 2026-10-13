"""Margen y probabilidades sin margen, incluidas lineas enteras y cuartos."""

import pytest

from app.probability.devig import (
    DEFAULT_METHOD,
    conditional_on_no_push,
    devig,
    double_chance_from_1x2,
    line_kind,
    overround,
    settle_total,
    split_quarter,
    win_probability_with_push,
)


def test_overround_of_the_whole_market():
    assert overround([1.909, 1.909]) == pytest.approx(0.0477, abs=1e-4)
    assert overround([2.0, 2.0]) == pytest.approx(0.0)
    with pytest.raises(ValueError):
        overround([1.9])
    with pytest.raises(ValueError):
        overround([1.0, 3.0])


@pytest.mark.parametrize("method", ["proportional", "power", "shin"])
def test_every_method_sums_to_one_and_keeps_the_order(method):
    probs = devig([1.25, 6.0, 11.0], method)
    assert sum(probs) == pytest.approx(1.0)
    assert probs[0] > probs[1] > probs[2]
    # Sin margen no hay nada que quitar.
    assert devig([2.0, 2.0], method) == pytest.approx([0.5, 0.5])


def test_power_and_shin_give_more_to_the_favourite_than_proportional():
    odds = [1.18, 5.2]
    favourite = {m: devig(odds, m)[0] for m in ("proportional", "power", "shin")}
    assert favourite["power"] > favourite["proportional"]
    assert favourite["shin"] > favourite["proportional"]
    assert DEFAULT_METHOD == "shin"


def test_line_kinds():
    assert line_kind(2.5) == "half"
    assert line_kind(-1.5) == "half"
    assert line_kind(2.0) == "integer"
    assert line_kind(0.0) == "integer"
    assert line_kind(2.25) == "quarter"
    assert line_kind(-0.75) == "quarter"
    assert split_quarter(2.25) == (2.0, 2.5)
    assert split_quarter(-0.75) == (-1.0, -0.5)
    with pytest.raises(ValueError):
        split_quarter(2.5)


def test_settlement_with_push_and_quarter_lines():
    assert settle_total(3, 2.5, "over") == 1
    assert settle_total(2, 2.5, "over") == -1
    assert settle_total(2, 2.0, "over") == 0  # devolucion
    assert settle_total(2, 2.25, "over") == -0.5  # mitad devuelta (2.0), mitad perdida (2.5)
    assert settle_total(2, 2.25, "under") == 0.5
    assert settle_total(3, 2.75, "over") == 0.5  # mitad ganada (2.5), mitad devuelta (3.0)
    assert settle_total(4, 2.75, "over") == 1


def test_push_probabilities_are_explicit():
    win, push, loss = win_probability_with_push(0.6, 0.25)
    assert (win, push, loss) == pytest.approx((0.45, 0.25, 0.30))
    assert conditional_on_no_push(0.45, 0.25) == pytest.approx(0.6)
    with pytest.raises(ValueError):
        conditional_on_no_push(0.5, 1.0)


def test_double_chance_from_1x2():
    dc = double_chance_from_1x2(0.5, 0.3, 0.2)
    assert dc == pytest.approx({"home_draw": 0.8, "draw_away": 0.5, "home_away": 0.7})
