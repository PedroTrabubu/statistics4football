"""Pagina Aciertos (app/analysis/hit_rate.py): cifras, Champions sin calibrar,
equipos, lectura solo de ligas y temporadas del indice e incrementalidad."""

import json
import math
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from app.analysis import hit_rate as hr
from app.analysis.stats import bootstrap_mean_diff
from app.core.competitions import CHAMPIONS_LEAGUE


def _rows(league: str, season: str, n_matches: int, hit_every: int = 2, start_id: int = 0, teams=("A", "B")) -> pd.DataFrame:
    rows = []
    for i in range(n_matches):
        rows.append({
            "model": "probable_picks", "league": league, "season": season, "match_id": start_id + i,
            "date": pd.Timestamp("2025-08-01") + pd.Timedelta(days=i), "home": teams[0], "away": teams[1],
            "origin": "reconstructed", "type": "goles", "level": "media", "hit": float(i % hit_every == 0), "base": 0.4,
        })  # fmt: skip
    return pd.DataFrame(rows, columns=hr.COLUMNS)


def test_edge_ci_is_bootstrap_mean_diff() -> None:
    rng = np.random.default_rng(1)
    ids = rng.integers(0, 600, 3000)
    hit, base = rng.integers(0, 2, 3000).astype(float), rng.random(3000)
    _, low, high = bootstrap_mean_diff(ids, hit, base)
    assert hr.edge_ci(ids, hit, base) == pytest.approx((low, high), abs=1e-12)


def test_cell_skips_rows_without_data() -> None:
    df = _rows("ESP-La Liga", "2526", 10)
    df.loc[0, "hit"] = np.nan
    c = hr.cell(df)
    assert (c["n"], c["no_data"], c["hits"]) == (9, 1, 4)
    assert c["low"] < c["rate"] < c["high"]
    assert c["edge"] == pytest.approx(4 / 9 - 0.4)


def test_result_bases_follow_the_market_and_skip_matches_without_odds() -> None:
    market = (0.2, 0.3, 0.5)  # favorito: visitante; doble oportunidad: X2
    assert hr.market_bases(market, np.array([2])) == (1.0, 1.0)
    assert hr.market_bases(market, np.array([1])) == (0.0, 1.0)
    assert hr.market_bases(market, np.array([0])) == (0.0, 0.0)
    assert all(math.isnan(base) for base in hr.market_bases(None, np.array([0])))


def test_champions_shown_but_not_in_totals() -> None:
    df = pd.concat([_rows("ESP-La Liga", "2526", 30), _rows(CHAMPIONS_LEAGUE, "2526", 30, hit_every=1, start_id=100)])
    out = hr.model_slice(df, hr.ALL, hr.ALL)
    assert out["total"]["n"] == 30
    by_league = {g["key"]: g for g in out["by_league"]}
    assert by_league[CHAMPIONS_LEAGUE]["calibrated"] is False and by_league[CHAMPIONS_LEAGUE]["n"] == 30
    only = hr.model_slice(df, CHAMPIONS_LEAGUE, hr.ALL)
    assert only["calibrated"] is False and only["total"]["rate"] == 1.0


def test_teams_are_all_of_them_alphabetically_with_their_counts() -> None:
    df = pd.concat([
        _rows("ESP-La Liga", "2526", 25, hit_every=1, teams=("Top", "Rival")),
        _rows("ESP-La Liga", "2526", 5, start_id=200, teams=("Few", "Rival3")),
    ])  # fmt: skip
    teams = {t["key"]: t for t in hr.model_slice(df, hr.ALL, hr.ALL)["by_team"]}
    assert list(teams) == ["Few", "Rival", "Rival3", "Top"]  # tambien los de pocos datos
    assert (teams["Few"]["hits"], teams["Few"]["n"], teams["Few"]["matches"]) == (3, 5, 5)
    assert teams["Top"]["rate"] == 1.0


def test_team_payloads_list_each_match_with_its_picks() -> None:
    df = _rows("ESP-La Liga", "2526", 2, teams=("A", "B")).assign(tie=False, pick=[["goles", "over-2.5", "home"]] * 2)
    df.loc[1, "origin"] = "frozen"
    payloads = hr.team_payloads(df, {0: (2, 1)})
    assert set(payloads) == {"A", "B"}
    first, second = payloads["A"]["matches"]
    assert (first["id"], first["score"], first["preds"]) == (0, [2, 1], [["probable_picks", ["goles", "over-2.5", "home"], 1, "r"]])
    assert (second["score"], second["preds"][0][2:]) == (None, [0, "f"])
    assert hr.team_slug("Atlético Madrid") == "atletico-madrid"


def test_read_slice_only_from_index(tmp_path: Path) -> None:
    (tmp_path / "index.json").write_text(json.dumps({"leagues": [{"code": "ESP-La Liga"}], "seasons": ["2526"]}))
    (tmp_path / "ESP-La Liga").mkdir()
    (tmp_path / "ESP-La Liga" / "2526.json").write_text('{"ok": true}')
    assert hr.read_slice("ESP-La Liga", "2526", tmp_path) == {"ok": True}
    assert hr.read_slice("../..", "2526", tmp_path) is None
    assert hr.read_slice("ESP-La Liga", "../index", tmp_path) is None


