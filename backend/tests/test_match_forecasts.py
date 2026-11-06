"""Duelo de corners y predictor de estadisticas en el backend
(app/probability/corner_duel.py, stats_predictor.py y match_forecasts.py):
las mismas cifras que el codigo de la web, solo partidos anteriores, y
generacion incremental con filas congeladas al inicio."""

import math
from datetime import datetime, timedelta
from types import SimpleNamespace

import numpy as np
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.competitions import CHAMPIONS_LEAGUE
from app.db.base import Base
from app.db.models import League, Match, MatchForecast, MatchStatus, Season, Team, TeamMatchStats
from app.probability import match_forecasts as mf
from app.probability.corner_duel import StatHistory, corner_duel_forecast, count_pmf, duel_probabilities
from app.probability.stats_predictor import CAP, STAT_KEYS, ModelSettings, predict_stats, stat_forecast_with

# --- Las mismas cifras que frontend/src/lib (cornerDuel.ts, statsPredictor.ts) --

# Liga de 80 partidos entre 12 equipos (dias antes del partido: 1, 3.5, 6...),
# con estadisticas variadas, xG que falta, una falta que falta, corners de 18 y
# cuatro arbitros (alguno sin designar).
NAN = math.nan


def _fixture() -> list[dict]:
    rows = []
    for i in range(80):
        home, away = 1 + i % 12, 1 + (i * 5 + 3) % 12
        if away == home:
            away = home % 12 + 1
        xg_missing = i % 9 == 0
        rows.append({
            "days": -(1 + i * 2.5), "home": home, "away": away,
            "referee": None if i % 15 == 7 else "ABCD"[i % 4],
            "h": {"xg": NAN if xg_missing else 0.5 + (i % 7) * 0.21, "shots": 8 + (i * 3) % 11,
                  "shots_on_target": 2 + i % 6, "corners": 18 if i % 17 == 0 else 2 + (i * 7) % 13,
                  "fouls": NAN if i % 10 == 4 else 9 + i % 8, "yellow_cards": i % 5,
                  "red_cards": 1 if i % 13 == 0 else 0},
            "a": {"xg": NAN if xg_missing else 0.4 + ((i * 2) % 9) * 0.15, "shots": 6 + (i * 5) % 10,
                  "shots_on_target": 1 + (i * 2) % 7, "corners": 1 + (i * 3) % 10, "fouls": 10 + (i * 3) % 7,
                  "yellow_cards": (i * 3) % 6, "red_cards": 1 if i % 11 == 0 else 0},
        })  # fmt: skip
    return rows


def _histories(rows: list[dict]) -> dict[str, StatHistory]:
    return {
        key: StatHistory([r["days"] for r in rows], [r["home"] for r in rows], [r["away"] for r in rows],
                         [r["h"][key] for r in rows], [r["a"][key] for r in rows], [r["referee"] for r in rows],
                         CAP.get(key, math.inf))  # fmt: skip
        for key in STAT_KEYS
    }


# Sacadas de la web (TZ=UTC): local 1 contra visitante 2, arbitro "B".
WEB_DUEL = (9.193760431346455, 4.834083912977609, 0.7831342068304381, 0.05964781471527097, 0.15721797845429092, 7, 7)
WEB_STATS = {
    "xg": (1.2085778947930002, 1.0398569766965646, 8, 14, "all", None),
    "shots": (15.337972568911983, 6.986151143436808, 13, 14, "all", None),
    "shots_on_target": (3.517665317264037, 3.641308872863105, 13, 14, "all", None),
    "corners": (9.406067846408526, 5.1829235426411815, 13, 14, "all", None),
    "fouls": (11.986338394859066, 12.479962499553894, 12, 12, "all", None),
    "yellow_cards": (2.5189286245868865, 0.9954130249861981, 13, 14, "all", (0.9480030133230096, 19)),
    "red_cards": (0.23462430017561114, 0.04391779781926314, 7, 7, "venue", (0.9275789361330088, 19)),
}


def test_same_figures_as_the_web():
    histories = _histories(_fixture())
    duel = corner_duel_forecast(histories["corners"].before(0.0), 1, 2)
    got = (duel.home_expected, duel.away_expected, duel.home, duel.draw, duel.away, duel.home_matches, duel.away_matches)
    assert got == pytest.approx(WEB_DUEL, rel=1e-12)

    stats = predict_stats(histories, 0.0, 1, 2, "B")
    for key, (home, away, home_n, away_n, scope, referee) in WEB_STATS.items():
        f = stats[key]
        assert (f.home, f.away) == pytest.approx((home, away), rel=1e-12), key
        assert (f.home_matches, f.away_matches, f.scope) == (home_n, away_n, scope), key
        if referee is None:
            assert f.referee is None
        else:
            assert (f.referee.factor, f.referee.matches) == (pytest.approx(referee[0], rel=1e-12), referee[1])


