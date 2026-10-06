"""Backtest de los picks (protocolo en docs/PICKS_PROTOCOLO.md).

    python scripts/backtest_picks.py build    # dataset point-in-time por jornada
    python scripts/backtest_picks.py dev      # entrena 21/22-23/24, valida en 24/25 y congela
    python scripts/backtest_picks.py test     # una sola vez: entrena hasta 24/25 y evalua 25/26 + 26/27
    python scripts/backtest_picks.py export   # guarda el modelo probado para la web
    python scripts/backtest_picks.py history  # vuelca las combinadas del test al historico de la web

`dev` nunca lee filas del test; `test` exige la configuracion congelada.
"""

import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.models import League, Match, MatchOdds, MatchStatus, TeamMatchStats  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.picks.combos import Combo  # noqa: E402
from app.picks.count_model import N_FEATURES, SIDES, STATS, CountTracker, fit_count_model  # noqa: E402
from app.picks.engine import PARAMS_PATH, PATTERN_TO_LEG, PicksParams, market_goals, window_key  # noqa: E402
from app.picks.legs import FAMILIES, MIN_PROB, Leg, LegKey, match_legs, resolve_leg  # noqa: E402
from app.probability.pattern_model import FEATURE_SOURCES, fit_logistic, logit  # noqa: E402
from app.picks.service import build_window_combos, delete_combos, save_combos  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = ROOT / "data" / "model_cache"
DATASET = CACHE_DIR / "picks_dataset.csv"
PATTERN_DATASET = CACHE_DIR / "pattern_dataset.csv"  # de scripts/backtest_pattern_model.py build
FROZEN_CONFIG = ROOT / "docs" / "picks_config.json"

WARMUP = ["2021"]
TRAIN = ["2122", "2223", "2324"]
VALIDATION = ["2425"]
TEST = ["2526", "2627"]

# Regla de validacion del protocolo.
CALIB_MIN_PROB = 0.60
CALIB_MAX_GAP = 0.03
CALIB_MIN_LEGS = 200

SCOPES = ["todas", "ESP-La Liga", "ENG-Premier League"]

# v3: opciones evaluadas en validacion (docs/PICKS_PROTOCOLO.md).
V3_TIER_MIN_PROB = 0.30
ODDS_COLUMNS = ["home", "draw", "away", "over_2.5", "under_2.5"]


def _feature_cols(stat: str, side: str) -> list[str]:
    return [f"{stat}_{side}_{i}" for i in range(N_FEATURES)]


# --- build -------------------------------------------------------------------


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
            ids = [m.id for m in matches]
            stats = {(s.match_id, s.team_id): s for s in db.query(TeamMatchStats).filter(TeamMatchStats.match_id.in_(ids))}
            odds: dict[int, dict[str, float]] = defaultdict(dict)
            for r in db.query(MatchOdds).filter(
                MatchOdds.match_id.in_(ids),
                MatchOdds.bookmaker == "Market Average",
                MatchOdds.market.in_(["1x2", "over_under_2.5"]),
            ):
                odds[r.match_id][r.selection if r.market == "1x2" else f"{r.selection}_2.5"] = r.odds

            trackers = {stat: CountTracker() for stat in STATS}
            by_window: dict[str, list[Match]] = defaultdict(list)
            for m in matches:
                by_window[window_key(m.date)].append(m)

            for window in sorted(by_window):
                window_matches = by_window[window]
                # Features de toda la jornada con lo anterior a la jornada.
                feats = {
                    m.id: {stat: trackers[stat].features(m.home_team_id, m.away_team_id) for stat in STATS}
                    for m in window_matches
                }
                for m in window_matches:
                    hs, as_ = stats.get((m.id, m.home_team_id)), stats.get((m.id, m.away_team_id))
                    values = {
                        "corners": (hs.corners_for if hs else None, as_.corners_for if as_ else None),
                        "yellow": (hs.yellow_cards if hs else None, as_.yellow_cards if as_ else None),
                    }
                    if m.season.name not in WARMUP:
                        o = odds.get(m.id, {})
                        lm = market_goals(o)
                        rec = {
                            "match_id": m.id,
                            "league": league.code,
                            "season": m.season.name,
                            "window": window,
                            "home_goals": m.home_goals,
                            "away_goals": m.away_goals,
                            "home_corners": values["corners"][0],
                            "away_corners": values["corners"][1],
                            "home_yellow": values["yellow"][0],
                            "away_yellow": values["yellow"][1],
                            "lam": lm[0] if lm else None,
                            "mu": lm[1] if lm else None,
                            **{f"odds_{k}": o.get(k) for k in ODDS_COLUMNS},
                        }
                        for stat in STATS:
                            for side in SIDES:
                                rec.update(dict(zip(_feature_cols(stat, side), feats[m.id][stat][side], strict=True)))
                        records.append(rec)
                # La jornada entra en el historial solo despues de calcularla entera.
                for m in window_matches:
                    hs, as_ = stats.get((m.id, m.home_team_id)), stats.get((m.id, m.away_team_id))
                    if hs and as_ and hs.corners_for is not None and as_.corners_for is not None:
                        trackers["corners"].add(m.home_team_id, m.away_team_id, hs.corners_for, as_.corners_for)
                    if hs and as_ and hs.yellow_cards is not None and as_.yellow_cards is not None:
                        trackers["yellow"].add(m.home_team_id, m.away_team_id, hs.yellow_cards, as_.yellow_cards)
            print(f"  {league.code}: {len(by_window)} jornadas", flush=True)
    finally:
        db.close()

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    pd.DataFrame.from_records(records).to_csv(DATASET, index=False)
    print(f"Dataset: {len(records)} partidos -> {DATASET}")


