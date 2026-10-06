"""Tests de los picks: patas, probabilidad conjunta, combinadas y point-in-time."""

import math

import numpy as np
import pytest

from app.picks.combos import TIERS, build_same_match_combo, build_tier_combo
from app.picks.count_model import CountModel, CountTracker, fit_count_model
from app.picks.legs import Leg, MatchDistributions, joint_probability, match_legs, resolve_leg
from app.probability.pattern_model import poisson_matrix


def _dist(match_id: int = 1, odds: dict | None = None, lam: float = 1.6, mu: float = 1.1) -> MatchDistributions:
    corners = CountModel(coef=np.array([math.log(5.0), 0, 0, 0, 0]), alpha=0.05)
    yellow = CountModel(coef=np.array([math.log(2.0), 0, 0, 0, 0]), alpha=0.0)
    x = [0.0] * 4
    return MatchDistributions(
        match_id=match_id,
        goals=poisson_matrix(lam, mu),
        corners=np.outer(corners.pmf(x), corners.pmf(x)),
        yellow=np.outer(yellow.pmf(x), yellow.pmf(x)),
        real_odds=odds or {},
    )


def test_resolve_leg_by_component():
    assert resolve_leg("corners_over_under", "over", 9.5, (0, 0), (6, 4), (1, 1)) is True
    assert resolve_leg("team_yellow_over", "away", 1.5, (0, 0), (6, 4), (3, 1)) is False
    assert resolve_leg("double_chance", "X2", None, (1, 1), None, None) is True
    assert resolve_leg("corners_over_under", "over", 9.5, (0, 0), None, None) is None


def test_joint_probability_goals_is_computed_on_the_score_matrix():
    dist = _dist()
    legs = {(l.market, l.selection, l.line): l for l in match_legs(dist)}
    home_scores = legs[("team_goals_over", "home", 0.5)]
    over_15 = legs[("goals_over_under", "over", 1.5)]
    joint = joint_probability(dist, [home_scores, over_15])
    # Sucesos positivamente relacionados: la conjunta supera el producto.
    assert joint > home_scores.prob * over_15.prob
    assert joint <= min(home_scores.prob, over_15.prob)


def test_joint_probability_multiplies_independent_components():
    dist = _dist()
    legs = {(l.market, l.selection, l.line): l for l in match_legs(dist)}
    a = legs[("team_goals_over", "home", 0.5)]
    b = legs[("yellow_over_under", "under", 6.5)]
    assert joint_probability(dist, [a, b]) == pytest.approx(a.prob * b.prob)


def test_real_odds_used_when_available():
    # Favorito claro: la victoria local supera el minimo de 0.55.
    dist = _dist(odds={"home": 1.5, "draw": 4.2, "away": 6.5}, lam=2.4, mu=0.7)
    legs = {(l.market, l.selection, l.line): l for l in match_legs(dist)}
    assert legs[("1x2", "home", None)].odds_kind == "real"
    assert legs[("double_chance", "1X", None)].odds_kind == "derivada"
    assert legs[("double_chance", "1X", None)].odds == pytest.approx(1 / (1 / 1.5 + 1 / 4.2), abs=1e-3)
    assert legs[("team_goals_over", "home", 1.5)].odds_kind == "estimada"
    # "Marca el local" (p~0.91) daria cuota estimada < 1.05: no es candidata.
    assert ("team_goals_over", "home", 0.5) not in legs


def test_tier_combos_respect_odds_range_and_distinct_matches():
    legs = [l for mid in range(1, 21) for l in match_legs(_dist(mid))]
    for tier in TIERS:
        combo = build_tier_combo(legs, tier)
        assert combo is not None
        assert tier.lo <= combo.odds <= tier.hi
        assert 2 <= len(combo.legs) <= tier.max_legs
        assert len({l.match_id for l in combo.legs}) == len(combo.legs)


def test_same_match_combo_is_at_least_70_percent_and_distinct_families():
    dist = _dist()
    combo = build_same_match_combo(dist, match_legs(dist))
    assert combo is not None
    assert combo.prob >= 0.70
    assert len({l.family for l in combo.legs}) == len(combo.legs)


def test_count_tracker_features_do_not_see_the_match():
    tracker = CountTracker()
    before = tracker.features(1, 2)
    tracker.add(1, 2, 12, 2)
    after = tracker.features(1, 2)
    assert after["home"][0] > before["home"][0]


def test_count_model_recovers_mean():
    rng = np.random.default_rng(1)
    x = rng.normal(size=(3000, 4))
    y = rng.poisson(np.exp(1.5 + 0.4 * x[:, 0]))
    model = fit_count_model(x, y.astype(float))
    assert model.coef[1] == pytest.approx(0.4, abs=0.05)
    assert model.alpha < 0.05


def test_leg_dataclass_key():
    leg = Leg(1, "btts", "yes", None, "goles_equipo", "goals", 0.6, 1.5, "estimada")
    assert leg.key == ("btts", "yes", None)


def test_tier_dp_matches_brute_force():
    """La programacion dinamica encuentra la combinada de mayor probabilidad conjunta."""
    from itertools import combinations, product

    from app.picks.combos import Tier

    rng = np.random.default_rng(7)
    for trial in range(30):
        legs = []
        for mid in range(6):
            for _ in range(3):
                p = float(rng.uniform(0.55, 0.92))
                legs.append(Leg(mid, "btts", "yes", None, "goles_equipo", "goals", p, round(1 / (p * 1.07), 3), "estimada"))
        tier = Tier("t", "t", 1.85, 2.15, 3)

        best = None
        by_match = [[l for l in legs if l.match_id == m] for m in range(6)]
        for k in range(2, tier.max_legs + 1):
            for matches in combinations(range(6), k):
                for chosen in product(*(by_match[m] for m in matches)):
                    odds = math.prod(l.odds for l in chosen)
                    if tier.lo <= odds <= tier.hi:
                        p = math.prod(l.prob for l in chosen)
                        best = p if best is None else max(best, p)

        combo = build_tier_combo(legs, tier)
        if best is None:
            continue
        assert combo is not None
        # Tolerancia por la discretizacion de la log-cuota.
        assert combo.prob == pytest.approx(best, rel=0.01), trial
        assert tier.lo <= math.prod(l.odds for l in combo.legs) <= tier.hi


def test_overrides_change_probability_but_not_estimated_odds():
    dist = _dist()
    key = ("team_goals_over", "home", 1.5)
    base = {l.key: l for l in match_legs(dist, min_prob=0.30)}[key]
    overridden = {l.key: l for l in match_legs(dist, min_prob=0.30, prob_overrides={key: 0.9})}[key]
    assert overridden.prob == 0.9
    # La cuota estimada sale de la probabilidad de mercado, no de la del modelo.
    assert overridden.odds == base.odds


def test_lower_floor_adds_candidates():
    dist = _dist()
    assert len(match_legs(dist, min_prob=0.30)) > len(match_legs(dist))


def test_unavailable_selections_are_never_offered():
    # Partido igualado: "1 o 2" tendria buena probabilidad, pero Winamax no la acepta en combinadas.
    dist = _dist(odds={"home": 2.6, "draw": 3.3, "away": 2.8}, lam=1.3, mu=1.25)
    keys = {l.key for l in match_legs(dist, min_prob=0.30)}
    assert ("double_chance", "12", None) not in keys
    assert ("double_chance", "1X", None) in keys
