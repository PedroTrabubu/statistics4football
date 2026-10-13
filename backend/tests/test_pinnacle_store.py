"""Capturas de Pinnacle: solo anadir, apertura y cierre, mercados que
aparecen tarde, fallos sin perder nada y aislamiento de "Market Average"."""

import importlib.util
import json
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db.models import (
    League,
    Match,
    MatchOdds,
    MatchStatus,
    PinnacleCapture,
    PinnacleMatchSnapshot,
    PinnaclePrice,
    Season,
    Team,
)
from app.db.models.pinnacle import VIEWS
from app.ingestion import pinnacle_queries as q
from app.ingestion.pinnacle_capture import capture_league, load_raw
from app.probability import engine, pattern_engine

BACKEND = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).parent / "fixtures" / "pinnacle"
START = datetime(2026, 10, 17, 19, 0)
LIMIT = [{"amount": 3000, "type": "maxRiskStake"}]


@pytest.fixture
def db() -> Session:
    engine_ = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine_)
    with engine_.begin() as conn:
        for name, sql in VIEWS.items():
            conn.execute(text(f"CREATE VIEW {name} AS {sql}"))
    session = sessionmaker(bind=engine_)()
    yield session
    session.close()


@pytest.fixture
def match(db: Session) -> Match:
    league = League(code="ESP-La Liga", name="LaLiga")
    db.add(league)
    db.flush()
    season = Season(league_id=league.id, name="2627")
    malaga = Team(name="Malaga", league_id=league.id)
    espanol = Team(name="Espanol", league_id=league.id)  # Pinnacle: "Espanyol"
    db.add_all([season, malaga, espanol])
    db.flush()
    m = Match(
        league_id=league.id,
        season_id=season.id,
        home_team_id=malaga.id,
        away_team_id=espanol.id,
        date=START,
        status=MatchStatus.SCHEDULED,
    )
    db.add(m)
    db.commit()
    return m


def _matchup(mid, units="Regular", parent=None, start=START, live=False):
    suffix = "" if units == "Regular" else f" ({units})"
    iso = start.isoformat() + "Z"
    return {
        "id": mid,
        "parentId": parent,
        "type": "matchup",
        "units": units,
        "startTime": iso,
        "status": "pending",
        "isLive": live,
        "version": 7,
        "periods": [{"period": 0, "cutoffAt": iso, "status": "open"}],
        "participants": [
            {"alignment": "home", "name": f"Malaga{suffix}"},
            {"alignment": "away", "name": f"Espanyol{suffix}"},
        ],
    }


def _ml(mid, prices, version):
    return {
        "matchupId": mid, "type": "moneyline", "key": "s;0;m", "period": 0, "version": version, "limits": LIMIT,
        "prices": [{"designation": d, "price": p} for d, p in zip(("home", "draw", "away"), prices, strict=True)],
    }  # fmt: skip


def _total(mid, line, over, under, version):
    return {
        "matchupId": mid, "type": "total", "key": f"s;0;ou;{line}", "period": 0, "version": version,
        "isAlternate": False, "status": "open", "limits": LIMIT,
        "prices": [{"designation": "over", "points": line, "price": over},
                   {"designation": "under", "points": line, "price": under}],
    }  # fmt: skip


def responses(ml=(150, 220, 180), goals=(2.5, -110, -105), version=1, bookings=None, live=False, total=True):
    matchups = [_matchup(100, live=live)]
    markets = [_ml(100, ml, version)]
    if total:
        markets.append(_total(100, *goals, version))
    if bookings:
        matchups.append(_matchup(101, "Bookings", parent=100, live=live))
        markets.append(_total(101, *bookings, version))
    return matchups, markets


class FakeClient:
    def __init__(self, payload=None, error=None):
        self.payload, self.error, self.requests = payload, error, 0

    def league_raw(self, league_code):
        self.requests += 2
        if self.error:
            raise self.error
        return self.payload


def run(db, tmp_path, payload, at, error=None):
    return capture_league(db, FakeClient(payload, error), "ESP-La Liga", raw_dir=tmp_path, clock=lambda: at)


T1, T2, T3 = START - timedelta(days=3), START - timedelta(hours=5), START - timedelta(minutes=3)


