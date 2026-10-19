"""Indice de predecibilidad: walk-forward, metricas de desarrollo (25/26) y de
prueba (26/27, se evalua una sola vez) y comparacion con Pinnacle por banda.
Protocolo pre-registrado: docs/PREDECIBILIDAD_PROTOCOLO.md.

Antes, con el backend en marcha (desde frontend/):
    npm run export:predictability
    npm run export:picks -- --seasons 2526,2627
Despues (desde backend/, con el venv activado):
    python scripts/report_predictability.py

Escribe data/model_cache/predictability.json, que sirve GET /picks/predictability.
"""

import argparse
import csv
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.analysis.books import captured_books, football_data_books  # noqa: E402
from app.analysis.pinnacle_picks import evaluate_picks, read_picks, summarize  # noqa: E402
from app.analysis.predictability import (  # noqa: E402
    BANDS,
    MIN_BAND,
    MIN_TRAIN,
    REPS,
    SEED,
    VARIANT_B,
    MatchRow,
    Scored,
    band_stats,
    calibration,
    feature_scorer,
    fit,
    model_scorer,
    paired_gain,
    separation,
    spearman,
    walk_forward,
)
from app.analysis.stats import bootstrap_mean_diff, fmt_pct, fmt_pts  # noqa: E402
from app.core.config import PROJECT_ROOT  # noqa: E402
from app.db.models import PinnacleCapture  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402

REPORTS = PROJECT_ROOT / "data" / "reports"
OUTPUT = PROJECT_ROOT / "data" / "model_cache" / "predictability.json"
SEASONS = {"2526": "25/26 (desarrollo)", "2627": "26/27 (prueba)"}
TARGET_COLUMNS = ("league", "season", "match_id", "date", "home_team", "away_team", "picks", "hits", "expected", "excess")
UNCALIBRATED = ["INT-Champions League"]


def ci_bootstrap(ids, a, b):
    return bootstrap_mean_diff(ids, a, b, reps=REPS, seed=SEED)


def read_rows(path: Path) -> tuple[list[MatchRow], list[str]]:
    with path.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        features = [c for c in reader.fieldnames or [] if c not in TARGET_COLUMNS]
        rows = [
            MatchRow(
                match_id=int(r["match_id"]),
                league=r["league"],
                season=r["season"],
                date=r["date"],
                picks=int(r["picks"]),
                hits=int(r["hits"]),
                expected=float(r["expected"]),
                excess=float(r["excess"]) if r["excess"] else None,
                features={f: float(r[f]) if r[f] != "" else None for f in features},
            )
            for r in reader
        ]
    return rows, features


def table(headers: list[str], rows: list[list[str]]) -> None:
    widths = [max(len(str(x)) for x in col) for col in zip(headers, *rows, strict=False)]
    print("  " + " | ".join(h.ljust(w) for h, w in zip(headers, widths, strict=True)))
    print("  " + "-+-".join("-" * w for w in widths))
    for row in rows:
        print("  " + " | ".join(str(c).ljust(w) for c, w in zip(row, widths, strict=True)))


def interval(point: float, low: float, high: float) -> str:
    return f"{fmt_pts(point)} [{fmt_pts(low)}, {fmt_pts(high)}]"


def band_rows(scored: list[Scored]) -> list[list[str]]:
    out = []
    for name in BANDS:
        rows = [s for s in scored if s.band == name]
        if not rows:
            out.append([name.capitalize(), "0", "—"])
            continue
        mean, low, high = ci_bootstrap([s.row.match_id for s in rows], [s.row.excess for s in rows], [0.0] * len(rows))
        label = name.capitalize() + (" (muestra insuficiente)" if len(rows) < MIN_BAND else "")
        out.append([label, str(len(rows)), interval(mean, low, high)])
    return out


def report_variant(title: str, scored: list[Scored], baseline: list[Scored] | None, calibrate: bool = True) -> dict:
    print(f"\n  {title}: {len(scored)} partidos con índice")
    if not scored:
        return {}
    table(["Banda", "Partidos", "Exceso medio (pts) [IC 95 %]"], band_rows(scored))
    sep = separation(scored)
    rho = spearman([s.index for s in scored], [s.row.excess for s in scored])
    print(f"  Alta - Baja: {interval(*sep)} · Spearman índice-exceso: {rho:+.3f}")
    gain = None
    if baseline is not None:
        gain = paired_gain(scored, baseline)
        print(f"  Frente a 'nº de picks de fuerza alta' (misma métrica, mismos partidos): {interval(*gain)}")
        print("  Frente al índice constante: su separación es 0, así que la ganancia es la propia Alta − Baja.")
    if calibrate:
        print("  Calibración por quintiles de la predicción (exceso predicho → observado):")
        for b in calibration(scored):
            print(f"    n={b.n:4d}  {fmt_pts(b.predicted)} → {fmt_pts(b.observed)}")
    return {"separation": sep, "spearman": rho, "gain_vs_n_alta": gain}


