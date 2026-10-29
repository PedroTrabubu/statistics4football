"""Porcentajes de resultado (docs/RESULTADOS_PROTOCOLO.md): probabilidad
calibrada de local, empate y visitante; la doble oportunidad sale de sumarlas.

- `load_inputs` + `build_features`: variables point-in-time de cada partido,
  por dias naturales (los partidos de un mismo dia no se ven entre si).
- `walk_forward`: un modelo por liga, reentrenado cada dia de partido con todo
  lo anterior y calibrado con temperatura sobre sus predicciones previas.
- `double_chance`: 1X, X2 y 12 a partir de las 1X2 ya calibradas.

Variante A: con el mercado sin margen (solo partidos con cuotas pre-partido).
Variante B: sin mercado (todos los partidos).
"""

from __future__ import annotations

import math
from bisect import bisect_left
from collections import defaultdict, deque
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from scipy.optimize import minimize, minimize_scalar
from sqlalchemy.orm import Session

from app.db.models import League, Match, MatchOdds, MatchStatus, OwnEloPre, Season, TeamMatchStats
from app.probability.market import implied_probabilities_shin
from app.stats.own_elo import HOME_ADVANTAGE

VERSION = "resultado_v1"
L2 = 1.0
MIN_TRAIN = 300
CAL_WINDOW, CAL_MIN = 1000, 200
REST_CAP = 14
XG_WINDOW = 10
HIGH_CONFIDENCE = 0.80
# Toma pre-partido; nunca "Market Average (closing)".
MARKET_BOOKMAKER = "Market Average"
_UTC, _UK = ZoneInfo("UTC"), ZoneInfo("Europe/London")

COLS_B = [
    "elo", "dc_h", "dc_d", "dc_a",
    "ppg5_h", "ppg10_h", "ppg5_a", "ppg10_a", "ppg_home5_h", "ppg_away5_a",
    "rest_h", "rest_a", "season_ppg_h", "season_ppg_a", "xgd_diff",
]  # fmt: skip
COLS_A = COLS_B + ["mk_h", "mk_d", "mk_a"]
COLS_ELO = ["elo"]
# 20/21: solo calienta el historial (Dixon-Coles, Elo, forma); no entrena ni se predice.
WARMUP_SEASONS = frozenset({"2021"})


def logit(p: float) -> float:
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


# --- Entradas -----------------------------------------------------------------


@dataclass(frozen=True)
class ResultMatch:
    match_id: int
    league: str
    season: str
    date: datetime
    home_team_id: int
    away_team_id: int
    home_goals: int | None  # None: aun no jugado
    away_goals: int | None
    home_xg: float | None = None
    away_xg: float | None = None

    @property
    def played(self) -> bool:
        return self.home_goals is not None and self.away_goals is not None


@dataclass
class Inputs:
    matches: list[ResultMatch]
    # Fechas de todos los partidos jugados de cada equipo en la BD (cualquier competicion), ordenadas.
    played_dates: dict[int, list[datetime]]
    elo: dict[tuple[int, int], float]  # (match_id, team_id) -> Elo propio previo
    market: dict[int, tuple[float, float, float]]  # match_id -> mercado sin margen (L, E, V)


def _uk_local(utc: datetime) -> datetime:
    return utc.replace(tzinfo=_UTC).astimezone(_UK).replace(tzinfo=None)


def prematch_snapshot(snapshot_time: datetime, kickoff: datetime) -> bool:
    """Toma anterior al inicio. Las filas del CSV de Football-Data no traen su
    hora real (la del viernes o martes): llevan la del partido, y las cargadas
    antes de pasar la BD a UTC, en hora de Reino Unido. Esa hora de relleno
    exacta tambien vale; una toma real posterior (cuotas en directo de
    the-odds-api) no."""
    return snapshot_time <= kickoff or snapshot_time == _uk_local(kickoff)


def market_probabilities(rows: Iterable[MatchOdds], kickoff: dict[int, datetime]) -> dict[int, tuple[float, float, float]]:
    """Mercado sin margen (Shin) con la ultima `Market Average` 1X2 pre-partido
    de cada partido. Ignora las de cierre y cualquier toma posterior."""
    latest: dict[int, dict[str, MatchOdds]] = defaultdict(dict)
    for r in rows:
        if r.bookmaker != MARKET_BOOKMAKER or r.market != "1x2" or not prematch_snapshot(r.snapshot_time, kickoff[r.match_id]):
            continue
        current = latest[r.match_id].get(r.selection)
        if current is None or r.snapshot_time > current.snapshot_time:
            latest[r.match_id][r.selection] = r
    out = {}
    for match_id, sel in latest.items():
        if {"home", "draw", "away"} <= sel.keys():
            out[match_id] = tuple(implied_probabilities_shin([sel[k].odds for k in ("home", "draw", "away")]))
    return out


