"""Picks muy probables frente a Pinnacle: ¿aciertan mas de lo que el mercado
ya espera?

Los picks salen del motor de la web sin tocarlo (frontend/scripts/
export-picks.ts escribe un CSV); aqui solo se miden. Para cada pick con un
mercado equivalente en Pinnacle y la misma linea exacta (sin interpolar): la
probabilidad sin margen de Pinnacle al cierre, si se cumplio y, si hay
apertura, cuanto se movio el mercado a favor o en contra (CLV).

Equivalencias (EQUIVALENCES): el suceso del pick y el del mercado son el mismo.
- Goles del partido -> total de goles; marca / encaja X goles -> total del
  equipo (y "marca" o "encaja" a secas, si no hay total a 0.5, -> "marca X").
- Ambos marcan -> ambos marcan; gana / empata / pierde -> 1X2; no pierde ->
  doble oportunidad derivada del 1X2 sin margen.
- Corners del partido y del equipo -> corners de Pinnacle (cuenta los
  lanzados; un corner repetido cuenta una vez, como en nuestros datos).
Sin equivalente (NO_EQUIVALENT): tarjetas (no comparables, ver
CARDS_NOT_COMPARABLE), faltas, tiros y tiros a puerta (Pinnacle no tiene).
"""

from __future__ import annotations

import csv
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from app.analysis.books import Book, MONEYLINE, double_chance, market_probabilities
from app.analysis.stats import bootstrap_mean_diff, calibration
from app.probability.devig import DEFAULT_METHOD, Method, line_kind

# Pinnacle cuenta amarilla = 1 y roja = 2, ignora la segunda amarilla (maximo
# 3 por jugador) y no cuenta las de banquillo; nuestros datos cuentan
# amarillas + rojas. Ver docs/PINNACLE.md.
CARDS_NOT_COMPARABLE = "no comparable: tarjetas con otra definición (roja = 2)"
NO_MARKET = "sin mercado en Pinnacle"

NO_EQUIVALENT = {
    "tarjetas": CARDS_NOT_COMPARABLE,
    "tarjetas-equipo": CARDS_NOT_COMPARABLE,
    "faltas": NO_MARKET,
    "faltas-equipo": NO_MARKET,
    "tiros": NO_MARKET,
    "tiros-equipo": NO_MARKET,
    "tiros-puerta": NO_MARKET,
    "tiros-puerta-equipo": NO_MARKET,
}

FAMILY_LABEL = {
    "goles": "Goles del partido",
    "goles-equipo": "Goles del equipo (marca)",
    "goles-rival": "Goles del rival (encaja)",
    "ambos-marcan": "Ambos marcan",
    "resultado": "Resultado",
    "corners": "Córners del partido",
    "corners-equipo": "Córners del equipo",
    "tarjetas": "Tarjetas del partido",
    "tarjetas-equipo": "Tarjetas del equipo",
    "faltas": "Faltas del partido",
    "faltas-equipo": "Faltas del equipo",
    "tiros": "Tiros del partido",
    "tiros-equipo": "Tiros del equipo",
    "tiros-puerta": "Tiros a puerta del partido",
    "tiros-puerta-equipo": "Tiros a puerta del equipo",
}


@dataclass(frozen=True)
class Target:
    """Un mercado de Pinnacle y la seleccion que equivale al pick."""

    units: str
    period: int
    market: str
    team: str | None
    line: float | None
    selection: str


@dataclass(frozen=True)
class Equivalence:
    targets: tuple[Target, ...]  # en orden de preferencia
    derived_dc: str | None = None  # "no pierde": doble oportunidad del 1X2


@dataclass(frozen=True)
class NoEquivalence:
    reason: str


def _other(side: str) -> str:
    return "away" if side == "home" else "home"


def _team_goals(team: str, direction: str, line: float) -> tuple[Target, ...]:
    targets = [Target("goals", 0, "team_total", team, line, direction)]
    if line == 0.5:  # "marca" / "no marca" son tambien el especial "marca X"
        targets.append(Target("goals", 0, "team_to_score", team, None, "yes" if direction == "over" else "no"))
    return tuple(targets)


