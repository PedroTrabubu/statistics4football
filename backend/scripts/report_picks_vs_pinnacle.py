"""Picks muy probables frente a Pinnacle: ¿aciertan mas de lo que el mercado
ya espera? Medicion, no ajuste (protocolo: docs/PINNACLE_PROTOCOLO.md).

Antes, con el backend en marcha, exporta los picks con el motor de la web:
    cd frontend && npm run export:picks
Despues (desde backend/, con el venv activado):
    python scripts/report_picks_vs_pinnacle.py
    python scripts/report_picks_vs_pinnacle.py --method proportional

Dos bloques que no se mezclan:
1. Retrospectivo, con el cierre de Pinnacle del CSV de Football-Data (1X2 y
   mas/menos 2.5; hasta mediados de enero de 2026). CLV: desde la toma de
   Football-Data (viernes/martes) hasta el cierre.
2. Pre-declarado, con nuestras capturas: solo partidos posteriores a la
   primera captura. Todos los mercados equivalentes; CLV desde la apertura.
Ademas, la evaluacion por linea (modelo frente a Pinnacle en cada linea).

Escribe en data/reports/: picks_vs_pinnacle.csv (cada pick evaluado),
picks_vs_pinnacle_excluded.csv y lines_vs_pinnacle.csv.
"""

import argparse
import csv
import sys
from collections import Counter
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.analysis.books import MONEYLINE, captured_books, football_data_books  # noqa: E402
from app.analysis.model_providers import db_model_provider, match_results  # noqa: E402
from app.analysis.pinnacle_lines import LineEvent, line_events, market_calibration, summarize_lines  # noqa: E402
from app.analysis.pinnacle_picks import (  # noqa: E402
    FAMILY_LABEL,
    Evaluated,
    evaluate_picks,
    pick_calibration,
    read_picks,
    summarize,
)
from app.analysis.stats import fmt_pct, fmt_pts  # noqa: E402
from app.core.config import PROJECT_ROOT  # noqa: E402
from app.db.models import ModelPrediction, PinnacleCapture  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.probability.devig import DEFAULT_METHOD  # noqa: E402

REPORTS = PROJECT_ROOT / "data" / "reports"
TEST_SEASONS = {"2526", "2627"}
STRENGTHS = ("alta", "media", "baja")
SMALL_SAMPLE = 30  # con menos picks, el intervalo apenas dice nada


def table(headers: list[str], rows: list[list[str]]) -> None:
    widths = [max(len(str(x)) for x in col) for col in zip(headers, *rows, strict=False)]
    print("  " + " | ".join(h.ljust(w) for h, w in zip(headers, widths, strict=True)))
    print("  " + "-+-".join("-" * w for w in widths))
    for row in rows:
        print("  " + " | ".join(str(c).ljust(w) for c, w in zip(row, widths, strict=True)))


def summary_row(label: str, rows: list[Evaluated]) -> list[str] | None:
    s = summarize(rows)
    if s is None:
        return None
    move = (
        "—"
        if s.mean_move is None
        else f"{fmt_pts(s.mean_move)} [{fmt_pts(s.move_low)}, {fmt_pts(s.move_high)}] ({fmt_pct(s.moved_for, 0)} a favor)"
    )
    return [
        label + (" (muestra pequeña)" if s.n < SMALL_SAMPLE else ""),
        str(s.n),
        str(s.matches),
        fmt_pct(s.hit_rate),
        fmt_pct(s.mean_p),
        f"{fmt_pts(s.diff)} [{fmt_pts(s.low)}, {fmt_pts(s.high)}]",
        move,
    ]


HEADERS = ["Grupo", "Picks", "Partidos", "Acierto", "Pinnacle", "Diferencia (pts) [IC 95 %]", "CLV: apertura→cierre (pts) [IC]"]


