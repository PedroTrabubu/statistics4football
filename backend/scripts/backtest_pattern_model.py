"""Backtest del modelo de patrones (protocolo en docs/MODELO_PATRONES.md).

Tres fases, en este orden:

    python scripts/backtest_pattern_model.py build   # dataset point-in-time (lento: reajusta Dixon-Coles mes a mes)
    python scripts/backtest_pattern_model.py dev     # entrena 21/22-23/24, elige umbrales en 24/25 y los congela
    python scripts/backtest_pattern_model.py test    # una sola vez: reentrena hasta 24/25 y evalua 25/26 + 26/27
    python scripts/backtest_pattern_model.py export  # guarda el modelo probado en el test para la web
    python scripts/backtest_pattern_model.py history # vuelca sus selecciones del test al historico de la web

`dev` nunca lee filas del test. `test` se niega a ejecutarse sin la
configuracion congelada por `dev`.
"""

import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.models import League, Match, MatchOdds, MatchStatus, ModelPrediction  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.probability.engine import fit_league_model  # noqa: E402
from app.probability.pattern_engine import build_prediction_rows  # noqa: E402
from app.probability.pattern_model import (  # noqa: E402
    FEATURE_SOURCES,
    MODEL_VERSION,
    PARAMS_PATH,
    SELECTION_KEYS,
    SELECTIONS,
    PatternModelParams,
    PatternTracker,
    choose_selection,
    fit_logistic,
    logit,
    market_probabilities,
    selection_probs_from_matrix,
)

ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = ROOT / "data" / "model_cache"
DATASET = CACHE_DIR / "pattern_dataset.csv"
FROZEN_CONFIG = ROOT / "docs" / "modelo_patrones_config.json"

WARMUP = ["2021"]
TRAIN = ["2122", "2223", "2324"]
VALIDATION = ["2425"]
TEST = ["2526", "2627"]

TARGET_HIT_RATE = 0.72
MIN_PICKS_TAU = 100
MIN_PICKS_DELTA = 50
TAU_GRID = [round(x, 2) for x in np.arange(0.60, 0.905, 0.01)]
DELTA_GRID = [0.01, 0.02, 0.03, 0.05]

REFERENCE_BOOKMAKER = "Market Average"  # pre-partido; nunca "(closing)"
MARKET_BY_KEY = {s.key: s.market for s in SELECTIONS}


# --- build -------------------------------------------------------------------


def _prematch_odds(db, match_ids: list[int]) -> dict[int, dict[str, float]]:
    rows = (
        db.query(MatchOdds)
        .filter(
            MatchOdds.match_id.in_(match_ids),
            MatchOdds.bookmaker == REFERENCE_BOOKMAKER,
            MatchOdds.market.in_(["1x2", "over_under_2.5"]),
        )
        .all()
    )
    out: dict[int, dict[str, float]] = defaultdict(dict)
    for r in rows:
        key = r.selection if r.market == "1x2" else f"{r.selection}_2.5"
        out[r.match_id][key] = r.odds
    return out


def build() -> None:
    db = SessionLocal()
    records = []
    try:
        for league in db.query(League).all():
            matches = (
                db.query(Match)
                .filter(
                    Match.league_id == league.id,
                    Match.status == MatchStatus.HISTORICAL,
                    Match.home_goals.is_not(None),
                    Match.away_goals.is_not(None),
                )
                .order_by(Match.date.asc(), Match.id.asc())
                .all()
            )
            odds = _prematch_odds(db, [m.id for m in matches])

            # Dixon-Coles walk-forward: un reajuste por mes con todo lo anterior.
            dc_probs: dict[int, dict[str, float]] = {}
            to_predict = [m for m in matches if m.season.name not in WARMUP]
            months = sorted({(m.date.year, m.date.month) for m in to_predict})
            for i, (year, month) in enumerate(months, start=1):
                month_matches = [m for m in to_predict if (m.date.year, m.date.month) == (year, month)]
                cutoff = min(m.date for m in month_matches)
                model = fit_league_model(db, league.id, before_date=cutoff)
                for m in month_matches:
                    dc_probs[m.id] = selection_probs_from_matrix(model.score_matrix(m.home_team_id, m.away_team_id))
                print(f"  {league.code}: Dixon-Coles {year}-{month:02d} ({i}/{len(months)})", flush=True)

            tracker = PatternTracker()
            for m in matches:
                patterns = tracker.features(m.home_team_id, m.away_team_id)
                tracker.add(m.home_team_id, m.away_team_id, m.home_goals, m.away_goals)
                if m.id not in dc_probs:
                    continue

                o = odds.get(m.id, {})
                p_mkt = market_probabilities(o)
                if p_mkt is None:
                    continue  # sin cuotas pre-partido: fuera de la evaluacion de todos los modelos

                rec = {
                    "match_id": m.id,
                    "league": league.code,
                    "season": m.season.name,
                    "date": m.date.isoformat(),
                    "home_goals": m.home_goals,
                    "away_goals": m.away_goals,
                    "odds_home": o["home"],
                    "odds_draw": o["draw"],
                    "odds_away": o["away"],
                    "odds_over_2.5": o.get("over_2.5"),
                    "odds_under_2.5": o.get("under_2.5"),
                }
                for sel in SELECTIONS:
                    k = sel.key
                    rec[f"y_{k}"] = int(sel.resolve(m.home_goals, m.away_goals))
                    rec[f"mkt_{k}"] = p_mkt[k]
                    rec[f"dc_{k}"] = dc_probs[m.id][k]
                    rec[f"patv_{k}"] = patterns[k]["pat_venue"]
                    rec[f"pata_{k}"] = patterns[k]["pat_all"]
                records.append(rec)
    finally:
        db.close()

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    pd.DataFrame.from_records(records).to_csv(DATASET, index=False)
    print(f"Dataset: {len(records)} partidos -> {DATASET}")


