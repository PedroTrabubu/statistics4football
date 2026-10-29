"""Backtest de los porcentajes de resultado (docs/RESULTADOS_PROTOCOLO.md).

Uso (desde backend/, con el venv activado):
    python scripts/backtest_result_model.py dc    # Dixon-Coles diario a cache (lento, incremental; no puntua nada)
    python scripts/backtest_result_model.py dry   # prueba en seco: variables y un ajuste, sin puntuar
    python scripts/backtest_result_model.py run   # la ejecucion unica: desarrollo 22/23-25/26 y prueba 26/27

Salidas en data/model_cache/: result_dc/<liga>.csv, result_predictions.csv y result_backtest.json.
"""

import json
import sys
import time
import warnings
from datetime import datetime
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.analysis.stats import bootstrap_mean_diff  # noqa: E402
from app.core.config import PROJECT_ROOT  # noqa: E402
from app.probability.result_metrics import (  # noqa: E402
    best_dc_hit,
    brier_dc_per_match,
    calibration_bins,
    coverage_accuracy,
    ece,
    high_confidence,
    log_loss_per_match,
    rps_per_match,
    top_hit,
)
from app.probability.result_model import (  # noqa: E402
    COLS_A,
    COLS_B,
    COLS_ELO,
    build_features,
    double_chance,
    load_inputs,
    temperature_walk_forward,
    walk_forward,
)

warnings.filterwarnings("ignore", category=RuntimeWarning)

LEAGUES = ["ENG-Premier League", "ESP-La Liga", "ESP-La Liga 2", "FRA-Ligue 1", "GER-Bundesliga", "ITA-Serie A"]
WARMUP = "2021"
DEV = ["2223", "2324", "2425", "2526"]
TEST = ["2627"]
CACHE = PROJECT_ROOT / "data" / "model_cache"
DC_DIR = CACHE / "result_dc"
MODELS = {  # nombre en el informe -> prefijo de columnas
    "A (con mercado)": "a",
    "B (sin mercado)": "b",
    "Mercado sin margen": "mk",
    "Mercado calibrado": "mkcal",
    "Dixon-Coles": "dc",
    "Elo": "elo",
    "Frecuencias de la liga": "freq",
}


# --- Dixon-Coles diario --------------------------------------------------------


def _dc_league(code: str) -> tuple[str, int]:
    from app.db.models import League, Match, MatchStatus
    from app.db.session import SessionLocal
    from app.probability.engine import fit_league_model
    from app.probability.score_markets import probabilities_1x2

    path = DC_DIR / f"{code}.csv"
    done = set(pd.read_csv(path).match_id) if path.exists() else set()
    db = SessionLocal()
    try:
        league = db.query(League).filter_by(code=code).one()
        matches = (
            db.query(Match)
            .filter(Match.league_id == league.id, Match.status == MatchStatus.HISTORICAL, Match.home_goals.is_not(None))
            .order_by(Match.date, Match.id)
            .all()
        )
        todo = [m for m in matches if m.season.name != WARMUP and m.id not in done]
        days = sorted({m.date.date() for m in todo})
        written = 0
        for day in days:
            start = datetime(day.year, day.month, day.day)
            model = fit_league_model(db, league.id, before_date=start)
            rows = []
            for m in (m for m in todo if m.date.date() == day):
                p = probabilities_1x2(model.score_matrix(m.home_team_id, m.away_team_id))
                rows.append({"match_id": m.id, "dc_h": p["home"], "dc_d": p["draw"], "dc_a": p["away"]})
            pd.DataFrame(rows).to_csv(path, mode="a", header=not path.exists(), index=False)
            written += len(rows)
        return code, written
    finally:
        db.rollback()
        db.close()


def stage_dc() -> None:
    DC_DIR.mkdir(parents=True, exist_ok=True)
    with Pool(len(LEAGUES)) as pool:
        for code, n in pool.imap_unordered(_dc_league, LEAGUES):
            print(f"{code}: {n} partidos nuevos", flush=True)


def load_dc() -> dict[int, tuple[float, float, float]]:
    df = pd.concat([pd.read_csv(p) for p in DC_DIR.glob("*.csv")]).drop_duplicates("match_id")
    return {int(r.match_id): (r.dc_h, r.dc_d, r.dc_a) for r in df.itertuples()}


def features() -> pd.DataFrame:
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        inputs = load_inputs(db, LEAGUES)
    finally:
        db.rollback()
        db.close()
    F = build_features(inputs, load_dc())
    return F[F.res >= 0]


