"""Pick del partido: calculo historico (walk-forward por dia) y validacion.
Protocolo pre-registrado: docs/PICK_DEL_PARTIDO_PROTOCOLO.md.

Desde backend/, con el venv activado:
    python scripts/report_match_pick.py                     # calcula y evalua 25/26 y 26/27
    python scripts/report_match_pick.py --leagues "ESP-La Liga" --seasons 2526 --matches otra.csv
    python scripts/report_match_pick.py --report-only       # solo evalua el CSV ya calculado

Para comparar con los picks actuales y con Pinnacle, antes (desde frontend/):
    npm run export:picks

Escribe data/reports/match_pick_matches.csv y data/model_cache/match_pick.json
(lo sirve GET /picks/match-pick).
"""

import argparse
import csv
import json
import sys
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.analysis.books import captured_books, football_data_books  # noqa: E402
from app.picks.match_pick import kind_label, pick_text  # noqa: E402
from app.analysis.pinnacle_picks import Pick, evaluate_picks, summarize  # noqa: E402
from app.analysis.stats import bootstrap_mean_diff, fmt_pct, fmt_pts  # noqa: E402
from app.core.config import PROJECT_ROOT  # noqa: E402
from app.db.models import League, PinnacleCapture  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402

REPORTS = PROJECT_ROOT / "data" / "reports"
OUTPUT = PROJECT_ROOT / "data" / "model_cache" / "match_pick.json"
LEAGUES = ["ESP-La Liga", "ESP-La Liga 2", "ENG-Premier League", "FRA-Ligue 1", "GER-Bundesliga", "ITA-Serie A"]
SEASON_LABEL = {"2526": "25/26 (desarrollo)", "2627": "26/27 (prueba)"}
SEED = 20261014
REPS = 2000
CALIBRATION = ((0.65, 0.70), (0.70, 0.80), (0.80, 0.90), (0.90, 1.0001))
COLUMNS = [
    "league", "season", "match_id", "date", "home_team", "away_team", "available", "eligible",
    "family", "side", "option", "direction", "line", "text", "p_model", "p", "base", "n", "score", "hit",
    "b_family", "b_side", "b_option", "b_direction", "b_line", "b_p", "b_base", "b_hit",
]  # fmt: skip


def boot(ids, a, b):
    return bootstrap_mean_diff(ids, a, b, reps=REPS, seed=SEED)


def compute_league(code: str, seasons: list[str]) -> list[dict]:
    """Un proceso por liga: Dixon-Coles tarda ~2 s por dia."""
    from app.picks.match_pick import outcome
    from app.picks.match_pick_data import load_league, run

    db = SessionLocal()
    try:
        league = db.query(League).filter_by(code=code).one()
        history, _ = load_league(db, league.id)
        targets = {m.match_id for m in history if m.season in seasons}
        rows = []
        for item in run(db, league.id, targets):
            m, pick, base = item.match, item.pick, item.baseline
            row = {
                "league": code, "season": m.season, "match_id": m.match_id, "date": m.date.isoformat(),
                "home_team": m.home_team, "away_team": m.away_team, "available": item.available, "eligible": item.eligible,
            }  # fmt: skip
            if pick:
                c = pick.candidate
                hit = outcome(c, m)
                row |= {
                    "family": c.family, "side": c.side, "option": c.option, "direction": c.direction or "",
                    "line": "" if c.line is None else c.line, "text": pick_text(c, m.home_team, m.away_team),
                    "p_model": round(pick.p_model, 6), "p": round(pick.p, 6), "base": round(pick.base, 6),
                    "n": pick.n, "score": round(pick.score, 6), "hit": "" if hit is None else int(hit),
                }  # fmt: skip
            if base:
                c = base.candidate
                hit = outcome(c, m)
                row |= {
                    "b_family": c.family, "b_side": c.side, "b_option": c.option, "b_direction": c.direction or "",
                    "b_line": "" if c.line is None else c.line, "b_p": round(base.p, 6), "b_base": round(base.base, 6),
                    "b_hit": "" if hit is None else int(hit),
                }  # fmt: skip
            rows.append(row)
        return rows
    finally:
        db.close()


def table(headers: list[str], rows: list[list[str]]) -> None:
    widths = [max(len(str(x)) for x in col) for col in zip(headers, *rows, strict=False)]
    print("  " + " | ".join(h.ljust(w) for h, w in zip(headers, widths, strict=True)))
    print("  " + "-+-".join("-" * w for w in widths))
    for row in rows:
        print("  " + " | ".join(str(c).ljust(w) for c, w in zip(row, widths, strict=True)))


def interval(point: float, low: float, high: float) -> str:
    return f"{fmt_pts(point)} [{fmt_pts(low)}, {fmt_pts(high)}]"


