"""Tests de los árbitros y el calendario de ESPN."""

from datetime import date, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db.models import League, Match, MatchStatus, Season, Team
from app.ingestion import espn
from app.ingestion.espn import EspnEvent, RefereeNames, _parse_event


def _raw_event(event_id, home, away, when, *, slug="regular-season", time_valid=True, completed=False, score=("0", "0")):
    return {
        "id": event_id,
        "date": when,
        "season": {"year": 2026, "slug": slug},
        "status": {"type": {"completed": completed}},
        "competitions": [
            {
                "timeValid": time_valid,
                "competitors": [
                    {"homeAway": "away", "team": {"displayName": away, "shortDisplayName": away}, "score": score[1]},
                    {"homeAway": "home", "team": {"displayName": home, "shortDisplayName": home}, "score": score[0]},
                ],
            }
        ],
    }


def _event(event_id, home, away, when, *, time_known=True, completed=False, score=(None, None)):
    return EspnEvent(event_id, when, time_known, (home,), (away,), completed, home_score=score[0], away_score=score[1])


def test_parse_event_uses_home_away_flags_and_tells_playoffs_apart():
    event = _parse_event(_raw_event("1", "Real Valladolid", "Córdoba", "2026-09-27T12:00Z", completed=True))
    assert (event.home_names[0], event.away_names[0], event.completed) == ("Real Valladolid", "Córdoba", True)
    assert event.is_league_match
    assert _parse_event(_raw_event("2", "Sevilla", "Granada", "2020-10-17T19:00Z", slug="2020-2021-laliga")).is_league_match
    playoff = _parse_event(_raw_event("3", "Espanyol", "Real Oviedo", "2024-06-16T19:00Z", slug="promotion-finals"))
    assert not playoff.is_league_match


def test_parse_event_keeps_the_score_only_when_finished():
    finished = _parse_event(_raw_event("1", "Leganés", "Córdoba", "2026-10-16T18:30Z", completed=True, score=("0", "1")))
    assert (finished.home_score, finished.away_score, finished.has_score) == (0, 1, True)
    # Por jugar, ESPN da "0" - "0": no es un marcador.
    pending = _parse_event(_raw_event("2", "Celta Fortuna", "Tenerife", "2026-10-19T18:30Z"))
    assert (pending.home_score, pending.away_score, pending.has_score) == (None, None, False)


def test_provisional_kickoff_is_stored_as_unknown_time_on_its_madrid_day():
    known = _event("1", "A", "B", "2026-10-11T16:30Z")
    assert known.stored_kickoff == datetime(2026, 10, 11, 16, 30)
    # 23:30 UTC ya es el día siguiente en Madrid.
    provisional = _event("2", "A", "B", "2027-01-17T23:30Z", time_known=False)
    assert provisional.stored_kickoff == datetime(2027, 1, 18)


def test_referee_names_follow_the_existing_format():
    names = RefereeNames({"R de Burgos", "J Munuera Montero", "J Martínez Munuera", "A Hernández Hernández"})
    assert names.canonical("Ricardo De Burgos Bengoetxea") == "R de Burgos"
    assert names.canonical("José Luis Munuera Montero") == "J Munuera Montero"
    assert names.canonical("Alejandro Hernandez Hernandez") == "A Hernández Hernández"
    assert names.canonical("Gonzalo Romero Freixas") == "G Romero Freixas"
    # Ya conocido: el siguiente partido del mismo árbitro sale igual.
    assert names.canonical("Gonzalo Romero Freixas") == "G Romero Freixas"


def test_referee_names_keep_espn_name_when_ambiguous():
    names = RefereeNames({"J Sánchez Martínez", "J Sánchez López"})
    assert names.canonical("Javier Sánchez") == "J Sánchez"


