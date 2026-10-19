"""Indice de predecibilidad: sin fuga del futuro, reproducible con semilla,
bandas y minimos (protocolo: docs/PREDECIBILIDAD_PROTOCOLO.md)."""

from dataclasses import replace
from datetime import date, timedelta

import numpy as np

from app.analysis.predictability import (
    MIN_BAND,
    BandStats,
    MatchRow,
    band,
    model_scorer,
    percentile,
    separation,
    walk_forward,
)

FEATURES = ("n_alta", "sample_min")


def rows(n: int = 60, per_day: int = 3) -> list[MatchRow]:
    rng = np.random.default_rng(1)
    start = date(2025, 8, 15)
    out = []
    for i in range(n):
        n_alta = float(rng.integers(0, 4))
        out.append(
            MatchRow(
                match_id=i + 1,
                league="ESP-La Liga",
                season="2526",
                date=f"{start + timedelta(days=i // per_day)}T18:00:00",
                picks=4,
                hits=int(rng.integers(0, 5)),
                expected=2.8,
                excess=float(0.02 * n_alta + rng.normal(0, 0.1)),
                features={"n_alta": n_alta, "sample_min": float(rng.integers(5, 20)) if i % 7 else None},
            )
        )
    return out


def test_walk_forward_never_uses_later_matches() -> None:
    base = rows()
    scored = {s.row.match_id: s.index for s in walk_forward(base, model_scorer(FEATURES), min_train=15)}
    # Cambiar el objetivo y las variables de los partidos del ultimo dia no puede
    # mover el indice de ningun partido anterior.
    last_day = max(r.day for r in base)
    changed = [
        replace(r, excess=5.0, features={"n_alta": 99.0, "sample_min": 0.0}) if r.day == last_day else r for r in base
    ]
    again = {s.row.match_id: s.index for s in walk_forward(changed, model_scorer(FEATURES), min_train=15)}
    earlier = [r.match_id for r in base if r.day < last_day and r.match_id in scored]
    assert earlier
    assert all(scored[i] == again[i] for i in earlier)


def test_same_day_matches_are_not_in_their_own_training() -> None:
    base = rows(per_day=3)
    scored = walk_forward(base, model_scorer(FEATURES), min_train=15)
    first_day = min(s.row.day for s in scored)
    trained_before = sum(1 for r in base if r.day < first_day)
    assert trained_before >= 15
    assert all(s.row.day >= first_day for s in scored)


def test_minimum_training_size() -> None:
    base = rows(n=30)
    assert walk_forward(base, model_scorer(FEATURES), min_train=300) == []
    scored = walk_forward(base, model_scorer(FEATURES), min_train=15)
    assert {s.row.match_id for s in scored} == {r.match_id for r in base if r.match_id > 15}


def test_separation_reproducible_with_seed() -> None:
    scored = walk_forward(rows(n=90), model_scorer(FEATURES), min_train=15)
    assert separation(scored, reps=300) == separation(scored, reps=300)
    assert separation(scored, reps=300, seed=1) != separation(scored, reps=300, seed=2)


def test_bands_and_percentile() -> None:
    assert band(33.2) == "baja" and band(33.4) == "media" and band(66.6) == "media" and band(66.7) == "alta"
    reference = np.array([1.0, 2.0, 2.0, 3.0])
    assert percentile(2.0, reference) == 50.0  # empates: cuentan la mitad, igual que en la web
    assert percentile(0.0, reference) == 0.0 and percentile(9.0, reference) == 100.0


def test_band_minimum_sample() -> None:
    stats = BandStats(matches=MIN_BAND - 1, picks=100, hit_rate=0.8, base=0.7, edge=0.1, low=0.0, high=0.2)
    assert stats.insufficient
    assert not replace(stats, matches=MIN_BAND).insufficient
