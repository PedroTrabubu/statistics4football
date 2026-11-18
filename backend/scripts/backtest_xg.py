"""Medicion desechable: ¿anadir estadisticas (xG / tiros a puerta) mejora el 1X2?

Uso (desde backend/, con el venv activado):
    python scripts/backtest_xg.py

Solo lee: la BD se abre con mode=ro y Dixon-Coles sale de la cache mensual.

A) Modelo actual `elo_dc_v1`, como lo reconstruye `compute_summary`: media 50/50
   del Elo calibrado (logits y temperatura guardados) y Dixon-Coles mensual
   calibrado. No se reajusta nada.
B) A + estadistica: capa sobre A por liga, reajustada el dia 1 de cada mes con lo
   anterior a ese mes (predicciones de A, ya fuera de muestra):
       score_k = alpha * log(pA_k) + beta * z * (+1, 0, -1)
   z = media de (a favor - en contra) en los ultimos 10 partidos de liga del
   local menos la del visitante, estandarizada con el entrenamiento. xG en las
   ligas que lo tienen, tiros a puerta en las demas. Sin dato (menos de MIN_OBS
   partidos de alguno de los dos) o sin CAL_MIN partidos de entrenamiento: B = A.
C) Favorito del mercado: `Market Average` 1X2 pre-partido sin margen (Shin).
"""

import sqlite3
import sys
import warnings
from collections import defaultdict, deque
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.analysis.stats import bootstrap_mean_diff  # noqa: E402
from app.core.competitions import CHAMPIONS_LEAGUE  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.db.models import League, Match, ResultPrediction, TeamMatchStats  # noqa: E402
from app.probability.dc_monthly import load_dc_monthly  # noqa: E402
from app.probability.result_metrics import log_loss_per_match, top_hit, wilson  # noqa: E402
from app.probability.result_model import CAL_MIN, L2, XG_WINDOW, build_features, load_inputs, softmax  # noqa: E402
from app.probability.result_predictions import LEAGUES, _dc_calibrated  # noqa: E402

warnings.filterwarnings("ignore", category=RuntimeWarning)

MIN_OBS = 5
SINCE = pd.Timestamp("2022-01-01")
CURRENT = "2627"
DIRECTION = np.array([1.0, 0.0, -1.0])  # z sube la victoria local y baja la visitante
LABELS = {
    "ENG-Premier League": "Premier", "ESP-La Liga": "LaLiga", "ESP-La Liga 2": "Hypermotion",
    "FRA-Ligue 1": "Ligue 1", "GER-Bundesliga": "Bundesliga", "ITA-Serie A": "Serie A",
}  # fmt: skip


def readonly_session() -> Session:
    path = Path(get_settings().database_url.removeprefix("sqlite:///")).resolve().as_posix()
    uri = f"file:/{path}?mode=ro"
    return Session(create_engine("sqlite://", creator=lambda: sqlite3.connect(uri, uri=True, check_same_thread=False)))


def shots_on_target(db: Session, matches: list) -> dict[int, tuple[int, int]]:
    """match_id -> (tiros a puerta local, visitante)."""
    side = {m.match_id: m for m in matches}
    found: dict[int, dict[int, int]] = defaultdict(dict)
    ids = list(side)
    for start in range(0, len(ids), 500):
        rows = db.query(TeamMatchStats.match_id, TeamMatchStats.team_id, TeamMatchStats.shots_on_target).filter(
            TeamMatchStats.match_id.in_(ids[start : start + 500]), TeamMatchStats.shots_on_target.is_not(None)
        )
        for match_id, team_id, value in rows:
            found[match_id][team_id] = value
    out = {}
    for match_id, teams in found.items():
        m = side[match_id]
        if m.home_team_id in teams and m.away_team_id in teams:
            out[match_id] = (teams[m.home_team_id], teams[m.away_team_id])
    return out


def rolling_diff(matches: list, values: dict[int, tuple[float, float]]) -> dict[int, float]:
    """Point-in-time por dias naturales, como `build_features`: los partidos de
    un mismo dia no se ven entre si."""
    hist = defaultdict(lambda: deque(maxlen=XG_WINDOW))
    by_day = defaultdict(list)
    for m in matches:
        by_day[m.date.date()].append(m)
    out = {}
    for day in sorted(by_day):
        for m in by_day[day]:
            home, away = hist[m.league, m.home_team_id], hist[m.league, m.away_team_id]
            if len(home) >= MIN_OBS and len(away) >= MIN_OBS:
                out[m.match_id] = float(np.mean(home) - np.mean(away))
        for m in by_day[day]:
            v = values.get(m.match_id)
            if m.played and v is not None:
                hist[m.league, m.home_team_id].append(v[0] - v[1])
                hist[m.league, m.away_team_id].append(v[1] - v[0])
    return out


