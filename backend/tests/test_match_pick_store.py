"""Pick del partido de los jugados: se calcula una vez, se guarda y su acierto
se mira con las estadisticas de hoy; resumen por temporada."""

import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.db.models import League
from app.db.session import SessionLocal
from app.main import app
from app.picks import match_pick_store as store
from app.picks.match_pick import CANDIDATES, Picked, Scored

from tests.test_match_pick import match

OVER_25 = next(c for c in CANDIDATES if c.key == "goles|match|over-2.5")


def pick(hit: bool | None, base: float = 0.5, p: float = 0.7) -> dict:
    return {"family": "goles", "side": "match", "option": "over-2.5", "kind": "goles|over", "p": p, "base": base, "n": 10, "hit": hit}


@pytest.fixture
def files(tmp_path, monkeypatch):
    """Ficheros de picks en una carpeta temporal; el del protocolo, con el partido 1."""
    protocol = tmp_path / "match_pick.json"
    protocol.write_text(json.dumps({"matches": {"1": pick(True)}, "kinds": {}}), encoding="utf-8")
    monkeypatch.setattr(store, "PROTOCOL_PATH", protocol)
    monkeypatch.setattr(store, "PLAYED_PATH", tmp_path / "match_pick_played.json")
    # El acierto, el guardado (sin BD).
    monkeypatch.setattr(store, "_hit_today", lambda p, m: p["hit"])
    return tmp_path


def fake_run(calls: list):
    def run(db, league_id, targets):
        calls.append((league_id, set(targets)))
        out = []
        for i in sorted(targets):
            scored = Scored(OVER_25, 0.7, 0.7, 0.5, 10, 0.8) if i != 3 else None
            out.append(Picked(match(i, 0, hg=3, ag=1), 338, 50, scored, None))
        return out

    return run


def test_played_picks_computes_only_what_is_missing_and_saves_it(files, monkeypatch) -> None:
    calls: list = []
    monkeypatch.setattr(store, "run", fake_run(calls))
    matches = [SimpleNamespace(id=i, league_id=7) for i in (1, 2, 3)]

    first = store.played_picks(None, matches)
    assert calls == [(7, {2, 3})]  # el 1 ya esta en el protocolo
    assert first[1]["hit"] is True
    assert first[2]["option"] == "over-2.5" and first[2]["hit"] is True  # 3-1: mas de 2.5
    assert first[3] is None  # sin pick del partido, tambien guardado
    saved = json.loads(store.PLAYED_PATH.read_text(encoding="utf-8"))["matches"]
    assert set(saved) == {"2", "3"} and saved["3"] is None

    def no_run(*args):
        raise AssertionError("no deberia recalcular")

    monkeypatch.setattr(store, "run", no_run)
    assert store.played_picks(None, matches) == first


def test_save_keeps_what_another_process_wrote(files) -> None:
    store._save({"10": pick(True)})
    other = json.loads(store.PLAYED_PATH.read_text(encoding="utf-8"))
    other["matches"]["11"] = pick(False)
    store.PLAYED_PATH.write_text(json.dumps(other), encoding="utf-8")
    store._save({"12": None})
    saved = json.loads(store.PLAYED_PATH.read_text(encoding="utf-8"))["matches"]
    assert set(saved) == {"10", "11", "12"}


def test_hit_is_checked_with_todays_stats(monkeypatch) -> None:
    # Guardado como acierto, pero el partido quedo 1-0: no fue mas de 2.5.
    monkeypatch.setattr(store, "to_match_data", lambda m: match(1, 0, hg=1, ag=0))
    assert store._hit_today(pick(True), object()) is False
    # Un pick que ya no esta en la lista de candidatos conserva su acierto.
    assert store._hit_today({**pick(True), "option": "over-99.5"}, object()) is True


def test_summarize_by_season_skips_undecided() -> None:
    rows = [
        ("2526", pick(True, base=0.4, p=0.7)),
        ("2526", pick(False, base=0.6, p=0.8)),
        ("2526", pick(None)),
        ("2526", None),
        ("2627", pick(True, base=0.5, p=0.9)),
    ]
    by = {s["season"]: s for s in store.summarize(rows)}
    assert [s["season"] for s in store.summarize(rows)] == ["2627", "2526"]
    s = by["2526"]
    assert (s["matches"], s["with_pick"], s["decided"], s["hits"]) == (4, 3, 2, 1)
    assert s["base"] == pytest.approx(0.5) and s["p"] == pytest.approx(0.75)
    assert store.summarize([("2526", None)])[0]["base"] is None


def test_summary_endpoint(monkeypatch) -> None:
    client = TestClient(app)
    with SessionLocal() as db:
        laliga = db.query(League).filter_by(code="ESP-La Liga").one()
        champions = db.query(League).filter_by(code="INT-Champions League").one_or_none()
    monkeypatch.setattr(store, "season_summary", lambda db, league: [{"season": "2627", "hits": 1}])
    body = client.get("/picks/match-pick/summary", params={"league_id": laliga.id}).json()
    assert body == {"calibrated": True, "first_season": "2526", "seasons": [{"season": "2627", "hits": 1}]}
    if champions is not None:
        assert client.get("/picks/match-pick/summary", params={"league_id": champions.id}).json()["calibrated"] is False
    assert client.get("/picks/match-pick/summary", params={"league_id": 999_999}).status_code == 404
