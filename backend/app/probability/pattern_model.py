"""Modelo de patrones: combina mercado, Dixon-Coles y patrones repetidos de
cada equipo en una probabilidad por seleccion.

Protocolo (datos, splits, umbrales) en docs/MODELO_PATRONES.md. Todo lo de
aqui es point-in-time: las features de un partido solo usan partidos
anteriores a su fecha.
"""

import json
import math
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy.optimize import minimize
from scipy.stats import poisson

from app.probability.market import implied_probabilities_shin

MODEL_VERSION = "pattern_v1"
# Coeficientes y umbrales del modelo probado en el test (ver
# scripts/backtest_pattern_model.py export). Versionado en git.
PARAMS_PATH = Path(__file__).with_name("pattern_model_params.json")
FEATURE_SOURCES = ["mkt", "dc", "patv", "pata"]

# Parametros fijados en el protocolo: no se ajustan mirando resultados.
VENUE_WINDOW = 10
ALL_WINDOW = 20
SHRINK_MATCHES = 5
LEAGUE_PRIOR_WINDOW = 760  # ~2 temporadas
PROB_CLIP = 0.02

# Eventos desde la perspectiva de UN equipo en un partido (goles a favor/en contra).
TEAM_EVENTS = {
    "win": lambda gf, ga: gf > ga,
    "draw": lambda gf, ga: gf == ga,
    "loss": lambda gf, ga: gf < ga,
    "not_lose": lambda gf, ga: gf >= ga,
    "not_win": lambda gf, ga: gf <= ga,
    "not_draw": lambda gf, ga: gf != ga,
    "o15": lambda gf, ga: gf + ga > 1.5,
    "o25": lambda gf, ga: gf + ga > 2.5,
    "o35": lambda gf, ga: gf + ga > 3.5,
    "u15": lambda gf, ga: gf + ga < 1.5,
    "u25": lambda gf, ga: gf + ga < 2.5,
    "u35": lambda gf, ga: gf + ga < 3.5,
    "btts": lambda gf, ga: gf > 0 and ga > 0,
    "no_btts": lambda gf, ga: not (gf > 0 and ga > 0),
    "scored": lambda gf, ga: gf > 0,
    "conceded": lambda gf, ga: ga > 0,
}


@dataclass(frozen=True)
class Selection:
    key: str
    market: str  # mercado para agrupar resultados
    # Evento de equipo que mide el patron del local (en casa) y del visitante (fuera).
    home_event: str
    away_event: str
    # Resultado real a partir de goles local/visitante.
    resolve: callable = field(compare=False)


SELECTIONS: list[Selection] = [
    Selection("home", "1x2", "win", "loss", lambda h, a: h > a),
    Selection("draw", "1x2", "draw", "draw", lambda h, a: h == a),
    Selection("away", "1x2", "loss", "win", lambda h, a: h < a),
    Selection("1X", "doble_oportunidad", "not_lose", "not_win", lambda h, a: h >= a),
    Selection("X2", "doble_oportunidad", "not_win", "not_lose", lambda h, a: h <= a),
    Selection("12", "doble_oportunidad", "not_draw", "not_draw", lambda h, a: h != a),
    Selection("over_1.5", "goles_1.5", "o15", "o15", lambda h, a: h + a > 1.5),
    Selection("under_1.5", "goles_1.5", "u15", "u15", lambda h, a: h + a < 1.5),
    Selection("over_2.5", "goles_2.5", "o25", "o25", lambda h, a: h + a > 2.5),
    Selection("under_2.5", "goles_2.5", "u25", "u25", lambda h, a: h + a < 2.5),
    Selection("over_3.5", "goles_3.5", "o35", "o35", lambda h, a: h + a > 3.5),
    Selection("under_3.5", "goles_3.5", "u35", "u35", lambda h, a: h + a < 3.5),
    Selection("btts_yes", "ambos_marcan", "btts", "btts", lambda h, a: h > 0 and a > 0),
    Selection("btts_no", "ambos_marcan", "no_btts", "no_btts", lambda h, a: not (h > 0 and a > 0)),
    Selection("home_scores", "marca_equipo", "scored", "conceded", lambda h, a: h > 0),
    Selection("away_scores", "marca_equipo", "conceded", "scored", lambda h, a: a > 0),
]
SELECTION_KEYS = [s.key for s in SELECTIONS]