def test_capture_saves_raw_snapshot_and_prices(db, match, tmp_path):
    capture = run(db, tmp_path, responses(), T1)
    assert capture.status == "ok" and capture.requests == 2
    assert (capture.n_matchups, capture.n_matched, capture.n_prices, capture.n_rows_written) == (1, 1, 5, 5)
    raw = load_raw(tmp_path, capture.raw_path)
    assert raw["league_code"] == "ESP-La Liga" and raw["matchups"][0]["id"] == 100
    snap = db.query(PinnacleMatchSnapshot).one()
    assert (snap.match_id, snap.status, snap.max_stake, snap.cutoff_at) == (match.id, "pending", 3000, START)
    rows = db.query(PinnaclePrice).all()
    assert {r.match_id for r in rows} == {match.id} and all(r.captured_at == T1 for r in rows)
    assert db.query(MatchOdds).count() == 0  # nunca escribe en match_odds


def test_append_only_writes_only_changes_and_never_updates(db, match, tmp_path):
    run(db, tmp_path, responses(), T1)
    before = {r.id: (r.odds, r.captured_at) for r in db.query(PinnaclePrice)}
    same = run(db, tmp_path, responses(), T2)  # misma version: nada que escribir
    assert same.status == "ok" and same.n_rows_written == 0 and same.n_removed == 0
    moved = run(db, tmp_path, responses(ml=(140, 220, 190), version=2), T3)  # se mueve el 1X2
    assert moved.n_rows_written == 2  # local y visitante; empate y total igual
    after = {r.id: (r.odds, r.captured_at) for r in db.query(PinnaclePrice)}
    assert all(after[i] == before[i] for i in before)  # las filas viejas no cambian
    assert len(after) == len(before) + 2
    assert db.query(PinnacleCapture).count() == 3  # cada pasada queda registrada
    assert db.query(PinnacleMatchSnapshot).count() == 3


def test_opening_closing_and_removed_markets(db, match, tmp_path):
    run(db, tmp_path, responses(ml=(150, 220, 180)), T1)
    run(db, tmp_path, responses(ml=(140, 220, 190), version=2), T2)
    run(db, tmp_path, responses(ml=(130, 225, 200), version=3, total=False), T3)  # se retira el total
    # Ya empezado: no es pre-partido, no escribe nada ni cambia el cierre.
    late = run(db, tmp_path, responses(ml=(-300, 400, 800), version=4, live=True), START + timedelta(minutes=10))
    assert late.n_live_skipped == 1 and late.n_rows_written == 0

    closing = {(r["market"], r["selection"]): r for r in q.closing_prices(db)}
    assert closing[("moneyline", "home")]["odds"] == 2.3  # +130, captura de T3
    assert closing[("moneyline", "away")]["odds"] == 3.0
    assert ("total", "over") not in closing  # retirado antes del cierre
    assert all(r["closed_at"] == T3 for r in closing.values())
    opening = {(r["market"], r["selection"]): r for r in q.opening_prices(db)}
    assert opening[("moneyline", "home")]["odds"] == 2.5 and opening[("moneyline", "home")]["captured_at"] == T1
    assert opening[("total", "over")]["line"] == 2.5
    removed = db.query(PinnaclePrice).filter_by(is_removed=True).all()
    assert {r.selection for r in removed} == {"over", "under"}


def test_market_that_opens_late_has_its_own_first_seen(db, match, tmp_path):
    run(db, tmp_path, responses(), T1)
    run(db, tmp_path, responses(bookings=(4.5, 105, -125)), T2)  # las tarjetas abren tarde
    seen = {(r["units"], r["market"]): r["first_seen_at"] for r in q.first_seen(db)}
    assert seen[("goals", "moneyline")] == T1
    assert seen[("bookings", "total")] == T2