def model_a(db: Session, played: pd.DataFrame) -> pd.DataFrame:
    """Probabilidades de A por partido, indexadas por match_id."""
    rows = db.query(
        ResultPrediction.match_id, ResultPrediction.score_home, ResultPrediction.score_draw,
        ResultPrediction.score_away, ResultPrediction.temperature,
    ).filter(ResultPrediction.score_home.is_not(None), ResultPrediction.match_id.in_(played.match_id.tolist()))  # fmt: skip
    stored = pd.DataFrame(rows, columns=["match_id", "h", "d", "a", "T"]).set_index("match_id")
    elo = softmax(stored[["h", "d", "a"]].to_numpy(float) / stored[["T"]].to_numpy(float))
    A = pd.DataFrame(elo, index=stored.index, columns=["p_home", "p_draw", "p_away"])
    dc = load_dc_monthly(LEAGUES)
    dc_cal = pd.concat([_dc_calibrated(played[played.league == code], dc) for code in LEAGUES])
    both = A.index.intersection(dc_cal.index)
    A.loc[both] = (A.loc[both].to_numpy(float) + dc_cal.loc[both, A.columns].to_numpy(float)) / 2
    return A


def fit_stack(lp: np.ndarray, z: np.ndarray, y: np.ndarray, x0: np.ndarray) -> np.ndarray:
    """(alpha, beta) con L2 hacia (1, 0), es decir, hacia A."""
    Y = np.eye(3)[y]
    zd = z[:, None] * DIRECTION

    def loss(w: np.ndarray) -> tuple[float, np.ndarray]:
        S = w[0] * lp + w[1] * zd
        S -= S.max(axis=1, keepdims=True)
        lse = np.log(np.exp(S).sum(axis=1, keepdims=True))
        R = np.exp(S - lse) - Y
        value = -(Y * (S - lse)).sum() + 0.5 * L2 * ((w[0] - 1) ** 2 + w[1] ** 2)
        return value, np.array([(R * lp).sum() + L2 * (w[0] - 1), (R * zd).sum() + L2 * w[1]])

    return minimize(loss, x0, jac=True, method="L-BFGS-B").x