# --- modelos -----------------------------------------------------------------

VARIANTS = {
    # nombre: (columnas de features por seleccion, se apila con logistica)
    "modelo": FEATURE_SOURCES,
    "mercado_dc": ["mkt", "dc"],
    "patrones": ["patv", "pata"],
}


def _features(df: pd.DataFrame, key: str, sources: list[str]) -> np.ndarray:
    return np.column_stack([logit(df[f"{src}_{key}"].to_numpy()) for src in sources])


def predict_variants(train: pd.DataFrame, evaluate: pd.DataFrame) -> tuple[dict[str, dict[str, np.ndarray]], dict]:
    """{variante: {seleccion: probabilidades sobre `evaluate`}} y coeficientes."""
    preds: dict[str, dict[str, np.ndarray]] = {
        "mercado": {k: evaluate[f"mkt_{k}"].to_numpy() for k in SELECTION_KEYS},
        "dixon_coles": {k: evaluate[f"dc_{k}"].to_numpy() for k in SELECTION_KEYS},
    }
    coefs: dict = {}
    for name, sources in VARIANTS.items():
        preds[name] = {}
        for k in SELECTION_KEYS:
            model = fit_logistic(_features(train, k, sources), train[f"y_{k}"].to_numpy())
            preds[name][k] = model.predict(_features(evaluate, k, sources))
            if name == "modelo":
                coefs[k] = dict(zip(["intercepto", *sources], np.round(model.coef, 3).tolist(), strict=True))
    return preds, coefs


# --- seleccion y metricas ----------------------------------------------------


def _pick_odds(df: pd.DataFrame) -> dict[str, np.ndarray]:
    oh, od, oa = df["odds_home"].to_numpy(), df["odds_draw"].to_numpy(), df["odds_away"].to_numpy()
    return {
        "home": oh,
        "draw": od,
        "away": oa,
        # Doble oportunidad sintetica: combina las dos cuotas, margen incluido.
        "1X": 1 / (1 / oh + 1 / od),
        "X2": 1 / (1 / oa + 1 / od),
        "12": 1 / (1 / oh + 1 / oa),
        "over_2.5": df["odds_over_2.5"].to_numpy(dtype=float),
        "under_2.5": df["odds_under_2.5"].to_numpy(dtype=float),
    }


def pick(df: pd.DataFrame, probs: dict[str, np.ndarray], tau: float, delta: float | None) -> list[tuple[int, str]]:
    """Aplica choose_selection (la misma regla que usa la web) a cada partido."""
    picks = []
    for i in range(len(df)):
        p = {k: probs[k][i] for k in SELECTION_KEYS}
        p_mkt = {k: df[f"mkt_{k}"].iat[i] for k in SELECTION_KEYS}
        key = choose_selection(p, p_mkt, tau, delta)
        if key is not None:
            picks.append((i, key))
    return picks