def test_views_match_the_query_functions_and_the_migration(db, match, tmp_path):
    run(db, tmp_path, responses(), T1)
    run(db, tmp_path, responses(ml=(140, 220, 190), version=2), T3)
    for view, fn in (
        ("pinnacle_closing_odds", q.closing_prices),
        ("pinnacle_opening_odds", q.opening_prices),
        ("pinnacle_market_first_seen", q.first_seen),
    ):
        from_view = [
            {k: datetime.fromisoformat(v) if k.endswith("_at") and isinstance(v, str) else v for k, v in r.items()}
            for r in db.execute(text(f"SELECT * FROM {view}")).mappings()
        ]
        assert len(from_view) > 0
        assert sorted(from_view, key=repr) == sorted(fn(db), key=repr)

    path = BACKEND / "alembic" / "versions" / "e4b7c2d9f1a6_pinnacle_captures.py"
    spec = importlib.util.spec_from_file_location("pinnacle_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert migration.VIEWS == VIEWS  # la copia fija de la migracion no se ha desviado


def test_failed_request_is_recorded_without_rows(db, match, tmp_path):
    capture = run(db, tmp_path, None, T1, error=ConnectionError("Pinnacle respondió 503"))
    assert capture.status == "failed" and "503" in capture.error
    assert db.query(PinnaclePrice).count() == 0 and capture.raw_path is None


def test_unexpected_format_keeps_the_raw_and_writes_no_false_removals(db, match, tmp_path):
    run(db, tmp_path, responses(), T1)
    matchups, _ = responses()
    broken = run(db, tmp_path, (matchups, {"markets": "ahora es un objeto"}), T2)
    assert broken.status == "failed" and "formato inesperado" in broken.error
    assert broken.raw_path and load_raw(tmp_path, broken.raw_path)["markets"] == {"markets": "ahora es un objeto"}
    assert "se esperaba una lista" in json.loads(broken.warnings)[0]
    renamed = [dict(m, prices=[{**p, "designation": p["designation"].upper()} for p in m["prices"]]) for m in responses()[1]]
    weird = run(db, tmp_path, (matchups, renamed), T3)  # nada entendido
    assert weird.status == "failed"
    assert db.query(PinnaclePrice).filter_by(is_removed=True).count() == 0


def test_real_response_end_to_end(db, tmp_path):
    league = League(code="ESP-La Liga", name="LaLiga")
    db.add(league)
    db.flush()
    season = Season(league_id=league.id, name="2627")
    teams = {n: Team(name=n, league_id=league.id) for n in ("Malaga", "Espanol", "Alaves", "Ath Madrid")}
    db.add_all([season, *teams.values()])
    db.flush()
    db.add(Match(league_id=league.id, season_id=season.id, home_team_id=teams["Malaga"].id,
                 away_team_id=teams["Espanol"].id, date=datetime(2026, 10, 9, 19), status=MatchStatus.SCHEDULED))  # fmt: skip
    db.commit()
    payload = tuple(
        json.loads((FIXTURES / f"laliga_{kind}.json").read_text(encoding="utf-8")) for kind in ("matchups", "markets")
    )
    capture = run(db, tmp_path, payload, datetime(2026, 10, 9, 14, 46))
    assert capture.status == "ok"
    assert (capture.n_matchups, capture.n_matched) == (2, 1)  # Alaves - Atletico no esta en la BD
    assert any("Alaves - Atletico Madrid" in w for w in json.loads(capture.warnings))
    units = {r.units for r in db.query(PinnaclePrice).filter(PinnaclePrice.match_id.is_not(None))}
    assert units == {"goals", "corners", "bookings"}


# --- Aislamiento de "Market Average" / "Market Max" ---------------------------


def test_pinnacle_captures_never_reach_market_average_or_max(db, match, tmp_path):
    for bookmaker, prices in (("Market Average", (2.4, 3.3, 3.0)), ("Market Max", (2.6, 3.5, 3.2)), ("Pinnacle", (2.5, 3.4, 3.1))):
        for selection, odds in zip(("home", "draw", "away"), prices, strict=True):
            db.add(MatchOdds(match_id=match.id, bookmaker=bookmaker, market="1x2", selection=selection,
                             odds=odds, line=None, snapshot_time=T1))  # fmt: skip
    db.commit()

    def reference():
        return (
            {s: r.odds for s, r in engine._odds_map(db, match.id, "1x2", engine.REFERENCE_BOOKMAKER).items()},
            {s: r.odds for s, r in engine._odds_map(db, match.id, "1x2", engine.BEST_PRICE_BOOKMAKER).items()},
            engine._individual_odds(db, match.id, "1x2", "home"),
            pattern_engine.prematch_odds(db, match.id),
            db.query(MatchOdds).count(),
        )

    before = reference()
    run(db, tmp_path, responses(ml=(-200, 400, 600)), T1)
    run(db, tmp_path, responses(ml=(-250, 450, 700), version=2), T3)
    assert db.query(PinnaclePrice).count() > 0
    assert reference() == before


def test_market_reference_code_does_not_read_pinnacle_tables():
    """Ningun calculo de la web (probabilidades, EV, Recomendaciones,
    combinadas, backtests) toca las tablas de capturas."""
    sources = [*(BACKEND / "app" / "probability").glob("*.py"), *(BACKEND / "app" / "picks").glob("*.py")]
    sources += [BACKEND / "app" / "api" / "routers" / f for f in ("recommendations.py", "picks.py", "matches.py")]
    sources += [BACKEND / "scripts" / f for f in ("backtest_picks.py", "backtest_pattern_model.py", "generate_predictions.py",
                                                  "refresh_predictions.py", "refresh_picks.py")]  # fmt: skip
    for path in sources:
        code = path.read_text(encoding="utf-8")
        for name in ("pinnacle_odds", "PinnaclePrice", "pinnacle_captures", "pinnacle_queries", "app.analysis"):
            assert name not in code, f"{path.name} usa {name}"
