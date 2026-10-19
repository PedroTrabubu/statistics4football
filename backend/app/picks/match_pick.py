"""Pick del partido (protocolo pre-registrado: docs/PICK_DEL_PARTIDO_PROTOCOLO.md).

Para cada partido, un pick entre una lista cerrada de candidatos (los mercados de
FAMILIES en frontend/src/lib/patterns.ts con las lineas de markets.ts): la
probabilidad de cada uno sale de Dixon-Coles (goles y resultado) o de un modelo de
recuentos por liga, estadistica y campo (con el arbitro en tarjetas y faltas),
encogida hacia la frecuencia de la liga; gana la mayor ventaja en logit sobre esa
frecuencia. Todo point-in-time: cada partido solo con lo anterior a su dia.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np

from app.picks.count_model import MAX_COUNT, CountModel, CountTracker, fit_count_model

MIN_P = 0.65
TRIVIAL_BASE = 0.80
SHRINK = 5
CLIP = (0.001, 0.999)
REFEREE_SHRINK = 5
MIN_TRAIN_PAIRS = 50
COUNT_L2 = 1.0

# --- Candidatos (lista cerrada del protocolo) ---------------------------------------

TEAM_LINES: dict[str, tuple[float, float]] = {
    "goles-equipo": (0.5, 4.5),
    "goles-rival": (0.5, 4.5),
    "corners-equipo": (1.5, 8.5),
    "tarjetas-equipo": (0.5, 5.5),
    "faltas-equipo": (8.5, 15.5),
    "tiros-equipo": (6.5, 18.5),
    "tiros-puerta-equipo": (1.5, 7.5),
}
MATCH_LINES: dict[str, tuple[float, float]] = {
    "goles": (0.5, 6.5),
    "corners": (6.5, 13.5),
    "tarjetas": (0.5, 9.5),
    "faltas": (18.5, 28.5),
    "tiros": (16.5, 30.5),
    "tiros-puerta": (4.5, 12.5),
}
RESULT_OPTIONS = ("gana", "empata", "pierde", "no-pierde")
BTTS_OPTIONS = ("si", "no")

# Estadistica de cada mercado: goles o la de los recuentos.
STAT_OF = {
    "goles-equipo": "goals",
    "goles-rival": "goals",
    "goles": "goals",
    "corners": "corners",
    "corners-equipo": "corners",
    "tarjetas": "cards",
    "tarjetas-equipo": "cards",
    "faltas": "fouls",
    "faltas-equipo": "fouls",
    "tiros": "shots",
    "tiros-equipo": "shots",
    "tiros-puerta": "sot",
    "tiros-puerta-equipo": "sot",
}
COUNT_STATS = ("corners", "cards", "fouls", "shots", "sot")
REFEREE_STATS = ("cards", "fouls")
SIDES = ("home", "away")


@dataclass(frozen=True)
class Candidate:
    family: str
    side: str  # "home" | "away" | "match"
    option: str  # "over-2.5", "gana", "si"...
    direction: str | None
    line: float | None

    @property
    def key(self) -> str:
        return f"{self.family}|{self.side}|{self.option}"

    @property
    def ladder(self) -> str:
        """Escalera: mismo mercado, equipo y sentido (las opciones sueltas, solas)."""
        return f"{self.family}|{self.side}|{self.direction or self.option}"

    @property
    def kind(self) -> str:
        """Tipo de pick para el acierto historico: mercado y sentido (u opcion)."""
        return f"{self.family}|{self.direction or self.option}"


def _lines(low: float, high: float) -> list[float]:
    return [low + i for i in range(int(round(high - low)) + 1)]


def _over_under(family: str, side: str, low: float, high: float) -> list[Candidate]:
    lines = _lines(low, high)
    return [Candidate(family, side, f"{d}-{line:g}", d, line) for d in ("over", "under") for line in lines]


def candidates() -> list[Candidate]:
    out: list[Candidate] = []
    for side in SIDES:
        for family in ("goles-equipo", "goles-rival"):
            out += _over_under(family, side, *TEAM_LINES[family])
        out += [Candidate("resultado", side, o, None, None) for o in RESULT_OPTIONS]
        for family in ("corners-equipo", "tarjetas-equipo", "faltas-equipo", "tiros-equipo", "tiros-puerta-equipo"):
            out += _over_under(family, side, *TEAM_LINES[family])
    out += _over_under("goles", "match", *MATCH_LINES["goles"])
    out += [Candidate("ambos-marcan", "match", o, None, None) for o in BTTS_OPTIONS]
    for family in ("corners", "tarjetas", "faltas", "tiros", "tiros-puerta"):
        out += _over_under(family, "match", *MATCH_LINES[family])
    return out


CANDIDATES = candidates()

# --- Partidos y resultados ---------------------------------------------------------------


@dataclass
class MatchData:
    match_id: int
    league: str
    season: str
    date: datetime
    home_id: int
    away_id: int
    home_team: str
    away_team: str
    referee: str | None
    home_goals: int | None = None
    away_goals: int | None = None
    # estadistica -> (local, visitante); None si falta
    stats: dict[str, tuple[int | None, int | None]] = field(default_factory=dict)

    @property
    def played(self) -> bool:
        return self.home_goals is not None and self.away_goals is not None

    @property
    def day(self) -> str:
        return self.date.date().isoformat()

    def value(self, stat: str, side: str) -> int | None:
        if stat == "goals":
            return self.home_goals if side == "home" else self.away_goals
        pair = self.stats.get(stat)
        if pair is None:
            return None
        return pair[0] if side == "home" else pair[1]


def _other(side: str) -> str:
    return "away" if side == "home" else "home"


def _over_under_hit(c: Candidate, value: float | None) -> bool | None:
    if value is None:
        return None
    return value > c.line if c.direction == "over" else value < c.line


def outcome(c: Candidate, m: MatchData) -> bool | None:
    """Si el candidato se cumplio en el partido (None sin dato)."""
    if not m.played:
        return None
    if c.family == "resultado":
        own, rival = m.value("goals", c.side), m.value("goals", _other(c.side))
        return {"gana": own > rival, "empata": own == rival, "pierde": own < rival, "no-pierde": own >= rival}[c.option]
    if c.family == "ambos-marcan":
        both = m.home_goals > 0 and m.away_goals > 0
        return both if c.option == "si" else not both
    stat = STAT_OF[c.family]
    if c.side == "match":
        h, a = m.value(stat, "home"), m.value(stat, "away")
        return _over_under_hit(c, None if h is None or a is None else h + a)
    side = _other(c.side) if c.family == "goles-rival" else c.side
    return _over_under_hit(c, m.value(stat, side))


# --- Probabilidades ------------------------------------------------------------------------


@dataclass
class Distributions:
    """Marcador (Dixon-Coles) y lo que saca cada equipo en cada estadistica."""

    goals: np.ndarray | None  # local x visitante
    counts: dict[str, tuple[np.ndarray, np.ndarray]]  # estadistica -> (pmf local, pmf visitante)


def _tail(pmf: np.ndarray, c: Candidate) -> float:
    k = np.arange(len(pmf))
    return float(pmf[k > c.line].sum() if c.direction == "over" else pmf[k < c.line].sum())


def probability(c: Candidate, d: Distributions) -> float | None:
    if c.family in ("resultado", "ambos-marcan") or STAT_OF[c.family] == "goals":
        m = d.goals
        if m is None:
            return None
        i, j = np.indices(m.shape)
        if c.family == "resultado":
            own, rival = (i, j) if c.side == "home" else (j, i)
            mask = {"gana": own > rival, "empata": own == rival, "pierde": own < rival, "no-pierde": own >= rival}
            return float(m[mask[c.option]].sum())
        if c.family == "ambos-marcan":
            both = float(m[(i > 0) & (j > 0)].sum())
            return both if c.option == "si" else 1 - both
        if c.side == "match":
            total = np.bincount((i + j).ravel(), weights=m.ravel())
            return _tail(total, c)
        side = _other(c.side) if c.family == "goles-rival" else c.side
        return _tail(m.sum(axis=1) if side == "home" else m.sum(axis=0), c)
    pair = d.counts.get(STAT_OF[c.family])
    if pair is None:
        return None
    home, away = pair
    if c.side == "match":
        return _tail(np.convolve(home, away), c)
    return _tail(home if c.side == "home" else away, c)


# --- Estado de la liga, partido a partido ------------------------------------------------


class LeagueState:
    """Lo que se sabe de una liga antes de un dia: frecuencias por temporada,
    partidos por equipo, recuentos (CountTracker) y arbitros. Se alimenta en
    orden de fecha: primero se consulta, despues se añade el partido."""

    def __init__(self) -> None:
        # temporada -> clave del candidato -> [aciertos, con dato]
        self.freq: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(lambda: [0, 0]))
        # temporada -> equipo -> partidos
        self.team_matches: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
        self.trackers = {stat: CountTracker() for stat in COUNT_STATS}
        # estadistica -> campo -> (variables, valores) para entrenar
        self.train: dict[str, dict[str, tuple[list, list]]] = {s: {"home": ([], []), "away": ([], [])} for s in COUNT_STATS}
        self.referee: dict[str, dict[str, list[float]]] = {s: defaultdict(lambda: [0.0, 0]) for s in REFEREE_STATS}
        self.league_totals: dict[str, list[float]] = {s: [0.0, 0] for s in REFEREE_STATS}
        self.models: dict[tuple[str, str], CountModel] = {}

    # Ventana de la base: la temporada del partido y la anterior.
    def _window(self, season: str, seasons: list[str]) -> list[str]:
        i = seasons.index(season) if season in seasons else len(seasons)
        return [s for s in seasons[max(0, i - 1) : i + 1]]

    def base(self, c: Candidate, season: str, seasons: list[str]) -> float | None:
        hits = total = 0
        for s in self._window(season, seasons):
            h, n = self.freq[s][c.key]
            hits += h
            total += n
        return hits / total if total else None

    def sample(self, c: Candidate, m: MatchData, seasons: list[str]) -> int:
        window = self._window(m.season, seasons)

        def count(team: int) -> int:
            return sum(self.team_matches[s][team] for s in window)

        if c.side == "match":
            return min(count(m.home_id), count(m.away_id))
        return count(m.home_id if c.side == "home" else m.away_id)

    def _referee_feature(self, stat: str, referee: str | None) -> float:
        total, n = self.league_totals[stat]
        if not referee or n == 0 or total <= 0:
            return 0.0
        league_mean = total / n
        ref_total, ref_n = self.referee[stat][referee]
        return math.log((ref_total + REFEREE_SHRINK * league_mean) / ((ref_n + REFEREE_SHRINK) * league_mean))

    def features(self, stat: str, m: MatchData) -> dict[str, list[float]]:
        f = self.trackers[stat].features(m.home_id, m.away_id)
        if stat in REFEREE_STATS:
            ref = self._referee_feature(stat, m.referee)
            f = {side: [*f[side], ref] for side in SIDES}
        return f

    def refit(self) -> None:
        """Modelos de recuentos con todos los partidos anteriores."""
        self.models = {}
        for stat in COUNT_STATS:
            for side in SIDES:
                x, y = self.train[stat][side]
                if len(y) >= MIN_TRAIN_PAIRS:
                    self.models[(stat, side)] = fit_count_model(np.array(x), np.array(y, dtype=float), COUNT_L2)

    def count_distributions(self, m: MatchData) -> dict[str, tuple[np.ndarray, np.ndarray]]:
        out = {}
        for stat in COUNT_STATS:
            home, away = self.models.get((stat, "home")), self.models.get((stat, "away"))
            if home is None or away is None:
                continue
            f = self.features(stat, m)
            out[stat] = (home.pmf(f["home"]), away.pmf(f["away"]))
        return out

    def add(self, m: MatchData) -> None:
        if not m.played:
            return
        for c in CANDIDATES:
            hit = outcome(c, m)
            if hit is not None:
                cell = self.freq[m.season][c.key]
                cell[0] += int(hit)
                cell[1] += 1
        self.team_matches[m.season][m.home_id] += 1
        self.team_matches[m.season][m.away_id] += 1
        for stat in COUNT_STATS:
            h, a = m.value(stat, "home"), m.value(stat, "away")
            if h is None or a is None:
                continue
            f = self.features(stat, m)
            for side, value in (("home", h), ("away", a)):
                self.train[stat][side][0].append(f[side])
                self.train[stat][side][1].append(min(value, MAX_COUNT))
            self.trackers[stat].add(m.home_id, m.away_id, h, a)
            if stat in REFEREE_STATS:
                self.league_totals[stat][0] += h + a
                self.league_totals[stat][1] += 1
                if m.referee:
                    self.referee[stat][m.referee][0] += h + a
                    self.referee[stat][m.referee][1] += 1


# --- Eleccion --------------------------------------------------------------------------------


@dataclass(frozen=True)
class Scored:
    candidate: Candidate
    p_model: float
    p: float  # encogida hacia la base
    base: float
    n: int
    score: float


def _logit(p: float) -> float:
    p = min(max(p, CLIP[0]), CLIP[1])
    return math.log(p / (1 - p))


def score_candidates(m: MatchData, dists: Distributions, state: LeagueState, seasons: list[str]) -> list[Scored]:
    """Todos los candidatos con probabilidad y base (los que tienen dato)."""
    out = []
    for c in CANDIDATES:
        p_model = probability(c, dists)
        base = state.base(c, m.season, seasons)
        if p_model is None or base is None:
            continue
        n = state.sample(c, m, seasons)
        p = (n * p_model + SHRINK * base) / (n + SHRINK)
        out.append(Scored(c, p_model, p, base, n, _logit(p) - _logit(base)))
    return out


def eligible(scored: Iterable[Scored]) -> list[Scored]:
    return [s for s in scored if s.base < TRIVIAL_BASE and s.p >= MIN_P]


def _demanding(s: Scored) -> float:
    """Exigencia dentro de su escalera: mas de -> linea mas alta; menos de -> mas baja."""
    c = s.candidate
    if c.line is None:
        return 0.0
    return c.line if c.direction == "over" else -c.line


def choose(scored: list[Scored]) -> Scored | None:
    """El pick del partido: de cada escalera la linea mas exigente que pasa los
    filtros; gana la mayor ventaja en logit (empate: mas muestra)."""
    tops: dict[str, Scored] = {}
    for s in eligible(scored):
        ladder = s.candidate.ladder
        if ladder not in tops or _demanding(s) > _demanding(tops[ladder]):
            tops[ladder] = s
    if not tops:
        return None
    return max(tops.values(), key=lambda s: (s.score, s.n))


def choose_max_probability(scored: list[Scored]) -> Scored | None:
    """Linea base: el candidato de mayor probabilidad entre los que pasan los filtros."""
    pool = eligible(scored)
    return max(pool, key=lambda s: (s.p, s.n)) if pool else None


# --- Recorrido por dias -----------------------------------------------------------------------

GoalsModel = Callable[[MatchData], np.ndarray | None]


@dataclass
class Picked:
    match: MatchData
    available: int
    eligible: int
    pick: Scored | None
    baseline: Scored | None


def walk_forward(
    history: list[MatchData],
    targets: set[int],
    goals_for_day: Callable[[str], GoalsModel],
    seasons: list[str],
) -> list[Picked]:
    """Recorre la liga en orden de fecha. Cada dia con partidos objetivo: se
    reajustan los recuentos con lo anterior, se puntuan esos partidos (Dixon-Coles
    del dia: `goals_for_day`) y despues se añaden los partidos del dia."""
    state = LeagueState()
    out: list[Picked] = []
    by_day: dict[str, list[MatchData]] = defaultdict(list)
    for m in sorted(history, key=lambda m: (m.date, m.match_id)):
        by_day[m.day].append(m)
    for day in sorted(by_day):
        matches = by_day[day]
        todays = [m for m in matches if m.match_id in targets]
        if todays:
            state.refit()
            goals = goals_for_day(day)
            for m in todays:
                dists = Distributions(goals=goals(m), counts=state.count_distributions(m))
                scored = score_candidates(m, dists, state, seasons)
                out.append(Picked(m, len(scored), len(eligible(scored)), choose(scored), choose_max_probability(scored)))
        for m in matches:
            state.add(m)
    return out


# --- Textos ------------------------------------------------------------------------------------

_RESULT_TEXT = {"gana": "gana", "empata": "empata", "pierde": "pierde", "no-pierde": "no pierde"}
_NOUN = {"corners": "córners", "cards": "tarjetas", "fouls": "faltas", "shots": "tiros", "sot": "tiros a puerta"}
_VERB = {"corners": "saca", "cards": "recibe", "fouls": "comete", "shots": "hace", "sot": "hace"}


def pick_text(c: Candidate, home: str, away: str) -> str:
    team = home if c.side == "home" else away
    amount = (lambda noun: f"{'más' if c.direction == 'over' else 'menos'} de {c.line:g} {noun}") if c.line is not None else None
    if c.family == "resultado":
        return f"{team} {_RESULT_TEXT[c.option]}"
    if c.family == "ambos-marcan":
        return "Marcan los dos equipos" if c.option == "si" else "No marcan los dos equipos"
    if c.family in ("goles-equipo", "goles-rival"):
        verb = "marca" if c.family == "goles-equipo" else "encaja"
        if c.line == 0.5:
            return f"{team} {verb}" if c.direction == "over" else f"{team} no {verb}"
        return f"{team} {verb} {amount('goles')}"
    stat = STAT_OF[c.family]
    if c.side == "match":
        noun = "goles" if stat == "goals" else _NOUN[stat]
        text = amount(noun)
        return f"{text[0].upper()}{text[1:]} en el partido"
    return f"{team} {_VERB[stat]} {amount(_NOUN[stat])}"


KIND_LABEL = {
    "goles-equipo": "Goles del equipo",
    "goles-rival": "Goles que encaja",
    "goles": "Goles del partido",
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


def kind_label(kind: str) -> str:
    family, rest = kind.split("|")
    detail = {"over": "más de", "under": "menos de", "si": "sí", "no": "no", "no-pierde": "no pierde"}.get(rest, rest)
    return f"{KIND_LABEL.get(family, family)} · {detail}"
