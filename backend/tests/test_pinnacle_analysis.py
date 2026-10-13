"""Informes frente a Pinnacle: equivalencias pick-mercado, lineas distintas,
casos sinteticos con y sin ventaja, evaluacion por linea, comparacion de
referencias y cuotas de Pinnacle importadas de Football-Data."""

from datetime import datetime

import numpy as np
import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.analysis.books import MONEYLINE, Book, football_data_books, market_probabilities
from app.analysis.pinnacle_lines import MatchResultData, ModelDists, line_events, summarize_lines
from app.analysis.pinnacle_picks import (
    CARDS_NOT_COMPARABLE,
    NO_MARKET,
    Equivalence,
    NoEquivalence,
    Pick,
    equivalence,
    evaluate_picks,
    pick_quote,
    summarize,
)
from app.analysis.reference import ReferenceData, compare
from app.analysis.stats import bootstrap_mean_diff, calibration
from app.db.base import Base
from app.db.models import League, Match, MatchOdds, MatchStatus, Season, Team
from app.ingestion.odds_columns import extract_all_odds

TOTAL = ("goals", 0, "total", None)


def _book(**markets) -> Book:
    book = Book("captura")
    for key, quotes in markets.items():
        for selection, odds in quotes.items():
            book.add(_KEYS[key], selection, odds)
    return book


_KEYS = {
    "ml": MONEYLINE,
    "ou25": (*TOTAL, 2.5),
    "ou35": (*TOTAL, 3.5),
    "ou225": (*TOTAL, 2.25),
    "home_tt05": ("goals", 0, "team_total", "home", 0.5),
    "away_score": ("goals", 0, "team_to_score", "away", None),
    "btts": ("goals", 0, "btts", None, None),
    "corners95": ("corners", 0, "total", None, 9.5),
}


# --- Equivalencias -------------------------------------------------------------


def test_equivalences_map_each_pick_to_the_same_event():
    eq = equivalence("goles", "over-2.5", "home", "over", 2.5)
    assert isinstance(eq, Equivalence) and eq.targets[0].market == "total" and eq.targets[0].line == 2.5
    # "Encaja" del local = goles del visitante.
    eq = equivalence("goles-rival", "over-0.5", "home", "over", 0.5)
    assert [(t.market, t.team, t.selection) for t in eq.targets] == [
        ("team_total", "away", "over"),
        ("team_to_score", "away", "yes"),
    ]
    assert equivalence("resultado", "pierde", "away", None, None).targets[0].selection == "home"
    assert equivalence("resultado", "no-pierde", "away", None, None).derived_dc == "draw_away"
    assert equivalence("ambos-marcan", "no", "home", None, None).targets[0].selection == "no"
    assert equivalence("corners-equipo", "under-4.5", "away", "under", 4.5).targets[0].units == "corners"
    assert equivalence("tarjetas", "over-4.5", "home", "over", 4.5) == NoEquivalence(CARDS_NOT_COMPARABLE)
    assert equivalence("faltas-equipo", "over-12.5", "home", "over", 12.5) == NoEquivalence(NO_MARKET)
    assert equivalence("tiros-puerta", "under-8.5", "home", "under", 8.5) == NoEquivalence(NO_MARKET)


def test_only_identical_lines_without_interpolation():
    book = _book(ou25={"over": 1.9, "under": 1.95}, ou35={"over": 3.1, "under": 1.38})
    assert pick_quote(equivalence("goles", "over-2.5", "home", "over", 2.5), book).p == pytest.approx(0.5, abs=0.02)
    assert pick_quote(equivalence("goles", "over-3.0", "home", "over", 3.0), book) == "línea distinta"
    assert pick_quote(equivalence("corners", "over-9.5", "home", "over", 9.5), book) == "sin cuota del mercado"
    # Un cuarto de linea no es un suceso: no sirve ni aunque sea la "misma".
    quarter = _book(ou225={"over": 1.9, "under": 1.95})
    assert pick_quote(equivalence("goles", "over-2.25", "home", "over", 2.25), quarter) == "cuarto de línea"


