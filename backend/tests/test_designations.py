"""Designaciones arbitrales oficiales: lectura de las tres APIs (respuestas
reales recortadas en tests/fixtures/designations), nombres en el formato de
la base y reglas al aplicarlas."""

import json
from datetime import datetime
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db.models import League, Match, MatchStatus, Season, Team
from app.ingestion import designations as des
from app.ingestion.designations import (
    Designation,
    LaLigaApi,
    Ligue1Api,
    PremierLeagueApi,
    apply_designations,
    collect_designations,
    laliga_person_name,
    tidy_name,
)
from app.ingestion.referee_overrides import apply_referee_overrides

FIXTURES = Path(__file__).parent / "fixtures" / "designations"


def _load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class FakeResponse:
    def __init__(self, payload=None, text=""):
        self._payload, self.text = payload, text

    def json(self):
        return self._payload


def fake_get(self, url, params=None):
    """Sirve las respuestas guardadas según la URL pedida."""
    self.requests += 1
    params = params or {}
    if url == des.LALIGA_PAGE:
        return FakeResponse(text='..."runtimeConfig":{"backendSubscription":"0123456789abcdef0123456789abcdef"}...')
    if url.endswith("/subscriptions/laliga-easports-2026"):
        assert params["subscription-key"] == "0123456789abcdef0123456789abcdef"  # la clave leída de la página
        return FakeResponse(_load("laliga_subscription.json"))
    if url.endswith("/matches") and "laliga.com" in url:
        week = params["week"]
        return FakeResponse(_load("laliga_matches.json") if week == 8 else {"matches": []})
    if url.endswith("/v2/matches"):
        return FakeResponse(_load("premier_matches.json"))
    if "/officials" in url:
        match_id = url.split("/matches/")[1].split("/")[0]
        return FakeResponse(_load("premier_officials.json")[match_id])
    if "championship-calendar" in url:
        return FakeResponse(_load("ligue1_calendar.json"))
    if "championship-match/" in url:
        return FakeResponse(_load("ligue1_matches.json")[url.rsplit("/", 1)[1]])
    raise AssertionError(f"URL inesperada: {url}")


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    monkeypatch.setattr(des._Http, "get", fake_get)


def test_names_in_the_shape_the_matcher_expects():
    assert tidy_name("Eric WATTELLIER") == "Eric Wattellier"
    assert tidy_name("Florian GONCALVES DE ARAUJO") == "Florian Goncalves de Araujo"
    assert tidy_name("Jérémy STINAT") == "Jérémy Stinat"
    assert tidy_name("Paul Tierney") == "Paul Tierney"
    # laliga.com: el más largo de nombre y apodo (los apellidos sueltos no sirven).
    assert laliga_person_name({"name": "Juan Miguel Gordillo Escamilla", "nickname": "Gordillo Escamilla",
                               "firstname": "Juan Miguel", "lastname": "Gordillo Escamilla"}) == "Juan Miguel Gordillo Escamilla"  # fmt: skip
    assert laliga_person_name({"name": "González Paez", "nickname": "Gonzalo González Paez"}) == "Gonzalo González Paez"
    assert laliga_person_name({}) is None


def test_laliga_api_reads_the_main_referee_and_skips_matches_without_one():
    with_ref = LaLigaApi().designations("ESP-La Liga", 2026)
    by_home = {d.home_names[0]: d for d in with_ref}
    assert by_home["Rayo Vallecano"].referee == "José María Sánchez Martínez"
    assert by_home["Rayo Vallecano"].kickoff == datetime(2026, 10, 10, 12, 0)
    assert by_home["Rayo Vallecano"].away_names[0] == "Athletic Club"
    assert by_home["Málaga CF"].referee == "Francisco José Hernández Maeso"  # ya jugado: también
    assert "Elche CF" not in by_home  # domingo: aún sin designar
    assert all(d.source == "laliga" for d in with_ref)


def test_laliga_key_falls_back_to_the_setting_and_fails_without_one(monkeypatch):
    def page_without_key(self, url, params=None):
        if url == des.LALIGA_PAGE:
            return FakeResponse(text="<html>sin runtimeConfig</html>")
        return fake_get(self, url, params)

    monkeypatch.setattr(des._Http, "get", page_without_key)
    assert LaLigaApi(fallback_key="fedcba9876543210fedcba9876543210").key() == "fedcba9876543210fedcba9876543210"
    with pytest.raises(ConnectionError, match="LALIGA_SUBSCRIPTION_KEY"):
        LaLigaApi(fallback_key="").key()


def test_premier_league_api_converts_london_time_to_utc():
    found = PremierLeagueApi().designations(2026, [6])
    by_home = {d.home_names[0]: d for d in found}
    assert by_home["Arsenal"].referee == "Paul Tierney"
    assert by_home["Arsenal"].kickoff == datetime(2026, 10, 10, 11, 30)  # 12:30 BST
    assert by_home["Arsenal"].away_names == ("Leeds United", "Leeds")


def test_ligue1_api_reads_type_1_official_and_tidies_the_name():
    found = Ligue1Api().designations(2026, datetime(2026, 10, 9), datetime(2026, 10, 12))
    by_home = {d.home_names[0]: d for d in found}
    assert by_home["Stade Brestois 29"].referee == "Eric Wattellier"
    assert by_home["Stade Brestois 29"].kickoff == datetime(2026, 10, 10, 18, 45)
    assert by_home["RC Lens"].referee == "Jérémy Stinat"
    # Una jornada fuera de la ventana no se pide.
    assert Ligue1Api().designations(2026, datetime(2027, 1, 1), datetime(2027, 1, 5)) == []


