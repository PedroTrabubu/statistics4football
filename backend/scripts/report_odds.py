"""Inventario de las cuotas guardadas: de que casa, que mercados, desde cuando
y que hay para los proximos partidos. Solo lee la BD. Horas en UTC.

Uso (desde backend/, con el venv activado):
    python scripts/report_odds.py               # inventario y proximos 7 dias
    python scripts/report_odds.py --days 3      # proximos 3 dias
    python scripts/report_odds.py --match 4560  # todas las cuotas de un partido
    python scripts/report_odds.py --match 4560 --alt  # con las lineas alternativas de Pinnacle

Fuentes:
- Football-Data.co.uk (CSV de la temporada y fixtures.csv): tabla match_odds,
  con la hora del partido como snapshot_time (en punto: ...:00.000000).
- the-odds-api.com (app/ingestion/prematch_odds_backfill.py): tambien en
  match_odds, con la hora real de la consulta como snapshot_time.
- Pinnacle, capturas propias (app/ingestion/pinnacle.py): pinnacle_odds.
"""

import argparse
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text

from app.db.session import engine

# Football-Data guarda la hora del partido (en punto); the-odds-api, la de la consulta.
SOURCE_SQL = "CASE WHEN substr(o.snapshot_time, 18) = '00.000000' THEN 'Football-Data' ELSE 'The Odds API' END"

MARKET = {"1x2": "1X2", "over_under_2.5": "Más/menos 2,5", "asian_handicap": "Hándicap asiático"}
PIN_MARKET = {
    "moneyline": "1X2",
    "double_chance": "Doble oportunidad",
    "draw_no_bet": "Empate no apuesta",
    "spread": "Hándicap",
    "total": "Más/menos",
    "team_total": "Por equipo",
    "team_to_score": "Marca",
    "btts": "Ambos marcan",
}
PIN_ORDER = list(PIN_MARKET)
UNITS = {"goals": "Goles", "corners": "Córners", "bookings": "Tarjetas"}
PERIOD = {0: "Partido", 1: "1.ª parte"}
SELECTION = {
    "home": "1",
    "draw": "X",
    "away": "2",
    "over": "Más",
    "under": "Menos",
    "yes": "Sí",
    "no": "No",
    "home_draw": "1X",
    "home_away": "12",
    "draw_away": "X2",
}
SELECTION_ORDER = list(SELECTION)


def when(value) -> str:
    """'2026-11-17 09:22:53.26' -> '17/11/2026 09:22'."""
    if value is None:
        return "—"
    s = str(value)
    return f"{s[8:10]}/{s[5:7]}/{s[:4]} {s[11:16]}".strip()


def day(value) -> str:
    return when(value)[:10] if value is not None else "—"


def line_text(line, signed: bool = False) -> str:
    """2.5 -> '2,5'; con signo (handicap): -1.5 -> '-1,5', 1.5 -> '+1,5'."""
    if line is None:
        return ""
    return (f"{line:+g}" if signed else f"{line:g}").replace(".", ",")


def table(headers: list[str], rows: list[list], right: set[int] | None = None) -> None:
    right = right or set()
    cells = [[str(c) for c in headers]] + [["—" if c is None else str(c) for c in r] for r in rows]
    widths = [max(len(r[i]) for r in cells) for i in range(len(headers))]

    def fmt(r: list[str]) -> str:
        return "  ".join(c.rjust(w) if i in right else c.ljust(w) for i, (c, w) in enumerate(zip(r, widths))).rstrip()

    print("  " + fmt(cells[0]))
    print("  " + "  ".join("-" * w for w in widths))
    for r in cells[1:]:
        print("  " + fmt(r))


def title(s: str) -> None:
    print(f"\n{s}\n{'=' * len(s)}")


