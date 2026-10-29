"""Porcentajes de resultado (app/probability/result_model.py y result_metrics.py):
sin fuga del futuro ni cuotas posteriores, doble oportunidad coherente,
reproducible, y niveles y calibracion bien contados."""

from datetime import datetime, timedelta
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from app.analysis.stats import bootstrap_mean_diff
from app.probability.market import implied_probabilities_shin
from app.probability.result_metrics import (
    best_dc_hit,
    brier_dc_per_match,
    calibration_bins,
    coverage_accuracy,
    ece,
    high_confidence,
    rps_per_match,
    wilson,
)
from app.probability.result_model import (
    COLS_A,
    Inputs,
    ResultMatch,
    build_features,
    double_chance,
    market_probabilities,
    prematch_snapshot,
    walk_forward,
)

DAY0 = datetime(2024, 8, 10, 18, 0)


def _season(n_days: int = 8, teams: int = 6, offset: int = 0, start_id: int = 1) -> list[ResultMatch]:
    out, mid = [], start_id
    for d in range(n_days):
        perm = np.random.default_rng(d + offset).permutation(teams) + 1
        for i in range(0, teams, 2):
            date = DAY0 + timedelta(days=7 * (d + offset), hours=i)
            out.append(ResultMatch(mid, "L", "2425", date, int(perm[i]), int(perm[i + 1]), mid % 3, (mid * 2) % 3,
                                   1.0 + 0.1 * (mid % 5), 0.8))  # fmt: skip
            mid += 1
    return out


def _inputs(matches: list[ResultMatch]) -> Inputs:
    dates: dict[int, list[datetime]] = {}
    for m in matches:
        if m.played:
            for t in (m.home_team_id, m.away_team_id):
                dates.setdefault(t, []).append(m.date)
    for v in dates.values():
        v.sort()
    elo = {(m.match_id, t): 1500.0 + t for m in matches for t in (m.home_team_id, m.away_team_id)}
    market = {m.match_id: (0.45, 0.28, 0.27) for m in matches}
    return Inputs(matches, dates, elo, market)


def test_features_ignore_own_result_same_day_and_later_matches():
    base = _season()
    target = base[12]
    dc = {m.match_id: (0.4, 0.3, 0.3) for m in base}
    expected = build_features(_inputs(base), dc).set_index("match_id").loc[target.match_id, COLS_A]

    same_day = {m.match_id for m in base if m.date.date() == target.date.date()}
    changed = [
        ResultMatch(m.match_id, m.league, m.season, m.date, m.home_team_id, m.away_team_id, 7, 0, 3.0, 0.1)
        if m.match_id in same_day else m
        for m in base
    ]  # fmt: skip
    later = _season(n_days=3, offset=20, start_id=500)
    got = build_features(_inputs(changed + later), dc).set_index("match_id").loc[target.match_id, COLS_A]
    # El descanso sale de los partidos jugados: los posteriores no cuentan.
    pd.testing.assert_series_equal(got, expected)


def test_market_uses_latest_prematch_snapshot_and_never_closing():
    kickoff = datetime(2026, 10, 31, 15, 0)

    def row(bookmaker, selection, odds, when):
        return SimpleNamespace(match_id=1, bookmaker=bookmaker, market="1x2", selection=selection, odds=odds,
                               snapshot_time=when)  # fmt: skip

    early, late = kickoff - timedelta(hours=30), kickoff - timedelta(hours=6)
    rows = [row("Market Average", s, o, early) for s, o in (("home", 2.0), ("draw", 3.4), ("away", 4.0))]
    rows += [row("Market Average", s, o, late) for s, o in (("home", 1.8), ("draw", 3.6), ("away", 4.8))]
    rows += [row("Market Average (closing)", s, o, kickoff) for s, o in (("home", 1.2), ("draw", 6.0), ("away", 12.0))]
    rows += [row("Market Average", s, o, kickoff + timedelta(hours=2)) for s, o in (("home", 1.1), ("draw", 8.0), ("away", 20.0))]
    p = market_probabilities(rows, {1: kickoff})[1]
    assert p == pytest.approx(implied_probabilities_shin([1.8, 3.6, 4.8]))
    assert market_probabilities(rows[6:], {1: kickoff}) == {}


def test_prematch_snapshot_accepts_only_the_football_data_placeholder_after_kickoff():
    kickoff = datetime(2025, 9, 13, 14, 0)  # 15:00 en Reino Unido (BST)
    assert prematch_snapshot(kickoff - timedelta(hours=30), kickoff)
    assert prematch_snapshot(datetime(2025, 9, 13, 15, 0), kickoff)  # hora de relleno del CSV
    assert not prematch_snapshot(datetime(2025, 9, 13, 14, 30, 12, 345), kickoff)  # en directo
    assert not prematch_snapshot(datetime(2025, 9, 13, 15, 0, 0, 1), kickoff)