def test_cards_need_a_referee_and_unknown_referee_is_neutral():
    histories = _histories(_fixture())
    without = predict_stats(histories, 0.0, 3, 4, None)
    assert without["yellow_cards"] is None and without["red_cards"] is None
    assert without["shots"] is not None
    # Arbitro sin partidos y visitante sin historial: factor 1, la liga para el visitante.
    new = predict_stats(histories, 0.0, 5, 99, "Z")
    assert (new["yellow_cards"].referee.factor, new["yellow_cards"].referee.matches) == (1.0, 0)
    assert new["yellow_cards"].home == pytest.approx(2.350431609246371, rel=1e-12)
    assert new["shots"].away_matches == 0


def test_only_earlier_matches_count():
    rows = _fixture()
    before = predict_stats(_histories(rows), 0.0, 1, 2, "B")
    same_time = rows[0] | {"days": 0.0, "h": {k: 40 for k in STAT_KEYS}}
    later = rows[1] | {"days": 3.0, "h": {k: 40 for k in STAT_KEYS}}
    assert predict_stats(_histories([*rows, same_time, later]), 0.0, 1, 2, "B") == before
    assert corner_duel_forecast(_histories([])["corners"].before(0.0), 1, 2) is None


def test_distributions_and_venue_model_match_the_duel():
    for alpha in (0.0, 0.1):
        pmf = count_pmf(5, alpha)
        assert pmf.sum() == pytest.approx(1)
        assert (pmf * np.arange(len(pmf))).sum() == pytest.approx(5, abs=1e-3)
    home, draw, away = duel_probabilities(count_pmf(5, 0.05), count_pmf(5, 0.05))
    assert home == pytest.approx(away) and home + draw + away == pytest.approx(1)
    # En corners, la configuracion publicada (cada equipo en su campo) da los esperados del duelo.
    samples = _histories(_fixture())["corners"].before(0.0)
    venue = stat_forecast_with(samples, 1, 2, ModelSettings("venue", 0.0018, 5))
    duel = corner_duel_forecast(samples, 1, 2)
    assert (venue.home, venue.away) == pytest.approx((duel.home_expected, duel.away_expected), rel=1e-12)


# --- Generacion y lectura --------------------------------------------------------

DAY0 = datetime(2026, 8, 15, 18, 0)


ACTIVE = ["ENG-Premier League", "ESP-La Liga", CHAMPIONS_LEAGUE]


@pytest.fixture
def db(monkeypatch) -> Session:
    # Las ligas de la web, sin depender del .env; NED-Eredivisie queda como de contexto.
    monkeypatch.setattr(mf, "get_settings", lambda: SimpleNamespace(leagues=ACTIVE))
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _league(db: Session, code: str, n_teams: int = 6, days: int = 12, scheduled: int = 2):
    """Una liga con una jornada al dia (los primeros `days` jugados, con
    estadisticas) y `scheduled` jornadas programadas despues."""
    league = League(code=code, name=code)
    db.add(league)
    db.flush()
    season = Season(league_id=league.id, name="2627")
    db.add(season)
    db.flush()
    teams = [Team(name=f"{code} {i}", league_id=league.id) for i in range(n_teams)]
    db.add_all(teams)
    db.flush()
    rng = np.random.default_rng(len(code))
    matches = []
    for d in range(days + scheduled):
        perm = rng.permutation(n_teams)
        for k in range(0, n_teams, 2):
            home, away = teams[perm[k]], teams[perm[k + 1]]
            played = d < days
            m = Match(league_id=league.id, season_id=season.id, date=DAY0 + timedelta(days=d), home_team_id=home.id,
                      away_team_id=away.id, home_goals=1 if played else None, away_goals=0 if played else None,
                      status=MatchStatus.HISTORICAL if played else MatchStatus.SCHEDULED,
                      referee=f"R{(d + k) % 3}")  # fmt: skip
            db.add(m)
            db.flush()
            if played:
                for team in (home, away):
                    db.add(TeamMatchStats(match_id=m.id, team_id=team.id, corners_for=int(rng.integers(1, 12)),
                                          shots=int(rng.integers(5, 20)), shots_on_target=int(rng.integers(1, 8)),
                                          fouls=int(rng.integers(6, 16)), yellow_cards=int(rng.integers(0, 5)),
                                          red_cards=0, xg=float(rng.uniform(0.2, 2.5))))  # fmt: skip
            matches.append(m)
    db.flush()
    return league, matches


