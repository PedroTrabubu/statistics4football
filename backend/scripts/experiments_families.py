"""Calibracion, por familia, de las selecciones que el optimizador elige
(validacion cruzada temporal 22/23-24/25, sin tocar el test)."""

import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import backtest_picks as bp  # noqa: E402
from experiments_picks import FOLDS  # noqa: E402


def main() -> None:
    df = bp.load_dataset()
    rows: dict[tuple[str, str], list[tuple[float, float, bool]]] = defaultdict(list)
    for season in FOLDS:
        train = df[df.season < season]
        params = bp.fit_params(train, excluded=[])
        params.tier_min_prob = bp.V3_TIER_MIN_PROB
        result = bp.evaluate(df[df.season == season], params)
        for _, scope, combo in result["combos"]:
            if scope not in ("todas", "mismo_partido"):
                continue
            group = "mismo_partido" if scope == "mismo_partido" else "niveles"
            for leg in combo.legs:
                won = bp.leg_won(leg, result["outcomes"][leg.match_id])
                if won is not None:
                    rows[(group, leg.family)].append((leg.prob, 1 / leg.odds, won))
    print(f"{'grupo':14s} {'familia':18s} {'n':>5s} {'prob':>6s} {'1/cuota':>7s} {'real':>6s} {'real-prob':>9s}")
    for (group, family), r in sorted(rows.items()):
        p = np.mean([x[0] for x in r])
        imp = np.mean([x[1] for x in r])
        real = np.mean([x[2] for x in r])
        print(f"{group:14s} {family:18s} {len(r):5d} {100 * p:5.1f}% {100 * imp:6.1f}% {100 * real:5.1f}% {100 * (real - p):+8.1f}")


if __name__ == "__main__":
    main()
