"""Cuotas de Pinnacle de cada partido en un momento (apertura o cierre),
agrupadas por mercado, y probabilidad sin margen de un suceso.

Dos fuentes, siempre marcadas:
- "captura": nuestras capturas de la API (app/ingestion/pinnacle_queries.py):
  todos los mercados; apertura = primera captura, cierre = ultima antes del
  inicio.
- "football-data": el CSV de Football-Data.co.uk ya guardado en match_odds por
  la ingesta historica: "Pinnacle (closing)" (columnas PSCH/PSCD/PSCA y
  PC>2.5/PC<2.5) es el cierre; "Pinnacle" (PSH/PSD/PSA y P>2.5/P<2.5) es la
  toma de Football-Data, el viernes por la tarde para los partidos del fin de
  semana y el martes para los de entre semana. Solo 1X2 y mas/menos 2.5.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.db.models import MatchOdds
from app.ingestion.pinnacle_queries import closing_max_stakes, closing_prices, matchup_match_ids, opening_prices
from app.probability.devig import DEFAULT_METHOD, Method, devig, double_chance_from_1x2, line_kind

# (units, period, market, team, line)
MarketKey = tuple[str, int, str, str | None, float | None]
MONEYLINE: MarketKey = ("goals", 0, "moneyline", None, None)

# Selecciones de cada mercado completo, en el orden en que se quita el margen.
TWO_WAY = {
    "total": ("over", "under"),
    "team_total": ("over", "under"),
    "btts": ("yes", "no"),
    "team_to_score": ("yes", "no"),
    "draw_no_bet": ("home", "away"),
}
THREE_WAY = {"moneyline": ("home", "draw", "away")}

FD_CLOSING = "Pinnacle (closing)"
FD_PRECLOSING = "Pinnacle"


@dataclass
class Book:
    """Las cuotas de un partido en un momento: {mercado: {seleccion: cuota}}."""

    source: str
    markets: dict[MarketKey, dict[str, float]] = field(default_factory=dict)
    max_stake: float | None = None

    def add(self, key: MarketKey, selection: str, odds: float) -> None:
        self.markets.setdefault(key, {})[selection] = odds

    def lines(self, units: str, period: int, market: str, team: str | None) -> list[float]:
        return sorted(k[4] for k in self.markets if k[:4] == (units, period, market, team) and k[4] is not None)


def _norm_line(line: float | None) -> float | None:
    return None if line is None else float(line) + 0.0


def books_from_rows(rows: Iterable, matchup_to_match: dict[int, int], source: str) -> dict[int, Book]:
    """Libros por partido de la BD a partir de filas de pinnacle_odds (vistas
    de apertura o cierre). Las filas de partidos sin cruzar se descartan."""
    books: dict[int, Book] = {}
    for r in rows:
        match_id = r["match_id"] or matchup_to_match.get(r["matchup_id"])
        if match_id is None or r["odds"] is None:
            continue
        key = (r["units"], int(r["period"]), r["market"], r["team"], _norm_line(r["line"]))
        books.setdefault(match_id, Book(source)).add(key, r["selection"], float(r["odds"]))
    return books


def captured_books(db: Session) -> tuple[dict[int, Book], dict[int, Book]]:
    """(cierre, apertura) de nuestras capturas, por partido de la BD."""
    mapping = matchup_match_ids(db)
    closing = books_from_rows(closing_prices(db), mapping, "captura")
    opening = books_from_rows(opening_prices(db), mapping, "captura")
    stakes = closing_max_stakes(db)
    by_match = {match_id: stakes.get(matchup) for matchup, match_id in mapping.items()}
    for match_id, book in closing.items():
        book.max_stake = by_match.get(match_id)
    return closing, opening


def football_data_books(db: Session, match_ids: Iterable[int] | None = None) -> tuple[dict[int, Book], dict[int, Book]]:
    """(cierre, toma del viernes/martes) de Pinnacle del CSV de Football-Data."""
    query = db.query(MatchOdds).filter(
        MatchOdds.bookmaker.in_([FD_CLOSING, FD_PRECLOSING]),
        MatchOdds.market.in_(["1x2", "over_under_2.5"]),
    )
    if match_ids is not None:
        query = query.filter(MatchOdds.match_id.in_(list(match_ids)))
    closing: dict[int, Book] = {}
    preclosing: dict[int, Book] = {}
    for r in query:
        target = closing if r.bookmaker == FD_CLOSING else preclosing
        key = MONEYLINE if r.market == "1x2" else ("goals", 0, "total", None, 2.5)
        target.setdefault(r.match_id, Book("football-data")).add(key, r.selection, r.odds)
    return closing, preclosing


def market_probabilities(book: Book, key: MarketKey, method: Method = DEFAULT_METHOD) -> dict[str, float] | None:
    """Probabilidades sin margen de un mercado completo del libro, o None si
    falta alguna seleccion, alguna cuota no es valida o es un cuarto de linea
    (no es un suceso)."""
    quotes = book.markets.get(key)
    if not quotes:
        return None
    market, line = key[2], key[4]
    if line is not None and line_kind(line) == "quarter":
        return None
    selections = TWO_WAY.get(market) or THREE_WAY.get(market)
    if selections is None or any(s not in quotes for s in selections):
        return None
    if any(quotes[s] <= 1.0 for s in selections):
        return None  # cuota corrupta (el CSV trae alguna a 0)
    probs = devig([quotes[s] for s in selections], method)
    return dict(zip(selections, probs, strict=True))


def double_chance(book: Book, method: Method = DEFAULT_METHOD) -> dict[str, float] | None:
    """Doble oportunidad derivada del 1X2 sin margen (el mismo suceso)."""
    probs = market_probabilities(book, MONEYLINE, method)
    return double_chance_from_1x2(probs["home"], probs["draw"], probs["away"]) if probs else None


def merge_sources(primary: dict[int, Book], fallback: dict[int, Book]) -> dict[int, Book]:
    """Por partido, el libro de la fuente principal si existe; si no, el otro.
    (Capturas y Football-Data no se solapan: el CSV dejo de traer Pinnacle en
    enero de 2026 y las capturas empiezan en octubre de 2026.)"""
    return {**fallback, **primary}
