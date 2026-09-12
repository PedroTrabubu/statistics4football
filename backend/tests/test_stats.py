"""Tests del modulo de stats con datos sinteticos (BD SQLite en memoria).

Lo importante a verificar: que ninguna funcion usa datos del propio partido
ni de partidos futuros (point-in-time), y que la aritmetica de forma/H2H es
correcta.
"""

from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db.models import (
    EloRating,
    League,
    Match,
    MatchStatus,
    Season,
    Team,
    TeamMatchStats,
)
from app.stats.elo import get_elo_at
from app.stats.form import compute_team_form
from app.stats.h2h import compute_h2h
from app.stats.xg import compute_xg_form


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def league_and_teams(db: Session):
    league = League(code="TEST-League", name="Test League")
    db.add(league)
    db.flush()
    season = Season(league_id=league.id, name="2425")
    db.add(season)
    db.flush()
    team_a = Team(name="Team A", league_id=league.id)
    team_b = Team(name="Team B", league_id=league.id)
    team_c = Team(name="Team C", league_id=league.id)
    db.add_all([team_a, team_b, team_c])
    db.flush()
    return league, season, team_a, team_b, team_c


def _add_match(
    db: Session,
    league_id: int,
    season_id: int,
    home: Team,
    away: Team,
    date: datetime,
    home_goals: int,
    away_goals: int,
) -> Match:
    match = Match(
        league_id=league_id,
        season_id=season_id,
        home_team_id=home.id,
        away_team_id=away.id,
        date=date,
        home_goals=home_goals,
        away_goals=away_goals,
        status=MatchStatus.HISTORICAL,
    )
    db.add(match)
    db.flush()
    return match


def test_form_ignores_future_and_current_matches(db: Session, league_and_teams):
    league, season, team_a, team_b, _team_c = league_and_teams

    # Partido pasado: A gana 2-0 como local.
    _add_match(db, league.id, season.id, team_a, team_b, datetime(2024, 1, 1), 2, 0)
    # Partido "objetivo" (el que estamos evaluando): NO debe contar.
    target = _add_match(db, league.id, season.id, team_a, team_b, datetime(2024, 2, 1), 1, 1)
    # Partido futuro respecto al objetivo: tampoco debe contar.
    _add_match(db, league.id, season.id, team_a, team_b, datetime(2024, 3, 1), 0, 3)

    form = compute_team_form(db, team_a.id, target.date, num_matches=5)

    assert form.matches_played == 1
    assert form.wins == 1
    assert form.points == 3
    assert form.goals_for == 2
    assert form.goals_against == 0


def test_form_aggregates_wins_draws_losses(db: Session, league_and_teams):
    league, season, team_a, team_b, team_c = league_and_teams

    _add_match(db, league.id, season.id, team_a, team_b, datetime(2024, 1, 1), 2, 0)  # win
    _add_match(db, league.id, season.id, team_c, team_a, datetime(2024, 1, 8), 1, 1)  # draw (away)
    _add_match(db, league.id, season.id, team_a, team_b, datetime(2024, 1, 15), 0, 1)  # loss

    form = compute_team_form(db, team_a.id, datetime(2024, 2, 1), num_matches=5)

    assert form.matches_played == 3
    assert form.wins == 1
    assert form.draws == 1
    assert form.losses == 1
    assert form.points == 4
    assert form.goals_for == 3
    assert form.goals_against == 2


def test_form_respects_num_matches_limit(db: Session, league_and_teams):
    league, season, team_a, team_b, _team_c = league_and_teams

    for i in range(10):
        _add_match(db, league.id, season.id, team_a, team_b, datetime(2024, 1, i + 1), 1, 0)

    form = compute_team_form(db, team_a.id, datetime(2024, 3, 1), num_matches=3)

    assert form.matches_played == 3


def test_h2h_counts_both_venues(db: Session, league_and_teams):
    league, season, team_a, team_b, _team_c = league_and_teams

    _add_match(db, league.id, season.id, team_a, team_b, datetime(2024, 1, 1), 2, 1)  # A wins home
    _add_match(db, league.id, season.id, team_b, team_a, datetime(2024, 6, 1), 3, 0)  # B wins home

    h2h = compute_h2h(db, team_a.id, team_b.id, datetime(2025, 1, 1), num_matches=5)

    assert h2h.matches_played == 2
    assert h2h.team_a_wins == 1
    assert h2h.team_b_wins == 1
    assert h2h.team_a_goals == 2
    assert h2h.team_b_goals == 4


def test_xg_form_only_uses_matches_with_data(db: Session, league_and_teams):
    league, season, team_a, team_b, _team_c = league_and_teams

    m1 = _add_match(db, league.id, season.id, team_a, team_b, datetime(2024, 1, 1), 2, 1)
    db.add(TeamMatchStats(match_id=m1.id, team_id=team_a.id, xg=1.8, xga=0.9))

    # Partido sin stats de xG (por ejemplo, Understat no lo cubrio).
    _add_match(db, league.id, season.id, team_a, team_b, datetime(2024, 1, 8), 1, 1)

    xg_form = compute_xg_form(db, team_a.id, datetime(2024, 2, 1), num_matches=5)

    assert xg_form.matches_with_data == 1
    assert xg_form.avg_xg_for == pytest.approx(1.8)
    assert xg_form.avg_xg_against == pytest.approx(0.9)


def test_elo_returns_latest_value_before_date(db: Session, league_and_teams):
    _league, _season, team_a, _team_b, _team_c = league_and_teams

    db.add(EloRating(team_id=team_a.id, date=datetime(2024, 1, 1).date(), elo=1500))
    db.add(EloRating(team_id=team_a.id, date=datetime(2024, 2, 1).date(), elo=1550))
    db.flush()

    assert get_elo_at(db, team_a.id, datetime(2024, 1, 15)) == 1500
    assert get_elo_at(db, team_a.id, datetime(2024, 3, 1)) == 1550
    assert get_elo_at(db, team_a.id, datetime(2023, 1, 1)) is None