# Seleccion del modelo -> (market, selection) tal y como se guarda en
# ModelPrediction y se resuelve en app/probability/outcomes.py.
DB_SELECTION: dict[str, tuple[str, str]] = {
    "home": ("1x2", "home"),
    "draw": ("1x2", "draw"),
    "away": ("1x2", "away"),
    "1X": ("double_chance", "1X"),
    "X2": ("double_chance", "X2"),
    "12": ("double_chance", "12"),
    "over_1.5": ("over_under_1.5", "over"),
    "under_1.5": ("over_under_1.5", "under"),
    "over_2.5": ("over_under_2.5", "over"),
    "under_2.5": ("over_under_2.5", "under"),
    "over_3.5": ("over_under_3.5", "over"),
    "under_3.5": ("over_under_3.5", "under"),
    "btts_yes": ("btts", "yes"),
    "btts_no": ("btts", "no"),
    "home_scores": ("team_scores", "home"),
    "away_scores": ("team_scores", "away"),
}


# --- Probabilidades a partir de una matriz de marcadores ---------------------


def selection_probs_from_matrix(matrix: np.ndarray) -> dict[str, float]:
    n = matrix.shape[0]
    h, a = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
    total = h + a
    p = {
        "home": matrix[h > a].sum(),
        "draw": matrix[h == a].sum(),
        "away": matrix[h < a].sum(),
        "over_1.5": matrix[total > 1.5].sum(),
        "over_2.5": matrix[total > 2.5].sum(),
        "over_3.5": matrix[total > 3.5].sum(),
        "btts_yes": matrix[(h > 0) & (a > 0)].sum(),
        "home_scores": matrix[h > 0].sum(),
        "away_scores": matrix[a > 0].sum(),
    }
    p["1X"] = p["home"] + p["draw"]
    p["X2"] = p["away"] + p["draw"]
    p["12"] = p["home"] + p["away"]
    p["under_1.5"] = 1 - p["over_1.5"]
    p["under_2.5"] = 1 - p["over_2.5"]
    p["under_3.5"] = 1 - p["over_3.5"]
    p["btts_no"] = 1 - p["btts_yes"]
    return {k: float(v) for k, v in p.items()}


def poisson_matrix(lam: float, mu: float, max_goals: int = 10) -> np.ndarray:
    goals = np.arange(max_goals + 1)
    matrix = np.outer(poisson.pmf(goals, lam), poisson.pmf(goals, mu))
    return matrix / matrix.sum()


def market_implied_goals(p_home: float, p_away: float, p_over25: float | None) -> tuple[float, float]:
    """(lambda, mu) de un Poisson independiente que reproduce las
    probabilidades de mercado de 1X2 (y over 2.5 si existe)."""

    def loss(theta: np.ndarray) -> float:
        probs = selection_probs_from_matrix(poisson_matrix(math.exp(theta[0]), math.exp(theta[1])))
        err = (probs["home"] - p_home) ** 2 + (probs["away"] - p_away) ** 2
        if p_over25 is not None:
            err += (probs["over_2.5"] - p_over25) ** 2
        return err

    res = minimize(loss, x0=np.log([1.5, 1.2]), method="Nelder-Mead", options={"xatol": 1e-4, "fatol": 1e-9})
    return math.exp(res.x[0]), math.exp(res.x[1])


