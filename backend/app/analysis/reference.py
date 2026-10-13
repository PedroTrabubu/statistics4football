"""¿Pinnacle es mejor referencia de mercado que "Market Average"? Y ¿el EV
de la web con "Market Max" es optimista? Solo informa: la web sigue usando
"Market Average" (validada en los backtests pre-registrados).

Que es cada referencia (nombres de match_odds, del CSV de Football-Data):
- "Market Average" (AvgH/AvgD/AvgA, Avg>2.5/Avg<2.5): media de las casas en
  la toma de Football-Data, el viernes por la tarde (fin de semana) o el
  martes (entre semana). Es la que usa la web: probabilidades, valor
  esperado, Recomendaciones y combinadas. En partidos aun por jugar sale del
  fixtures.csv (la misma toma) o de the-odds-api.
- "Pinnacle" (PSH..., P>2.5...): Pinnacle en esa misma toma.
- "... (closing)" (AvgCH, PSCH, AvgC>2.5, PC>2.5...): las ultimas antes del inicio.
Todas sin margen con el mismo metodo (Shin, como la web).

Cada partido aporta un suceso por mercado (1X2 y mas/menos 2.5); log-loss =
-log(probabilidad que se dio a lo que paso), menos es mejor. Las diferencias
se calculan sobre los mismos partidos y con intervalo remuestreando partidos.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.analysis.books import MONEYLINE, Book, market_probabilities
from app.analysis.stats import bootstrap_mean_diff, calibration, neg_log
from app.db.models import Match, MatchOdds, MatchStatus, ModelPrediction
from app.probability.devig import DEFAULT_METHOD, Method

AVERAGE = "Market Average"
PINNACLE = "Pinnacle"
AVERAGE_CLOSE = "Market Average (closing)"
PINNACLE_CLOSE = "Pinnacle (closing)"
PINNACLE_CAPTURED = "Pinnacle (captura, cierre)"
REFERENCES = (AVERAGE, PINNACLE, AVERAGE_CLOSE, PINNACLE_CLOSE)

COMPARISONS = (
    (PINNACLE_CLOSE, AVERAGE, "Cierre de Pinnacle frente a la referencia de la web (media del viernes/martes)"),
    (PINNACLE, AVERAGE, "Misma toma (viernes/martes): Pinnacle frente a la media"),
    (PINNACLE_CLOSE, AVERAGE_CLOSE, "Al cierre: Pinnacle frente a la media"),
    (AVERAGE_CLOSE, AVERAGE, "Cuánto aporta esperar al cierre (la media)"),
    (PINNACLE_CAPTURED, AVERAGE, "Capturas de Pinnacle (cierre) frente a la referencia de la web"),
)

MARKETS = {"1X2": MONEYLINE, "Más/menos 2.5": ("goals", 0, "total", None, 2.5)}
DECILES = tuple(i / 10 for i in range(11))


def realized(market: str, home: int, away: int) -> str:
    if market == "1X2":
        return "home" if home > away else "away" if away > home else "draw"
    return "over" if home + away > 2.5 else "under"


@dataclass
class ReferenceData:
    # partido -> referencia -> libro
    books: dict[int, dict[str, Book]]
    # partido -> (goles local, goles visitante)
    scores: dict[int, tuple[int, int]]


def load_reference_data(db: Session, match_ids: Iterable[int], captured: dict[int, Book] | None = None) -> ReferenceData:
    ids = list(match_ids)
    scores = {
        m.id: (m.home_goals, m.away_goals)
        for m in db.query(Match).filter(
            Match.id.in_(ids), Match.status == MatchStatus.HISTORICAL, Match.home_goals.is_not(None)
        )
    }
    books: dict[int, dict[str, Book]] = defaultdict(dict)
    rows = db.query(MatchOdds).filter(
        MatchOdds.match_id.in_(list(scores)),
        MatchOdds.bookmaker.in_(REFERENCES),
        MatchOdds.market.in_(["1x2", "over_under_2.5"]),
    )
    for r in rows:
        key = MONEYLINE if r.market == "1x2" else MARKETS["Más/menos 2.5"]
        books[r.match_id].setdefault(r.bookmaker, Book("football-data")).add(key, r.selection, r.odds)
    for match_id, book in (captured or {}).items():
        if match_id in scores:
            books[match_id][PINNACLE_CAPTURED] = book
    return ReferenceData(dict(books), scores)


def realized_probabilities(data: ReferenceData, market: str, reference: str, method: Method = DEFAULT_METHOD) -> dict[int, float]:
    """Partido -> probabilidad sin margen que esa referencia dio a lo que paso."""
    out = {}
    for match_id, refs in data.books.items():
        book = refs.get(reference)
        if book is None:
            continue
        probs = market_probabilities(book, MARKETS[market], method)
        if probs is not None:
            out[match_id] = probs[realized(market, *data.scores[match_id])]
    return out


@dataclass(frozen=True)
class Comparison:
    a: str
    b: str
    label: str
    market: str
    n: int
    logloss_a: float
    logloss_b: float
    diff: float  # a - b: negativo, mejor a
    low: float
    high: float


def compare(data: ReferenceData, market: str, a: str, b: str, label: str, method: Method = DEFAULT_METHOD) -> Comparison | None:
    pa = realized_probabilities(data, market, a, method)
    pb = realized_probabilities(data, market, b, method)
    common = sorted(set(pa) & set(pb))
    if not common:
        return None
    la = [neg_log(pa[m]) for m in common]
    lb = [neg_log(pb[m]) for m in common]
    diff, low, high = bootstrap_mean_diff(common, la, lb)
    return Comparison(a, b, label, market, len(common), sum(la) / len(la), sum(lb) / len(lb), diff, low, high)


def reference_calibration(data: ReferenceData, market: str, reference: str, method: Method = DEFAULT_METHOD):
    """Calibracion por deciles de todas las selecciones de esa referencia."""
    probs, outcomes = [], []
    for match_id, refs in data.books.items():
        book = refs.get(reference)
        p = market_probabilities(book, MARKETS[market], method) if book else None
        if p is None:
            continue
        won = realized(market, *data.scores[match_id])
        for selection, value in p.items():
            probs.append(value)
            outcomes.append(1.0 if selection == won else 0.0)
    return calibration(probs, outcomes, DECILES)


# --- Market Max ---------------------------------------------------------------


@dataclass(frozen=True)
class MaxPriceReview:
    selections: int  # selecciones con Market Max y Bet365
    max_vs_bet365: float  # media de (Max / Bet365 - 1)
    max_vs_pinnacle: float | None
    value_n: int  # selecciones "value" de la web (is_recommended)
    value_ev_max: float | None  # EV medio con Market Max (el de la web)
    value_ev_bet365: float | None  # EV medio de esas mismas con la cuota de Bet365
    still_value_bet365: float | None  # parte que sigue >= umbral con Bet365
    roi_max: float | None  # rentabilidad real a cuota Market Max
    roi_bet365: float | None  # rentabilidad real a cuota Bet365


ODDS_SELECTION = {"1x2": ("home", "draw", "away"), "over_under_2.5": ("over", "under")}


def review_max_price(db: Session, match_ids: Iterable[int], ev_threshold: float) -> MaxPriceReview | None:
    """El EV de la web usa "Market Max" (mejor cuota entre las casas del CSV);
    aqui, lo mismo con la cuota de una sola casa (Bet365) en las selecciones
    que la web marca como valor, y la rentabilidad real de cada una."""
    ids = list(match_ids)
    scores = {
        m.id: (m.home_goals, m.away_goals)
        for m in db.query(Match).filter(Match.id.in_(ids), Match.home_goals.is_not(None))
    }
    prices: dict[tuple[int, str, str, str], float] = {}
    for r in db.query(MatchOdds).filter(
        MatchOdds.match_id.in_(list(scores)),
        MatchOdds.bookmaker.in_(["Market Max", "Bet365", "Pinnacle"]),
        MatchOdds.market.in_(list(ODDS_SELECTION)),
    ):
        prices[(r.match_id, r.market, r.selection, r.bookmaker)] = r.odds
    preds = db.query(ModelPrediction).filter(
        ModelPrediction.match_id.in_(list(scores)),
        ModelPrediction.model_version == "dixon_coles_v1",
        ModelPrediction.market.in_(list(ODDS_SELECTION)),
    )
    ratios_b365, ratios_pin = [], []
    value = []
    for p in preds:
        mx = prices.get((p.match_id, p.market, p.selection, "Market Max"))
        b365 = prices.get((p.match_id, p.market, p.selection, "Bet365"))
        pin = prices.get((p.match_id, p.market, p.selection, "Pinnacle"))
        if mx is None or b365 is None:
            continue
        ratios_b365.append(mx / b365 - 1)
        if pin is not None:
            ratios_pin.append(mx / pin - 1)
        if p.is_recommended and p.ev is not None:
            market = "1X2" if p.market == "1x2" else "Más/menos 2.5"
            won = realized(market, *scores[p.match_id]) == p.selection
            value.append((p.ev, p.prob_model * b365 - 1, won, mx, b365))
    if not ratios_b365:
        return None
    n = len(value)
    return MaxPriceReview(
        selections=len(ratios_b365),
        max_vs_bet365=sum(ratios_b365) / len(ratios_b365),
        max_vs_pinnacle=sum(ratios_pin) / len(ratios_pin) if ratios_pin else None,
        value_n=n,
        value_ev_max=sum(v[0] for v in value) / n if n else None,
        value_ev_bet365=sum(v[1] for v in value) / n if n else None,
        still_value_bet365=sum(v[1] >= ev_threshold for v in value) / n if n else None,
        roi_max=sum((v[3] - 1) if v[2] else -1 for v in value) / n if n else None,
        roi_bet365=sum((v[4] - 1) if v[2] else -1 for v in value) / n if n else None,
    )
