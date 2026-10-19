"""Pick del partido: candidatos, probabilidades, eleccion y sin fuga del futuro
(protocolo: docs/PICK_DEL_PARTIDO_PROTOCOLO.md)."""

from datetime import datetime, timedelta

import numpy as np
from scipy.stats import poisson

from app.picks.match_pick import (
    CANDIDATES,
    Candidate,
    Distributions,
    MatchData,
    Scored,
    choose,
    choose_max_probability,
    outcome,
    probability,
    walk_forward,
)


def goals_matrix(lam: float = 1.5, mu: float = 1.1) -> np.ndarray:
    k = np.arange(11)
    m = np.outer(poisson.pmf(k, lam), poisson.pmf(k, mu))
    return m / m.sum()


def match(i: int, day: int, season: str = "2526", hg: int | None = 2, ag: int | None = 1) -> MatchData:
    rng = np.random.default_rng(i)
    stats = {s: (int(rng.integers(lo, hi)), int(rng.integers(lo, hi))) for s, lo, hi in (
        ("corners", 2, 9), ("cards", 0, 5), ("fouls", 8, 16), ("shots", 6, 18), ("sot", 1, 8))}  # fmt: skip
    return MatchData(
        match_id=i,
        league="ESP-La Liga",
        season=season,
        date=datetime(2025, 8, 15) + timedelta(days=day),
        home_id=1 + i % 6,
        away_id=1 + (i + 3) % 6,
        home_team="Local",
        away_team="Visitante",
        referee=f"R{i % 3}",
        home_goals=hg,
        away_goals=ag,
        stats=stats if hg is not None else {},
    )


def test_closed_list_of_candidates() -> None:
    assert len(CANDIDATES) == 338
    assert len({c.key for c in CANDIDATES}) == 338


def test_probabilities_are_complementary_and_match_markets() -> None:
    d = Distributions(goals=goals_matrix(), counts={"corners": (np.full(31, 1 / 31), np.full(31, 1 / 31))})
    over = probability(Candidate("goles", "match", "over-2.5", "over", 2.5), d)
    under = probability(Candidate("goles", "match", "under-2.5", "under", 2.5), d)
    assert abs(over + under - 1) < 1e-9
    win = probability(Candidate("resultado", "home", "gana", None, None), d)
    lose_away = probability(Candidate("resultado", "away", "pierde", None, None), d)
    assert abs(win - lose_away) < 1e-12
    # Lo que encaja el local = lo que marca el visitante.
    assert probability(Candidate("goles-rival", "home", "over-0.5", "over", 0.5), d) == probability(
        Candidate("goles-equipo", "away", "over-0.5", "over", 0.5), d
    )
    assert probability(Candidate("faltas", "match", "over-20.5", "over", 20.5), d) is None  # sin modelo: sin candidato


def test_outcome_uses_cards_as_yellow_plus_red_and_skips_missing() -> None:
    m = match(1, 0)
    m.stats["cards"] = (3, 2)
    assert outcome(Candidate("tarjetas", "match", "over-4.5", "over", 4.5), m) is True
    assert outcome(Candidate("tarjetas-equipo", "away", "under-2.5", "under", 2.5), m) is True
    m.stats["fouls"] = (None, 12)
    assert outcome(Candidate("faltas", "match", "over-20.5", "over", 20.5), m) is None


def scored(c: Candidate, p: float, base: float, n: int = 20) -> Scored:
    import math

    return Scored(c, p, p, base, n, math.log(p / (1 - p)) - math.log(base / (1 - base)))


def test_choice_rules() -> None:
    over = lambda line: Candidate("corners", "match", f"over-{line}", "over", line)  # noqa: E731
    rows = [
        scored(over(7.5), 0.90, 0.85),  # base >= 80 %: fuera
        scored(over(8.5), 0.80, 0.70),
        scored(over(9.5), 0.70, 0.55),  # la mas exigente de su escalera que pasa
        scored(over(10.5), 0.60, 0.40),  # p < 65 %: fuera
        scored(Candidate("resultado", "home", "gana", None, None), 0.66, 0.60),
    ]
    pick = choose(rows)
    assert pick.candidate == over(9.5)  # gana a "gana" por ventaja en logit
    assert choose_max_probability(rows).candidate == over(8.5)
    assert choose([scored(over(10.5), 0.6, 0.4)]) is None
    tie = [scored(Candidate("goles", "match", "under-3.5", "under", 3.5), 0.7, 0.6, n=10),
           scored(Candidate("ambos-marcan", "match", "no", None, None), 0.7, 0.6, n=30)]  # fmt: skip
    assert choose(tie).n == 30  # empate: mas muestra


def test_walk_forward_never_uses_later_matches() -> None:
    history = [match(i, i // 3, season="2425" if i < 150 else "2526") for i in range(240)]
    targets = {m.match_id for m in history if m.season == "2526" and m.match_id < 200}

    def goals_for_day(day):
        return lambda m: goals_matrix()

    first = {p.match.match_id: p.pick for p in walk_forward(history, targets, goals_for_day, ["2425", "2526"])}
    # Cambiar todo lo jugado despues del ultimo objetivo no mueve ningun pick.
    last_day = max(m.day for m in history if m.match_id in targets)
    changed = [match(m.match_id + 10_000, 0) if m.day > last_day else m for m in history]
    for m in changed:
        if m.match_id >= 10_000:
            m.date = datetime(2026, 5, 1)
    again = {p.match.match_id: p.pick for p in walk_forward(changed, targets, goals_for_day, ["2425", "2526"])}
    assert first == again
    assert len(first) == len(targets)
