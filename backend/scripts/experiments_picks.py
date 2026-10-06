"""Experimentos para subir el acierto de los picks (docs/PICKS_PROTOCOLO.md).

Validacion cruzada temporal SOLO con temporadas anteriores al test:
para cada temporada de evaluacion (22/23, 23/24, 24/25) todo se entrena con
las temporadas anteriores (desde 21/21). El periodo 25/26 + 26/27 no se toca
aqui: se usa una sola vez al final para confirmar la variante elegida.

    python scripts/experiments_picks.py            # todas las variantes en CV
    python scripts/experiments_picks.py confirm V1 # una variante sobre 25/26 + 26/27
"""

import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import backtest_picks as bp  # noqa: E402
from app.db.models import MatchOdds  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.picks.count_model import SIDES, STATS, CountModel, fit_count_model  # noqa: E402
from app.picks.engine import PATTERN_TO_LEG, PicksParams  # noqa: E402
from app.picks.legs import MatchDistributions  # noqa: E402
from app.probability.pattern_model import (  # noqa: E402
    FEATURE_SOURCES,
    fit_logistic,
    logit,
    market_probabilities,
)

FOLDS = ["2223", "2324", "2425"]
ALL_TRAIN_START = ["2122"]
KINDS = ["segura", "fiable", "media", "alta", "bomba", "mismo_partido"]


# --- fuentes de probabilidad -------------------------------------------------


def pinnacle_probs() -> dict[int, dict[str, float]]:
    """Probabilidades de las 16 selecciones a partir de las cuotas pre-partido de Pinnacle."""
    db = SessionLocal()
    try:
        odds: dict[int, dict[str, float]] = defaultdict(dict)
        for r in db.query(MatchOdds).filter(
            MatchOdds.bookmaker == "Pinnacle", MatchOdds.market.in_(["1x2", "over_under_2.5"])
        ):
            odds[r.match_id][r.selection if r.market == "1x2" else f"{r.selection}_2.5"] = r.odds
    finally:
        db.close()
    out = {}
    for mid, o in odds.items():
        p = market_probabilities(o)
        if p is not None:
            out[mid] = p
    return out


def _pattern_df() -> pd.DataFrame:
    return pd.read_csv(bp.PATTERN_DATASET, dtype={"season": str})


def overrides_from(probs: dict[int, dict[str, float]]) -> dict[int, dict]:
    return {mid: {PATTERN_TO_LEG[k]: v for k, v in p.items() if k in PATTERN_TO_LEG} for mid, p in probs.items()}


def recalibrated(source: dict[int, dict[str, float]], train_seasons: list[str]) -> dict[int, dict[str, float]]:
    """Recalibracion logistica de una fuente (logit(p) -> resultado), entrenada solo con train_seasons."""
    pdf = _pattern_df()
    season_of = dict(zip(pdf.match_id.astype(int), pdf.season, strict=True))
    y_of = {k: dict(zip(pdf.match_id.astype(int), pdf[f"y_{k}"], strict=True)) for k in PATTERN_TO_LEG}
    out: dict[int, dict[str, float]] = defaultdict(dict)
    for k in PATTERN_TO_LEG:
        train = [(source[m][k], y_of[k][m]) for m in source if season_of.get(m) in train_seasons]
        if len(train) < 200:
            continue
        model = fit_logistic(logit(np.array([[p] for p, _ in train])), np.array([y for _, y in train]))
        mids = list(source)
        preds = model.predict(logit(np.array([[source[m][k]] for m in mids])))
        for m, p in zip(mids, preds, strict=True):
            out[m][k] = float(p)
    return out


def market_avg_probs() -> dict[int, dict[str, float]]:
    pdf = _pattern_df()
    return {int(r.match_id): {k: r[f"mkt_{k}"] for k in PATTERN_TO_LEG} for _, r in pdf.iterrows()}


def shrunk_pattern(train_seasons: list[str], k: float) -> dict[int, dict[str, float]]:
    pat = bp.pattern_probs(train_seasons)
    mkt = market_avg_probs()
    out: dict[int, dict[str, float]] = {}
    inv = {v: kk for kk, v in PATTERN_TO_LEG.items()}
    for mid, probs in pat.items():
        if mid not in mkt:
            continue
        out[mid] = {inv[leg]: mkt[mid][inv[leg]] + k * (p - mkt[mid][inv[leg]]) for leg, p in probs.items()}
    return out


# --- corners/amarillas con fuerza esperada (V5) ------------------------------


class StrengthParams(PicksParams):
    """Modelos de conteo con log(lambda) y log(mu) del mercado como features extra."""

    extra: dict[tuple[str, str], CountModel]

    def distributions(self, match_id, odds, features, goals_lambda_mu) -> MatchDistributions:
        base = super().distributions(match_id, odds, features, goals_lambda_mu)
        if goals_lambda_mu is None:
            return base
        lm = [math.log(goals_lambda_mu[0]), math.log(goals_lambda_mu[1])]
        grids = {}
        for stat in STATS:
            pmf = {side: self.extra[(stat, side)].pmf(features[stat][side] + lm) for side in SIDES}
            grids[stat] = np.outer(pmf["home"], pmf["away"])
        return MatchDistributions(match_id, base.goals, grids["corners"], grids["yellow"], base.real_odds)