def equivalence(family: str, option: str, side: str, direction: str | None, line: float | None) -> Equivalence | NoEquivalence:
    """El mercado de Pinnacle con el mismo suceso que el pick, o por que no hay."""
    if family in NO_EQUIVALENT:
        return NoEquivalence(NO_EQUIVALENT[family])
    if family in ("goles", "corners") and direction and line is not None:
        units = "goals" if family == "goles" else "corners"
        return Equivalence((Target(units, 0, "total", None, line, direction),))
    if family == "goles-equipo" and direction and line is not None:
        return Equivalence(_team_goals(side, direction, line))
    if family == "goles-rival" and direction and line is not None:
        return Equivalence(_team_goals(_other(side), direction, line))
    if family == "corners-equipo" and direction and line is not None:
        return Equivalence((Target("corners", 0, "team_total", side, line, direction),))
    if family == "ambos-marcan" and option in ("si", "no"):
        return Equivalence((Target("goals", 0, "btts", None, None, "yes" if option == "si" else "no"),))
    if family == "resultado":
        if option == "gana":
            return Equivalence((Target(*MONEYLINE[:3], None, None, side),))
        if option == "pierde":
            return Equivalence((Target(*MONEYLINE[:3], None, None, _other(side)),))
        if option == "empata":
            return Equivalence((Target(*MONEYLINE[:3], None, None, "draw"),))
        if option == "no-pierde":
            return Equivalence((), derived_dc="home_draw" if side == "home" else "draw_away")
    return NoEquivalence(f"pick sin equivalencia definida ({family} {option})")


@dataclass(frozen=True)
class Quote:
    p: float
    market: str  # descripcion del mercado usado


def pick_quote(eq: Equivalence, book: Book, method: Method = DEFAULT_METHOD) -> Quote | str:
    """Probabilidad sin margen del pick en ese libro, o el motivo por el que no
    se puede (linea distinta, mercado ausente)."""
    if eq.derived_dc:
        probs = double_chance(book, method)
        return Quote(probs[eq.derived_dc], "doble oportunidad (del 1X2)") if probs else "sin 1X2"
    reasons = []
    for t in eq.targets:
        if t.line is not None and line_kind(t.line) == "quarter":
            reasons.append("cuarto de línea")
            continue
        key = (t.units, t.period, t.market, t.team, t.line)
        probs = market_probabilities(book, key, method)
        if probs is not None:
            label = t.market if t.line is None else f"{t.market} {t.line:g}"
            return Quote(probs[t.selection], f"{t.units} {label}")
        offered = book.lines(t.units, t.period, t.market, t.team)
        reasons.append("línea distinta" if offered else "sin cuota del mercado")
    return "línea distinta" if "línea distinta" in reasons else (reasons[0] if reasons else "sin cuota del mercado")


def nearest_line(eq: Equivalence, book: Book) -> float | None:
    """La linea ofrecida mas cercana a la del pick (solo informativa: no se
    usa para evaluar, no se interpola)."""
    for t in eq.targets:
        offered = book.lines(t.units, t.period, t.market, t.team)
        if t.line is not None and offered:
            return min(offered, key=lambda line: (abs(line - t.line), line))
    return None


# --- picks exportados --------------------------------------------------------


@dataclass(frozen=True)
class Pick:
    league: str
    season: str
    match_id: int
    date: str
    side: str
    team: str
    family: str
    option: str
    direction: str | None
    line: float | None
    text: str
    strength: str
    hit: int | None


def read_picks(path: Path) -> list[Pick]:
    """El CSV de frontend/scripts/export-picks.ts."""
    with path.open(encoding="utf-8", newline="") as f:
        return [
            Pick(
                league=r["league"],
                season=r["season"],
                match_id=int(r["match_id"]),
                date=r["date"],
                side=r["side"],
                team=r["team"],
                family=r["family"],
                option=r["option"],
                direction=r["dir"] or None,
                line=float(r["line"]) if r["line"] else None,
                text=r["text"],
                strength=r["strength"],
                hit=int(r["hit"]) if r["hit"] != "" else None,
            )
            for r in csv.DictReader(f)
        ]


