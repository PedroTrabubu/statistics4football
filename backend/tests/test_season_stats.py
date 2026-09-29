"""Tests del modulo de estadisticas agregadas por temporada (over/under,
BTTS, porteria a cero, forma local/visitante/total)."""

from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db.models import League, Match, MatchStatus, Season, Team
from app.stats.season_stats import compute_league_season_stats, compute_team_season_stats


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
    status: MatchStatus = MatchStatus.HISTORICAL,
) -> Match:
    match = Match(
        league_id=league_id,
        season_id=season_id,
        home_team_id=home.id,
        away_team_id=away.id,
        date=date,
        home_goals=home_goals,
        away_goals=away_goals,
        status=status,
    )
    db.add(match)
    db.flush()
    return match


def test_season_stats_splits_home_and_away(db: Session, league_and_teams):
    league, season, team_a, team_b, team_c = league_and_teams

    # Team A: local 2-0 (gana, over 1.5, clean sheet, no btts)
    _add_match(db, league.id, season.id, team_a, team_b, datetime(2024, 1, 1), 2, 0)
    # Team A: visitante 1-1 (empata, over 1.5, btts, no clean sheet, no failed to score)
    _add_match(db, league.id, season.id, team_c, team_a, datetime(2024, 2, 1), 1, 1)
    # Team A: visitante 3-0 (gana, over 1.5/2.5, clean sheet)
    _add_match(db, league.id, season.id, team_b, team_a, datetime(2024, 3, 1), 0, 3)

    stats = compute_team_season_stats(db, team_a, season)

    assert stats.overall.matches_played == 3
    assert stats.overall.wins == 2
    assert stats.overall.draws == 1
    assert stats.overall.losses == 0
    assert stats.overall.goals_for == 6
    assert stats.overall.goals_against == 1
    assert stats.overall.points == 7

    assert stats.home.matches_played == 1
    assert stats.home.wins == 1
    assert stats.home.clean_sheets == 1
    assert stats.home.btts == 0

    assert stats.away.matches_played == 2
    assert stats.away.wins == 1
    assert stats.away.draws == 1
    assert stats.away.losses == 0
    assert stats.away.btts == 1
    assert stats.away.clean_sheets == 1
    assert stats.away.failed_to_score == 0


def test_season_stats_percentages_and_averages(db: Session, league_and_teams):
    league, season, team_a, team_b, _team_c = league_and_teams

    _add_match(db, league.id, season.id, team_a, team_b, datetime(2024, 1, 1), 2, 2)  # over 3.5, btts, draw
    _add_match(db, league.id, season.id, team_b, team_a, datetime(2024, 2, 1), 0, 0)  # under 1.5, clean sheet both, draw

    stats = compute_team_season_stats(db, team_a, season)

    assert stats.overall.matches_played == 2
    assert stats.overall.over_1_5_pct == 50.0
    assert stats.overall.over_2_5_pct == 50.0
    assert stats.overall.over_3_5_pct == 50.0
    assert stats.overall.btts_pct == 50.0
    assert stats.overall.clean_sheet_pct == 50.0
    assert stats.overall.goals_for_avg == 1.0
    assert stats.overall.goals_against_avg == 1.0
    assert stats.overall.points_per_game == pytest.approx(1.0)


def test_team_with_no_matches_has_none_percentages(db: Session, league_and_teams):
    _league, season, _team_a, _team_b, team_c = league_and_teams

    stats = compute_team_season_stats(db, team_c, season)

    assert stats.overall.matches_played == 0
    assert stats.overall.over_2_5_pct is None
    assert stats.overall.points_per_game is None


def test_league_season_stats_excludes_teams_with_no_matches(db: Session, league_and_teams):
    league, season, team_a, team_b, team_c = league_and_teams

    _add_match(db, league.id, season.id, team_a, team_b, datetime(2024, 1, 1), 1, 0)

    results = compute_league_season_stats(db, league.id, season_name=season.name)

    team_names = {r.team_name for r in results}
    assert team_names == {"Team A", "Team B"}
    assert team_c.name not in team_names


def test_league_season_stats_ignores_scheduled_matches(db: Session, league_and_teams):
    league, season, team_a, team_b, _team_c = league_and_teams

    _add_match(db, league.id, season.id, team_a, team_b, datetime(2024, 1, 1), 2, 1)
    _add_match(
        db,
        league.id,
        season.id,
        team_a,
        team_b,
        datetime(2024, 6, 1),
        None,
        None,
        status=MatchStatus.SCHEDULED,
    )

    stats = compute_team_season_stats(db, team_a, season)

    assert stats.overall.matches_played == 1


def test_league_season_stats_defaults_to_latest_season(db: Session, league_and_teams):
    league, season, team_a, team_b, _team_c = league_and_teams
    later_season = Season(league_id=league.id, name="2526")
    db.add(later_season)
    db.flush()

    _add_match(db, league.id, season.id, team_a, team_b, datetime(2024, 1, 1), 1, 0)
    _add_match(db, league.id, later_season.id, team_a, team_b, datetime(2025, 1, 1), 3, 3)

    results = compute_league_season_stats(db, league.id)

    assert all(r.season == "2526" for r in results)