def market_probabilities(odds: dict[str, float]) -> dict[str, float] | None:
    """Probabilidad de mercado de cada seleccion a partir de cuotas
    pre-partido {"home", "draw", "away", "over_2.5"?, "under_2.5"?}.

    Donde hay cuota directa (1X2 y derivados, over/under 2.5) se usa Shin;
    el resto sale de un Poisson que reproduce esas cuotas. None sin 1X2."""
    if not all(k in odds for k in ("home", "draw", "away")):
        return None
    p_home, p_draw, p_away = implied_probabilities_shin([odds["home"], odds["draw"], odds["away"]])
    p_over = None
    if "over_2.5" in odds and "under_2.5" in odds:
        p_over, _ = implied_probabilities_shin([odds["over_2.5"], odds["under_2.5"]])

    lam, mu = market_implied_goals(p_home, p_away, p_over)
    p_mkt = selection_probs_from_matrix(poisson_matrix(lam, mu))
    p_mkt.update(
        {
            "home": p_home,
            "draw": p_draw,
            "away": p_away,
            "1X": p_home + p_draw,
            "X2": p_away + p_draw,
            "12": p_home + p_away,
        }
    )
    if p_over is not None:
        p_mkt["over_2.5"], p_mkt["under_2.5"] = p_over, 1 - p_over
    return p_mkt


def choose_selection(
    probs: dict[str, float], p_mkt: dict[str, float], tau: float, delta: float | None
) -> str | None:
    """Regla del protocolo: como maximo una seleccion por partido. Entre las
    de p >= tau (y p - p_mkt >= delta si hay delta), la de mayor ventaja
    sobre el mercado; a igualdad, la mas probable."""
    best, best_key = None, None
    for k in SELECTION_KEYS:
        p = probs[k]
        edge = p - p_mkt[k]
        if p < tau or (delta is not None and edge < delta):
            continue
        score = (round(edge, 6), p)
        if best is None or score > best:
            best, best_key = score, k
    return best_key


# --- Patrones point-in-time --------------------------------------------------


def _shrunk_rate(values: list[bool], prior: float) -> float:
    return (sum(values) + SHRINK_MATCHES * prior) / (len(values) + SHRINK_MATCHES)


class PatternTracker:
    """Historial por equipo y de la liga, alimentado en orden cronologico.

    Uso: para cada partido, primero features(...) y despues add(...): asi las
    features nunca ven el propio partido."""

    def __init__(self) -> None:
        self.home_hist: dict[int, deque] = {}
        self.away_hist: dict[int, deque] = {}
        self.all_hist: dict[int, deque] = {}
        # Partidos de la liga como (eventos del local, eventos del visitante).
        self.league: deque = deque(maxlen=LEAGUE_PRIOR_WINDOW)

    @staticmethod
    def _team_events(gf: int, ga: int) -> dict[str, bool]:
        return {name: fn(gf, ga) for name, fn in TEAM_EVENTS.items()}

    def _league_prior(self, event: str, side: str | None) -> float:
        if not self.league:
            return 0.5
        if side == "home":
            vals = [h[event] for h, _ in self.league]
        elif side == "away":
            vals = [a[event] for _, a in self.league]
        else:
            vals = [h[event] for h, _ in self.league] + [a[event] for _, a in self.league]
        return sum(vals) / len(vals)

    def features(self, home_id: int, away_id: int) -> dict[str, dict[str, float]]:
        """{seleccion: {"pat_venue": p, "pat_all": p}}."""
        home_venue = list(self.home_hist.get(home_id, []))
        away_venue = list(self.away_hist.get(away_id, []))
        home_all = list(self.all_hist.get(home_id, []))
        away_all = list(self.all_hist.get(away_id, []))

        out = {}
        for sel in SELECTIONS:
            hv = _shrunk_rate([e[sel.home_event] for e in home_venue], self._league_prior(sel.home_event, "home"))
            av = _shrunk_rate([e[sel.away_event] for e in away_venue], self._league_prior(sel.away_event, "away"))
            ha = _shrunk_rate([e[sel.home_event] for e in home_all], self._league_prior(sel.home_event, None))
            aa = _shrunk_rate([e[sel.away_event] for e in away_all], self._league_prior(sel.away_event, None))
            out[sel.key] = {"pat_venue": (hv + av) / 2, "pat_all": (ha + aa) / 2}
        return out

    def matches_available(self, home_id: int, away_id: int) -> int:
        """Partidos (hasta ALL_WINDOW) que respaldan los patrones del partido: el minimo de los dos equipos."""
        return min(len(self.all_hist.get(home_id, [])), len(self.all_hist.get(away_id, [])))

    def add(self, home_id: int, away_id: int, home_goals: int, away_goals: int) -> None:
        home_ev = self._team_events(home_goals, away_goals)
        away_ev = self._team_events(away_goals, home_goals)
        self.home_hist.setdefault(home_id, deque(maxlen=VENUE_WINDOW)).append(home_ev)
        self.away_hist.setdefault(away_id, deque(maxlen=VENUE_WINDOW)).append(away_ev)
        self.all_hist.setdefault(home_id, deque(maxlen=ALL_WINDOW)).append(home_ev)
        self.all_hist.setdefault(away_id, deque(maxlen=ALL_WINDOW)).append(away_ev)
        self.league.append((home_ev, away_ev))