def pinnacle_by_band(picks_path: Path, scored: list[Scored]) -> None:
    print("\n=== Mercado: picks frente a Pinnacle sin margen, por banda (variante A) ===")
    if not picks_path.exists():
        print(f"  Sin {picks_path}: exporta los picks (npm run export:picks -- --seasons 2526,2627).")
        return
    by_id = {s.row.match_id: s for s in scored}
    picks = [p for p in read_picks(picks_path) if p.match_id in by_id]
    db = SessionLocal()
    try:
        first = db.query(PinnacleCapture.captured_at).filter_by(status="ok").order_by(PinnacleCapture.captured_at).first()
        fd_close, fd_pre = football_data_books(db, {p.match_id for p in picks})
        cap_close, cap_open = captured_books(db)
    finally:
        db.close()
    forward = [p for p in picks if first and p.date >= first[0].isoformat()]
    blocks = (
        ("Cierre de Pinnacle en Football-Data (1X2, más/menos 2.5)", evaluate_picks(picks, fd_close, fd_pre)),
        ("Capturas propias (también córners)", evaluate_picks(forward, cap_close, cap_open)),
    )
    for title, evaluation in blocks:
        print(f"\n  {title}: {len(evaluation.evaluated)} picks evaluados")
        out = []
        for name in BANDS:
            rows = [e for e in evaluation.evaluated if by_id[e.pick.match_id].band == name]
            s = summarize(rows)
            if s is None:
                out.append([name.capitalize(), "0", "0", "—", "—", "—"])
                continue
            label = name.capitalize() + (" (muestra insuficiente)" if s.matches < MIN_BAND else "")
            out.append([label, str(s.n), str(s.matches), fmt_pct(s.hit_rate), fmt_pct(s.mean_p), interval(s.diff, s.low, s.high)])
        table(["Banda", "Picks", "Partidos", "Acierto", "Pinnacle", "Diferencia (pts) [IC]"], out)


def band_table_json(scored: list[Scored]) -> dict:
    out = {}
    for name in BANDS:
        stats = band_stats([s for s in scored if s.band == name], ci_bootstrap)
        out[name] = None if stats is None else {
            "matches": stats.matches,
            "picks": stats.picks,
            "hit_rate": stats.hit_rate,
            "base": stats.base,
            "edge": stats.edge,
            "low": stats.low,
            "high": stats.high,
            "insufficient": stats.insufficient,
        }
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--matches", type=Path, default=REPORTS / "predictability_matches.csv")
    parser.add_argument("--picks", type=Path, default=REPORTS / "picks_probables.csv")
    parser.add_argument("--out", type=Path, default=OUTPUT)
    parser.add_argument("--min-train", type=int, default=MIN_TRAIN)
    parser.add_argument("--no-pinnacle", action="store_true")
    args = parser.parse_args()

    if not args.matches.exists():
        sys.exit(f"No está {args.matches}. Exporta antes: cd frontend && npm run export:predictability")
    rows, features = read_rows(args.matches)
    with_target = [r for r in rows if r.excess is not None]
    print(f"Partidos exportados: {len(rows)} · con picks: {len(with_target)} · variables: {len(features)}")

    scored_a = walk_forward(rows, model_scorer(features), args.min_train)
    scored_b = walk_forward(rows, model_scorer(VARIANT_B), args.min_train)
    scored_base = walk_forward(rows, feature_scorer("n_alta"), args.min_train)

    summary = {}
    for season, label in SEASONS.items():
        a = [s for s in scored_a if s.row.season == season]
        if not a:
            continue
        print(f"\n=== {label} ===")
        result = report_variant("Variante A (principal: todas las variables)", a, [s for s in scored_base if s.row.season == season])
        report_variant(f"Variante B ({', '.join(VARIANT_B)})", [s for s in scored_b if s.row.season == season], None)
        report_variant("Línea base: nº de picks de fuerza alta", [s for s in scored_base if s.row.season == season], None, False)
        summary[season] = {
            "separation": result["separation"],
            "spearman": result["spearman"],
            "matches": {name: sum(s.band == name for s in a) for name in BANDS},
        }

    if not args.no_pinnacle:
        pinnacle_by_band(args.picks, scored_a)

    final = fit(with_target, features)
    print("\nModelo final (variante A, todos los partidos con picks): coeficientes estandarizados")
    for name, coef in sorted(zip(features, final.coef, strict=True), key=lambda kv: -abs(kv[1])):
        print(f"  {name:20s} {coef:+.4f}")

    bands: dict = {}
    for season in SEASONS:
        season_rows = [s for s in scored_a if s.row.season == season]
        if not season_rows:
            continue
        bands[season] = {"all": band_table_json(season_rows)}
        for league in sorted({s.row.league for s in season_rows}):
            bands[season][league] = band_table_json([s for s in season_rows if s.row.league == league])

    payload = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "protocol": "docs/PREDECIBILIDAD_PROTOCOLO.md",
        "uncalibrated_leagues": UNCALIBRATED,
        "min_band": MIN_BAND,
        "model": final.to_json(),
        "matches": {str(s.row.match_id): {"index": round(s.index, 1), "band": s.band} for s in scored_a},
        "bands": bands,
        "summary": summary,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"\n{len(payload['matches'])} partidos con índice -> {args.out}")


if __name__ == "__main__":
    main()
