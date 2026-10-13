"""Champions League desde ESPN: lectura del marcador y del resumen, jornadas
(fase de liga y eliminatorias), carga en la base y que las ligas no vean sus
partidos en la forma de los equipos."""

from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db.models import League, Match, MatchStatus, Season, Team, TeamMatchStats
from app.ingestion import champions as ucl
from app.ingestion.champions import (
    league_phase_matchdays,
    matchday_of,
    ninety_minutes,
    parse_event,
    parse_summary,
    sync_champions,
)
from app.stats.features import compute_match_features


def _raw_event(event_id: str, home: str, away: str, stage: str, leg: int | None, status: str, completed: bool, score=("1", "1")) -> dict:
    return {
        "id": event_id,
        "date": "2026-03-11T20:00Z",
        "season": {"slug": stage},
        "status": {"type": {"name": status, "completed": completed}},
        "competitions": [
            {
                "timeValid": True,
                "leg": {"value": leg} if leg else None,
                "competitors": [
                    {"homeAway": "home", "team": {"displayName": home}, "score": score[0]},
                    {"homeAway": "away", "team": {"displayName": away}, "score": score[1], "shootoutScore": 3},
                ],
            }
        ],
    }


def _summary(home_lines: list[int], away_lines: list[int]) -> dict:
    def box(corners: int) -> list[dict]:
        return [{"name": "wonCorners", "displayValue": str(corners)}, {"name": "yellowCards", "displayValue": "2"}]

    return {
        "header": {
            "competitions": [
                {
                    "competitors": [
                        {"homeAway": "home", "linescores": [{"displayValue": str(g)} for g in home_lines]},
                        {"homeAway": "away", "linescores": [{"displayValue": str(g)} for g in away_lines]},
                    ]
                }
            ]
        },
        "gameInfo": {"officials": [{"displayName": "Halil Meler", "order": 1}]},
        "boxscore": {
            "teams": [{"homeAway": "home", "statistics": box(7)}, {"homeAway": "away", "statistics": box(3)}]
        },
    }


def test_event_and_summary_parsing():
    event = parse_event(_raw_event("1", "Real Madrid", "Bayern Munich", "round-of-16", 2, "STATUS_FINAL_PEN", True, ("2", "2")))
    assert event["stage"] == "round-of-16" and event["leg"] == 2 and event["completed"]
    assert event["home"] == {"names": ["Real Madrid"], "score": 2, "shootout": None}
    assert event["away"]["shootout"] == 3
    summary = parse_summary(_summary([0, 1, 1], [1, 0, 1]))
    assert summary["lines"] == {"home": [0, 1, 1], "away": [1, 0, 1]}  # 1ª, 2ª y prórroga
    assert summary["referee"] == "Halil Meler"
    assert summary["box"]["home"]["corners_for"] == 7


def test_ninety_minutes_only_trusts_consistent_halves():
    def event(status, home, away):
        return {"status": status, "home": {"score": home}, "away": {"score": away}}

    assert ninety_minutes(event("STATUS_FULL_TIME", 2, 1), {"home": [1, 1], "away": [0, 1]}) == (2, 1, 1, 0)
    assert ninety_minutes(event("STATUS_FINAL_AET", 2, 1), {"home": [0, 1, 1], "away": [1, 0, 0]}) == (1, 1, 0, 1)
    # Final 25/26 en ESPN: partes 0+2 y 1+1 con un 1-1 total; no cuadran.
    assert ninety_minutes(event("STATUS_FINAL_PEN", 1, 1), {"home": [0, 2, -1, 0, 4], "away": [1, 1, -1, 0, 3]}) == (1, 1, None, None)


def test_matchdays_league_phase_and_knockouts():
    assert matchday_of("league-phase", None) is None
    assert matchday_of("knockout-round-playoffs", 1) == 9
    assert matchday_of("round-of-16", 2) == 12
    assert matchday_of("semifinals", 1) == 15
    assert matchday_of("final", None) == 17

    def m(i, h, a, day):
        return Match(id=i, home_team_id=h, away_team_id=a, date=datetime(2025, 9, day))

    # Cuatro equipos, dos jornadas; el aplazado (id 4) sigue en la jornada de su equipo.
    rounds = league_phase_matchdays([m(1, 1, 2, 16), m(2, 3, 4, 17), m(3, 1, 3, 30), m(4, 2, 4, 30)])
    assert rounds == {1: 1, 2: 1, 3: 2, 4: 2}


class _FakeCache(dict):
    def put(self, key, value):
        self[key] = value