def report_block(title: str, evaluation, method_note: str) -> None:
    rows = evaluation.evaluated
    print(f"\n=== {title} ===")
    print(
        f"Picks jugados: {len(rows) + sum(evaluation.excluded.values()) + evaluation.undecided} · evaluados: {len(rows)}"
        f" · fuera: {sum(evaluation.excluded.values())} · sin dato: {evaluation.undecided} · {method_note}"
    )
    if not rows:
        print("  (ningún pick evaluable todavía)")
    else:
        print("\nPor nivel de fuerza:")
        out = [summary_row(s.capitalize(), [r for r in rows if r.pick.strength == s]) for s in STRENGTHS]
        out.append(summary_row("Alta + media", [r for r in rows if r.pick.strength != "baja"]))
        out.append(summary_row("Total", rows))
        table(HEADERS, [r for r in out if r])

        print("\nPor tipo de pick y fuerza (alta + media):")
        out = []
        for family in sorted({r.pick.family for r in rows}):
            fam = [r for r in rows if r.pick.family == family]
            out.append(summary_row(FAMILY_LABEL.get(family, family), [r for r in fam if r.pick.strength != "baja"]))
            for s in STRENGTHS:
                out.append(summary_row(f"  {s}", [r for r in fam if r.pick.strength == s]))
        table(HEADERS, [r for r in out if r])

        print("\nPor temporada:")
        test = [r for r in rows if r.pick.season in TEST_SEASONS]
        before = [r for r in rows if r.pick.season not in TEST_SEASONS]
        out = [summary_row("Test pre-registrado (25/26 y 26/27)", test), summary_row("Temporadas anteriores", before)]
        table(HEADERS, [r for r in out if r])

        print("\nCalibración de Pinnacle en estos picks:")
        table(
            ["Tramo Pinnacle", "Picks", "Pinnacle media", "Se cumplió"],
            [[f"{b.low:.0%}–{b.high:.0%}", str(b.n), fmt_pct(b.mean_p), fmt_pct(b.observed)] for b in pick_calibration(rows)],
        )

    if evaluation.other_line:
        print("\nPicks con otra línea en Pinnacle (no se interpola): línea del pick frente a la más cercana ofrecida")
        by_family: dict[str, list[float]] = {}
        for pick, nearest in evaluation.other_line:
            if nearest is not None and pick.line is not None:
                by_family.setdefault(pick.family, []).append(abs(pick.line - nearest))
        table(
            ["Tipo", "Picks", "Distancia media a la línea más cercana", "A 0.5 o menos"],
            [[FAMILY_LABEL.get(f, f), str(len(d)), f"{sum(d) / len(d):.2f}", fmt_pct(sum(x <= 0.5 for x in d) / len(d))]
             for f, d in sorted(by_family.items())],
        )  # fmt: skip

    print("\nFuera del informe (tipo de pick · motivo · picks):")
    by_reason = sorted(evaluation.excluded.items(), key=lambda kv: (-kv[1], kv[0]))
    table(["Tipo", "Motivo", "Picks"], [[FAMILY_LABEL.get(f, f), reason, str(n)] for (f, reason), n in by_reason])


def with_stored_predictions(events: list[LineEvent], preds: dict) -> list[LineEvent]:
    out = []
    for e in events:
        key = "1x2" if e.key == MONEYLINE else "over_under_2.5" if e.key == ("goals", 0, "total", None, 2.5) else None
        probs = preds.get((e.match_id, key)) if key else None
        out.append(replace(e, p_model=probs if probs and len(probs) == len(e.p_close) else None))
    return out


