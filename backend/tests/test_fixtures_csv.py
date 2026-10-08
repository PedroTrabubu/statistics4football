"""Tests del calendario desde el fixtures.csv de Football-Data.co.uk y del
cambio de liga de los equipos que ascienden o descienden."""

from datetime import date, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db.models import League, Match, MatchOdds, MatchStatus, Season, Team
from app.ingestion import fixtures_csv
from app.ingestion.historical_backfill import season_name_for

CSV = (
    "﻿Div,Date,Time,HomeTeam,AwayTeam,AvgH,AvgD,AvgA,Avg>2.5,Avg<2.5\n"
    "SP2,10/10/2026,19:30,Girona,Huesca,1.80,3.40,4.50,2.10,1.72\n"
    "SP2,11/10/2026,12:00,Eibar,Burgos,2.00,3.10,3.90,2.30,1.60\n"
    "SP1,17/10/2026,20:00,Barcelona,Sevilla,1.30,5.50,9.00,1.50,2.60\n"
    "E0,17/10/2026,15:00,Arsenal,Chelsea,1.90,3.50,4.00,1.80,2.00\n"
)


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def setup(db: Session, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(fixtures_csv, "fetch_football_data_csv", lambda client, url: CSV.encode("utf-8"))

    laliga = League(code="ESP-La Liga", name="ESP-La Liga")
    segunda = League(code="ESP-La Liga 2", name="ESP-La Liga 2")
    db.add_all([laliga, segunda])
    db.flush()
    laliga_2526 = Season(league_id=laliga.id, name="2526")
    laliga_2627 = Season(league_id=laliga.id, name="2627")
    segunda_2627 = Season(league_id=segunda.id, name="2627")
    db.add_all([laliga_2526, laliga_2627, segunda_2627])
    db.flush()
    teams = {name: Team(name=name, league_id=laliga.id) for name in ("Girona", "Barcelona", "Sevilla")}
    teams |= {name: Team(name=name, league_id=segunda.id) for name in ("Eibar", "Burgos")}
    db.add_all(teams.values())
    db.flush()

    def add(league, season, home, away, when, status, goals=(None, None)):
        match = Match(
            league_id=league.id,
            season_id=season.id,
            home_team_id=teams[home].id,
            away_team_id=teams[away].id,
            date=when,
            status=status,
            home_goals=goals[0],
            away_goals=goals[1],
        )
        db.add(match)
        db.flush()
        return match

    # El Girona jugó la 25/26 en LaLiga y baja a la Hypermotion.
    add(laliga, laliga_2526, "Girona", "Barcelona", datetime(2026, 5, 10, 17), MatchStatus.HISTORICAL, (1, 2))
    played = add(segunda, segunda_2627, "Eibar", "Burgos", datetime(2026, 10, 11, 11), MatchStatus.HISTORICAL, (2, 0))
    # Partido de LaLiga ya creado por football-data.org, con cuotas de the-odds-api.com.
    barca = add(laliga, laliga_2627, "Barcelona", "Sevilla", datetime(2026, 10, 17, 19), MatchStatus.SCHEDULED)
    db.add(
        MatchOdds(
            match_id=barca.id,
            bookmaker="Market Average",
            market="1x2",
            selection="home",
            odds=1.35,
            line=None,
            snapshot_time=datetime(2026, 10, 15),
        )
    )
    db.commit()
    return {"laliga": laliga, "segunda": segunda, "teams": teams, "played": played, "barca": barca}


def _average_home_odds(db: Session, match_id: int) -> float:
    return (
        db.query(MatchOdds.odds)
        .filter_by(match_id=match_id, bookmaker="Market Average", market="1x2", selection="home")
        .scalar()
    )


def test_sync_creates_scheduled_matches_with_odds(db: Session, setup) -> None:
    run = fixtures_csv.sync_fixtures_csv(db, ["ESP-La Liga", "ESP-La Liga 2"], odds_api_leagues={"ESP-La Liga"})

    assert run.notes == "nuevos=1 actualizados=1 ya_jugados=1 con_cuotas=1"
    huesca = db.query(Team).filter_by(name="Huesca").one()
    match = db.query(Match).filter_by(home_team_id=setup["teams"]["Girona"].id, away_team_id=huesca.id).one()
    assert match.status == MatchStatus.SCHEDULED
    assert match.league_id == setup["segunda"].id
    assert match.season.name == "2627"
    # 19:30 en Reino Unido (horario de verano) son las 18:30 UTC.
    assert match.date == datetime(2026, 10, 10, 18, 30)
    assert _average_home_odds(db, match.id) == pytest.approx(1.80)


def test_sync_keeps_played_matches_and_odds_api_prices(db: Session, setup) -> None:
    fixtures_csv.sync_fixtures_csv(db, ["ESP-La Liga", "ESP-La Liga 2"], odds_api_leagues={"ESP-La Liga"})

    played = db.get(Match, setup["played"].id)
    assert played.status == MatchStatus.HISTORICAL
    assert db.query(MatchOdds).filter_by(match_id=played.id).count() == 0

    barca = db.get(Match, setup["barca"].id)
    assert _average_home_odds(db, barca.id) == pytest.approx(1.35)
    # Con football-data.org manda su hora UTC, no la del CSV.
    assert barca.date == datetime(2026, 10, 17, 19)
    # Ligas no activas (E0) se ignoran.
    assert db.query(League).filter_by(code="ENG-Premier League").count() == 0


def test_sync_moves_relegated_team_to_its_new_league(db: Session, setup) -> None:
    fixtures_csv.sync_fixtures_csv(db, ["ESP-La Liga", "ESP-La Liga 2"], odds_api_leagues=set())

    assert db.get(Team, setup["teams"]["Girona"].id).league_id == setup["segunda"].id
    assert db.get(Team, setup["teams"]["Barcelona"].id).league_id == setup["laliga"].id


@pytest.mark.parametrize(
    ("day", "season"),
    [(date(2026, 10, 6), "2627"), (date(2027, 5, 30), "2627"), (date(2026, 7, 1), "2627"), (date(2026, 6, 30), "2526")],
)
def test_season_name_for(day: date, season: str) -> None:
    assert season_name_for(day) == season
