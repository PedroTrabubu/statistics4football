"""Tests de los arbitros corregidos a mano (data/arbitros_manual.csv)."""

from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db.models import League, Match, MatchStatus, Season, Team
from app.ingestion.referee_overrides import apply_referee_overrides

HEADER = "liga,fecha,local,visitante,arbitro,fuente_1,fuente_2\n"


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def match(db: Session) -> Match:
    league = League(code="ESP-La Liga", name="LaLiga")
    db.add(league)
    db.flush()
    season = Season(league_id=league.id, name="2627")
    elche = Team(name="Elche", league_id=league.id)
    barca = Team(name="Barcelona", league_id=league.id)
    db.add_all([season, elche, barca])
    db.flush()
    m = Match(
        league_id=league.id,
        season_id=season.id,
        home_team_id=elche.id,
        away_team_id=barca.id,
        date=datetime(2026, 8, 23, 19, 30),
        home_goals=0,
        away_goals=5,
        status=MatchStatus.HISTORICAL,
    )
    db.add(m)
    db.commit()
    return m


def test_override_fills_missing_referee(db: Session, match: Match, tmp_path):
    path = tmp_path / "arbitros.csv"
    path.write_text(HEADER + "ESP-La Liga,2026-08-23,Elche,Barcelona,A Quintero González,a,b\n", encoding="utf-8")

    updated, unmatched = apply_referee_overrides(db, path)

    assert (updated, unmatched) == (1, [])
    assert db.get(Match, match.id).referee == "A Quintero González"


def test_override_wins_and_is_idempotent(db: Session, match: Match, tmp_path):
    match.referee = "X Otro"
    db.commit()
    path = tmp_path / "arbitros.csv"
    path.write_text(HEADER + "ESP-La Liga,2026-08-23,Elche,Barcelona,A Quintero González,a,b\n", encoding="utf-8")

    assert apply_referee_overrides(db, path)[0] == 1
    # Segunda pasada: ya esta aplicado, no cambia nada.
    assert apply_referee_overrides(db, path)[0] == 0


def test_unknown_match_is_reported(db: Session, match: Match, tmp_path):
    path = tmp_path / "arbitros.csv"
    path.write_text(HEADER + "ESP-La Liga,2026-08-24,Elche,Barcelona,A Quintero González,a,b\n", encoding="utf-8")

    updated, unmatched = apply_referee_overrides(db, path)

    assert updated == 0
    assert unmatched == ["2026-08-24 Elche - Barcelona"]
    assert db.get(Match, match.id).referee is None