def load_inputs(db: Session, league_codes: list[str], with_market: bool = True) -> Inputs:
    leagues = {lg.id: lg.code for lg in db.query(League).filter(League.code.in_(league_codes))}
    seasons = {s.id: s.name for s in db.query(Season).filter(Season.league_id.in_(leagues))}
    rows = (
        db.query(Match)
        .filter(Match.league_id.in_(leagues), Match.status.in_([MatchStatus.HISTORICAL, MatchStatus.SCHEDULED]))
        .order_by(Match.date, Match.id)
        .all()
    )
    rows = [m for m in rows if m.status == MatchStatus.SCHEDULED or m.home_goals is not None]
    ids = [m.id for m in rows]
    xg: dict[tuple[int, int], float] = {}
    for start in range(0, len(ids), 500):
        chunk = ids[start : start + 500]
        for s in db.query(TeamMatchStats).filter(TeamMatchStats.match_id.in_(chunk), TeamMatchStats.xg.is_not(None)):
            xg[(s.match_id, s.team_id)] = s.xg
    matches = [
        ResultMatch(
            m.id, leagues[m.league_id], seasons[m.season_id], m.date, m.home_team_id, m.away_team_id,
            m.home_goals if m.status == MatchStatus.HISTORICAL else None,
            m.away_goals if m.status == MatchStatus.HISTORICAL else None,
            xg.get((m.id, m.home_team_id)), xg.get((m.id, m.away_team_id)),
        )  # fmt: skip
        for m in rows
    ]

    played_dates: dict[int, list[datetime]] = defaultdict(list)
    for home, away, date in db.query(Match.home_team_id, Match.away_team_id, Match.date).filter(
        Match.status == MatchStatus.HISTORICAL
    ):
        played_dates[home].append(date)
        played_dates[away].append(date)
    for dates in played_dates.values():
        dates.sort()

    elo: dict[tuple[int, int], float] = {}
    odds: list[MatchOdds] = []
    for start in range(0, len(ids), 500):
        chunk = ids[start : start + 500]
        for r in db.query(OwnEloPre).filter(OwnEloPre.match_id.in_(chunk)):
            elo[(r.match_id, r.team_id)] = r.elo
        if with_market:
            odds += db.query(MatchOdds).filter(
                MatchOdds.match_id.in_(chunk), MatchOdds.bookmaker == MARKET_BOOKMAKER, MatchOdds.market == "1x2"
            )
    market = market_probabilities(odds, {m.id: m.date for m in rows})
    return Inputs(matches, dict(played_dates), elo, market)


# --- Variables point-in-time --------------------------------------------------


def _mean(values) -> float:
    values = list(values)
    return float(np.mean(values)) if values else math.nan