def inventory(conn) -> None:
    title("Football-Data y The Odds API (tabla match_odds)")
    rows = conn.execute(
        text(f"""
        SELECT {SOURCE_SQL} AS source, o.bookmaker, o.market, count(DISTINCT o.match_id),
               min(m.date), max(m.date), max(o.snapshot_time)
        FROM match_odds o JOIN matches m ON m.id = o.match_id
        GROUP BY 1, 2, 3 ORDER BY 1, 2, 3""")
    ).all()
    table(
        ["Fuente", "Casa", "Mercado", "Partidos", "Primer partido", "Último partido", "Última consulta"],
        [
            [src, bk, MARKET.get(mk, mk), n, day(first), day(last), when(snap) if src == "The Odds API" else ""]
            for src, bk, mk, n, first, last, snap in rows
        ],
        right={3},
    )
    print("  Cada casa de Football-Data va dos veces: la cuota cuando hace la foto (viernes o martes) y la de cierre.")

    title("Pinnacle: capturas propias (tablas pinnacle_captures y pinnacle_odds)")
    rows = conn.execute(
        text("""
        SELECT league_code, count(*), sum(status = 'ok'), sum(status = 'failed'), sum(status NOT IN ('ok', 'failed')),
               min(captured_at), max(CASE WHEN status = 'ok' THEN captured_at END), sum(n_rows_written)
        FROM pinnacle_captures GROUP BY league_code ORDER BY league_code""")
    ).all()
    table(
        ["Liga", "Capturas", "Bien", "Fallidas", "Sin acabar", "Primera", "Última buena", "Precios"],
        [[lg, n, ok, bad, other, when(first), when(last), f"{prices or 0:,}".replace(",", ".")] for lg, n, ok, bad, other, first, last, prices in rows],
        right={1, 2, 3, 4, 7},
    )
    failures = conn.execute(
        text("""
        SELECT substr(captured_at, 1, 10), count(*), max(substr(coalesce(error, ''), 1, 90))
        FROM pinnacle_captures WHERE status = 'failed' AND captured_at >= datetime('now', '-14 days')
        GROUP BY 1 ORDER BY 1 DESC""")
    ).all()
    if failures:
        print("\n  Fallos de los últimos 14 días:")
        for d, n, error in failures:
            print(f"    {day(d)}: {n} — {error}")

    title("Pinnacle: mercados capturados (partidos con cada uno)")
    rows = conn.execute(
        text("""
        SELECT units, market, period, count(DISTINCT match_id) FROM pinnacle_odds
        GROUP BY 1, 2, 3""")
    ).all()
    by = defaultdict(dict)
    for units, market, period, n in rows:
        by[(units, market)][period] = n
    keys = sorted(by, key=lambda k: (list(UNITS).index(k[0]) if k[0] in UNITS else 9, PIN_ORDER.index(k[1]) if k[1] in PIN_ORDER else 99))
    table(
        ["Estadística", "Mercado", "Partido", "1.ª parte"],
        [[UNITS.get(u, u), PIN_MARKET.get(m, m), by[(u, m)].get(0, ""), by[(u, m)].get(1, "")] for u, m in keys],
        right={2, 3},
    )


def upcoming(conn, days: int) -> None:
    title(f"Próximos {days} días: qué cuotas tiene cada partido")
    rows = conn.execute(
        text(f"""
        SELECT l.code, count(*),
          sum(EXISTS (SELECT 1 FROM pinnacle_odds p WHERE p.match_id = m.id)),
          max((SELECT max(p.captured_at) FROM pinnacle_odds p WHERE p.match_id = m.id)),
          sum(EXISTS (SELECT 1 FROM match_odds o WHERE o.match_id = m.id AND {SOURCE_SQL} = 'Football-Data')),
          sum(EXISTS (SELECT 1 FROM match_odds o WHERE o.match_id = m.id AND {SOURCE_SQL} = 'The Odds API')),
          max((SELECT max(o.snapshot_time) FROM match_odds o WHERE o.match_id = m.id AND {SOURCE_SQL} = 'The Odds API'))
        FROM matches m JOIN leagues l ON l.id = m.league_id
        WHERE m.status = 'SCHEDULED' AND m.date BETWEEN datetime('now') AND datetime('now', :span)
        GROUP BY l.code ORDER BY l.code"""),
        {"span": f"+{days} days"},
    ).all()
    if not rows:
        print("  Sin partidos programados.")
        return
    table(
        ["Liga", "Partidos", "Pinnacle", "Última captura", "Football-Data", "The Odds API", "Consultada"],
        [[lg, n, pin, when(last_pin), fd, oa, when(last_oa)] for lg, n, pin, last_pin, fd, oa, last_oa in rows],
        right={1, 2, 4, 5},
    )
    missing = conn.execute(
        text("""
        SELECT m.id, m.date, l.code, h.name, a.name FROM matches m
        JOIN leagues l ON l.id = m.league_id JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
        WHERE m.status = 'SCHEDULED' AND m.date BETWEEN datetime('now') AND datetime('now', :span)
          AND NOT EXISTS (SELECT 1 FROM pinnacle_odds p WHERE p.match_id = m.id)
        ORDER BY m.date"""),
        {"span": f"+{days} days"},
    ).all()
    if missing:
        print("\n  Sin cuotas de Pinnacle:")
        for mid, date, lg, home, away in missing:
            print(f"    {mid}  {when(date)}  {lg}: {home} - {away}")
    print("\n  Detalle de un partido: python scripts/report_odds.py --match <id>")


def margin_text(prices: dict[str, float], selections: tuple[str, ...]) -> str:
    """Margen de la casa y probabilidades sin margen, si estan todas las selecciones."""
    if not all(s in prices and prices[s] > 1 for s in selections):
        return ""
    total = sum(1 / prices[s] for s in selections)
    fair = " / ".join(f"{100 / prices[s] / total:.0f}" for s in selections)
    return f"margen {100 * (total - 1):.1f} % · sin margen {fair} %"


def odds_row(prices: dict[str, float]) -> str:
    keys = sorted(prices, key=lambda s: SELECTION_ORDER.index(s) if s in SELECTION_ORDER else 99)
    return "  ".join(f"{SELECTION.get(s, s)} {prices[s]:.2f}" for s in keys)