class _FakeEspn:
    """Responde como ESPN con un día de octavos: vuelta con prórroga y una ida por jugar."""

    def __init__(self, *args, **kwargs):
        self.requests = 0
        self.caches: dict[str, _FakeCache] = {}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return None

    def _cache(self, name):
        return self.caches.setdefault(name, _FakeCache())

    def _get(self, path, params):
        self.requests += 1
        if path.endswith("/summary"):
            return _summary([0, 1, 1], [0, 1, 0])
        if params["dates"].endswith("1015"):
            entry = {"startDate": "2026-03-11T00:00Z", "endDate": "2026-03-11T23:59Z"}
            return {"leagues": [{"season": {"year": 2025}, "calendar": [{"entries": [entry]}]}]}
        return {
            "events": [
                _raw_event("10", "Real Madrid", "Bayern Munich", "round-of-16", 2, "STATUS_FINAL_AET", True, ("2", "1")),
                _raw_event("11", "Bayern Munich", "Real Madrid", "quarterfinals", 1, "STATUS_SCHEDULED", False, ("0", "0")),
            ]
        }


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def test_sync_creates_matches_with_90_minute_score_and_new_teams(db, monkeypatch):
    laliga = League(code="ESP-La Liga", name="LaLiga")
    db.add(laliga)
    db.flush()
    db.add(Team(name="Real Madrid", league_id=laliga.id))
    db.commit()
    monkeypatch.setattr(ucl, "EspnClient", _FakeEspn)

    run = sync_champions(db, ["2526"], now=datetime(2026, 3, 20))
    assert run.status.value == "success" and "Bayern Munich" in run.notes

    league = db.query(League).filter_by(code=ucl.LEAGUE_CODE).one()
    rm, bayern = db.query(Team).filter_by(name="Real Madrid").one(), db.query(Team).filter_by(name="Bayern Munich").one()
    assert rm.league_id == laliga.id  # el mismo Real Madrid de LaLiga
    assert bayern.league_id == league.id
    played, upcoming = sorted(db.query(Match).filter_by(league_id=league.id), key=lambda m: m.matchday)
    # Prórroga fuera: 1-1 a los 90 (ESPN da 2-1), 0-0 al descanso.
    assert (played.home_goals, played.away_goals, played.home_ht_goals, played.away_ht_goals) == (1, 1, 0, 0)
    assert played.status == MatchStatus.HISTORICAL and played.matchday == 12 and played.referee == "H Meler"
    assert played.source_ids == {"espn_event_id": "10", "stage": "round-of-16", "leg": 2}
    assert (upcoming.status, upcoming.matchday, upcoming.home_team_id) == (MatchStatus.SCHEDULED, 13, bayern.id)
    corners = {s.team_id: (s.corners_for, s.corners_against) for s in db.query(TeamMatchStats).filter_by(match_id=played.id)}
    assert corners == {rm.id: (7, 3), bayern.id: (3, 7)}

    # Volver a cargar no duplica.
    sync_champions(db, ["2526"], now=datetime(2026, 3, 20))
    assert db.query(Match).filter_by(league_id=league.id).count() == 2


def test_league_form_ignores_champions_and_champions_form_includes_league(db):
    laliga, champions = League(code="ESP-La Liga", name="LaLiga"), League(code=ucl.LEAGUE_CODE, name="Champions League")
    db.add_all([laliga, champions])
    db.flush()
    s_liga, s_ucl = Season(league_id=laliga.id, name="2627"), Season(league_id=champions.id, name="2627")
    teams = [Team(name=n, league_id=laliga.id) for n in ("Real Madrid", "Getafe", "Elche")]
    db.add_all([s_liga, s_ucl, *teams])
    db.flush()
    rm, getafe, elche = teams

    def match(league, season, home, away, day, status=MatchStatus.HISTORICAL, goals=(2, 0)):
        m = Match(league_id=league.id, season_id=season.id, home_team_id=home.id, away_team_id=away.id,
                  date=datetime(2026, 9, day), status=status, home_goals=goals[0], away_goals=goals[1])  # fmt: skip
        db.add(m)
        return m

    match(laliga, s_liga, rm, getafe, 1)
    match(champions, s_ucl, rm, elche, 8, goals=(0, 3))
    liga_next = match(laliga, s_liga, rm, elche, 15, MatchStatus.SCHEDULED, (None, None))
    ucl_next = match(champions, s_ucl, rm, getafe, 16, MatchStatus.SCHEDULED, (None, None))
    db.commit()

    liga_form = compute_match_features(db, liga_next).home_form
    ucl_form = compute_match_features(db, ucl_next).home_form
    assert (liga_form.matches_played, liga_form.wins) == (1, 1)  # sin la derrota de Champions
    assert (ucl_form.matches_played, ucl_form.wins, ucl_form.losses) == (2, 1, 1)