def evaluate_picks(df: pd.DataFrame, probs: dict[str, np.ndarray], picks: list[tuple[int, str]]) -> dict:
    odds = _pick_odds(df)
    hits, p_mkt, p_model = [], [], []
    pnl, n_odds = 0.0, 0
    by_market: dict[str, list[int]] = defaultdict(list)
    for i, k in picks:
        y = int(df[f"y_{k}"].iat[i])
        hits.append(y)
        p_mkt.append(df[f"mkt_{k}"].iat[i])
        p_model.append(probs[k][i])
        by_market[MARKET_BY_KEY[k]].append(y)
        o = odds.get(k)
        if o is not None and not np.isnan(o[i]):
            n_odds += 1
            pnl += (o[i] - 1) if y else -1
    n = len(picks)
    return {
        "n": n,
        "acierto": round(100 * np.mean(hits), 1) if n else None,
        "prob_mercado_media": round(100 * np.mean(p_mkt), 1) if n else None,
        "prob_modelo_media": round(100 * np.mean(p_model), 1) if n else None,
        "margen_sobre_mercado_pp": round(100 * (np.mean(hits) - np.mean(p_mkt)), 1) if n else None,
        "con_cuota": n_odds,
        "roi_pct": round(100 * pnl / n_odds, 1) if n_odds else None,
        "por_mercado": {m: {"n": len(v), "acierto": round(100 * np.mean(v), 1)} for m, v in sorted(by_market.items())},
    }


def choose_tau(df: pd.DataFrame, probs: dict[str, np.ndarray]) -> float | None:
    for tau in TAU_GRID:
        res = evaluate_picks(df, probs, pick(df, probs, tau, None))
        if res["n"] >= MIN_PICKS_TAU and res["acierto"] >= 100 * TARGET_HIT_RATE:
            return tau
    return None


def choose_delta(df: pd.DataFrame, probs: dict[str, np.ndarray], tau: float) -> float | None:
    best, best_delta = None, None
    for delta in DELTA_GRID:
        res = evaluate_picks(df, probs, pick(df, probs, tau, delta))
        if res["con_cuota"] >= MIN_PICKS_DELTA and res["roi_pct"] is not None:
            if best is None or res["roi_pct"] > best:
                best, best_delta = res["roi_pct"], delta
    return best_delta


def log_losses(df: pd.DataFrame, preds: dict[str, dict[str, np.ndarray]]) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for variant, probs in preds.items():
        per_market: dict[str, list[float]] = defaultdict(list)
        for k in SELECTION_KEYS:
            p = np.clip(probs[k], 1e-6, 1 - 1e-6)
            y = df[f"y_{k}"].to_numpy()
            per_market[MARKET_BY_KEY[k]].append(float(np.mean(-(y * np.log(p) + (1 - y) * np.log(1 - p)))))
        out[variant] = {m: round(float(np.mean(v)), 4) for m, v in per_market.items()}
    return out


def report(title: str, df: pd.DataFrame, preds, config: dict) -> dict:
    print(f"\n=== {title}: {len(df)} partidos ===")
    results = {}
    for variant, probs in preds.items():
        cfg = config.get(variant, {})
        tau, delta = cfg.get("tau"), cfg.get("delta")
        results[variant] = {"tau": tau, "delta": delta}
        if tau is None:
            print(f"  {variant:12s} ningun tau alcanza {100 * TARGET_HIT_RATE:.0f}% con >= {MIN_PICKS_TAU} picks")
            continue
        for strategy, d in (("A", None), ("B", delta)):
            if strategy == "B" and d is None:
                continue
            res = evaluate_picks(df, probs, pick(df, probs, tau, d))
            results[variant][strategy] = res
            print(
                f"  {variant:12s} {strategy} tau={tau:.2f}"
                + (f" delta={d:.2f}" if d is not None else "           ")
                + f"  picks={res['n']:4d}  acierto={res['acierto']}%  mercado esperaba={res['prob_mercado_media']}%"
                f"  margen={res['margen_sobre_mercado_pp']:+}pp  ROI={res['roi_pct']}% ({res['con_cuota']} con cuota)"
            )
            print(f"{'':17s}{res['por_mercado']}")
    results["log_loss"] = log_losses(df, preds)
    print("  log-loss por mercado (menor es mejor):")
    for variant, ll in results["log_loss"].items():
        print(f"    {variant:12s} {ll}")
    return results


# --- fases -------------------------------------------------------------------


def load_dataset() -> pd.DataFrame:
    if not DATASET.exists():
        sys.exit("Falta el dataset: ejecuta primero `build`.")
    return pd.read_csv(DATASET, dtype={"season": str})