def summary_row(label: str, ids: list[int], hits: list[float], bases: list[float]) -> list[str]:
    if not ids:
        return [label, "0", "—", "—", "—"]
    edge = boot(ids, hits, bases)
    return [label, str(len(set(ids))), fmt_pct(sum(hits) / len(hits)), fmt_pct(sum(bases) / len(bases)), interval(*edge)]


def decided(rows: list[dict], prefix: str = "") -> list[dict]:
    return [r for r in rows if r[f"{prefix}hit"] != ""]


def engine_picks(path: Path) -> dict[int, list[tuple[float, float]]]:
    """Picks actuales del motor por partido, en su orden (el primero, el mas
    fuerte): (se cumplio, frecuencia de la liga). Del CSV de export-picks."""
    out: dict[int, list[tuple[float, float]]] = defaultdict(list)
    if not path.exists():
        return out
    with path.open(encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            if r["hit"] != "" and r["league_rate"] != "":
                out[int(r["match_id"])].append((float(r["hit"]), float(r["league_rate"])))
    return out


def report(rows: list[dict], picks_path: Path) -> dict:
    engine = engine_picks(picks_path)
    summary = {}
    for season, label in SEASON_LABEL.items():
        season_rows = [r for r in rows if r["season"] == season]
        if not season_rows:
            continue
        chosen = decided([r for r in season_rows if r["family"]])
        print(f"\n=== {label} ===")
        print(
            f"Partidos: {len(season_rows)} · con pick: {sum(1 for r in season_rows if r['family'])}"
            f" · candidatos con dato por partido: {sum(int(r['available']) for r in season_rows) / len(season_rows):.0f} de 338"
            f" · elegibles: {sum(int(r['eligible']) for r in season_rows) / len(season_rows):.1f}"
        )
        ids = [int(r["match_id"]) for r in chosen]
        hits = [float(r["hit"]) for r in chosen]
        bases = [float(r["base"]) for r in chosen]
        probs = [float(r["p"]) for r in chosen]
        out = [summary_row("Pick del partido", ids, hits, bases)]

        base_rows = decided([r for r in season_rows if r["b_family"]], "b_")
        out.append(
            summary_row(
                "Base: mayor probabilidad",
                [int(r["match_id"]) for r in base_rows],
                [float(r["b_hit"]) for r in base_rows],
                [float(r["b_base"]) for r in base_rows],
            )
        )
        season_ids = sorted({int(r["match_id"]) for r in season_rows})
        eng_rows = [(mid, h, b) for mid in season_ids for h, b in engine.get(mid, [])]
        eng_top = [(mid, *engine[mid][0]) for mid in season_ids if engine.get(mid)]
        for name, data in (("Motor actual: todos sus picks", eng_rows), ("Motor actual: primer pick", eng_top)):
            out.append(summary_row(name, [m for m, _, _ in data], [h for _, h, _ in data], [b for _, _, b in data]))
        table(["", "Partidos", "Acierto", "Base liga", "Ventaja (pts) [IC 95 %]"], out)

        # Diferencias de ventaja en los mismos partidos.
        def paired(label2: str, other: dict[int, tuple[float, float]]) -> None:
            common = [r for r in chosen if int(r["match_id"]) in other]
            if not common:
                return
            d = [(float(r["hit"]) - float(r["base"])) - (other[int(r["match_id"])][0] - other[int(r["match_id"])][1]) for r in common]
            gain = boot([int(r["match_id"]) for r in common], d, [0.0] * len(d))
            print(f"  Pick del partido − {label2} (mismos partidos, n={len(common)}): {interval(*gain)}")

        paired("mayor probabilidad", {int(r["match_id"]): (float(r["b_hit"]), float(r["b_base"])) for r in base_rows})
        paired("primer pick del motor", {m: (h, b) for m, h, b in eng_top})

        print(f"  Calibración: anunciado {fmt_pct(sum(probs) / len(probs))} → acierto {fmt_pct(sum(hits) / len(hits))}")
        for low, high in CALIBRATION:
            sel = [(p, h) for p, h in zip(probs, hits, strict=True) if low <= p < high]
            if sel:
                print(f"    {low:.0%}–{min(high, 1):.0%}: n={len(sel):4d} anunciado {fmt_pct(sum(p for p, _ in sel) / len(sel))} → {fmt_pct(sum(h for _, h in sel) / len(sel))}")

        kinds = defaultdict(int)
        for r in chosen:
            kinds[kind_label(f"{r['family']}|{r['direction'] or r['option']}")] += 1
        print("  Tipos más elegidos: " + ", ".join(f"{k} ({v})" for k, v in sorted(kinds.items(), key=lambda kv: -kv[1])[:6]))
        summary[season] = {"matches": len(season_rows), "with_pick": len(chosen), "edge": boot(ids, hits, bases) if ids else None}

    pinnacle(rows)
    return summary


def pinnacle(rows: list[dict]) -> None:
    print("\n=== Mercado: pick del partido frente a Pinnacle sin margen ===")
    picks = [
        Pick(
            league=r["league"], season=r["season"], match_id=int(r["match_id"]), date=r["date"],
            side=r["side"] if r["side"] != "match" else "home", team="", family=r["family"], option=r["option"],
            direction=r["direction"] or None, line=float(r["line"]) if r["line"] != "" else None, text=r["text"],
            strength="pick-del-partido", hit=int(r["hit"]) if r["hit"] != "" else None,
        )
        for r in rows
        if r["family"]
    ]  # fmt: skip
    db = SessionLocal()
    try:
        first = db.query(PinnacleCapture.captured_at).filter_by(status="ok").order_by(PinnacleCapture.captured_at).first()
        fd_close, fd_pre = football_data_books(db, {p.match_id for p in picks})
        cap_close, cap_open = captured_books(db)
    finally:
        db.close()
    forward = [p for p in picks if first and p.date >= first[0].isoformat()]
    for title, ev in (
        ("Cierre de Pinnacle en Football-Data (1X2, más/menos 2.5)", evaluate_picks(picks, fd_close, fd_pre)),
        ("Capturas propias", evaluate_picks(forward, cap_close, cap_open)),
    ):
        out = []
        for season, label in SEASON_LABEL.items():
            s = summarize([e for e in ev.evaluated if e.pick.season == season])
            if s:
                out.append([label, str(s.n), fmt_pct(s.hit_rate), fmt_pct(s.mean_p), interval(s.diff, s.low, s.high)])
        print(f"\n  {title}: {len(ev.evaluated)} picks con línea equivalente")
        if out:
            table(["Temporada", "Picks", "Acierto", "Pinnacle", "Diferencia (pts) [IC]"], out)


def write_json(rows: list[dict], summary: dict, out: Path) -> None:
    kinds: dict[str, list[dict]] = defaultdict(list)
    for r in decided([r for r in rows if r["family"]]):
        kinds[f"{r['family']}|{r['direction'] or r['option']}"].append(r)
    kind_stats = {}
    for kind, rs in kinds.items():
        edge, low, high = boot([int(r["match_id"]) for r in rs], [float(r["hit"]) for r in rs], [float(r["base"]) for r in rs])
        kind_stats[kind] = {
            "label": kind_label(kind),
            "n": len(rs),
            "hit_rate": sum(float(r["hit"]) for r in rs) / len(rs),
            "base": sum(float(r["base"]) for r in rs) / len(rs),
            "edge": edge,
            "low": low,
            "high": high,
        }
    matches = {}
    for r in rows:
        matches[r["match_id"]] = None if not r["family"] else {
            "text": r["text"], "family": r["family"], "side": r["side"], "option": r["option"],
            "kind": f"{r['family']}|{r['direction'] or r['option']}", "p": float(r["p"]), "base": float(r["base"]),
            "n": int(r["n"]), "hit": None if r["hit"] == "" else bool(int(r["hit"])),
        }  # fmt: skip
    payload = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "protocol": "docs/PICK_DEL_PARTIDO_PROTOCOLO.md",
        "matches": matches,
        "kinds": kind_stats,
        "summary": summary,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"\n{len(matches)} partidos -> {out}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--leagues", default=",".join(LEAGUES))
    parser.add_argument("--seasons", default="2526,2627")
    parser.add_argument("--matches", type=Path, default=REPORTS / "match_pick_matches.csv")
    parser.add_argument("--picks", type=Path, default=REPORTS / "picks_probables.csv")
    parser.add_argument("--out", type=Path, default=OUTPUT)
    parser.add_argument("--report-only", action="store_true")
    parser.add_argument("--jobs", type=int, default=6)
    args = parser.parse_args()

    if not args.report_only:
        leagues = [x.strip() for x in args.leagues.split(",")]
        seasons = [x.strip() for x in args.seasons.split(",")]
        rows: list[dict] = []
        with ProcessPoolExecutor(max_workers=min(args.jobs, len(leagues))) as pool:
            for code, result in zip(leagues, pool.map(compute_league, leagues, [seasons] * len(leagues)), strict=True):
                print(f"{code}: {len(result)} partidos")
                rows += result
        args.matches.parent.mkdir(parents=True, exist_ok=True)
        with args.matches.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=COLUMNS)
            w.writeheader()
            for r in rows:
                w.writerow({c: r.get(c, "") for c in COLUMNS})
    with args.matches.open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    summary = report(rows, args.picks)
    write_json(rows, summary, args.out)


if __name__ == "__main__":
    main()