# --- Walk-forward por liga ------------------------------------------------------


def _league_predictions(job: tuple[str, pd.DataFrame]) -> pd.DataFrame:
    code, df = job
    out = df[["match_id"]].copy()
    for prefix, frame in (
        ("a", walk_forward(df, COLS_A, predict_unplayed=False)),
        ("b", walk_forward(df, COLS_B, predict_unplayed=False)),
        ("elo", walk_forward(df, COLS_ELO, predict_unplayed=False)),
    ):
        out = out.merge(frame.rename(columns={"p_home": f"{prefix}_h", "p_draw": f"{prefix}_d", "p_away": f"{prefix}_a",
                                              "T": f"{prefix}_T"}), on="match_id", how="left")  # fmt: skip
    # Mercado y Dixon-Coles tal cual: se deshace el logit de las variables.
    raw = df[["match_id", "day", "res"]].copy()
    for src in ("mk", "dc"):
        cols = [f"{src}_h", f"{src}_d", f"{src}_a"]
        P = 1 / (1 + np.exp(-df[cols].to_numpy(float)))
        raw[cols] = P / P.sum(axis=1, keepdims=True)
    cal = temperature_walk_forward(raw.rename(columns={"mk_h": "ph", "mk_d": "pd", "mk_a": "pa"}), ["ph", "pd", "pa"])
    out = out.merge(raw.drop(columns=["day", "res"]), on="match_id", how="left")
    out = out.merge(cal.rename(columns={"p_home": "mkcal_h", "p_draw": "mkcal_d", "p_away": "mkcal_a", "T": "mkcal_T"}),
                    on="match_id", how="left")  # fmt: skip
    # Frecuencias de la liga: L/E/V de todos sus partidos de dias anteriores.
    counts = np.zeros(3)
    freq = []
    for _day, today in df.sort_values("day").groupby("day", sort=True):
        p = counts / counts.sum() if counts.sum() else np.full(3, 1 / 3)
        freq += [(mid, *p) for mid in today.match_id]
        counts += np.bincount(today.res.to_numpy(), minlength=3)
    out = out.merge(pd.DataFrame(freq, columns=["match_id", "freq_h", "freq_d", "freq_a"]), on="match_id", how="left")
    return out


# --- Evaluacion ----------------------------------------------------------------


def _P(E: pd.DataFrame, prefix: str) -> np.ndarray:
    return E[[f"{prefix}_h", f"{prefix}_d", f"{prefix}_a"]].to_numpy(float)


def _ci(ids: np.ndarray, values: np.ndarray, other: np.ndarray | None = None) -> list[float]:
    point, low, high = bootstrap_mean_diff(ids, values, np.zeros_like(values) if other is None else other)
    return [point, low, high]


def evaluate(E: pd.DataFrame) -> dict:
    ids = E.match_id.to_numpy()
    y = E.res.to_numpy()
    per = {}
    rep = {"n": len(E), "modelos": {}}
    for name, prefix in MODELS.items():
        P = _P(E, prefix)
        per[prefix] = {
            "log_loss": log_loss_per_match(P, y), "rps": rps_per_match(P, y), "brier_doble": brier_dc_per_match(P, y),
            "acierto_resultado": top_hit(P, y), "acierto_doble": best_dc_hit(P, y),
        }  # fmt: skip
        rep["modelos"][name] = {m: _ci(ids, v) for m, v in per[prefix].items()} | {"ece": ece(P, y)}
    rep["siempre_local"] = {"acierto_resultado": _ci(ids, (y == 0).astype(float)),
                            "acierto_doble_1X": _ci(ids, (y != 2).astype(float))}  # fmt: skip
    pairs = {"A - mercado": ("a", "mk"), "A - mercado calibrado": ("a", "mkcal"), "B - Elo": ("b", "elo"),
             "B - Dixon-Coles": ("b", "dc"), "B - mercado": ("b", "mk")}  # fmt: skip
    rep["diferencias"] = {
        label: {m: _ci(ids, per[a][m], per[b][m]) for m in ("log_loss", "rps", "acierto_resultado", "acierto_doble")}
        for label, (a, b) in pairs.items()
    }
    for prefix, label in (("a", "A"), ("b", "B"), ("mk", "mercado")):
        P = _P(E, prefix)
        rep[f"calibracion_{label}"] = [b.__dict__ for b in calibration_bins(P, y)]
        rep[f"cobertura_{label}"] = {
            "resultado": coverage_accuracy(P.max(axis=1), top_hit(P, y)),
            "doble": coverage_accuracy(double_chance(P).max(axis=1), best_dc_hit(P, y)),
        }
        rep[f"alta_confianza_{label}"] = high_confidence(P, y)
    return rep