def dev() -> None:
    df = load_dataset()
    train = df[df.season.isin(TRAIN)].reset_index(drop=True)
    val = df[df.season.isin(VALIDATION)].reset_index(drop=True)
    print(f"Entrenamiento {TRAIN}: {len(train)} partidos · Validacion {VALIDATION}: {len(val)} partidos")

    preds, coefs = predict_variants(train, val)
    config = {}
    for variant, probs in preds.items():
        tau = choose_tau(val, probs)
        config[variant] = {"tau": tau, "delta": choose_delta(val, probs, tau) if tau is not None else None}

    print("\nCoeficientes del modelo (features estandarizadas):")
    for k, c in coefs.items():
        print(f"  {k:12s} {c}")
    results = report("VALIDACION 24/25", val, preds, config)

    FROZEN_CONFIG.write_text(
        json.dumps(
            {
                "congelado": datetime.now().isoformat(timespec="seconds"),
                "entrenamiento_final": TRAIN + VALIDATION,
                "test": TEST,
                "umbrales": config,
                "validacion": results,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"\nConfiguracion congelada en {FROZEN_CONFIG}")


def test() -> None:
    if not FROZEN_CONFIG.exists():
        sys.exit("No hay configuracion congelada: ejecuta `dev` primero. El test no elige umbrales.")
    frozen = json.loads(FROZEN_CONFIG.read_text(encoding="utf-8"))
    df = load_dataset()
    train = df[df.season.isin(TRAIN + VALIDATION)].reset_index(drop=True)
    test_df = df[df.season.isin(TEST)].reset_index(drop=True)
    print(f"Entrenamiento {TRAIN + VALIDATION}: {len(train)} partidos · Test {TEST}: {len(test_df)} partidos")
    print(f"Configuracion congelada el {frozen['congelado']}")

    preds, _ = predict_variants(train, test_df)
    results = report("TEST 25/26 + 26/27", test_df, preds, frozen["umbrales"])
    out = CACHE_DIR / "test_results.json"
    out.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nResultados en {out}")


def _tested_params() -> PatternModelParams:
    """El mismo modelo que se evaluo en el test: entrenado con
    entrenamiento + validacion y con los umbrales congelados en `dev`."""
    if not FROZEN_CONFIG.exists():
        sys.exit("No hay configuracion congelada: ejecuta `dev` primero.")
    frozen = json.loads(FROZEN_CONFIG.read_text(encoding="utf-8"))["umbrales"]["modelo"]
    df = load_dataset()
    train = df[df.season.isin(TRAIN + VALIDATION)].reset_index(drop=True)
    models = {
        k: fit_logistic(_features(train, k, FEATURE_SOURCES), train[f"y_{k}"].to_numpy()) for k in SELECTION_KEYS
    }
    return PatternModelParams(tau=frozen["tau"], delta=frozen["delta"], trained_on=TRAIN + VALIDATION, models=models)


def export() -> None:
    params = _tested_params()
    PARAMS_PATH.write_text(params.to_json(), encoding="utf-8")
    print(f"Modelo exportado (tau={params.tau}, delta={params.delta}) -> {PARAMS_PATH}")


def history() -> None:
    """Guarda como pattern_v1 las predicciones de los partidos del test, con
    el mismo modelo y la misma regla del test: es el historico real fuera de
    muestra que muestra la web (sin elegir nada a posteriori)."""
    params = _tested_params()
    test_df = load_dataset()
    test_df = test_df[test_df.season.isin(TEST)].reset_index(drop=True)

    db = SessionLocal()
    try:
        match_ids = test_df["match_id"].astype(int).tolist()
        db.query(ModelPrediction).filter(
            ModelPrediction.model_version == MODEL_VERSION, ModelPrediction.match_id.in_(match_ids)
        ).delete(synchronize_session=False)

        # Muestra point-in-time de cada partido: partidos previos de cada equipo.
        matches_used: dict[int, int] = {}
        for league in db.query(League).all():
            tracker = PatternTracker()
            for m in (
                db.query(Match)
                .filter(
                    Match.league_id == league.id,
                    Match.status == MatchStatus.HISTORICAL,
                    Match.home_goals.is_not(None),
                    Match.away_goals.is_not(None),
                )
                .order_by(Match.date.asc(), Match.id.asc())
            ):
                matches_used[m.id] = tracker.matches_available(m.home_team_id, m.away_team_id)
                tracker.add(m.home_team_id, m.away_team_id, m.home_goals, m.away_goals)

        n_picks = 0
        for _, row in test_df.iterrows():
            features = {k: {src: row[f"{src}_{k}"] for src in FEATURE_SOURCES} for k in SELECTION_KEYS}
            odds = {
                "home": row["odds_home"],
                "draw": row["odds_draw"],
                "away": row["odds_away"],
                "over_2.5": row["odds_over_2.5"],
                "under_2.5": row["odds_under_2.5"],
            }
            rows = build_prediction_rows(
                match_id=int(row["match_id"]),
                features=features,
                odds={k: v for k, v in odds.items() if pd.notna(v)},
                params=params,
                matches_used=matches_used[int(row["match_id"])],
            )
            n_picks += sum(r.is_recommended for r in rows)
            db.add_all(rows)
        db.commit()
        print(f"Historico pattern_v1: {len(test_df)} partidos, {n_picks} selecciones recomendadas")
    finally:
        db.close()


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    stages = {"build": build, "dev": dev, "test": test, "export": export, "history": history}
    stages.get(stage, lambda: sys.exit(__doc__))()
