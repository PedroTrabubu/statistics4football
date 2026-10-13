"""Carga de MatchHistory: un cruce que se repite en la temporada (playoffs de
Bélgica y Grecia en el mismo CSV) es otro partido, no el mismo sobrescrito, y
una cuota que no es un número se ignora."""

import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db.models import Match
from app.ingestion import historical_backfill
from app.ingestion.historical_backfill import backfill_match_history
from app.ingestion.odds_columns import extract_1x2


def _row(day: str, home: str, away: str, goals: tuple[int, int]) -> dict:
    return {
        "league": "BEL-Pro League", "season": "2526", "game": f"{day} {home}-{away}", "date": pd.Timestamp(day),
        "home_team": home, "away_team": away, "FTHG": goals[0], "FTAG": goals[1], "HTHG": 0, "HTAG": 0,
    }  # fmt: skip


class _FakeReader:
    def __init__(self, rows: list[dict]):
        self.rows = rows

    def read_games(self) -> pd.DataFrame:
        return pd.DataFrame(self.rows).set_index(["league", "season", "game"])


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def test_repeated_pairing_in_a_season_is_another_match(db, monkeypatch):
    rows = [
        _row("2025-09-14", "Club Brugge", "Genk", (2, 0)),
        _row("2026-02-01", "Genk", "Club Brugge", (1, 1)),
        _row("2026-04-12", "Club Brugge", "Genk", (0, 3)),  # playoff: el mismo cruce otra vez
    ]
    monkeypatch.setattr(historical_backfill, "get_match_history_reader", lambda **kw: _FakeReader(rows))

    backfill_match_history(db, ["BEL-Pro League"], ["2526"])
    backfill_match_history(db, ["BEL-Pro League"], ["2526"])  # volver a cargar no duplica

    results = [(m.date.month, m.home_goals, m.away_goals) for m in db.query(Match).order_by(Match.date)]
    assert results == [(9, 2, 0), (2, 1, 1), (4, 0, 3)]


def test_odds_that_are_not_numbers_are_skipped():
    row = pd.Series({"B365CH": "#", "B365CD": "3.4", "B365CA": 2.1})  # Utrecht-Feyenoord, Eredivisie 22/23
    assert [(o["selection"], o["odds"]) for o in extract_1x2(row)] == [("draw", 3.4), ("away", 2.1)]