def stack_league(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Probabilidades de B de una liga (en el orden de `df`) y si B actuo."""
    P = df[["p_home", "p_draw", "p_away"]].to_numpy(float)
    lp = np.log(np.clip(P, 1e-12, 1))
    z, y = df.stat.to_numpy(float), df.res.to_numpy()
    has_stat = ~np.isnan(z)
    months = df.day.dt.to_period("M")
    B, active, w = P.copy(), np.zeros(len(df), dtype=bool), np.array([1.0, 0.0])
    for month in sorted(months.unique()):
        train = has_stat & (df.day < month.start_time).to_numpy()
        test = has_stat & (months == month).to_numpy()
        if train.sum() < CAL_MIN or not test.any():
            continue
        mean, std = z[train].mean(), z[train].std() or 1.0
        w = fit_stack(lp[train], (z[train] - mean) / std, y[train], w)
        zd = ((z[test] - mean) / std)[:, None] * DIRECTION
        B[test] = softmax(w[0] * lp[test] + w[1] * zd)
        active[test] = True
    return B, active


def score(P: np.ndarray, y: np.ndarray) -> dict:
    hits = top_hit(P, y)
    low, high = wilson(int(hits.sum()), len(y))
    return {
        "hit": f"{hits.mean() * 100:.1f} ({low * 100:.1f}-{high * 100:.1f})", "ll": log_loss_per_match(P, y).mean(),
        "brier": ((P - np.eye(3)[y]) ** 2).sum(axis=1).mean(),
    }  # fmt: skip


def row_ab(name: str, m: pd.DataFrame, PA: np.ndarray, PB: np.ndarray) -> str:
    y = m.res.to_numpy()
    a, b = score(PA, y), score(PB, y)
    diff, low, high = bootstrap_mean_diff(m.match_id.tolist(), log_loss_per_match(PB, y), log_loss_per_match(PA, y))
    return (
        f"{name:<20}{len(m):>6}{int(m.active.sum()):>6}  {a['hit']:<18}{b['hit']:<18}{a['ll']:.4f} {b['ll']:.4f} "
        f"{diff:+.4f} [{low:+.4f},{high:+.4f}]  {a['brier']:.4f} {b['brier']:.4f}"
    )


def row_abc(name: str, m: pd.DataFrame, PA: np.ndarray, PB: np.ndarray, PC: np.ndarray) -> str:
    y = m.res.to_numpy()
    a, b, c = score(PA, y), score(PB, y), score(PC, y)
    return (
        f"{name:<20}{len(m):>6}  {a['hit']:<18}{b['hit']:<18}{c['hit']:<18}"
        f"{a['ll']:.4f} {b['ll']:.4f} {c['ll']:.4f}  {a['brier']:.4f} {b['brier']:.4f} {c['brier']:.4f}"
    )


def main() -> None:
    db = readonly_session()
    try:
        inputs = load_inputs(db, LEAGUES)
        features = build_features(inputs, {})
        played = features[features.res >= 0]
        A = model_a(db, played)
        by_league = defaultdict(list)
        for m in inputs.matches:
            by_league[m.league].append(m)
        stat, stat_name = {}, {}
        for code, matches in by_league.items():
            xg = {m.match_id: (m.home_xg, m.away_xg) for m in matches if m.home_xg is not None and m.away_xg is not None}
            stat_name[code] = "xG" if xg else "tiros"
            stat |= rolling_diff(matches, xg or shots_on_target(db, matches))
        champions = (
            db.query(ResultPrediction.match_id).join(Match, Match.id == ResultPrediction.match_id)
            .join(League, League.id == Match.league_id).filter(League.code == CHAMPIONS_LEAGUE).count()
        )  # fmt: skip
    finally:
        db.close()

    df = played[played.match_id.isin(A.index) & (played.day >= SINCE)][["match_id", "league", "season", "day", "res"]]
    df = df.sort_values(["day", "match_id"]).reset_index(drop=True)
    df = df.join(A, on="match_id")
    df["stat"] = df.match_id.map(stat)
    cols = ["p_home", "p_draw", "p_away"]
    parts = []
    for _code, group in df.groupby("league"):
        B, active = stack_league(group)
        parts.append(pd.DataFrame(B, index=group.index, columns=["b_home", "b_draw", "b_away"]).assign(active=active))
    df = df.join(pd.concat(parts))
    PA, PB = df[cols].to_numpy(float), df[["b_home", "b_draw", "b_away"]].to_numpy(float)
    market = df.match_id.map(inputs.market)
    has_market = market.notna().to_numpy()
    PC = np.zeros_like(PA)
    PC[has_market] = np.array(market[has_market].tolist())

    scopes = [("Total", np.ones(len(df), dtype=bool)), ("Solo B activo", df.active.to_numpy())]
    scopes += [(f"{LABELS[c]} ({stat_name[c]})", (df.league == c).to_numpy()) for c in LEAGUES]
    scopes += [("Temporada 26/27", (df.season == CURRENT).to_numpy())]

    print(f"{'A vs B (todos)':<20}{'n':>6}{'B act':>6}  {'Acierto A (IC95)':<18}{'Acierto B (IC95)':<18}"
          f"{'LL A':<7}{'LL B':<7}{'dLL B-A [IC95]':<27}{'Br A':<7}Br B")
    for name, mask in scopes:
        print(row_ab(name, df[mask], PA[mask], PB[mask]))
    print(f"{'Champions':<20}{champions:>6}  sin prediccion del modelo actual ni cuota: no comparable")
    print(f"{'A/B/C (con cuota)':<20}{'n':>6}  {'Acierto A (IC95)':<18}{'Acierto B (IC95)':<18}{'Acierto C (IC95)':<18}"
          f"{'LL A':<7}{'LL B':<7}{'LL C':<8}{'Br A':<7}{'Br B':<7}Br C")
    for name, mask in scopes:
        mask = mask & has_market
        print(row_abc(name, df[mask], PA[mask], PB[mask], PC[mask]))


if __name__ == "__main__":
    main()
