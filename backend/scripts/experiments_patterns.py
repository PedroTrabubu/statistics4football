"""Experimentos para la estrategia "Alta probabilidad" (docs/MODELO_PATRONES.md).

Validacion cruzada temporal sin tocar el test: para cada temporada de
evaluacion (22/23, 23/24, 24/25) se entrena con las anteriores. Umbrales fijos
(los congelados: tau=0.62, delta=0.03), para comparar solo las fuentes de
probabilidad.

    python scripts/experiments_patterns.py
    python scripts/experiments_patterns.py confirm R1
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import backtest_pattern_model as bpm  # noqa: E402
from app.probability.pattern_model import SELECTION_KEYS, fit_logistic, logit  # noqa: E402
from experiments_picks import pinnacle_probs  # noqa: E402

FOLDS = ["2223", "2324", "2425"]
TAU, DELTA = 0.62, 0.03

VARIANTS = {
    "R0": ["mkt", "dc", "patv", "pata"],  # modelo actual
    "R1": ["mkt", "pin", "dc", "patv", "pata"],  # + Pinnacle
    "R2": ["pin"],  # solo Pinnacle recalibrado
    "R3": ["mkt"],  # solo mercado medio recalibrado
}


def with_pinnacle(df: pd.DataFrame) -> pd.DataFrame:
    pin = pinnacle_probs()
    df = df.copy()
    for k in SELECTION_KEYS:
        # Sin cuota de Pinnacle se usa la del mercado medio.
        df[f"pin_{k}"] = [pin.get(int(m), {}).get(k, mk) for m, mk in zip(df.match_id, df[f"mkt_{k}"], strict=True)]
    return df


def predict(train: pd.DataFrame, evaluation: pd.DataFrame, sources: list[str]) -> dict[str, np.ndarray]:
    out = {}
    for k in SELECTION_KEYS:
        X = np.column_stack([logit(train[f"{s}_{k}"].to_numpy()) for s in sources])
        Xe = np.column_stack([logit(evaluation[f"{s}_{k}"].to_numpy()) for s in sources])
        out[k] = fit_logistic(X, train[f"y_{k}"].to_numpy()).predict(Xe)
    return out


def run(df: pd.DataFrame, seasons: list[str], sources: list[str]) -> dict:
    acc = {"A": [], "B": [], "ll": []}
    for season in seasons:
        train = df[(df.season < season) & ~df.season.isin(bpm.TEST if season in bpm.TEST else [])].reset_index(drop=True)
        evaluation = df[df.season == season].reset_index(drop=True)
        probs = predict(train, evaluation, sources)
        for strategy, delta in (("A", None), ("B", DELTA)):
            picks = bpm.pick(evaluation, probs, TAU, delta)
            acc[strategy].append(bpm.evaluate_picks(evaluation, probs, picks))
        acc["ll"].append(np.mean(list(bpm.log_losses(evaluation, {"x": probs})["x"].values())))
    return acc


def summary(acc: dict) -> str:
    parts = []
    for strategy in ("A", "B"):
        rs = acc[strategy]
        n = sum(r["n"] for r in rs)
        hit = sum(r["acierto"] * r["n"] for r in rs) / n
        mkt = sum(r["prob_mercado_media"] * r["n"] for r in rs) / n
        with_odds = sum(r["con_cuota"] for r in rs)
        roi = sum((r["roi_pct"] or 0) * r["con_cuota"] for r in rs) / with_odds if with_odds else 0
        parts.append(f"{strategy}: n={n} acierto={hit:.1f}% mercado={mkt:.1f}% margen={hit - mkt:+.1f}pp ROI={roi:+.1f}% ({with_odds})")
    parts.append(f"logloss={np.mean(acc['ll']):.4f}")
    return " | ".join(parts)


def main() -> None:
    df = with_pinnacle(bpm.load_dataset())
    if len(sys.argv) > 2 and sys.argv[1] == "confirm":
        name = sys.argv[2]
        print(f"CONFIRMACION {name} sobre {bpm.TEST}")
        for v in ("R0", name):
            print(f"{v}: {summary(run(df, bpm.TEST, VARIANTS[v]))}")
        return
    print(f"Validacion cruzada temporal: evaluar {FOLDS}")
    for name, sources in VARIANTS.items():
        print(f"{name} {sources}: {summary(run(df, FOLDS, sources))}", flush=True)


if __name__ == "__main__":
    main()
