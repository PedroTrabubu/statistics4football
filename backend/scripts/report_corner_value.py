"""¿Hay value en el duelo de córners? (protocolo: docs/VALUE_CORNERES_PROTOCOLO.md).

Hasta llegar a 400 partidos solo dice cuántos lleva: el resultado se mira una vez.

Uso (desde backend/, con el venv activado):
    python scripts/report_corner_value.py
"""

import math
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import experiments_corner_duel as duel_model  # noqa: E402
from app.analysis.stats import bootstrap_mean_diff  # noqa: E402
from app.core.config import PROJECT_ROOT  # noqa: E402
from app.probability.devig import devig  # noqa: E402

START = datetime(2026, 10, 14)
TARGET = 400
EDGE = 0.05
DB = PROJECT_ROOT / "data" / "stadistics4bet.db"


def eligible(c: sqlite3.Connection) -> tuple[dict, dict]:
    """Cuotas de cierre del hándicap de córners y córners de los partidos que cuentan."""
    odds: dict[int, dict] = defaultdict(dict)
    for mid, sel, line, o in c.execute(
        """select o.match_id, o.selection, o.line, o.odds from pinnacle_closing_odds o join matches m on m.id = o.match_id
           where o.units = 'corners' and o.period = 0 and o.market = 'spread' and o.line in (-0.5, 0, 0.5)
             and m.status = 'HISTORICAL' and m.date >= ?""",
        (START.isoformat(sep=" "),),
    ):
        odds[mid][(sel, float(line) + 0.0)] = o
    corners = {
        mid: (h, a)
        for mid, h, a in c.execute(
            """select m.id, h.corners_for, a.corners_for from matches m
               join team_match_stats h on h.match_id = m.id and h.team_id = m.home_team_id
               join team_match_stats a on a.match_id = m.id and a.team_id = m.away_team_id
               where h.corners_for is not null and a.corners_for is not null"""
        )
    }
    return {m: q for m, q in odds.items() if m in corners}, corners


def markets(q: dict) -> list[tuple[str, str, float, float, str, float, float]]:
    """(mercado, selección, cuota, prob. Pinnacle, otra selección, su cuota, su prob.) de cada mercado completo."""
    out = []
    if ("home", 0.0) in q and ("away", 0.0) in q:
        ph, pa = devig([q[("home", 0.0)], q[("away", 0.0)]])
        out.append(("0", "home", q[("home", 0.0)], ph, "away", q[("away", 0.0)], pa))
    for side, other in (("home", "away"), ("away", "home")):
        if (side, -0.5) in q and (other, 0.5) in q:
            p, p_other = devig([q[(side, -0.5)], q[(other, 0.5)]])
            out.append(("-0.5", side, q[(side, -0.5)], p, other, q[(other, 0.5)], p_other))
    return out


def model_prob(market: str, side: str, minus: bool, f: dict) -> float:
    home, draw, away = duel_model.predict("v1", f)
    win = home if side == "home" else away
    if market == "0":
        return win / (1 - draw)
    return win if minus else win + draw


def settle(market: str, side: str, minus: bool, h: int, a: int) -> int:
    """1 gana, 0 devuelve, -1 pierde."""
    diff = (h - a) if side == "home" else (a - h)
    if market == "0":
        return 0 if diff == 0 else (1 if diff > 0 else -1)
    return 1 if (diff > 0 if minus else diff >= 0) else -1


def main() -> None:
    c = sqlite3.connect(DB)
    odds, corners = eligible(c)
    if len(odds) < TARGET and "--force" not in sys.argv:
        print(f"Partidos que cuentan: {len(odds)} de {TARGET}. El resultado se mira al llegar (protocolo).")
        return
    rows = duel_model.load()
    feats = {f["id"]: f for f in duel_model.build(rows, ("2627", "2728"))}
    fav, value, ll = [], [], []
    for mid, q in odds.items():
        f = feats.get(mid)
        if f is None:
            continue
        h, a = corners[mid]
        for market, side, o, p, other, o2, p2 in markets(q):
            # En "−0.5" la primera selección es la del −0.5 y la otra la del +0.5.
            sels = [(side, o, p, True), (other, o2, p2, False)]
            best = max(sels, key=lambda s: s[2])
            fav.append((mid, best[2], best[1], settle(market, best[0], best[3], h, a)))
            edges = [(model_prob(market, s, minus, f) - pp, s, oo, minus) for s, oo, pp, minus in sels]
            edge, s, oo, minus = max(edges)
            if edge > EDGE:
                value.append((mid, edge, oo, settle(market, s, minus, h, a)))
            res = settle(market, side, True, h, a)
            if res != 0:
                pm = model_prob(market, side, True, f)
                won = res == 1
                ll.append((mid, -math.log(pm if won else 1 - pm), -math.log(p if won else 1 - p)))

    def roi(bets):
        return [(o - 1) if r == 1 else (0.0 if r == 0 else -1.0) for _, _, o, r in bets]

    print(f"Partidos: {len(odds)}")
    decided = [x for x in fav if x[3] != 0]
    print(f"Favoritos: {len(fav)} · aciertan {np.mean([x[3] == 1 for x in decided]):.1%} · Pinnacle esperaba "
          f"{np.mean([x[1] for x in decided]):.1%} · rentabilidad {np.mean(roi(fav)):+.1%}")  # fmt: skip
    if value:
        r = roi(value)
        d, lo, hi = bootstrap_mean_diff([x[0] for x in value], r, [0.0] * len(r))
        print(f"Con valor: {len(value)} · ventaja media prevista {np.mean([x[1] for x in value]):.1%} · aciertan "
              f"{np.mean([x[3] == 1 for x in value if x[3] != 0]):.1%} · rentabilidad {d:+.1%} [{lo:+.1%}, {hi:+.1%}]")  # fmt: skip
    if ll:
        d, lo, hi = bootstrap_mean_diff([x[0] for x in ll], [x[1] for x in ll], [x[2] for x in ll])
        print(f"Log-loss modelo − Pinnacle: {d:+.4f} [{lo:+.4f}, {hi:+.4f}] ({len(ll)} mercados)")


if __name__ == "__main__":
    main()