def fit_strength(train: pd.DataFrame, base: PicksParams) -> StrengthParams:
    params = StrengthParams(base.models, base.excluded_families, base.trained_on, base.tier_min_prob, base.use_pattern_probs)
    params.extra = {}
    for stat in STATS:
        for side in SIDES:
            rows = train.dropna(subset=[f"{side}_{stat}", "lam", "mu"])
            X = np.column_stack([rows[bp._feature_cols(stat, side)].to_numpy(), np.log(rows[["lam", "mu"]].to_numpy())])
            params.extra[(stat, side)] = fit_count_model(X, rows[f"{side}_{stat}"].to_numpy(dtype=float))
    return params


# --- evaluacion --------------------------------------------------------------


def metrics(result: dict) -> dict:
    out: dict = {}
    for kind in KINDS:
        scope = "mismo_partido" if kind == "mismo_partido" else "todas"
        combos = [c for _, s, c in result["combos"] if s == scope and c.kind == kind]
        settled = [(c, bp.combo_won(c, result["outcomes"])) for c in combos]
        settled = [(c, w) for c, w in settled if w is not None]
        legs = [(l, bp.leg_won(l, result["outcomes"][l.match_id])) for c, _ in settled for l in c.legs]
        legs = [(l, w) for l, w in legs if w is not None]
        real = [(c, w) for c, w in settled if c.odds_kind == "real"]
        out[kind] = {
            "n": len(settled),
            "hits": sum(w for _, w in settled),
            "promised": sum(c.prob for c, _ in settled),
            # Acierto de las selecciones elegidas frente a lo que dice su cuota.
            "leg_edge": float(np.mean([w - 1 / l.odds for l, w in legs])) if legs else 0.0,
            "real_n": len(real),
            "real_pnl": sum((c.odds - 1) if w else -1 for c, w in real),
        }
    return out


def add(a: dict, b: dict) -> dict:
    for kind, m in b.items():
        acc = a.setdefault(kind, defaultdict(float))
        for k, v in m.items():
            acc[k] += v if k != "leg_edge" else v * m["n"]
    return a


def run_variant(name: str, df: pd.DataFrame, eval_seasons: list[str], cache: dict) -> dict:
    total: dict = {}
    for season in eval_seasons:
        train_seasons = [s for s in sorted(df.season.unique()) if s < season]
        if season in bp.TEST:
            train_seasons = [s for s in train_seasons if s not in bp.TEST]
        train = df[df.season.isin(train_seasons)]
        evaluation = df[df.season == season]

        params = bp.fit_params(train, excluded=[])
        params.tier_min_prob = bp.V3_TIER_MIN_PROB
        overrides = None
        if name in ("V1", "V3", "V6"):
            pin = cache.setdefault("pin", pinnacle_probs())
            src = recalibrated(pin, train_seasons) if name in ("V3", "V6") else pin
            overrides = overrides_from(src)
        elif name == "V2":
            overrides = overrides_from(recalibrated(market_avg_probs(), train_seasons))
        elif name == "V4":
            overrides = overrides_from(shrunk_pattern(train_seasons, 0.5))
        if name in ("V5", "V6"):
            params = fit_strength(train, params)
        if overrides is not None:
            params.use_pattern_probs = True
        total = add(total, metrics(bp.evaluate(evaluation, params, overrides)))
    return total


def report(name: str, total: dict) -> None:
    cells = []
    for kind in KINDS:
        m = total[kind]
        n = m["n"] or 1
        roi = f"{100 * m['real_pnl'] / m['real_n']:+.0f}%" if m["real_n"] else "  -"
        cells.append(
            f"{kind[:6]:6s} {100 * m['hits'] / n:5.1f}% (prom {100 * m['promised'] / n:4.1f}, borde {100 * m['leg_edge'] / n:+4.1f}, ROI {roi})"
        )
    print(f"{name}: " + " | ".join(cells), flush=True)


VARIANTS = {
    "V0": "base actual",
    "V1": "goles con Pinnacle",
    "V2": "mercado recalibrado",
    "V3": "Pinnacle recalibrado",
    "V4": "patrones encogidos al 50%",
    "V5": "corners/amarillas con fuerza esperada",
    "V6": "V3 + V5",
}


def main() -> None:
    df = bp.load_dataset()
    cache: dict = {}
    if len(sys.argv) > 2 and sys.argv[1] == "confirm":
        name = sys.argv[2]
        print(f"CONFIRMACION {name} ({VARIANTS[name]}) sobre {bp.TEST}")
        report(name, run_variant(name, df, bp.TEST, cache))
        report("V0", run_variant("V0", df, bp.TEST, cache))
        return
    print(f"Validacion cruzada temporal: evaluar {FOLDS}, entrenando con lo anterior")
    for name, label in VARIANTS.items():
        print(f"-- {name}: {label}")
        report(name, run_variant(name, df, FOLDS, cache))


if __name__ == "__main__":
    main()
