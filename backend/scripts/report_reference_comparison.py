"""¿Pinnacle seria mejor referencia de mercado que "Market Average"? Y ¿el EV
de la web con "Market Max" es optimista? Solo informa: no cambia la web.

Uso (desde backend/, con el venv activado):
    python scripts/report_reference_comparison.py                  # 25/26 y 26/27
    python scripts/report_reference_comparison.py --seasons 2122,2223,2324,2425,2526,2627

Escribe data/reports/reference_comparison_<temporadas>.csv. Ver app/analysis/reference.py.
"""

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.analysis.books import captured_books  # noqa: E402
from app.analysis.reference import (  # noqa: E402
    AVERAGE,
    COMPARISONS,
    MARKETS,
    PINNACLE_CLOSE,
    compare,
    load_reference_data,
    reference_calibration,
    review_max_price,
)
from app.analysis.stats import fmt_pct, fmt_pts  # noqa: E402
from app.core.config import PROJECT_ROOT, get_settings  # noqa: E402
from app.db.models import Match, MatchStatus, Season  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.probability.devig import DEFAULT_METHOD  # noqa: E402

REPORTS = PROJECT_ROOT / "data" / "reports"


def table(headers: list[str], rows: list[list[str]]) -> None:
    widths = [max(len(str(x)) for x in col) for col in zip(headers, *rows, strict=False)]
    print("  " + " | ".join(h.ljust(w) for h, w in zip(headers, widths, strict=True)))
    print("  " + "-+-".join("-" * w for w in widths))
    for row in rows:
        print("  " + " | ".join(str(c).ljust(w) for c, w in zip(row, widths, strict=True)))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--seasons", default="2526,2627")
    parser.add_argument("--method", choices=["shin", "proportional", "power"], default=DEFAULT_METHOD)
    args = parser.parse_args()
    seasons = [s.strip() for s in args.seasons.split(",")]

    db = SessionLocal()
    try:
        ids = [
            m.id
            for m in db.query(Match.id)
            .join(Season, Season.id == Match.season_id)
            .filter(Season.name.in_(seasons), Match.status == MatchStatus.HISTORICAL)
        ]
        captured, _ = captured_books(db)
        data = load_reference_data(db, ids, captured)
        print(f"Temporadas {', '.join(seasons)}: {len(data.scores)} partidos jugados · método sin margen: {args.method}")
        print("Log-loss: -log(probabilidad dada a lo que pasó); menos es mejor. Diferencia A − B: negativa = mejor A.")

        csv_rows = []
        for market in MARKETS:
            print(f"\n=== {market} ===")
            out = []
            for a, b, label in COMPARISONS:
                c = compare(data, market, a, b, label, args.method)
                if c is None:
                    out.append([label, "0", "—", "—", "—"])
                    continue
                verdict = "mejor A" if c.high < 0 else "mejor B" if c.low > 0 else "sin diferencia clara"
                out.append([
                    label,
                    str(c.n),
                    f"{c.logloss_a:.4f}",
                    f"{c.logloss_b:.4f}",
                    f"{c.diff:+.4f} [{c.low:+.4f}, {c.high:+.4f}] {verdict}",
                ])
                csv_rows.append([market, a, b, c.n, f"{c.logloss_a:.5f}", f"{c.logloss_b:.5f}",
                                 f"{c.diff:.5f}", f"{c.low:.5f}", f"{c.high:.5f}"])  # fmt: skip
            table(["Comparación (A frente a B)", "Partidos", "Log-loss A", "Log-loss B", "A − B [IC 95 %]"], out)
            for reference in (AVERAGE, PINNACLE_CLOSE):
                bins = reference_calibration(data, market, reference, args.method)
                if bins:
                    print(f"\nCalibración de {reference} ({market}, todas las selecciones):")
                    table(
                        ["Tramo", "Selecciones", "Probabilidad media", "Frecuencia"],
                        [[f"{b.low:.0%}–{b.high:.0%}", str(b.n), fmt_pct(b.mean_p), fmt_pct(b.observed)] for b in bins],
                    )

        review = review_max_price(db, ids, get_settings().ev_threshold)
        print("\n=== Valor esperado con Market Max (revisión, sin cambiar nada) ===")
        if review is None:
            print("  Sin predicciones del modelo con cuotas de Market Max y Bet365 en estas temporadas.")
        else:
            print(f"  Selecciones con Market Max y Bet365: {review.selections}")
            print(f"  Market Max paga de media {fmt_pts(review.max_vs_bet365)} % más que Bet365"
                  + (f" y {fmt_pts(review.max_vs_pinnacle)} % más que Pinnacle" if review.max_vs_pinnacle is not None else ""))  # fmt: skip
            print(f"  Selecciones que la web marca como valor: {review.value_n}")
            if review.value_n:
                print(f"    EV medio con Market Max (el de la web): {fmt_pts(review.value_ev_max)} %")
                print(f"    EV medio de esas mismas con la cuota de Bet365: {fmt_pts(review.value_ev_bet365)} %")
                print(f"    Siguen por encima del umbral con Bet365: {fmt_pct(review.still_value_bet365)}")
                print(f"    Rentabilidad real a cuota Market Max: {fmt_pts(review.roi_max)} % · a cuota Bet365: "
                      f"{fmt_pts(review.roi_bet365)} %")  # fmt: skip
    finally:
        db.close()

    REPORTS.mkdir(parents=True, exist_ok=True)
    out = REPORTS / f"reference_comparison_{'-'.join(seasons)}.csv"
    with out.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["mercado", "a", "b", "partidos", "logloss_a", "logloss_b", "a_menos_b", "ic_inf", "ic_sup"])
        w.writerows(csv_rows)
    print(f"\nCSV en {out}")


if __name__ == "__main__":
    main()