# --- modelo y evaluacion -----------------------------------------------------


def load_dataset() -> pd.DataFrame:
    if not DATASET.exists():
        sys.exit("Falta el dataset: ejecuta primero `build`.")
    return pd.read_csv(DATASET, dtype={"season": str, "window": str})


def fit_params(train: pd.DataFrame, excluded: list[str]) -> PicksParams:
    models = {}
    for stat in STATS:
        for side in SIDES:
            rows = train.dropna(subset=[f"{side}_{stat}"])
            models[(stat, side)] = fit_count_model(
                rows[_feature_cols(stat, side)].to_numpy(), rows[f"{side}_{stat}"].to_numpy(dtype=float)
            )
    return PicksParams(models=models, excluded_families=excluded, trained_on=sorted(train.season.unique().tolist()))


def _row_odds(row: pd.Series) -> dict[str, float]:
    return {k: row[f"odds_{k}"] for k in ODDS_COLUMNS if pd.notna(row[f"odds_{k}"])}


def _row_features(row: pd.Series) -> dict[str, dict[str, list[float]]]:
    return {stat: {side: [row[c] for c in _feature_cols(stat, side)] for side in SIDES} for stat in STATS}


def _outcomes(row: pd.Series) -> dict:
    def pair(a: str, b: str):
        return None if pd.isna(row[a]) or pd.isna(row[b]) else (int(row[a]), int(row[b]))

    return {
        "goals": (int(row["home_goals"]), int(row["away_goals"])),
        "corners": pair("home_corners", "away_corners"),
        "yellow": pair("home_yellow", "away_yellow"),
    }


def leg_won(leg: Leg, outcomes: dict) -> bool | None:
    return resolve_leg(leg.market, leg.selection, leg.line, outcomes["goals"], outcomes["corners"], outcomes["yellow"])


def pattern_probs(train_seasons: list[str]) -> dict[int, dict[LegKey, float]]:
    """Probabilidades del modelo de patrones entrenado solo con train_seasons,
    para todos los partidos de su dataset (point-in-time)."""
    if not PATTERN_DATASET.exists():
        sys.exit("Falta pattern_dataset.csv: ejecuta `python scripts/backtest_pattern_model.py build`.")
    pdf = pd.read_csv(PATTERN_DATASET, dtype={"season": str})
    train = pdf[pdf.season.isin(train_seasons)]
    out: dict[int, dict[LegKey, float]] = defaultdict(dict)
    for key, leg_key in PATTERN_TO_LEG.items():
        cols = [f"{src}_{key}" for src in FEATURE_SOURCES]
        model = fit_logistic(logit(train[cols].to_numpy()), train[f"y_{key}"].to_numpy())
        for mid, p in zip(pdf["match_id"].astype(int), model.predict(logit(pdf[cols].to_numpy())), strict=True):
            out[mid][leg_key] = float(p)
    return out