def criterion(dev: dict) -> dict:
    m, d = dev["modelos"], dev["diferencias"]
    a_ok = m["A (con mercado)"]["ece"] <= 0.02 and d["A - mercado"]["log_loss"][1] <= 0
    b_ok = (
        m["B (sin mercado)"]["ece"] <= 0.02
        and d["B - Elo"]["log_loss"][1] <= 0
        and d["B - Dixon-Coles"]["log_loss"][1] <= 0
    )
    return {"A": bool(a_ok), "B": bool(b_ok)}


def print_tables(label: str, rep: dict) -> None:
    pct = lambda x: f"{100 * x:5.1f}"  # noqa: E731
    print(f"\n== {label}: {rep['n']} partidos")
    print(f"{'modelo':24} {'log-loss':>8} {'RPS':>6} {'Brier DO':>8} {'acierto':>7} {'doble':>6} {'ECE':>6}")
    for name, v in rep["modelos"].items():
        print(f"{name:24} {v['log_loss'][0]:8.4f} {v['rps'][0]:6.4f} {v['brier_doble'][0]:8.4f} "
              f"{pct(v['acierto_resultado'][0]):>7} {pct(v['acierto_doble'][0]):>6} {v['ece']:6.3f}")  # fmt: skip
    for label2, v in rep["diferencias"].items():
        ll = v["log_loss"]
        print(f"  {label2:24} log-loss {ll[0]:+.4f} [{ll[1]:+.4f}; {ll[2]:+.4f}]")
    for who in ("A", "B"):
        hc = rep[f"alta_confianza_{who}"]
        for kind in ("resultado", "doble"):
            h = hc[kind]["alta"]
            print(f"  Alta confianza {who} {kind:9}: cobertura {pct(h['cobertura'])} %, acierto "
                  f"{pct(h['acierto']) if h['n'] else '  —'} % (n={h['n']})")  # fmt: skip


def stage_run(dry: bool = False) -> None:
    t0 = time.time()
    F = features()
    print(f"variables: {len(F)} partidos jugados, {time.time() - t0:.0f}s", flush=True)
    if dry:
        print(F.groupby(["league", "season"]).size().unstack().to_string())
        print(F[COLS_A].isna().mean().round(3).to_string())
        eng = F[(F.league == LEAGUES[0]) & (F.season < "2526") & F.dc_h.notna() & F.mk_h.notna()]
        from app.probability.result_model import fit_softmax

        X = eng[COLS_A].to_numpy(float)
        X = np.where(np.isnan(X), np.nanmean(X, axis=0), X)
        X = (X - X.mean(axis=0)) / np.where(X.std(axis=0) == 0, 1, X.std(axis=0))
        W = fit_softmax(X, eng.res.to_numpy())
        print("ajuste A:", X.shape, "pesos finitos:", bool(np.isfinite(W).all()), f"{time.time() - t0:.0f}s")
        return

    with Pool(len(LEAGUES)) as pool:
        preds = pd.concat(pool.map(_league_predictions, [(c, F[F.league == c]) for c in LEAGUES]))
    E = F[["match_id", "league", "season", "res"]].merge(preds, on="match_id")
    E.to_csv(CACHE / "result_predictions.csv", index=False)
    cols = [f"{p}_{k}" for p in MODELS.values() for k in ("h", "d", "a")]
    complete = E[cols].notna().all(axis=1)
    print(f"predicciones: {len(E)}; con todos los modelos: {int(complete.sum())}; {time.time() - t0:.0f}s", flush=True)
    E = E[complete]

    report = {"version": "resultado_v1", "desarrollo": evaluate(E[E.season.isin(DEV)])}
    report["criterio"] = criterion(report["desarrollo"])
    print_tables("Desarrollo 22/23-25/26", report["desarrollo"])
    print("criterio (desarrollo):", report["criterio"], flush=True)
    report["prueba"] = evaluate(E[E.season.isin(TEST)])  # una sola vez, al final
    print_tables("Prueba 26/27", report["prueba"])
    (CACHE / "result_backtest.json").write_text(json.dumps(report, default=float, indent=1), encoding="utf-8")
    print(f"total {time.time() - t0:.0f}s")


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "dc":
        stage_dc()
    elif stage in ("dry", "run"):
        stage_run(dry=stage == "dry")
    else:
        sys.exit(__doc__)
