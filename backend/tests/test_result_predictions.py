"""Porcentajes de resultado guardados (app/probability/result_predictions.py):
reconstruccion incremental igual que el walk-forward completo, congelacion al
inicio, estados de la ficha y lectura sin escribir."""

from datetime import datetime, timedelta

import numpy as np
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.competitions import CHAMPIONS_LEAGUE
from app.db.base import Base
from app.db.models import League, Match, MatchStatus, ResultPrediction, Season, Team
from app.probability import dc_monthly
from app.probability import result_predictions as rp
from app.probability.result_model import COLS_ELO, build_features, load_inputs, walk_forward
from app.stats.own_elo import generate_own_elo

CODE = "ENG-Premier League"
DAY0 = datetime(2024, 8, 10, 14, 0)


@pytest.fixture
def db(tmp_path, monkeypatch) -> Session:
    monkeypatch.setattr(rp, "SUMMARY_PATH", tmp_path / "result_summary.json")
    monkeypatch.setattr(dc_monthly, "DC_DIR", tmp_path / "dc")  # sin Dixon-Coles: solo Elo
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _league(db: Session, code: str, teams: int):
    league = League(code=code, name=code)
    db.add(league)
    db.flush()
    season = Season(league_id=league.id, name="2425")
    db.add(season)
    db.flush()
    members = [Team(name=f"{code} {i}", league_id=league.id) for i in range(teams)]
    db.add_all(members)
    db.flush()
    return league, season, members


def _match(db, league, season, home, away, date, goals=None) -> Match:
    m = Match(league_id=league.id, season_id=season.id, date=date, home_team_id=home.id, away_team_id=away.id,
              home_goals=goals[0] if goals else None, away_goals=goals[1] if goals else None,
              status=MatchStatus.HISTORICAL if goals else MatchStatus.SCHEDULED)  # fmt: skip
    db.add(m)
    db.flush()
    return m


def _played_days(db, league, season, teams, days: int) -> None:
    rng = np.random.default_rng(5)
    for d in range(days):
        perm = rng.permutation(len(teams))
        for i in range(0, len(teams), 2):
            home, away = teams[perm[i]], teams[perm[i + 1]]
            strength = (perm[i] - perm[i + 1]) / 8  # algo de senal para el Elo
            goals = (int(rng.poisson(1.4 + strength)), int(rng.poisson(1.1)))
            _match(db, league, season, home, away, DAY0 + timedelta(days=d), goals)


def test_reconstructs_incrementally_and_freezes_at_kickoff(db: Session):
    league, season, teams = _league(db, CODE, 8)
    _played_days(db, league, season, teams, 100)
    now = DAY0 + timedelta(days=99, hours=10)
    soon = _match(db, league, season, teams[0], teams[1], now + timedelta(hours=3))
    later = _match(db, league, season, teams[2], teams[3], now + timedelta(days=9))
    generate_own_elo(db)

    first = rp.generate_result_predictions(db, now=now, leagues=[CODE])
    assert first.frozen == 2 and first.reconstructed > 0 and first.insufficient > 0
    soon_row = db.query(ResultPrediction).filter_by(match_id=soon.id).one()
    frozen = (soon_row.p_home, soon_row.p_draw, soon_row.p_away, soon_row.generated_at)
    assert soon_row.kind == "frozen" and sum(frozen[:3]) == pytest.approx(1)

    # Pasa el inicio de `soon` y llega un resultado nuevo sin prediccion.
    extra = _match(db, league, season, teams[4], teams[5], now + timedelta(hours=2), (2, 1))
    generate_own_elo(db)
    now2 = soon.date + timedelta(hours=1)
    second = rp.generate_result_predictions(db, now=now2, leagues=[CODE])
    assert second.reconstructed == 1 and second.frozen == 1  # `extra` y `later`; `soon` ya no se toca
    db.refresh(soon_row)
    assert (soon_row.p_home, soon_row.p_draw, soon_row.p_away, soon_row.generated_at) == frozen
    assert db.query(ResultPrediction).filter_by(match_id=later.id).one().generated_at == now2

    # La reconstruccion incremental da lo mismo que el walk-forward completo (salvo la
    # tolerancia del optimizador: el completo arranca cada ajuste desde el del dia anterior).
    features = build_features(load_inputs(db, [CODE], with_market=False), {})
    full = walk_forward(features, COLS_ELO, predict_unplayed=False).set_index("match_id")
    row = db.query(ResultPrediction).filter_by(match_id=extra.id).one()
    assert row.kind == "reconstructed" and row.version == rp.ELO_VERSION  # sin Dixon-Coles, respaldo con su version
    assert row.p_home == pytest.approx(full.loc[extra.id, "p_home"], abs=1e-4)

    # Jugado: sigue la prediccion congelada antes del partido.
    soon.home_goals, soon.away_goals, soon.status = 0, 3, MatchStatus.HISTORICAL
    generate_own_elo(db)
    rp.generate_result_predictions(db, now=now2 + timedelta(days=1), leagues=[CODE])
    db.refresh(soon_row)
    assert soon_row.kind == "frozen" and soon_row.generated_at == frozen[3]


def test_states_and_reads_never_write(db: Session):
    league, season, teams = _league(db, CODE, 8)
    _played_days(db, league, season, teams, 100)
    ucl, ucl_season, (x, y, *_r) = _league(db, CHAMPIONS_LEAGUE, 2)
    champions = _match(db, ucl, ucl_season, x, y, DAY0 + timedelta(days=50), (1, 1))
    newcomer = Team(name="Nuevo", league_id=league.id)
    db.add(newcomer)
    db.flush()
    now = DAY0 + timedelta(days=99, hours=10)
    debut = _match(db, league, season, newcomer, teams[0], now + timedelta(days=2))
    generate_own_elo(db)
    rp.generate_result_predictions(db, now=now, leagues=[CODE])
    unseen = _match(db, league, season, teams[1], teams[2], now + timedelta(days=30))
    last = db.query(Match).filter(Match.league_id == league.id, Match.status == MatchStatus.HISTORICAL).order_by(
        Match.date.desc()
    ).first()

    before = db.query(ResultPrediction).count()
    ok = rp.match_result_probabilities(db, last)
    assert ok["prediction"]["status"] == "ok" and ok["summary"]["league"]["league"] == CODE
    assert ok["prediction"]["kind"] == "reconstructed"
    assert rp.match_result_probabilities(db, debut)["prediction"]["status"] == "insufficient_history"
    assert rp.match_result_probabilities(db, debut)["prediction"]["p_home"] is None  # nunca ceros
    assert rp.match_result_probabilities(db, champions)["prediction"]["status"] == "champions"
    assert rp.match_result_probabilities(db, unseen)["prediction"]["status"] == "not_generated"
    season_rows = rp.league_season_result_probabilities(db, league.id, "2425")["predictions"]
    assert len(season_rows) == db.query(Match).filter_by(league_id=league.id).count()
    assert db.query(ResultPrediction).count() == before