class FakeClient:
    def __init__(self, days: dict, referees: dict):
        self.days = days
        self.referees = referees
        self.asked: list[str] = []
        self.requests = 0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def season_days(self, league, start_year):
        return sorted(day for (lg, day) in self.days if lg == league)

    def day_events(self, league, day, cacheable):
        return self.days.get((league, day), [])

    def referee(self, league, event_id, cacheable):
        self.asked.append(event_id)
        return self.referees.get(event_id)


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def setup(db: Session):
    laliga = League(code="ESP-La Liga", name="ESP-La Liga")
    segunda = League(code="ESP-La Liga 2", name="ESP-La Liga 2")
    db.add_all([laliga, segunda])
    db.flush()
    laliga_2627 = Season(league_id=laliga.id, name="2627")
    segunda_2627 = Season(league_id=segunda.id, name="2627")
    db.add_all([laliga_2627, segunda_2627])
    db.flush()
    teams = {name: Team(name=name, league_id=laliga.id) for name in ("Barcelona", "Sevilla", "Betis")}
    teams |= {name: Team(name=name, league_id=segunda.id) for name in ("Eibar", "Burgos", "Huesca", "Sp Gijon")}
    db.add_all(teams.values())
    db.flush()

    def add(league, season, home, away, when, status, referee=None):
        match = Match(
            league_id=league.id,
            season_id=season.id,
            home_team_id=teams[home].id,
            away_team_id=teams[away].id,
            date=when,
            status=status,
            referee=referee,
        )
        db.add(match)
        db.flush()
        return match

    matches = {
        "eibar_burgos": add(segunda, segunda_2627, "Eibar", "Burgos", datetime(2026, 10, 4, 12), MatchStatus.HISTORICAL),
        "burgos_huesca": add(segunda, segunda_2627, "Burgos", "Huesca", datetime(2026, 10, 4, 14), MatchStatus.HISTORICAL),
        # Hora ya fijada por el fixtures.csv.
        "huesca_eibar": add(segunda, segunda_2627, "Huesca", "Eibar", datetime(2026, 10, 11, 16, 30), MatchStatus.SCHEDULED),
        # Con árbitro de football-data.org.
        "barca_sevilla": add(
            laliga, laliga_2627, "Barcelona", "Sevilla", datetime(2026, 10, 4, 17), MatchStatus.HISTORICAL, "R de Burgos"
        ),
        "betis_sevilla": add(laliga, laliga_2627, "Betis", "Sevilla", datetime(2026, 10, 4, 19), MatchStatus.HISTORICAL),
        "sevilla_barca": add(laliga, laliga_2627, "Sevilla", "Barcelona", datetime(2026, 9, 27, 19), MatchStatus.HISTORICAL),
    }
    db.commit()
    return teams, matches


def _run(db, monkeypatch, client):
    monkeypatch.setattr(espn, "EspnClient", lambda: client)
    return espn.sync_espn(db, ["ESP-La Liga", "ESP-La Liga 2"], ["2627"], "2627", now=datetime(2026, 10, 8, 12))