def _rows(db: Session) -> dict[tuple[int, str, str], MatchForecast]:
    return {(r.match_id, r.model, r.stat): r for r in db.query(MatchForecast)}


def test_generation_reconstructs_played_and_freezes_scheduled(db):
    _, matches = _league(db, "ENG-Premier League")
    now = DAY0 + timedelta(days=12, hours=-6)  # antes de la primera jornada programada
    summary = mf.generate_match_forecasts(db, now=now)
    rows = _rows(db)
    assert summary.reconstructed == 36 and summary.frozen == 6
    # Una fila de duelo y siete del predictor por partido.
    assert len(rows) == len(matches) * (1 + len(STAT_KEYS))
    played, scheduled = matches[3], matches[-1]
    assert rows[(played.id, mf.CORNER_DUEL, "corners")].kind == mf.KIND_RECONSTRUCTED
    assert rows[(scheduled.id, mf.STATS_PREDICTOR, "shots")].kind == mf.KIND_FROZEN
    # La primera jornada no tiene partidos anteriores: sin datos.
    assert rows[(matches[0].id, mf.CORNER_DUEL, "corners")].p_home is None

    # Lo mismo que la funcion pura con los jugados anteriores.
    prior = [m for m in matches if m.status == MatchStatus.HISTORICAL]
    stats = {(s.match_id, s.team_id): s for s in db.query(TeamMatchStats)}
    history = StatHistory([mf._days(m.date) for m in prior], [m.home_team_id for m in prior],
                          [m.away_team_id for m in prior], [stats[(m.id, m.home_team_id)].corners_for for m in prior],
                          [stats[(m.id, m.away_team_id)].corners_for for m in prior], [m.referee for m in prior], 14)  # fmt: skip
    duel = corner_duel_forecast(history.before(mf._days(scheduled.date)), scheduled.home_team_id, scheduled.away_team_id)
    assert rows[(scheduled.id, mf.CORNER_DUEL, "corners")].p_home == pytest.approx(duel.home, rel=1e-12)


def test_generation_is_incremental_and_frozen_rows_stay_after_kickoff(db):
    _, matches = _league(db, "ESP-La Liga")
    first = DAY0 + timedelta(days=12, hours=-6)
    mf.generate_match_forecasts(db, now=first)
    before = {k: (r.generated_at, r.home) for k, r in _rows(db).items()}

    # Otra pasada antes del inicio: solo se reescriben los programados.
    second = first + timedelta(hours=1)
    summary = mf.generate_match_forecasts(db, now=second)
    assert summary.reconstructed == 0 and summary.frozen == 6
    after = _rows(db)
    played = [m for m in matches if m.status == MatchStatus.HISTORICAL]
    assert all(after[(m.id, mf.CORNER_DUEL, "corners")].generated_at == before[(m.id, mf.CORNER_DUEL, "corners")][0]
               for m in played)  # fmt: skip
    assert after[(matches[-1].id, mf.CORNER_DUEL, "corners")].generated_at == second

    # Ya empezada la jornada (y jugada), su fila congelada no se toca.
    kickoff = matches[-6]
    kickoff.status, kickoff.home_goals, kickoff.away_goals = MatchStatus.HISTORICAL, 2, 2
    db.flush()
    mf.generate_match_forecasts(db, now=kickoff.date + timedelta(hours=3))
    row = _rows(db)[(kickoff.id, mf.STATS_PREDICTOR, "fouls")]
    assert row.kind == mf.KIND_FROZEN and row.generated_at == second


def test_champions_only_gets_the_duel_and_reading_says_what_there_is(db):
    _, matches = _league(db, CHAMPIONS_LEAGUE)
    target = matches[20]
    assert mf.match_forecasts(db, target)["status"] == "not_generated"
    mf.generate_match_forecasts(db, now=DAY0 + timedelta(days=12, hours=-6))
    assert {r.model for r in db.query(MatchForecast)} == {mf.CORNER_DUEL}
    out = mf.match_forecasts(db, target)
    assert out["status"] == "ok" and out["stats"] is None and out["duel"]["home"] > 0
    league_id = target.league_id
    duels = mf.league_season_duels(db, league_id, "2627")
    assert {d["match_id"] for d in duels} == {m.id for m in matches[3:]}  # la primera jornada, sin datos


def test_context_leagues_get_nothing(db):
    """Las ligas de contexto (solo historial de los equipos de Champions) no tienen ficha: sin filas."""
    _league(db, "ESP-La Liga")
    _, context = _league(db, "NED-Eredivisie")
    mf.generate_match_forecasts(db, now=DAY0 + timedelta(days=12, hours=-6))
    ids = {r.match_id for r in db.query(MatchForecast)}
    assert ids and not ids & {m.id for m in context}