def match_detail(conn, match_id: int, alternates: bool) -> None:
    match = conn.execute(
        text("""
        SELECT m.date, m.status, l.code, h.name, a.name FROM matches m
        JOIN leagues l ON l.id = m.league_id JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
        WHERE m.id = :id"""),
        {"id": match_id},
    ).first()
    if match is None:
        print(f"No hay ningún partido con id {match_id}.")
        return
    date, status, league, home, away = match
    title(f"{home} - {away} · {league} · {when(date)} UTC ({'jugado' if status == 'HISTORICAL' else 'por jugar'})")

    rows = conn.execute(
        text(f"""
        SELECT {SOURCE_SQL}, o.bookmaker, o.market, o.line, o.selection, o.odds, o.snapshot_time
        FROM match_odds o WHERE o.match_id = :id"""),
        {"id": match_id},
    ).all()
    print("\nFootball-Data y The Odds API")
    if not rows:
        print("  Sin cuotas.")
    groups: dict[tuple, dict] = defaultdict(dict)
    snaps: dict[tuple, str] = {}
    for src, bk, mk, line, sel, odds, snap in rows:
        groups[(mk, src, bk, line)][sel] = odds
        snaps[(mk, src, bk, line)] = snap
    for key in sorted(groups, key=lambda k: (list(MARKET).index(k[0]) if k[0] in MARKET else 9, k[1], k[2], k[3] or 0)):
        mk, src, bk, line = key
        prices = groups[key]
        three = ("home", "draw", "away") if mk == "1x2" else ("over", "under") if mk.startswith("over") else ("home", "away")
        extra = f" · consulta {when(snaps[key])}" if src == "The Odds API" else ""
        # Mas/menos 2,5 ya lleva la linea en el nombre; el handicap, la del local.
        label = f"{MARKET.get(mk, mk)} {line_text(line, signed=True)}" if mk == "asian_handicap" else MARKET.get(mk, mk)
        print(f"  {label:<22} {bk:<26} {odds_row(prices):<34} {margin_text(prices, three)}{extra}")

    last = conn.execute(text("SELECT max(captured_at) FROM pinnacle_odds WHERE match_id = :id"), {"id": match_id}).scalar()
    print(f"\nPinnacle (última captura: {when(last)} UTC)")
    if last is None:
        print("  Sin cuotas.")
        return
    rows = conn.execute(
        text("""
        SELECT period, units, market, team, line, selection, odds, max_stake, alternate
        FROM pinnacle_odds WHERE match_id = :id AND captured_at = :at AND is_removed = 0"""),
        {"id": match_id, "at": last},
    ).all()
    groups = defaultdict(dict)
    stakes: dict[tuple, float | None] = {}
    alt: dict[tuple, bool] = {}
    for period, units, market, team, line, sel, odds, stake, alternate in rows:
        # El handicap va con la linea del local: -1,5 local y +1,5 visitante son la misma.
        key_line = -line if market == "spread" and sel == "away" and line is not None else line
        key = (units, period, market, team, key_line)
        groups[key][sel] = odds
        stakes[key] = stake
        alt[key] = bool(alternate)
    hidden = 0
    current = None
    for key in sorted(
        groups,
        key=lambda k: (
            list(UNITS).index(k[0]) if k[0] in UNITS else 9,
            k[1],
            PIN_ORDER.index(k[2]) if k[2] in PIN_ORDER else 99,
            k[3] or "",
            k[4] if k[4] is not None else 0,
        ),
    ):
        units, period, market, team, line = key
        if alt[key] and not alternates:
            hidden += 1
            continue
        if (units, period) != current:
            current = (units, period)
            print(f"  {UNITS.get(units, units)} · {PERIOD.get(period, period)}")
        prices = groups[key]
        who = {"home": home, "away": away}.get(team, "")
        shown_line = "" if line is None else f"{line_text(line, signed=True)} (local)" if market == "spread" else line_text(line)
        label = " ".join(p for p in (PIN_MARKET.get(market, market), who, shown_line) if p)
        sels = ("home", "draw", "away") if market == "moneyline" else ("over", "under") if "total" in market else ("yes", "no") if market in ("btts", "team_to_score") else ("home", "away")
        margin = margin_text(prices, sels) if market != "double_chance" else ""
        stake = f" · máx. {stakes[key]:g}" if stakes[key] else ""
        print(f"    {label:<34} {odds_row(prices):<34} {margin}{stake}")
    if hidden:
        print(f"  ({hidden} líneas alternativas ocultas: --alt para verlas)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Inventario de las cuotas guardadas.")
    parser.add_argument("--days", type=int, default=7, help="Próximos días a revisar (por defecto 7).")
    parser.add_argument("--match", type=int, help="Todas las cuotas de un partido (id).")
    parser.add_argument("--alt", action="store_true", help="Con --match: también las líneas alternativas de Pinnacle.")
    args = parser.parse_args()
    with engine.connect() as conn:
        if args.match is not None:
            match_detail(conn, args.match, args.alt)
            return
        inventory(conn)
        upcoming(conn, max(1, args.days))


if __name__ == "__main__":
    main()
