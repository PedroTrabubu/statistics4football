"""Tests del orquestador (app/probability/engine.py) con BD sintetica.

Cubre en particular el guardrail contra cuotas agregadas corruptas
(Market Average/Max) que a veces trae football-data.co.uk, que sin filtro
generaban EV absurdos (visto con datos reales: un Market Max de 22.0 en
handicap asiatico cuando las casas individuales marcaban ~1.9)."""

from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db.models import League, Match, MatchOdds, MatchStatus, Season, Team
from app.probability.engine import _sane_price, fit_league_model, generate_predictions_for_match


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def test_sane_price_passes_through_when_within_range():
    assert _sane_price(2.0, [1.9, 2.0, 1.95]) == 2.0


def test_sane_price_clamps_outlier_to_best_individual_price():
    # Bug real: Market Max=22.0 con casas individuales en ~1.9-1.98
    assert _sane_price(22.0, [1.9, 1.95, 1.98]) == pytest.approx(1.98)


def test_sane_price_keeps_candidate_when_no_individual_odds_available():
    assert _sane_price(22.0, []) == 22.0


@pytest.fixture
def populated_league(db: Session):
    league = League(code="TEST-League", name="Test League")
    db.add(league)
    db.flush()
    season = Season(league_id=league.id, name="2425")
    db.add(season)
    db.flush()

    teams = [Team(name=f"Team {i}", league_id=league.id) for i in range(6)]
    db.add_all(teams)
    db.flush()

    # Historico suficiente para que el modelo tenga algo que ajustar.
    base_date = datetime(2024, 1, 1)
    for i in range(30):
        home, away = teams[i % 6], teams[(i + 1) % 6]
        m = Match(
            league_id=league.id,
            season_id=season.id,
            home_team_id=home.id,
            away_team_id=away.id,
            date=base_date + timedelta(days=i),
            home_goals=1 + (i % 3),
            away_goals=i % 2,
            status=MatchStatus.HISTORICAL,
        )
        db.add(m)
    db.flush()

    return league, season, teams


def test_generate_predictions_clamps_corrupted_aggregate_odds(db: Session, populated_league):
    league, season, teams = populated_league
    home, away = teams[0], teams[1]

    target_date = datetime(2024, 6, 1)
    match = Match(
        league_id=league.id,
        season_id=season.id,
        home_team_id=home.id,
        away_team_id=away.id,
        date=target_date,
        home_goals=1,
        away_goals=1,
        status=MatchStatus.HISTORICAL,
    )
    db.add(match)
    db.flush()

    # Casas individuales razonables...
    for bookmaker, home_odds, away_odds in [
        ("Bet365", 1.95, 1.9),
        ("Pinnacle", 1.98, 1.93),
    ]:
        db.add(
            MatchOdds(
                match_id=match.id,
                bookmaker=bookmaker,
                market="asian_handicap",
                selection="home",
                odds=home_odds,
                line=0.75,
                snapshot_time=target_date,
            )
        )
        db.add(
            MatchOdds(
                match_id=match.id,
                bookmaker=bookmaker,
                market="asian_handicap",
                selection="away",
                odds=away_odds,
                line=0.75,
                snapshot_time=target_date,
            )
        )

    # ...pero el agregado "Market Max" trae un valor corrupto (bug real de la fuente).
    db.add(
        MatchOdds(
            match_id=match.id,
            bookmaker="Market Average",
            market="asian_handicap",
            selection="home",
            odds=1.9,
            line=0.75,
            snapshot_time=target_date,
        )
    )
    db.add(
        MatchOdds(
            match_id=match.id,
            bookmaker="Market Average",
            market="asian_handicap",
            selection="away",
            odds=4.42,  # corrupto tambien en el average
            line=0.75,
            snapshot_time=target_date,
        )
    )
    db.add(
        MatchOdds(
            match_id=match.id,
            bookmaker="Market Max",
            market="asian_handicap",
            selection="home",
            odds=1.98,
            line=0.75,
            snapshot_time=target_date,
        )
    )
    db.add(
        MatchOdds(
            match_id=match.id,
            bookmaker="Market Max",
            market="asian_handicap",
            selection="away",
            odds=22.0,  # corrupto: dispara el EV si no se filtra
            line=0.75,
            snapshot_time=target_date,
        )
    )
    db.commit()

    model = fit_league_model(db, league.id, before_date=target_date)
    predictions = generate_predictions_for_match(db, match, model, ev_threshold=0.05)

    away_pred = next(p for p in predictions if p.market == "asian_handicap" and p.selection == "away")
    # Con el precio saneado (<=1.98 aprox), el EV no puede dispararse a 9-10.
    assert away_pred.ev < 1.0
