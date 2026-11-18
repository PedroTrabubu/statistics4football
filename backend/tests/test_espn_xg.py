"""xG de respaldo de ESPN para los partidos sin el de Understat."""

from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db.models import IngestionStatus, League, Match, MatchStatus, Season, Team, TeamMatchStats
from app.ingestion import espn_xg
from app.ingestion.espn_xg import ESPN_TO_UNDERSTAT, fill_xg_from_espn, parse_xg


def _stats(home, away):
    return {"home": {"expectedGoals": home, "totalShots": 12.0}, "away": {"expectedGoals": away}}


def test_parse_xg_in_understat_scale():
    assert parse_xg(_stats(1.25, 0.5)) == (pytest.approx(1.25 * ESPN_TO_UNDERSTAT), pytest.approx(0.5 * ESPN_TO_UNDERSTAT))
    assert parse_xg(_stats(0.0, 2.0))[0] == 0.0


def test_parse_xg_waits_until_espn_has_both():
    assert parse_xg({}) is None
    assert parse_xg(_stats(1.25, None)) is None
    assert parse_xg({"home": {"expectedGoals": 1.0}}) is None


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


class _FakeEspn:
    """team_statistics por id de partido; los que no están, sin xG aún."""

    def __init__(self, by_event):
        self.by_event = by_event
        self.asked = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return None

    def team_statistics(self, league, event_id):
        self.asked.append((league, event_id))
        return self.by_event.get(event_id, {})


def test_fills_only_matches_without_xg_of_that_season(db, monkeypatch):
    league = League(code="ENG-Premier League", name="Premier League")
    db.add(league)
    db.flush()
    current, previous = Season(league_id=league.id, name="2627"), Season(league_id=league.id, name="2526")
    db.add_all([current, previous])
    db.flush()
    a, b = Team(name="A", league_id=league.id), Team(name="B", league_id=league.id)
    db.add_all([a, b])
    db.flush()

    def match(season, day, status=MatchStatus.HISTORICAL):
        m = Match(league_id=league.id, season_id=season.id, date=datetime(2026, 11, day), home_team_id=a.id,
                  away_team_id=b.id, status=status, source_ids={"espn_event_id": f"e{day}"})  # fmt: skip
        db.add(m)
        db.flush()
        return m

    with_understat = match(current, 1)
    db.add_all([TeamMatchStats(match_id=with_understat.id, team_id=a.id, xg=2.0, xga=1.0),
                TeamMatchStats(match_id=with_understat.id, team_id=b.id, xg=1.0, xga=2.0)])  # fmt: skip
    without = match(current, 8)
    db.add(TeamMatchStats(match_id=without.id, team_id=a.id, corners_for=6))  # stats de Football-Data, sin xG
    not_yet = match(current, 9)
    match(current, 20, MatchStatus.SCHEDULED)
    old = match(previous, 2)
    db.commit()

    fake = _FakeEspn({"e8": _stats(1.5, 0.25), "e1": _stats(9.0, 9.0), "e2": _stats(9.0, 9.0)})
    monkeypatch.setattr(espn_xg, "EspnClient", lambda: fake)

    run = fill_xg_from_espn(db, ["ENG-Premier League"], "2627")

    assert run.status == IngestionStatus.SUCCESS and run.rows_ingested == 1
    assert "partidos_sin_xg=2 rellenados=1 sin_xg_en_espn=1" in run.notes
    # Solo se pregunta por los jugados de la temporada sin xG.
    assert fake.asked == [("eng.1", "e8"), ("eng.1", "e9")]
    home = db.query(TeamMatchStats).filter_by(match_id=without.id, team_id=a.id).one()
    away = db.query(TeamMatchStats).filter_by(match_id=without.id, team_id=b.id).one()
    assert home.xg == pytest.approx(1.5 * ESPN_TO_UNDERSTAT, abs=1e-3) and home.xga == away.xg
    assert away.xg == pytest.approx(0.25 * ESPN_TO_UNDERSTAT, abs=1e-3) and away.xga == home.xg
    assert home.corners_for == 6  # lo demás no se toca
    # Lo de Understat no se toca; lo que ESPN aún no tiene, tampoco.
    assert db.query(TeamMatchStats).filter_by(match_id=with_understat.id, team_id=a.id).one().xg == 2.0
    assert db.query(TeamMatchStats).filter_by(match_id=not_yet.id).count() == 0
    assert db.query(TeamMatchStats).filter_by(match_id=old.id).count() == 0
