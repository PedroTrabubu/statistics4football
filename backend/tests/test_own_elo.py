"""Elo propio (app/stats/own_elo.py): point-in-time, congelado y con motivo
cuando la ficha muestra "—"."""

from datetime import datetime, timedelta

import numpy as np
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.competitions import CHAMPIONS_LEAGUE
from app.db.base import Base
from app.db.models import IngestionRun, IngestionStatus, League, Match, MatchStatus, OwnEloPre, Season, Team
from app.stats import own_elo
from app.stats.features import compute_match_features
from app.stats.own_elo import (
    HOME_ADVANTAGE,
    INITIAL_RATING,
    K,
    MIN_MATCHES,
    EloMatch,
    generate_own_elo,
    refresh_own_elo,
    league_season_elo,
    match_elo,
    run_elo,
)

DAY0 = datetime(2024, 8, 10, 18, 0)


def _round_robin(teams: list[int], days: int, start_id: int = 1, offset_days: int = 0) -> list[EloMatch]:
    """Cada dia, todos los equipos emparejados al azar (semilla fija), con resultados variados."""
    out, mid = [], start_id
    for d in range(days):
        perm = np.random.default_rng(d).permutation(teams)
        for i in range(0, len(perm) - 1, 2):
            date = DAY0 + timedelta(days=7 * d + offset_days)
            out.append(EloMatch(mid, "L", date, int(perm[i]), int(perm[i + 1]), (mid * 7) % 4, (mid * 3) % 3))
            mid += 1
    return out


def test_pre_match_rating_ignores_its_result_same_day_and_later_matches():
    base = _round_robin(list(range(1, 9)), days=6)
    target = base[10]
    pre, _ = run_elo(base)
    expected = {t: pre[(target.match_id, t)] for t in (target.home_team_id, target.away_team_id)}

    same_day = {m.match_id for m in base if m.date.date() == target.date.date()}
    later = _round_robin(list(range(1, 9)), days=4, start_id=1000, offset_days=100)
    for home_goals, away_goals in ((0, 0), (6, 0), (0, 6)):
        changed = [
            EloMatch(m.match_id, m.league, m.date, m.home_team_id, m.away_team_id, home_goals, away_goals)
            if m.match_id in same_day
            else m
            for m in base
        ]
        pre2, _ = run_elo(changed + later)
        for team_id, value in expected.items():
            assert pre2[(target.match_id, team_id)] == value


def test_rating_update_by_hand():
    m1 = EloMatch(1, "L", DAY0, 1, 2, 2, 0)
    m2 = EloMatch(2, "L", DAY0 + timedelta(days=7), 1, 2, 0, 0)
    pre, _ = run_elo([m1, m2])
    expected = 1 / (1 + 10 ** (-HOME_ADVANTAGE / 400))
    assert pre[(1, 1)].elo == INITIAL_RATING and pre[(1, 1)].matches_rated == 0
    assert pre[(2, 1)].elo == pytest.approx(INITIAL_RATING + K * (1 - expected))
    assert pre[(2, 2)].elo == pytest.approx(INITIAL_RATING - K * (1 - expected))
    assert pre[(2, 1)].matches_rated == 1
    # "Calculado hasta": el ultimo resultado incluido, nunca el del propio partido.
    assert pre[(1, 1)].until is None and pre[(2, 1)].until == m1.date


def test_newcomer_starts_at_league_25th_percentile():
    season = _round_robin(list(range(1, 9)), days=5)
    _, state = run_elo(season)
    ratings = sorted(state.ratings.values())
    newcomer = EloMatch(999, "L", DAY0 + timedelta(days=200), 50, 1, 1, 1)
    pre, _ = run_elo(season + [newcomer])
    assert pre[(999, 50)].elo == pytest.approx(float(np.percentile(ratings, 25)))
    assert pre[(999, 50)].matches_rated == 0


# --- BD: generacion incremental y lectura -------------------------------------


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _setup(db: Session, code: str = "TEST-League"):
    league = League(code=code, name=code)
    db.add(league)
    db.flush()
    season = Season(league_id=league.id, name="2425")
    db.add(season)
    db.flush()
    teams = [Team(name=f"{code} {i}", league_id=league.id) for i in range(4)]
    db.add_all(teams)
    db.flush()
    return league, season, teams


def _match(db, league, season, home, away, date, goals=None):
    m = Match(
        league_id=league.id,
        season_id=season.id,
        date=date,
        home_team_id=home.id,
        away_team_id=away.id,
        home_goals=goals[0] if goals else None,
        away_goals=goals[1] if goals else None,
        status=MatchStatus.HISTORICAL if goals else MatchStatus.SCHEDULED,
    )
    db.add(m)
    db.flush()
    return m