@dataclass(frozen=True)
class Evaluated:
    pick: Pick
    p_close: float
    p_open: float | None
    source: str
    market: str
    max_stake: float | None


@dataclass
class Evaluation:
    evaluated: list[Evaluated]
    excluded: Counter  # (familia, motivo) -> picks
    undecided: int  # sin dato para saber si se cumplio
    # Picks con mercado equivalente pero otra linea: (pick, linea mas cercana).
    other_line: list[tuple[Pick, float | None]] = field(default_factory=list)


def evaluate_picks(
    picks: list[Pick],
    closing: dict[int, Book],
    opening: dict[int, Book] | None = None,
    method: Method = DEFAULT_METHOD,
) -> Evaluation:
    """Cada pick jugado con mercado equivalente y cuota de cierre, o el motivo
    por el que queda fuera."""
    opening = opening or {}
    evaluated: list[Evaluated] = []
    excluded: Counter = Counter()
    other_line: list[tuple[Pick, float | None]] = []
    undecided = 0
    for pick in picks:
        if pick.hit is None:
            undecided += 1
            continue
        eq = equivalence(pick.family, pick.option, pick.side, pick.direction, pick.line)
        if isinstance(eq, NoEquivalence):
            excluded[(pick.family, eq.reason)] += 1
            continue
        book = closing.get(pick.match_id)
        if book is None:
            excluded[(pick.family, "sin cuotas de Pinnacle del partido")] += 1
            continue
        quote = pick_quote(eq, book, method)
        if isinstance(quote, str):
            excluded[(pick.family, quote)] += 1
            if quote == "línea distinta":
                other_line.append((pick, nearest_line(eq, book)))
            continue
        opened = opening.get(pick.match_id)
        open_quote = pick_quote(eq, opened, method) if opened else None
        evaluated.append(
            Evaluated(
                pick=pick,
                p_close=quote.p,
                p_open=open_quote.p if isinstance(open_quote, Quote) else None,
                source=book.source,
                market=quote.market,
                max_stake=book.max_stake,
            )
        )
    return Evaluation(evaluated, excluded, undecided, other_line)


# --- resumenes -----------------------------------------------------------------


@dataclass(frozen=True)
class Summary:
    n: int
    matches: int
    hits: int
    hit_rate: float
    mean_p: float
    diff: float  # acierto - probabilidad media de Pinnacle
    low: float
    high: float
    clv_n: int
    mean_move: float | None  # media de (p cierre - p apertura)
    move_low: float | None  # intervalo al 95 % de esa media (por partidos)
    move_high: float | None
    moved_for: float | None  # parte de picks en los que el mercado se movio a favor


def summarize(rows: list[Evaluated]) -> Summary | None:
    if not rows:
        return None
    ids = [r.pick.match_id for r in rows]
    hits = [float(r.pick.hit) for r in rows]
    probs = [r.p_close for r in rows]
    diff, low, high = bootstrap_mean_diff(ids, hits, probs)
    with_open = [r for r in rows if r.p_open is not None]
    moves = [r.p_close - r.p_open for r in with_open]
    move_ci = (
        bootstrap_mean_diff([r.pick.match_id for r in with_open], moves, [0.0] * len(moves)) if moves else (None,) * 3
    )
    return Summary(
        n=len(rows),
        matches=len(set(ids)),
        hits=int(sum(hits)),
        hit_rate=sum(hits) / len(rows),
        mean_p=sum(probs) / len(rows),
        diff=diff,
        low=low,
        high=high,
        clv_n=len(moves),
        mean_move=move_ci[0],
        move_low=move_ci[1],
        move_high=move_ci[2],
        moved_for=sum(m > 0 for m in moves) / len(moves) if moves else None,
    )


def pick_calibration(rows: list[Evaluated]):
    """Probabilidad de Pinnacle por tramos frente a lo que se cumplio."""
    return calibration([r.p_close for r in rows], [r.pick.hit for r in rows])