def build_features(inputs: Inputs, dc: dict[int, tuple[float, float, float]]) -> pd.DataFrame:
    """Una fila por partido con sus variables (`COLS_A`), `res` (0 local, 1
    empate, 2 visitante; -1 si no se ha jugado), `day`, `league` y `season`.
    `dc`: Dixon-Coles de cada partido, ajustado con lo anterior a su dia."""
    hist = defaultdict(lambda: deque(maxlen=10))  # (liga, equipo) -> (puntos, xG a favor - en contra)
    venue = defaultdict(lambda: deque(maxlen=5))  # (liga, equipo, "home"/"away") -> puntos
    season_pts: dict[tuple[str, str, int], list[int]] = defaultdict(list)

    rows = []
    by_day = defaultdict(list)
    for m in inputs.matches:
        by_day[m.date.date()].append(m)
    for day in sorted(by_day):
        day_start = datetime(day.year, day.month, day.day)
        day_matches = by_day[day]
        for m in day_matches:
            f = {"match_id": m.match_id, "league": m.league, "season": m.season, "day": day_start}
            f["res"] = -1 if not m.played else 0 if m.home_goals > m.away_goals else 1 if m.home_goals == m.away_goals else 2
            eh, ea = inputs.elo.get((m.match_id, m.home_team_id)), inputs.elo.get((m.match_id, m.away_team_id))
            f["elo"] = (eh + HOME_ADVANTAGE - ea) / 400 * math.log(10) if eh is not None and ea is not None else math.nan
            p_dc = dc.get(m.match_id)
            for k, i in (("h", 0), ("d", 1), ("a", 2)):
                f[f"dc_{k}"] = logit(p_dc[i]) if p_dc else math.nan
            p_mk = inputs.market.get(m.match_id)
            for k, i in (("h", 0), ("d", 1), ("a", 2)):
                f[f"mk_{k}"] = logit(p_mk[i]) if p_mk else math.nan
            xgd = {}
            for side, team in (("h", m.home_team_id), ("a", m.away_team_id)):
                past = list(hist[(m.league, team)])
                f[f"ppg5_{side}"] = _mean(p for p, _ in past[-5:])
                f[f"ppg10_{side}"] = _mean(p for p, _ in past)
                xgd[side] = _mean(x for _, x in past[-XG_WINDOW:] if not math.isnan(x))
                f[f"season_ppg_{side}"] = _mean(season_pts[(m.league, m.season, team)])
                dates = inputs.played_dates.get(team, [])
                i = bisect_left(dates, day_start)
                f[f"rest_{side}"] = min((day_start - dates[i - 1]).days, REST_CAP) if i else REST_CAP
            f["xgd_diff"] = xgd["h"] - xgd["a"]
            f["ppg_home5_h"] = _mean(venue[(m.league, m.home_team_id, "home")])
            f["ppg_away5_a"] = _mean(venue[(m.league, m.away_team_id, "away")])
            rows.append(f)

        for m in day_matches:  # el dia ya calculado: se anaden sus resultados
            if not m.played:
                continue
            ph, pa = (3, 0) if m.home_goals > m.away_goals else (1, 1) if m.home_goals == m.away_goals else (0, 3)
            has_xg = m.home_xg is not None and m.away_xg is not None
            for team, pts, xgd in (
                (m.home_team_id, ph, m.home_xg - m.away_xg if has_xg else math.nan),
                (m.away_team_id, pa, m.away_xg - m.home_xg if has_xg else math.nan),
            ):
                hist[(m.league, team)].append((pts, xgd))
                season_pts[(m.league, m.season, team)].append(pts)
            venue[(m.league, m.home_team_id, "home")].append(ph)
            venue[(m.league, m.away_team_id, "away")].append(pa)
    return pd.DataFrame(rows)


# --- Modelo -------------------------------------------------------------------


def softmax(scores: np.ndarray) -> np.ndarray:
    s = scores - scores.max(axis=1, keepdims=True)
    e = np.exp(s)
    return e / e.sum(axis=1, keepdims=True)


def fit_softmax(X: np.ndarray, y: np.ndarray, w0: np.ndarray | None = None) -> np.ndarray:
    """Logistica multinomial con L2 sobre `X` ya estandarizada; pesos (k+1, 3)."""
    n, k = X.shape
    Y = np.eye(3)[y]
    Z = np.column_stack([np.ones(n), X])
    pen = np.r_[1e-6, np.full(k, L2)][:, None]  # intercepto (casi) sin penalizar

    def loss(wflat: np.ndarray) -> tuple[float, np.ndarray]:
        W = wflat.reshape(k + 1, 3)
        S = Z @ W
        S -= S.max(axis=1, keepdims=True)
        lse = np.log(np.exp(S).sum(axis=1, keepdims=True))
        P = np.exp(S - lse)
        value = -(Y * (S - lse)).sum() + 0.5 * (pen * W**2).sum()
        return value, (Z.T @ (P - Y) + pen * W).ravel()

    x0 = w0 if w0 is not None and w0.size == (k + 1) * 3 else np.zeros((k + 1) * 3)
    return minimize(loss, x0, jac=True, method="L-BFGS-B").x.reshape(k + 1, 3)


def fit_temperature(scores: np.ndarray, y: np.ndarray) -> float:
    def nll(t: float) -> float:
        P = softmax(scores / t)
        return -np.log(P[np.arange(len(y)), y] + 1e-12).sum()

    return float(minimize_scalar(nll, bounds=(0.3, 3.0), method="bounded").x)