def test_generation_freezes_final_rows_and_refreshes_provisional(db: Session):
    league, season, (a, b, c, d) = _setup(db)
    played = []
    for week in range(MIN_MATCHES + 1):
        day = DAY0 + timedelta(days=7 * week)
        played.append(_match(db, league, season, a, b, day, (week % 3, 1)))
        played.append(_match(db, league, season, c, d, day, (1, week % 2)))
    upcoming = _match(db, league, season, a, c, DAY0 + timedelta(days=400))

    first = generate_own_elo(db)
    assert first.final_written == 2 * len(played) and first.provisional_written == 2
    target = played[-2]
    frozen = {r.team_id: r.elo for r in db.query(OwnEloPre).filter_by(match_id=target.id)}

    # Nuevo resultado: la fila provisional del programado cambia; las finales no se reescriben.
    provisional_before = db.query(OwnEloPre).filter_by(match_id=upcoming.id, team_id=a.id).one().elo
    _match(db, league, season, a, d, DAY0 + timedelta(days=300), (3, 0))
    second = generate_own_elo(db)
    assert second.final_written == 2 and second.discrepancies == 0
    assert db.query(OwnEloPre).filter_by(match_id=upcoming.id, team_id=a.id).one().elo != provisional_before

    # Un resultado anterior corregido no recalcula lo ya congelado: se cuenta.
    played[0].home_goals = 5
    third = generate_own_elo(db)
    assert third.discrepancies > 0
    assert {r.team_id: r.elo for r in db.query(OwnEloPre).filter_by(match_id=target.id)} == frozen

    # Al jugarse, la provisional pasa a final con el rating previo (sin su resultado).
    upcoming.home_goals, upcoming.away_goals, upcoming.status = 0, 4, MatchStatus.HISTORICAL
    generate_own_elo(db)
    row = db.query(OwnEloPre).filter_by(match_id=upcoming.id, team_id=a.id).one()
    assert row.is_final


def test_match_elo_reasons_and_features(db: Session):
    league, season, (a, b, c, _d) = _setup(db)
    ucl, ucl_season, (x, y, *_rest) = _setup(db, CHAMPIONS_LEAGUE)
    for week in range(MIN_MATCHES):
        _match(db, league, season, a, b, DAY0 + timedelta(days=7 * week), (1, 0))
    ready = _match(db, league, season, b, a, DAY0 + timedelta(days=7 * MIN_MATCHES), (0, 0))
    newcomer = _match(db, league, season, a, c, DAY0 + timedelta(days=7 * MIN_MATCHES + 1), (2, 2))
    champions = _match(db, ucl, ucl_season, x, y, DAY0 + timedelta(days=3), (1, 1))
    generate_own_elo(db)
    not_generated = _match(db, league, season, b, c, DAY0 + timedelta(days=500))

    shown = match_elo(db, ready)
    assert shown.home.elo is not None and shown.home.matches_rated == MIN_MATCHES and shown.home.missing is None
    low = match_elo(db, newcomer)
    assert low.away.elo is None and low.away.matches_rated == 0 and low.away.missing == "insufficient_history"
    assert match_elo(db, champions).home.missing == "champions"
    assert match_elo(db, not_generated).home.missing == "not_generated"

    features = compute_match_features(db, ready)
    assert features.home_elo == shown.home.elo and features.elo.away.elo == shown.away.elo
    assert [e.match_id for e in league_season_elo(db, league.id, "2425")][-1] == not_generated.id


def test_refresh_is_idempotent_and_logged(db: Session):
    league, season, (a, b, _c, _d) = _setup(db)
    first = _match(db, league, season, a, b, DAY0, (1, 0))
    second = _match(db, league, season, b, a, DAY0 + timedelta(days=7), (2, 2))
    upcoming = _match(db, league, season, a, b, DAY0 + timedelta(days=30))

    run = refresh_own_elo(db)
    assert run.status == IngestionStatus.SUCCESS and run.source == "own_elo.refresh"
    snapshot = {(r.match_id, r.team_id): (r.elo, r.computed_until) for r in db.query(OwnEloPre)}
    again = refresh_own_elo(db)
    assert "0 finales nuevas" in again.notes and "0 discrepancias" in again.notes
    assert {(r.match_id, r.team_id): (r.elo, r.computed_until) for r in db.query(OwnEloPre)} == snapshot
    assert match_elo(db, upcoming).computed_until == second.date
    assert match_elo(db, second).computed_until == first.date


def test_refresh_failure_is_recorded_and_raised(db: Session, monkeypatch):
    def broken(_db):
        raise RuntimeError("roto")

    monkeypatch.setattr(own_elo, "generate_own_elo", broken)
    with pytest.raises(RuntimeError):
        refresh_own_elo(db)
    run = db.query(IngestionRun).filter_by(source="own_elo.refresh").one()
    assert run.status == IngestionStatus.FAILED and "roto" in run.notes