def test_team_scores_falls_back_to_the_special_and_double_chance_comes_from_1x2():
    book = _book(away_score={"yes": 1.30, "no": 3.60}, ml={"home": 2.5, "draw": 3.3, "away": 3.0})
    quote = pick_quote(equivalence("goles-rival", "over-0.5", "home", "over", 0.5), book)
    assert quote.p == pytest.approx(0.73, abs=0.02) and "team_to_score" in quote.market
    dc = pick_quote(equivalence("resultado", "no-pierde", "home", None, None), book)
    probs = market_probabilities(book, MONEYLINE)
    assert dc.p == pytest.approx(probs["home"] + probs["draw"])


# --- Casos sinteticos: con y sin ventaja sobre el mercado ----------------------


def _synthetic(edge: float, n: int = 3000, seed: int = 7):
    """Picks de "mas de 2.5" cuya probabilidad real es la de Pinnacle mas `edge`."""
    rng = np.random.default_rng(seed)
    picks, books = [], {}
    for match_id in range(n):
        p = rng.uniform(0.6, 0.85)
        margin = 1.03
        books[match_id] = _book(ou25={"over": 1 / (p * margin), "under": 1 / ((1 - p) * margin)})
        hit = int(rng.random() < min(p + edge, 0.99))
        picks.append(Pick("L", "2526", match_id, "2026-01-01", "home", "A", "goles", "over-2.5", "over", 2.5,
                          "Más de 2.5 goles", "media", hit))  # fmt: skip
    return picks, books


def test_when_pinnacle_already_knows_the_picks_add_nothing():
    picks, books = _synthetic(edge=0.0)
    s = summarize(evaluate_picks(picks, books, method="proportional").evaluated)
    assert s.n == 3000
    assert s.low < 0 < s.high  # sin ventaja: el intervalo incluye el 0
    assert abs(s.diff) < 0.02


def test_when_the_picks_know_more_the_report_shows_it():
    picks, books = _synthetic(edge=0.08)
    s = summarize(evaluate_picks(picks, books, method="proportional").evaluated)
    assert s.low > 0.04  # ventaja clara y su intervalo lejos del 0


def test_excluded_and_undecided_picks_are_counted():
    picks, books = _synthetic(edge=0.0, n=3)
    picks += [
        Pick("L", "2526", 0, "d", "home", "A", "tarjetas", "over-4.5", "over", 4.5, "t", "alta", 1),
        Pick("L", "2526", 1, "d", "home", "A", "goles", "over-3.5", "over", 3.5, "t", "alta", 1),
        Pick("L", "2526", 99, "d", "home", "A", "goles", "over-2.5", "over", 2.5, "t", "alta", 0),
        Pick("L", "2526", 2, "d", "home", "A", "faltas", "over-20.5", "over", 20.5, "t", "alta", None),
    ]
    ev = evaluate_picks(picks, books)
    assert len(ev.evaluated) == 3 and ev.undecided == 1
    assert ev.excluded == {
        ("tarjetas", CARDS_NOT_COMPARABLE): 1,
        ("goles", "línea distinta"): 1,
        ("goles", "sin cuotas de Pinnacle del partido"): 1,
    }


def test_clv_measures_the_move_towards_the_pick():
    picks, close = _synthetic(edge=0.0, n=50)
    opening = {m: _book(ou25={"over": 2.2, "under": 1.7}) for m in close}  # abrian mas bajo
    s = summarize(evaluate_picks(picks, close, opening).evaluated)
    assert s.clv_n == 50 and s.mean_move > 0 and s.moved_for == 1.0


def test_bootstrap_is_deterministic_and_by_match():
    ids = [1, 1, 2, 3, 3, 3]
    a, b = [1, 0, 1, 1, 1, 0], [0.5] * 6
    assert bootstrap_mean_diff(ids, a, b) == bootstrap_mean_diff(ids, a, b)
    assert bootstrap_mean_diff(ids, a, b)[0] == pytest.approx(4 / 6 - 0.5)
    bins = calibration([0.55, 0.58, 0.95], [1, 0, 1])
    assert [(b.n, b.observed) for b in bins] == [(2, 0.5), (1, 1.0)]