def evaluate(df: pd.DataFrame, params: PicksParams, overrides: dict[int, dict[LegKey, float]] | None = None) -> dict:
    """Patas, combinadas por nivel/ambito y combinadas del mismo partido."""
    outcomes = {int(r.match_id): _outcomes(r) for _, r in df.iterrows()}
    league_of = {int(r.match_id): r.league for _, r in df.iterrows()}
    excluded = set(params.excluded_families)

    all_legs: list[tuple[Leg, bool | None]] = []
    combos: list[tuple[str, str, Combo]] = []  # (jornada, ambito, combo)
    for window, wdf in df.groupby("window"):
        legs_by_match = {}
        for _, row in wdf.iterrows():
            lm = (row["lam"], row["mu"]) if pd.notna(row["lam"]) else None
            dist = params.distributions(int(row.match_id), _row_odds(row), _row_features(row), lm)
            ovr = overrides.get(int(row.match_id)) if (params.use_pattern_probs and overrides) else None
            legs_by_match[int(row.match_id)] = (
                dist,
                match_legs(dist, excluded),
                match_legs(dist, excluded, params.tier_min_prob, ovr),
            )
            # Calibracion: todas las patas candidatas (sin la exclusion, para poder medirla).
            for leg in match_legs(dist):
                all_legs.append((leg, leg_won(leg, outcomes[leg.match_id])))
        league_in_window = {mid: league_of[mid] for mid in legs_by_match}
        combos += [(window, scope, c) for scope, c in build_window_combos(legs_by_match, league_in_window)]
    return {"legs": all_legs, "combos": combos, "outcomes": outcomes}


def combo_won(combo: Combo, outcomes: dict) -> bool | None:
    results = [leg_won(l, outcomes[l.match_id]) for l in combo.legs]
    if any(r is False for r in results):
        return False
    return None if any(r is None for r in results) else True


def calibration(legs: list[tuple[Leg, bool | None]]) -> dict[str, dict]:
    out = {}
    for family in FAMILIES:
        rows = [(l.prob, w) for l, w in legs if l.family == family and w is not None]
        hi = [(p, w) for p, w in rows if p >= CALIB_MIN_PROB]
        if not rows:
            continue
        p = np.array([r[0] for r in rows])
        y = np.array([r[1] for r in rows], dtype=float)
        out[family] = {
            "patas": len(rows),
            "pred_media": round(100 * p.mean(), 1),
            "acierto": round(100 * y.mean(), 1),
            "brier": round(float(np.mean((p - y) ** 2)), 4),
            "patas_p60": len(hi),
            "pred_media_p60": round(100 * np.mean([r[0] for r in hi]), 1) if hi else None,
            "acierto_p60": round(100 * np.mean([r[1] for r in hi]), 1) if hi else None,
        }
    return out


def summarize_combos(result: dict) -> dict:
    groups: dict[tuple[str, str], list] = defaultdict(list)
    for _, scope, combo in result["combos"]:
        groups[(scope, combo.kind)].append((combo, combo_won(combo, result["outcomes"])))
    out = {}
    for (scope, kind), rows in sorted(groups.items()):
        settled = [(c, w) for c, w in rows if w is not None]
        real = [(c, w) for c, w in settled if c.odds_kind == "real"]
        pnl = sum((c.odds - 1) if w else -1 for c, w in settled)
        real_pnl = sum((c.odds - 1) if w else -1 for c, w in real)
        out[f"{scope} | {kind}"] = {
            "combinadas": len(rows),
            "acierto": round(100 * np.mean([w for _, w in settled]), 1) if settled else None,
            "prob_predicha_media": round(100 * np.mean([c.prob for c, _ in settled]), 1) if settled else None,
            "cuota_media": round(float(np.mean([c.odds for c, _ in settled])), 2) if settled else None,
            "patas_media": round(float(np.mean([len(c.legs) for c, _ in settled])), 1) if settled else None,
            "roi_cuota_mostrada": round(100 * pnl / len(settled), 1) if settled else None,
            "con_cuota_real": len(real),
            "roi_real": round(100 * real_pnl / len(real), 1) if real else None,
        }
    return out