# --- aplicarlas a la base --------------------------------------------------------


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _setup(db: Session):
    leagues = {code: League(code=code, name=code) for code in ("ESP-La Liga", "ENG-Premier League")}
    db.add_all(leagues.values())
    db.flush()
    seasons = {code: Season(league_id=lg.id, name="2627") for code, lg in leagues.items()}
    db.add_all(seasons.values())
    names = {"ESP-La Liga": ("Vallecano", "Ath Bilbao", "Malaga", "Espanol", "Barcelona", "Getafe"),
             "ENG-Premier League": ("Arsenal", "Leeds")}  # fmt: skip
    teams = {n: Team(name=n, league_id=leagues[code].id) for code, ns in names.items() for n in ns}
    db.add_all(teams.values())
    db.flush()

    def match(code, home, away, when, status=MatchStatus.SCHEDULED, referee=None):
        m = Match(league_id=leagues[code].id, season_id=seasons[code].id, home_team_id=teams[home].id,
                  away_team_id=teams[away].id, date=when, status=status, referee=referee,
                  matchday=6 if code == "ENG-Premier League" else 8)  # fmt: skip
        db.add(m)
        return m

    ms = {
        "rayo": match("ESP-La Liga", "Vallecano", "Ath Bilbao", datetime(2026, 10, 10, 12)),
        "malaga": match("ESP-La Liga", "Malaga", "Espanol", datetime(2026, 10, 9, 19), MatchStatus.HISTORICAL, "F Hernández Maeso"),
        "barca": match("ESP-La Liga", "Barcelona", "Getafe", datetime(2026, 10, 10, 16, 30), referee="X Otro"),
        "arsenal": match("ENG-Premier League", "Arsenal", "Leeds", datetime(2026, 10, 10, 11, 30)),
        # Nombres que ya existen en la base, en su formato.
        "old": match("ESP-La Liga", "Getafe", "Malaga", datetime(2026, 9, 1), MatchStatus.HISTORICAL, "J Sánchez Martínez"),
        "old_pl": match("ENG-Premier League", "Leeds", "Arsenal", datetime(2026, 9, 1), MatchStatus.HISTORICAL, "P Tierney"),
    }
    db.commit()
    return ms


def test_apply_uses_the_database_name_format_and_the_rules(db):
    ms = _setup(db)
    found = [
        Designation("laliga", "ESP-La Liga", datetime(2026, 10, 10, 12), ("Rayo Vallecano",), ("Athletic Club", "Athletic"),
                    "José María Sánchez Martínez"),
        Designation("laliga", "ESP-La Liga", datetime(2026, 10, 9, 19), ("Málaga CF",), ("RCD Espanyol de Barcelona", "Espanyol"),
                    "Otro Árbitro Distinto"),
        Designation("laliga", "ESP-La Liga", datetime(2026, 10, 10, 16, 30), ("FC Barcelona", "Barcelona"), ("Getafe CF", "Getafe"),
                    "Jesús Gil Manzano"),
        Designation("premierleague", "ENG-Premier League", datetime(2026, 10, 10, 11, 30), ("Arsenal",), ("Leeds United", "Leeds"),
                    "Paul Tierney"),
        Designation("laliga", "ENG-Premier League", datetime(2026, 10, 10, 11, 30), ("Arsenal",), ("Leeds",), "Chris Kavanagh"),
        Designation("laliga", "ESP-La Liga", datetime(2026, 10, 11, 12), ("Equipo Raro FC",), ("Getafe",), "Nadie"),
    ]  # fmt: skip
    result = apply_designations(db, found)

    assert db.get(Match, ms["rayo"].id).referee == "J Sánchez Martínez"  # el nombre que ya había
    assert db.get(Match, ms["malaga"].id).referee == "F Hernández Maeso"  # jugado con árbitro: no se toca
    assert db.get(Match, ms["barca"].id).referee == "J Gil Manzano"  # por jugar: manda la designación
    assert db.get(Match, ms["arsenal"].id).referee == "P Tierney"  # manda la oficial
    assert result.updated == 3 and result.skipped_played == 1 and result.unmatched == 1
    assert result.new_names == ["J Gil Manzano (Jesús Gil Manzano)"]
    assert len(result.conflicts) == 1 and "P Tierney (premierleague)" in result.conflicts[0]
    assert result.unresolved == {"Equipo Raro FC"}

    again = apply_designations(db, found)  # idempotente
    assert again.updated == 0 and again.unchanged == 3


def test_manual_referees_still_win_after_designations(db, tmp_path):
    ms = _setup(db)
    apply_designations(db, [Designation("laliga", "ESP-La Liga", datetime(2026, 10, 10, 12), ("Rayo Vallecano",),
                                        ("Athletic Club",), "José María Sánchez Martínez")])  # fmt: skip
    db.commit()
    path = tmp_path / "arbitros.csv"
    path.write_text("liga,fecha,local,visitante,arbitro,fuente_1,fuente_2\n"
                    "ESP-La Liga,2026-10-10,Vallecano,Ath Bilbao,A Manual,a,b\n", encoding="utf-8")  # fmt: skip
    apply_referee_overrides(db, path)
    assert db.get(Match, ms["rayo"].id).referee == "A Manual"


def test_a_failing_source_does_not_stop_the_others(db, monkeypatch):
    _setup(db)

    def broken(self, *args, **kwargs):
        raise ConnectionError("503 en premierleague.com")

    monkeypatch.setattr(PremierLeagueApi, "designations", broken)
    errors: list[str] = []
    found, requests = collect_designations(db, ["ENG-Premier League", "ESP-La Liga"], 2026, datetime(2026, 10, 10, 9), errors)
    assert errors and "premierleague" in errors[0]
    assert {d.source for d in found} == {"laliga"}
    assert requests > 0