# --- Evaluacion por linea --------------------------------------------------------


def test_line_events_handle_push_quarter_lines_and_cards():
    close = {
        1: _book(ou25={"over": 1.9, "under": 1.95}, ou225={"over": 1.8, "under": 2.05}),
        2: Book("captura"),
    }
    close[2].add((*TOTAL, 2.0), "over", 1.6)
    close[2].add((*TOTAL, 2.0), "under", 2.4)
    close[2].add(("bookings", 0, "total", None, 4.5), "over", 1.9)
    close[2].add(("bookings", 0, "total", None, 4.5), "under", 1.9)
    results = {1: MatchResultData(2, 1), 2: MatchResultData(1, 1)}  # en el 2, total = 2: devolucion
    out = line_events(close, {}, results)
    assert [(e.match_id, e.key[4], e.realized) for e in out.events] == [(1, 2.5, "over")]
    assert out.excluded == {"cuarto de línea": 1, "devolución o sin dato del partido": 1, "tarjetas: no comparables": 1}


def test_model_versus_pinnacle_on_each_line():
    # Modelo = verdad (Poisson 1.5 + 1.2); Pinnacle con un sesgo hacia el "mas".
    from scipy.stats import poisson

    grid = np.outer(poisson.pmf(np.arange(11), 1.5), poisson.pmf(np.arange(11), 1.2))
    p_over = float(grid[np.add.outer(np.arange(11), np.arange(11)) > 2.5].sum())
    rng = np.random.default_rng(3)
    close, opening, results = {}, {}, {}
    for m in range(1500):
        biased = min(p_over + 0.1, 0.95)
        close[m] = _book(ou25={"over": 1 / biased, "under": 1 / (1 - biased)})
        opening[m] = _book(ou25={"over": 1 / (biased + 0.05), "under": 1 / (0.95 - biased)})
        home, away = rng.poisson(1.5), rng.poisson(1.2)
        results[m] = MatchResultData(int(home), int(away))
    events = line_events(close, opening, results, lambda m: ModelDists(goals=grid)).events
    s = summarize_lines(events)
    assert s.n_model == 1500
    assert s.diff[2] < 0  # el modelo (la verdad) tiene menos log-loss que el Pinnacle sesgado
    # El modelo prefiere el "menos" (la apertura daba mas al "mas" que la
    # verdad) y el mercado bajo el "mas" hasta el cierre: se movio 5 puntos
    # hacia el modelo.
    assert s.clv[0] == pytest.approx(0.05, abs=1e-6) and s.clv[1] > 0


def test_model_probability_is_conditioned_on_no_push_for_integer_lines():
    from app.analysis.pinnacle_lines import _model_probs

    grid = np.zeros((11, 11))
    grid[1, 1], grid[2, 1], grid[0, 0] = 0.5, 0.25, 0.25  # total 2 (devolucion), 3 y 0
    probs = _model_probs((*TOTAL, 2.0), ModelDists(goals=grid))
    assert probs["over"] == pytest.approx(0.5)  # 0.25 / (1 - 0.5)


# --- Comparacion de referencias ----------------------------------------------------


def test_reference_comparison_prefers_the_sharper_market():
    rng = np.random.default_rng(11)
    books, scores = {}, {}
    for m in range(2000):
        p_over = rng.uniform(0.35, 0.65)
        sharp = Book("x")
        sharp.add(("goals", 0, "total", None, 2.5), "over", 1 / p_over)
        sharp.add(("goals", 0, "total", None, 2.5), "under", 1 / (1 - p_over))
        blunt = Book("x")
        blunt.add(("goals", 0, "total", None, 2.5), "over", 1.95)
        blunt.add(("goals", 0, "total", None, 2.5), "under", 1.95)
        books[m] = {"Pinnacle (closing)": sharp, "Market Average": blunt}
        scores[m] = (3, 0) if rng.random() < p_over else (1, 0)
    c = compare(ReferenceData(books, scores), "Más/menos 2.5", "Pinnacle (closing)", "Market Average", "x")
    assert c.n == 2000 and c.high < 0  # menos log-loss la referencia que sabe mas


