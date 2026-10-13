"""Programador: puntos de control de la actualización y una sola instancia."""

from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db.models import League, Match, MatchStatus, Season, Team, TeamMatchStats
from app.ingestion.scheduler import (
    MatchTimes,
    SingleInstance,
    match_times,
    next_update_at,
    update_checkpoints,
    update_due,
)

H = timedelta(hours=1)
KICKOFF = datetime(2026, 10, 11, 18, 0)


def test_checkpoints_before_and_after_each_match():
    points = update_checkpoints([MatchTimes(KICKOFF, has_stats=True)])
    assert points == sorted(KICKOFF + h * H for h in (-36, -24, -18, -12, -6, 3, 12))
    # Sin estadísticas aún: además, una vez al día hasta ~5 días después.
    missing = update_checkpoints([MatchTimes(KICKOFF, has_stats=False)])
    assert set(missing) - set(points) == {KICKOFF + h * H for h in (36, 60, 84, 108)}


def test_matches_at_the_same_time_share_checkpoints():
    assert update_checkpoints([MatchTimes(KICKOFF, True)] * 5) == update_checkpoints([MatchTimes(KICKOFF, True)])


def test_due_when_a_checkpoint_passed_since_the_last_update():
    points = update_checkpoints([MatchTimes(KICKOFF, True)])
    day_before = KICKOFF - 24 * H
    assert update_due(None, points, day_before - 5 * H)  # nunca se ha actualizado
    assert update_due(day_before - 2 * H, points, day_before + 1 * H)  # pasó el de 24 h
    assert not update_due(day_before + 30 * timedelta(minutes=1), points, day_before + 2 * H)
    assert update_due(day_before, points, KICKOFF - 12 * H)  # y el de 18 h ya pasó
    assert next_update_at(points, day_before) == KICKOFF - 18 * H
    assert next_update_at(points, KICKOFF + 13 * H) is None


def test_match_times_knows_which_played_matches_lack_stats():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db: Session = sessionmaker(bind=engine)()
    league = League(code="ESP-La Liga", name="LaLiga")
    other = League(code="ITA-Serie A", name="Serie A")
    db.add_all([league, other])
    db.flush()
    season = Season(league_id=league.id, name="2627")
    a, b = Team(name="A", league_id=league.id), Team(name="B", league_id=league.id)
    db.add_all([season, a, b])
    db.flush()

    def match(when, status, league_id=league.id):
        m = Match(league_id=league_id, season_id=season.id, home_team_id=a.id, away_team_id=b.id, date=when, status=status)
        db.add(m)
        db.flush()
        return m

    now = datetime(2026, 10, 10, 9)
    played = match(now - 14 * H, MatchStatus.HISTORICAL)
    with_stats = match(now - 3 * 24 * H, MatchStatus.HISTORICAL)
    for team in (a, b):
        db.add(TeamMatchStats(match_id=with_stats.id, team_id=team.id, corners_for=5))
    db.add(TeamMatchStats(match_id=played.id, team_id=a.id, corners_for=None))
    match(now + 30 * H, MatchStatus.SCHEDULED)
    match(now + 10 * 24 * H, MatchStatus.SCHEDULED)  # demasiado lejos
    match(now + 30 * H, MatchStatus.SCHEDULED, league_id=other.id)  # liga no activa
    db.commit()

    times = sorted(match_times(db, ["ESP-La Liga"], now), key=lambda t: t.kickoff)
    assert [(t.kickoff, t.has_stats) for t in times] == [
        (now - 3 * 24 * H, True),
        (now - 14 * H, False),
        (now + 30 * H, False),
    ]
    db.close()


def test_only_one_scheduler_at_a_time(tmp_path):
    first, second = SingleInstance(tmp_path / "s.lock"), SingleInstance(tmp_path / "s.lock")
    assert first.acquire()
    assert not second.acquire()
    first.release()
    assert second.acquire()
    second.release()


@pytest.mark.parametrize("hours_before", [36, 24, 18, 12, 6])
def test_every_pre_match_checkpoint_triggers_one_update(hours_before):
    points = update_checkpoints([MatchTimes(KICKOFF, True)])
    moment = KICKOFF - hours_before * H
    assert update_due(moment - timedelta(minutes=1), points, moment + timedelta(minutes=1))