def print_report(title: str, calib: dict, combos: dict) -> None:
    print(f"\n=== {title} ===")
    print("Calibracion por familia (todas las patas candidatas; p>=0.60 aparte):")
    for fam, c in calib.items():
        print(
            f"  {fam:18s} patas={c['patas']:6d} pred={c['pred_media']}% real={c['acierto']}% brier={c['brier']}"
            f" | p>=.60: n={c['patas_p60']} pred={c['pred_media_p60']}% real={c['acierto_p60']}%"
        )
    print("Combinadas:")
    for key, c in combos.items():
        print(
            f"  {key:34s} n={c['combinadas']:3d} acierto={c['acierto']}% predicho={c['prob_predicha_media']}%"
            f" cuota={c['cuota_media']} patas={c['patas_media']} ROI(cuota mostrada)={c['roi_cuota_mostrada']}%"
            f" real: n={c['con_cuota_real']} ROI={c['roi_real']}%"
        )


# --- fases -------------------------------------------------------------------


def _promised(result: dict) -> float:
    """Probabilidad media prometida de Alta y Bomba (ligas mezcladas)."""
    probs = [c.prob for _, scope, c in result["combos"] if scope == "todas" and c.kind in ("alta", "bomba")]
    return float(np.mean(probs))


def _calib(rows: list[tuple[float, bool]]) -> tuple[int, float, float]:
    if not rows:
        return 0, 0.0, 0.0
    pred = 100 * float(np.mean([p for p, _ in rows]))
    real = 100 * float(np.mean([w for _, w in rows]))
    return len(rows), round(pred, 1), round(real, 1)


def _selected_legs(result: dict) -> list[tuple[float, bool]]:
    """(probabilidad, acierto) de las patas que el optimizador eligio para Alta y Bomba (ligas mezcladas)."""
    rows = []
    for _, scope, combo in result["combos"]:
        if scope != "todas" or combo.kind not in ("alta", "bomba"):
            continue
        for leg in combo.legs:
            won = leg_won(leg, result["outcomes"][leg.match_id])
            if won is not None:
                rows.append((leg.prob, won))
    return rows


def choose_v3(val: pd.DataFrame, base: PicksParams) -> dict:
    """Regla de decision de la v3 (corregida, ver protocolo): solo validacion.
    Un cambio se acepta si sube la probabilidad prometida de Alta y Bomba y las
    patas que el optimizador elige no aciertan mas de 3 puntos por debajo de lo
    predicho."""
    overrides = pattern_probs(TRAIN)
    log: dict = {}

    def run(min_prob: float, use_pattern: bool) -> dict:
        params = PicksParams(base.models, base.excluded_families, base.trained_on, min_prob, use_pattern)
        return evaluate(val, params, overrides)

    def check(name: str, result: dict, reference: float) -> bool:
        promised = _promised(result)
        n, pred, real = _calib(_selected_legs(result))
        accepted = promised > reference and n >= 100 and real >= pred - 100 * CALIB_MAX_GAP
        log[name] = {"prometido": round(100 * promised, 2), "patas_elegidas": n, "pred": pred, "real": real, "aceptada": accepted}
        return accepted

    base_result = run(MIN_PROB, False)
    base_promised = _promised(base_result)
    n, pred, real = _calib(_selected_legs(base_result))
    log["base_v2"] = {"prometido": round(100 * base_promised, 2), "patas_elegidas": n, "pred": pred, "real": real}

    result_a = run(V3_TIER_MIN_PROB, False)
    accept_a = check("A_suelo_030", result_a, base_promised)
    min_prob = V3_TIER_MIN_PROB if accept_a else MIN_PROB
    reference = _promised(result_a) if accept_a else base_promised
    accept_b = check("B_patrones", run(min_prob, True), reference)

    print("Decision v3 (solo validacion):")
    for k, v in log.items():
        print(f"  {k}: {v}")
    return {"tier_min_prob": min_prob, "use_pattern_probs": accept_b, "overrides": overrides, "log": log}