# --- Football-Data: columnas reales de Pinnacle y cruce con la BD -------------------

# Cabecera real de E0_2526.csv (con Pinnacle) y de E0_2627.csv (sin Pinnacle).
HEADER_2526 = (
    "Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,PSH,PSD,PSA,AvgH,AvgD,AvgA,P>2.5,P<2.5,Avg>2.5,Avg<2.5,"
    "PSCH,PSCD,PSCA,AvgCH,AvgCD,AvgCA,PC>2.5,PC<2.5,AvgC>2.5,AvgC<2.5"
).split(",")
HEADER_2627 = "Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,AvgH,AvgD,AvgA,AvgCH,AvgCD,AvgCA".split(",")


def test_football_data_pinnacle_columns_are_imported_as_closing_and_preclosing():
    row = pd.Series(dict(zip(HEADER_2526, ["E0", "15/08/2025", "20:00", "Liverpool", "Bournemouth", 4, 2,
                                           1.30, 6.0, 9.5, 1.29, 5.8, 9.0, 1.6, 2.4, 1.58, 2.35,
                                           1.33, 5.6, 9.2, 1.31, 5.5, 8.8, 1.62, 2.38, 1.6, 2.3], strict=True)))  # fmt: skip
    odds = {(o["bookmaker"], o["market"], o["selection"]): o["odds"] for o in extract_all_odds(row)}
    assert odds[("Pinnacle (closing)", "1x2", "home")] == 1.33
    assert odds[("Pinnacle (closing)", "over_under_2.5", "over")] == 1.62
    assert odds[("Pinnacle", "1x2", "home")] == 1.30
    assert odds[("Market Average", "1x2", "home")] == 1.29  # la de la web: la toma del viernes
    no_pinnacle = pd.Series(dict(zip(HEADER_2627, ["E0", "1/1/2027", "15:00", "A", "B", 1, 0,
                                                  2.0, 3.4, 3.8, 2.1, 3.3, 3.6], strict=True)))  # fmt: skip
    assert not [o for o in extract_all_odds(no_pinnacle) if o["bookmaker"].startswith("Pinnacle")]


def test_football_data_books_cross_with_our_matches():
    engine_ = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine_)
    db: Session = sessionmaker(bind=engine_)()
    league = League(code="ENG-Premier League", name="PL")
    db.add(league)
    db.flush()
    season = Season(league_id=league.id, name="2526")
    home, away = Team(name="Liverpool", league_id=league.id), Team(name="Bournemouth", league_id=league.id)
    db.add_all([season, home, away])
    db.flush()
    m = Match(league_id=league.id, season_id=season.id, home_team_id=home.id, away_team_id=away.id,
              date=datetime(2025, 8, 15, 19), status=MatchStatus.HISTORICAL, home_goals=4, away_goals=2)  # fmt: skip
    db.add(m)
    db.flush()
    for bookmaker, sel, odds in [("Pinnacle (closing)", "home", 1.33), ("Pinnacle (closing)", "draw", 5.6),
                                 ("Pinnacle (closing)", "away", 9.2), ("Pinnacle", "home", 1.30),
                                 ("Market Average", "home", 1.29)]:  # fmt: skip
        db.add(MatchOdds(match_id=m.id, bookmaker=bookmaker, market="1x2", selection=sel, odds=odds, line=None,
                         snapshot_time=m.date))  # fmt: skip
    db.commit()
    closing, preclosing = football_data_books(db)
    assert closing[m.id].markets[MONEYLINE] == {"home": 1.33, "draw": 5.6, "away": 9.2}
    assert closing[m.id].source == "football-data"
    assert preclosing[m.id].markets[MONEYLINE] == {"home": 1.30}  # la media no se mezcla
    db.close()
