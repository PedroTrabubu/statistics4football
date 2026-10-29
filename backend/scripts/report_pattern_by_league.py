"""Margen sobre el mercado de Alta probabilidad en 22/23-24/25, liga a liga
(el aviso de la web lo muestra frente al de 25/26-26/27).

- Premier y LaLiga: la validacion cruzada temporal de experiments_patterns.py
  (docs/MODELO_PATRONES.md): cada temporada, el modelo entrenado solo con las
  anteriores, con tau y delta fijos.
- Hypermotion y Serie A: el modelo de la web, que nunca vio esas ligas
  (docs/LIGAS_NUEVAS.md).

    python scripts/report_pattern_by_league.py
"""

import sys
from collections import defaultdict
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import backtest_pattern_model as bpm  # noqa: E402
from app.analysis.stats import bootstrap_mean_diff  # noqa: E402
from app.probability.pattern_model import SELECTION_KEYS, load_params  # noqa: E402
from experiments_patterns import DELTA, FOLDS, TAU, VARIANTS, predict  # noqa: E402


def picked(df: pd.DataFrame, probs: dict, tau: float, delta: float) -> list[tuple[str, int, int, float]]:
    """(liga, partido, acierto 0/1, probabilidad de mercado) de cada seleccion."""
    return [
        (df.league.iat[i], int(df.match_id.iat[i]), int(df[f"y_{k}"].iat[i]), float(df[f"mkt_{k}"].iat[i]))
        for i, k in bpm.pick(df, probs, tau, delta)
    ]


def show(label: str, rows: list[tuple[str, int, int, float]]) -> None:
    n = len(rows)
    hit = 100 * sum(r[2] for r in rows) / n
    mkt = 100 * sum(r[3] for r in rows) / n
    _, low, high = bootstrap_mean_diff([r[1] for r in rows], [100.0 * r[2] for r in rows], [100 * r[3] for r in rows])
    print(f"  {label}: n={n} acierto={hit:.1f}% mercado={mkt:.1f}% margen={hit - mkt:+.1f} [{low:+.1f}, {high:+.1f}]")


def main() -> None:
    rows = []

    # Premier y LaLiga: validacion cruzada (modelo actual, R0).
    df = bpm.load_dataset()
    cv = []
    for season in FOLDS:
        train = df[df.season < season].reset_index(drop=True)
        evaluation = df[df.season == season].reset_index(drop=True)
        cv += picked(evaluation, predict(train, evaluation, VARIANTS["R0"]), TAU, DELTA)
    print(f"Validacion cruzada {FOLDS} (Premier + LaLiga):")
    show("total (debe dar 1009, +0.0)", cv)
    rows += cv

    # Hypermotion y Serie A: el modelo de la web.
    params = load_params()
    for dataset, league in ((bpm.NEW_LEAGUES_DATASET, "ESP-La Liga 2"), (bpm.EXTENSION_DATASET, "ITA-Serie A")):
        d = pd.read_csv(dataset, dtype={"season": str})
        d = d[(d.league == league) & d.season.isin(FOLDS)].reset_index(drop=True)
        probs = {k: params.models[k].predict(bpm._features(d, k, bpm.FEATURE_SOURCES)) for k in SELECTION_KEYS}
        rows += picked(d, probs, params.tau, params.delta)

    by_league = defaultdict(list)
    for r in rows:
        by_league[r[0]].append(r)
    print(f"\nPor liga, {FOLDS}:")
    for league in sorted(by_league):
        show(league, by_league[league])


if __name__ == "__main__":
    main()