def dev() -> None:
    df = load_dataset()
    train = df[df.season.isin(TRAIN)]
    val = df[df.season.isin(VALIDATION)]
    print(f"Entrenamiento {TRAIN}: {len(train)} partidos · Validacion {VALIDATION}: {len(val)} partidos")

    params = fit_params(train, excluded=[])
    for (stat, side), m in params.models.items():
        print(f"  modelo {stat}/{side}: coef={np.round(m.coef, 3).tolist()} alpha={m.alpha:.3f}")

    calib = calibration(evaluate(val, params)["legs"])
    excluded = [
        fam
        for fam, c in calib.items()
        if c["patas_p60"] >= CALIB_MIN_LEGS and c["acierto_p60"] < c["pred_media_p60"] - 100 * CALIB_MAX_GAP
    ]
    print(f"\nFamilias excluidas por la regla de validacion: {excluded or 'ninguna'}")

    params.excluded_families = excluded
    v3 = choose_v3(val, params)
    params.tier_min_prob, params.use_pattern_probs = v3["tier_min_prob"], v3["use_pattern_probs"]
    result = evaluate(val, params, v3["overrides"])
    combos = summarize_combos(result)
    print_report("VALIDACION 24/25 (configuracion elegida)", calib, combos)

    FROZEN_CONFIG.write_text(
        json.dumps(
            {
                "congelado": datetime.now().isoformat(timespec="seconds"),
                "entrenamiento_final": TRAIN + VALIDATION,
                "test": TEST,
                "familias_excluidas": excluded,
                "suelo_patas_niveles": params.tier_min_prob,
                "probabilidades_patrones": params.use_pattern_probs,
                "decision_v3": v3["log"],
                "validacion": {"calibracion": calib, "combinadas": combos},
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"\nConfiguracion congelada en {FROZEN_CONFIG}")


def _tested_params() -> PicksParams:
    if not FROZEN_CONFIG.exists():
        sys.exit("No hay configuracion congelada: ejecuta `dev` primero. El test no decide nada.")
    frozen = json.loads(FROZEN_CONFIG.read_text(encoding="utf-8"))
    df = load_dataset()
    params = fit_params(df[df.season.isin(TRAIN + VALIDATION)], excluded=frozen["familias_excluidas"])
    params.tier_min_prob = frozen.get("suelo_patas_niveles", MIN_PROB)
    params.use_pattern_probs = frozen.get("probabilidades_patrones", False)
    return params


def _test_overrides(params: PicksParams) -> dict[int, dict[LegKey, float]] | None:
    return pattern_probs(TRAIN + VALIDATION) if params.use_pattern_probs else None


def test() -> None:
    params = _tested_params()
    df = load_dataset()
    test_df = df[df.season.isin(TEST)]
    print(f"Test {TEST}: {len(test_df)} partidos, {test_df.window.nunique()} jornadas")
    print(f"Familias excluidas (congeladas): {params.excluded_families or 'ninguna'}")
    print(f"Suelo de patas por nivel: {params.tier_min_prob} - patrones: {params.use_pattern_probs}")
    result = evaluate(test_df, params, _test_overrides(params))
    calib = calibration(result["legs"])
    combos = summarize_combos(result)
    print_report("TEST 25/26 + 26/27", calib, combos)
    out = CACHE_DIR / "picks_test_results.json"
    out.write_text(json.dumps({"calibracion": calib, "combinadas": combos}, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nResultados en {out}")


def export() -> None:
    params = _tested_params()
    PARAMS_PATH.write_text(params.to_json(), encoding="utf-8")
    print(f"Modelo exportado -> {PARAMS_PATH}")


def history() -> None:
    """Guarda las combinadas del test (mismo modelo y reglas) como historico de la web."""
    params = _tested_params()
    df = load_dataset()
    result = evaluate(df[df.season.isin(TEST)], params, _test_overrides(params))
    db = SessionLocal()
    try:
        delete_combos(db, source="backtest")
        by_window: dict[str, list] = defaultdict(list)
        for window, scope, combo in result["combos"]:
            by_window[window].append((scope, combo))
        for window, combos in by_window.items():
            save_combos(db, "backtest", window, combos)
        db.commit()
        print(f"Historico de picks: {len(result['combos'])} combinadas en {len(by_window)} jornadas")
    finally:
        db.close()


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    stages = {"build": build, "dev": dev, "test": test, "export": export, "history": history}
    stages.get(stage, lambda: sys.exit(__doc__))()