def test_build_is_incremental(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    empty = pd.DataFrame(columns=hr.COLUMNS)
    monkeypatch.setattr(hr, "result_items", lambda db: empty)
    monkeypatch.setattr(hr, "high_probability_items", lambda db, settings: empty)
    monkeypatch.setattr(hr, "forecast_items", lambda db: empty)
    csv = tmp_path / "picks.csv"
    picks = pd.DataFrame({
        "league": ["ESP-La Liga"] * 2 + ["ENG-Premier League"] * 2, "season": ["2526", "2627"] * 2,
        "match_id": [1, 2, 3, 4], "date": ["2025-09-01T18:00:00"] * 4, "home_team": "A", "away_team": "B",
        "family": "goles", "strength": "media", "league_rate": 0.5, "hit": [1, 0, 1, 1],
    })  # fmt: skip
    picks.to_csv(csv, index=False)
    out = tmp_path / "out"
    first = hr.build(None, None, out_dir=out, picks_csv=csv)
    assert first.written == 9 and hr.build(None, None, out_dir=out, picks_csv=csv).written == 0

    picks.loc[3, "hit"] = 0  # cambia Premier 26/27: su fichero, el de su liga, el de su temporada y el total
    picks.to_csv(csv, index=False)
    again = hr.build(None, None, out_dir=out, picks_csv=csv)
    assert (again.written, again.kept) == (4, 5)
    data = json.loads((out / "ENG-Premier League" / "2627.json").read_text(encoding="utf-8"))
    assert data["models"]["probable_picks"]["total"]["hits"] == 0


def test_predictor_ties_count_only_for_the_mean_error() -> None:
    """Predictor: un empate en la estadistica no cuenta para el acierto (ni como
    "sin dato"), pero si para el error medio, que solo sale por estadistica."""
    rows = _rows("ESP-La Liga", "2526", 4).assign(model="stats_predictor", type="shots", level=None, tie=False,
                                                  err=[1.0, 2.0, 3.0, 4.0], err_base=[2.0, 2.0, 4.0, 4.0])  # fmt: skip
    rows.loc[3, ["hit", "base", "tie"]] = [math.nan, math.nan, True]
    total = hr.cell(rows)
    assert (total["n"], total["no_data"], total["hits"]) == (3, 0, 2)
    assert "mae" not in total
    by_type = hr.model_slice(rows, "ESP-La Liga", "2526")["by_type"][0]
    assert (by_type["mae"], by_type["mae_base"]) == (2.5, 3.0)


def test_stability_compares_each_season_with_the_next() -> None:
    """Mismo orden de equipos en las dos temporadas: correlacion 1; al reves, -1.
    Con una sola liga no hay orden de ligas que medir."""

    def season(name: str, reverse: bool) -> pd.DataFrame:
        frames = []
        for i in range(16):
            hits = 2 + (15 - i if reverse else i)
            df = _rows("ESP-La Liga", name, 20, start_id=1000 * i + (500 if reverse else 0), teams=(f"A{i}", f"B{i}"))
            frames.append(df.assign(hit=[float(k < hits) for k in range(20)]))
        return pd.concat(frames, ignore_index=True)

    same = hr.stability(pd.concat([season("2425", False), season("2526", False)], ignore_index=True))
    assert same["teams"]["rate"] == pytest.approx(1) and same["teams"]["edge"] == pytest.approx(1)
    assert (same["teams"]["pairs"], same["teams"]["rows"], same["leagues"]) == (1, 32, None)
    reversed_ = hr.stability(pd.concat([season("2425", False), season("2526", True)], ignore_index=True))
    assert reversed_["teams"]["rate"] == pytest.approx(-1)


def test_reference_is_the_team_with_more_average_in_its_last_ten() -> None:
    """Solo partidos anteriores y solo los 10 ultimos; empate o sin historial: fuera."""
    day = lambda n: datetime(2026, 1, 1) + timedelta(days=n)  # noqa: E731
    dates = [day(n) for n in range(12)]
    # El local fue muy bueno hace mucho: los 2 primeros partidos ya no entran.
    history = {
        ("L", 1, "shots"): (dates, [99.0, 99.0] + [5.0] * 10),
        ("L", 2, "shots"): (dates, [0.0, 0.0] + [6.0] * 10),
        ("L", 3, "shots"): (dates, [0.0, 0.0] + [5.0] * 10),
    }
    assert hr.recent_side(history, "L", 1, 2, "shots", day(12)) == "away"
    assert hr.recent_side(history, "L", 2, 1, "shots", day(12)) == "home"
    assert hr.recent_side(history, "L", 1, 3, "shots", day(12)) is None  # empate en la media
    assert hr.recent_side(history, "L", 1, 9, "shots", day(12)) is None  # sin historial
    # Solo lo anterior a la fecha: con 2 partidos jugados, el local gana de largo.
    assert hr.recent_side(history, "L", 1, 2, "shots", day(2)) == "home"
    assert hr.recent_side(history, "L", 1, 2, "shots", day(0)) is None