def walk_forward(
    df: pd.DataFrame,
    cols: list[str],
    predict_unplayed: bool = True,
    days: set | None = None,
    history: pd.DataFrame | None = None,
    with_scores: bool = False,
) -> pd.DataFrame:
    """Predicciones de una liga, dia a dia: el modelo del dia d se entrena con los
    partidos jugados de dias < d (sin la temporada de calentamiento), y la
    temperatura con las ultimas predicciones previas ya resueltas.

    `days`: solo predice esos dias (None: todos). `history`: predicciones ya
    guardadas de partidos jugados (day, match_id, score_home, score_draw,
    score_away, res); cuentan para la temperatura como si se hubieran hecho en
    este recorrido, asi que predecir solo lo que falta da lo mismo que todo.
    Devuelve match_id, p_home, p_draw, p_away, T (y los logits sin calibrar,
    score_*, con `with_scores`)."""
    required = ["elo"] + [c for c in ("dc_h", "mk_h") if c in cols]
    ok = df[required].notna().all(axis=1)
    if "season" in df:
        ok &= ~df.season.isin(WARMUP_SEASONS)
    df = df[ok].sort_values(["day", "match_id"])
    played = df[df.res >= 0]
    entries: list[tuple] = []  # (dia, match_id, logits, resultado) de las predicciones resueltas
    if history is not None:
        entries = [
            (r.day, r.match_id, np.array([r.score_home, r.score_draw, r.score_away]), int(r.res))
            for r in history.itertuples()
        ]
    known = {e[1] for e in entries}  # lo guardado no se duplica al volver a predecir su dia
    w_prev, out = None, []
    for day, today in df.groupby("day", sort=True):
        if days is not None and day not in days:
            continue
        if not predict_unplayed:
            today = today[today.res >= 0]
            if today.empty:
                continue
        train = played[played.day < day]
        if len(train) < MIN_TRAIN:
            continue
        X = train[cols].to_numpy(float)
        keep = ~np.isnan(X).all(axis=0)
        X = X[:, keep]
        mean = np.nanmean(X, axis=0)
        X = np.where(np.isnan(X), mean, X)
        std = X.std(axis=0)
        std[std == 0] = 1.0
        W = fit_softmax((X - mean) / std, train.res.to_numpy(), w_prev)
        w_prev = W.ravel()
        Xt = today[cols].to_numpy(float)[:, keep]
        Xt = np.where(np.isnan(Xt), mean, Xt)
        scores = np.column_stack([np.ones(len(today)), (Xt - mean) / std]) @ W
        entries.sort(key=lambda e: (e[0], e[1]))
        hist = [e for e in entries if e[0] < day][-CAL_WINDOW:]
        T = fit_temperature(np.vstack([e[2] for e in hist]), np.array([e[3] for e in hist])) if len(hist) >= CAL_MIN else 1.0
        P = softmax(scores / T)
        frame = pd.DataFrame({"match_id": today.match_id.to_numpy(), "p_home": P[:, 0], "p_draw": P[:, 1],
                              "p_away": P[:, 2], "T": T})  # fmt: skip
        if with_scores:
            frame[["score_home", "score_draw", "score_away"]] = scores
        out.append(frame)
        # La calibracion solo aprende de dias anteriores: lo de hoy entra para los siguientes.
        entries += [
            (day, mid, sc, int(res)) for mid, sc, res in zip(today.match_id, scores, today.res) if res >= 0 and mid not in known
        ]
    columns = ["match_id", "p_home", "p_draw", "p_away", "T"] + (["score_home", "score_draw", "score_away"] if with_scores else [])
    return pd.concat(out) if out else pd.DataFrame(columns=columns)


def temperature_walk_forward(df: pd.DataFrame, prob_cols: list[str]) -> pd.DataFrame:
    """Probabilidades dadas (p. ej. el mercado) recalibradas con temperatura,
    ajustada cada dia con las ultimas predicciones previas, igual que el modelo."""
    df = df[df[prob_cols].notna().all(axis=1)].sort_values(["day", "match_id"])
    hist_scores: list[np.ndarray] = []
    hist_y: list[int] = []
    out = []
    for _day, today in df.groupby("day", sort=True):
        scores = np.log(np.clip(today[prob_cols].to_numpy(float), 1e-12, 1))
        T = fit_temperature(np.vstack(hist_scores[-CAL_WINDOW:]), np.array(hist_y[-CAL_WINDOW:])) if len(hist_y) >= CAL_MIN else 1.0
        P = softmax(scores / T)
        out.append(pd.DataFrame({"match_id": today.match_id.to_numpy(), "p_home": P[:, 0], "p_draw": P[:, 1],
                                 "p_away": P[:, 2], "T": T}))  # fmt: skip
        resolved = today.res.to_numpy() >= 0
        hist_scores.extend(scores[resolved])
        hist_y.extend(today.res.to_numpy()[resolved].tolist())
    return pd.concat(out) if out else pd.DataFrame(columns=["match_id", "p_home", "p_draw", "p_away", "T"])


# --- Doble oportunidad y niveles ---------------------------------------------


def double_chance(P: np.ndarray) -> np.ndarray:
    """(n, 3) con 1X, X2 y 12 sumando las 1X2 calibradas (columnas L, E, V)."""
    P = np.asarray(P, dtype=float)
    return np.column_stack([P[:, 0] + P[:, 1], P[:, 1] + P[:, 2], P[:, 0] + P[:, 2]])


def is_high_confidence(p: float) -> bool:
    return p >= HIGH_CONFIDENCE