def report_lines(title: str, events: list[LineEvent], excluded: Counter, model_note: str) -> list[list[str]]:
    print(f"\n=== {title} ===")
    print(model_note)
    csv_rows = []
    if not events:
        print("  (ningún mercado con cierre de un partido jugado todavía)")
    else:
        out = []
        for group in sorted({e.group for e in events}):
            s = summarize_lines([e for e in events if e.group == group])
            diff = "—" if s.diff is None else f"{s.diff[0]:+.4f} [{s.diff[1]:+.4f}, {s.diff[2]:+.4f}]"
            clv = "—" if s.clv is None else f"{fmt_pts(s.clv[0])} [{fmt_pts(s.clv[1])}, {fmt_pts(s.clv[2])}] (n={s.clv_n})"
            out.append([
                group,
                str(s.n),
                str(s.matches),
                f"{s.logloss_pinnacle:.4f}",
                str(s.n_model),
                "—" if s.logloss_model is None else f"{s.logloss_model:.4f}",
                "—" if s.logloss_pinnacle_same is None else f"{s.logloss_pinnacle_same:.4f}",
                diff,
                clv,
            ])
            csv_rows.append([title, *out[-1]])
        table(
            ["Mercado", "Sucesos", "Partidos", "Log-loss Pinnacle", "Con modelo", "Log-loss modelo",
             "Pinnacle (mismos)", "Modelo − Pinnacle [IC]", "CLV del modelo (pts) [IC]"],
            out,
        )  # fmt: skip
        for which, label in (("close", "Pinnacle al cierre"), ("model", "Modelo")):
            bins = market_calibration(events, which)
            if bins:
                print(f"\nCalibración de {label} (todas las selecciones, por deciles):")
                table(
                    ["Tramo", "Selecciones", "Probabilidad media", "Frecuencia"],
                    [[f"{b.low:.0%}–{b.high:.0%}", str(b.n), fmt_pct(b.mean_p), fmt_pct(b.observed)] for b in bins],
                )
    if excluded:
        print("\nMercados fuera de la evaluación por línea:")
        table(["Motivo", "Mercados"], [[k, str(v)] for k, v in sorted(excluded.items(), key=lambda kv: -kv[1])])
    return csv_rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--picks", type=Path, default=REPORTS / "picks_probables.csv")
    parser.add_argument("--method", choices=["shin", "proportional", "power"], default=DEFAULT_METHOD)
    parser.add_argument("--no-model", action="store_true", help="evaluación por línea sin ajustar modelos (más rápido)")
    args = parser.parse_args()

    if not args.picks.exists():
        sys.exit(f"No está {args.picks}. Exporta los picks antes: cd frontend && npm run export:picks")
    picks = read_picks(args.picks)
    other = "proportional" if args.method != "proportional" else "shin"

    db = SessionLocal()
    try:
        first = db.query(PinnacleCapture.captured_at).filter_by(status="ok").order_by(PinnacleCapture.captured_at).first()
        first_capture = first[0] if first else None
        print(f"Picks exportados: {len(picks)} ({args.picks}) · método sin margen: {args.method}")
        print(f"Primera captura propia de Pinnacle: {first_capture:%Y-%m-%d %H:%M} UTC" if first_capture else
              "Todavía no hay capturas propias de Pinnacle")  # fmt: skip

        # 1. Retrospectivo con Football-Data.
        fd_close, fd_pre = football_data_books(db, {p.match_id for p in picks})
        fd = evaluate_picks(picks, fd_close, fd_pre, args.method)
        fd_alt = evaluate_picks(picks, fd_close, fd_pre, other)
        alt = summarize(fd_alt.evaluated)
        note = f"con {other}: diferencia total {fmt_pts(alt.diff)}" if alt else ""
        report_block(
            "1. Retrospectivo: cierre de Pinnacle en el CSV de Football-Data (1X2 y más/menos 2.5)", fd, f"sensibilidad {note}"
        )

        # 2. Pre-declarado con capturas propias.
        cap_close, cap_open = captured_books(db)
        forward = [p for p in picks if first_capture and p.date >= first_capture.isoformat()]
        cap = evaluate_picks(forward, cap_close, cap_open, args.method)
        report_block(
            "2. Pre-declarado: capturas propias de Pinnacle (desde la primera captura)",
            cap,
            f"partidos posteriores a la primera captura: {len({p.match_id for p in forward})}",
        )

        # 3. Evaluación por línea.
        fd_ids = set(fd_close)
        results = match_results(db, fd_ids | set(cap_close))
        preds: dict = {}
        for p in db.query(ModelPrediction).filter(
            ModelPrediction.match_id.in_(fd_ids),
            ModelPrediction.model_version == "dixon_coles_v1",
            ModelPrediction.market.in_(["1x2", "over_under_2.5"]),
        ):
            preds.setdefault((p.match_id, p.market), {})[p.selection] = p.prob_model
        fd_lines = line_events(fd_close, fd_pre, results, None, args.method)
        csv_lines = report_lines(
            "3a. Por línea, retrospectivo (Football-Data: 1X2 y más/menos 2.5)",
            with_stored_predictions(fd_lines.events, preds),
            fd_lines.excluded,
            "Modelo: predicciones Dixon-Coles guardadas (reajuste mensual, solo datos anteriores). "
            "CLV desde la toma de Football-Data (viernes/martes).",
        )
        played = [m for m in cap_close if m in results]
        provider = None if args.no_model or not played else db_model_provider(db, played)
        cap_lines = line_events({m: cap_close[m] for m in played}, cap_open, results, provider, args.method)
        csv_lines += report_lines(
            "3b. Por línea, capturas propias (todas las líneas de goles y córners)",
            cap_lines.events,
            cap_lines.excluded,
            "Modelo: Dixon-Coles (goles) y modelo de conteos de las combinadas (córners), ajustados antes de cada partido.",
        )
    finally:
        db.close()

    REPORTS.mkdir(parents=True, exist_ok=True)
    with (REPORTS / "picks_vs_pinnacle.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["bloque", "liga", "temporada", "match_id", "fecha", "equipo", "pick", "tipo", "fuerza", "se_cumplio",
                    "linea_pick", "linea_pinnacle", "evaluado", "p_pinnacle_cierre", "p_pinnacle_apertura",
                    "clv_pts", "fuente", "mercado", "apuesta_max"])  # fmt: skip
        for block, ev in (("football-data", fd), ("captura", cap)):
            for r in ev.evaluated:
                p = r.pick
                line = "" if p.line is None else p.line
                clv = "" if r.p_open is None else f"{100 * (r.p_close - r.p_open):.2f}"
                w.writerow([block, p.league, p.season, p.match_id, p.date, p.team, p.text, p.family, p.strength, p.hit,
                            line, line, "sí", f"{r.p_close:.4f}", "" if r.p_open is None else f"{r.p_open:.4f}", clv,
                            r.source, r.market, r.max_stake or ""])  # fmt: skip
            for p, nearest in ev.other_line:
                w.writerow([block, p.league, p.season, p.match_id, p.date, p.team, p.text, p.family, p.strength, p.hit,
                            p.line, "" if nearest is None else nearest, "no: línea distinta", "", "", "", "", "", ""])  # fmt: skip
    with (REPORTS / "picks_vs_pinnacle_excluded.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["bloque", "tipo", "motivo", "picks"])
        for block, ev in (("football-data", fd), ("captura", cap)):
            for (family, reason), n in sorted(ev.excluded.items()):
                w.writerow([block, family, reason, n])
    with (REPORTS / "lines_vs_pinnacle.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["bloque", "mercado", "sucesos", "partidos", "logloss_pinnacle", "con_modelo", "logloss_modelo",
                    "logloss_pinnacle_mismos", "modelo_menos_pinnacle", "clv_modelo"])  # fmt: skip
        w.writerows(csv_lines)
    print(f"\nCSV en {REPORTS}")


if __name__ == "__main__":
    main()