# --- Regresion logistica (sin sklearn) ---------------------------------------


def logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, PROB_CLIP, 1 - PROB_CLIP)
    return np.log(p / (1 - p))


@dataclass
class LogisticModel:
    mean: np.ndarray
    std: np.ndarray
    coef: np.ndarray  # [intercepto, w1..wk] sobre features estandarizadas

    def predict(self, X: np.ndarray) -> np.ndarray:
        z = (X - self.mean) / self.std
        return 1 / (1 + np.exp(-(self.coef[0] + z @ self.coef[1:])))


def fit_logistic(X: np.ndarray, y: np.ndarray, l2: float = 1.0) -> LogisticModel:
    mean = X.mean(axis=0)
    std = X.std(axis=0)
    std[std == 0] = 1.0
    Z = np.column_stack([np.ones(len(X)), (X - mean) / std])

    def nll(w: np.ndarray) -> tuple[float, np.ndarray]:
        s = Z @ w
        # log(1+exp(s)) estable
        loss = np.sum(np.logaddexp(0, s) - y * s) + 0.5 * l2 * np.sum(w[1:] ** 2)
        grad = Z.T @ (1 / (1 + np.exp(-s)) - y)
        grad[1:] += l2 * w[1:]
        return loss, grad

    res = minimize(nll, np.zeros(Z.shape[1]), jac=True, method="L-BFGS-B")
    return LogisticModel(mean=mean, std=std, coef=res.x)


# --- Parametros congelados ---------------------------------------------------


@dataclass
class PatternModelParams:
    tau: float
    delta: float | None
    trained_on: list[str]
    models: dict[str, LogisticModel]

    def predict(self, features: dict[str, dict[str, float]]) -> dict[str, float]:
        """features: {seleccion: {"mkt": p, "dc": p, "patv": p, "pata": p}}."""
        out = {}
        for k, model in self.models.items():
            x = logit(np.array([[features[k][src] for src in FEATURE_SOURCES]]))
            out[k] = float(model.predict(x)[0])
        return out

    def to_json(self) -> str:
        return json.dumps(
            {
                "model_version": MODEL_VERSION,
                "tau": self.tau,
                "delta": self.delta,
                "trained_on": self.trained_on,
                "features": FEATURE_SOURCES,
                "models": {
                    k: {"mean": m.mean.tolist(), "std": m.std.tolist(), "coef": m.coef.tolist()}
                    for k, m in self.models.items()
                },
            },
            indent=2,
        )


def load_params(path: Path = PARAMS_PATH) -> PatternModelParams | None:
    if not path.exists():
        return None
    raw = json.loads(path.read_text(encoding="utf-8"))
    return PatternModelParams(
        tau=raw["tau"],
        delta=raw["delta"],
        trained_on=raw["trained_on"],
        models={
            k: LogisticModel(mean=np.array(m["mean"]), std=np.array(m["std"]), coef=np.array(m["coef"]))
            for k, m in raw["models"].items()
        },
    )