def test_sync_fills_referees_and_builds_the_hypermotion_calendar(db, setup, monkeypatch):
    teams, matches = setup
    client = FakeClient(
        days={
            ("esp.2", date(2026, 10, 4)): [
                _event("21", "Eibar", "Burgos", "2026-10-04T12:00Z", completed=True),
                _event("24", "Burgos", "Huesca", "2026-10-04T14:00Z", completed=True),
            ],
            ("esp.2", date(2026, 10, 12)): [
                _event("22", "Huesca", "Eibar", "2026-10-12T20:00Z", time_known=False),
            ],
            ("esp.2", date(2026, 10, 18)): [
                _event("23", "Sporting Gijón", "Huesca", "2026-10-18T20:00Z", time_known=False),
            ],
            ("esp.1", date(2026, 10, 4)): [
                _event("11", "Betis", "Sevilla", "2026-10-04T19:00Z", completed=True),
                # Ya tiene árbitro de football-data.org: no se pregunta.
                _event("12", "Barcelona", "Sevilla", "2026-10-04T17:00Z", completed=True),
                # LaLiga tiene su calendario en football-data.org: no se crean partidos.
                _event("13", "Betis", "Barcelona", "2026-10-25T19:00Z"),
            ],
            # Mismo emparejamiento pero a más de 3 días: no es ese partido.
            ("esp.1", date(2026, 9, 27)): [_event("14", "Sevilla", "Barcelona", "2026-10-04T19:00Z", completed=True)],
        },
        referees={
            "21": "Gonzalo Romero Freixas",
            "24": "Ricardo De Burgos Bengoetxea",
            "11": "Ricardo De Burgos Bengoetxea",
            "14": "Otro Árbitro",
        },
    )
    run = _run(db, monkeypatch, client)

    assert matches["eibar_burgos"].referee == "G Romero Freixas"
    # El nombre de LaLiga vale también en la Hypermotion: mismo país.
    assert matches["burgos_huesca"].referee == "R de Burgos"
    assert matches["betis_sevilla"].referee == "R de Burgos"
    assert matches["barca_sevilla"].referee == "R de Burgos"
    assert matches["sevilla_barca"].referee is None
    assert "12" not in client.asked and "14" not in client.asked
    # La hora provisional de ESPN no pisa la ya fijada.
    assert matches["huesca_eibar"].date == datetime(2026, 10, 11, 16, 30)

    created = db.query(Match).filter_by(home_team_id=teams["Sp Gijon"].id).one()
    assert (created.status, created.date) == (MatchStatus.SCHEDULED, datetime(2026, 10, 18))
    assert created.source_ids == {"espn_event_id": "23"}
    assert db.query(Match).filter_by(home_team_id=teams["Betis"].id, away_team_id=teams["Barcelona"].id).count() == 0
    assert "creados=1" in run.notes and "fecha_distinta=1" in run.notes


def test_sync_updates_a_provisional_date_when_espn_fixes_the_time(db, setup, monkeypatch):
    _, matches = setup
    matches["huesca_eibar"].date = datetime(2026, 10, 11)
    db.commit()
    client = FakeClient(
        days={("esp.2", date(2026, 10, 10)): [_event("22", "Huesca", "Eibar", "2026-10-10T14:00Z")]},
        referees={},
    )
    _run(db, monkeypatch, client)
    assert matches["huesca_eibar"].date == datetime(2026, 10, 10, 14)


def test_sync_writes_the_provisional_hypermotion_score(db, setup, monkeypatch):
    _, matches = setup
    # Jugado hace 5 días, fuera de la ventana del calendario, y aún sin marcador.
    matches["huesca_eibar"].date = datetime(2026, 10, 3, 16, 30)
    # Ya con el marcador del CSV: no se toca.
    matches["eibar_burgos"].home_goals, matches["eibar_burgos"].away_goals = 1, 0
    # LaLiga tiene el marcador de football-data.org: tampoco.
    matches["betis_sevilla"].status = MatchStatus.SCHEDULED
    db.commit()
    client = FakeClient(
        days={
            ("esp.2", date(2026, 10, 3)): [
                _event("22", "Huesca", "Eibar", "2026-10-03T16:30Z", completed=True, score=(2, 3)),
            ],
            ("esp.2", date(2026, 10, 4)): [
                _event("21", "Eibar", "Burgos", "2026-10-04T12:00Z", completed=True, score=(2, 0)),
            ],
            ("esp.1", date(2026, 10, 4)): [
                _event("11", "Betis", "Sevilla", "2026-10-04T19:00Z", completed=True, score=(1, 1)),
            ],
        },
        referees={},
    )
    run = _run(db, monkeypatch, client)

    huesca_eibar = matches["huesca_eibar"]
    assert (huesca_eibar.status, huesca_eibar.home_goals, huesca_eibar.away_goals) == (MatchStatus.HISTORICAL, 2, 3)
    assert (huesca_eibar.home_ht_goals, huesca_eibar.away_ht_goals) == (None, None)
    assert (matches["eibar_burgos"].home_goals, matches["eibar_burgos"].away_goals) == (1, 0)
    assert matches["betis_sevilla"].status == MatchStatus.SCHEDULED
    assert matches["betis_sevilla"].home_goals is None
    assert "resultados=1" in run.notes