def test_double_chance_is_the_sum_of_calibrated_1x2():
    rng = np.random.default_rng(1)
    P = rng.dirichlet([2, 1, 1], size=50)
    dc = double_chance(P)
    assert np.allclose(dc.sum(axis=1), 2)
    assert np.allclose(dc[:, 0], 1 - P[:, 2]) and np.allclose(dc[:, 1], 1 - P[:, 0]) and np.allclose(dc[:, 2], 1 - P[:, 1])


def _wf_frame(n_days: int = 100, per_day: int = 8) -> pd.DataFrame:
    rng = np.random.default_rng(7)
    n = n_days * per_day
    elo = rng.normal(0, 1, n)
    p_home = 1 / (1 + np.exp(-(0.3 + elo)))
    res = np.where(rng.random(n) < p_home, 0, rng.integers(1, 3, n))
    return pd.DataFrame({
        "match_id": np.arange(n), "day": np.repeat(pd.date_range("2024-01-01", periods=n_days, freq="7D"), per_day),
        "res": res, "elo": elo, "dc_h": rng.normal(0, 1, n),
    })  # fmt: skip


def test_walk_forward_point_in_time_coherent_and_reproducible():
    df = _wf_frame()
    first = walk_forward(df, ["elo", "dc_h"])
    assert np.allclose(first[["p_home", "p_draw", "p_away"]].sum(axis=1), 1)
    assert (first["T"] != 1.0).any()
    assert first.equals(walk_forward(df, ["elo", "dc_h"]))

    # Cambiar los resultados de un dia no cambia lo predicho ese dia ni antes.
    day = df.day.unique()[80]  # ya con temperatura ajustada (>= 200 predicciones previas)
    flipped = df.copy()
    flipped.loc[flipped.day >= day, "res"] = 2
    again = walk_forward(flipped, ["elo", "dc_h"])
    upto = df.match_id[df.day <= day]
    cols = ["p_home", "p_draw", "p_away"]
    pd.testing.assert_frame_equal(
        first[first.match_id.isin(upto)][cols].reset_index(drop=True),
        again[again.match_id.isin(upto)][cols].reset_index(drop=True),
    )


def test_bootstrap_is_reproducible_with_fixed_seed():
    rng = np.random.default_rng(3)
    a, b = rng.random(200), rng.random(200)
    assert bootstrap_mean_diff(np.arange(200), a, b) == bootstrap_mean_diff(np.arange(200), a, b)


def test_levels_calibration_and_scores():
    P = np.array([[0.85, 0.10, 0.05], [0.55, 0.30, 0.15], [0.15, 0.30, 0.55], [0.05, 0.10, 0.85]])
    y = np.array([0, 1, 2, 0])
    hc = high_confidence(P, y)
    assert hc["resultado"]["alta"]["n"] == 2 and hc["resultado"]["alta"]["acierto"] == 0.5
    # Doble oportunidad: 0,95 / 0,85 / 0,85 / 0,95 -> las cuatro >= 0,80; aciertan las tres primeras.
    assert hc["doble"]["alta"]["n"] == 4 and hc["doble"]["alta"]["acierto"] == 0.75
    assert best_dc_hit(P, y).tolist() == [1, 1, 1, 0]

    curve = coverage_accuracy(P.max(axis=1), (P.argmax(axis=1) == y).astype(float), thresholds=(0.5, 0.9))
    assert curve[0]["n"] == 4 and curve[0]["acierto"] == 0.5 and curve[1]["n"] == 0

    perfect = np.tile([0.5, 0.25, 0.25], (400, 1))
    outcomes = np.array([0, 0, 1, 2] * 100)
    assert ece(perfect, outcomes) == pytest.approx(0.0)
    assert sum(b.n for b in calibration_bins(perfect, outcomes)) == 1200

    assert rps_per_match(np.array([[1.0, 0, 0]]), np.array([0]))[0] == 0
    # Todo al local y gana el visitante: fallan 1X y X2, acierta 12.
    assert brier_dc_per_match(np.array([[1.0, 0, 0]]), np.array([2]))[0] == pytest.approx(2 / 3)
    low, high = wilson(8, 10)
    assert low == pytest.approx(0.4902, abs=1e-3) and high == pytest.approx(0.9433, abs=1e-3)
