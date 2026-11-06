"""Aciertos de los modelos (pagina "Aciertos" de la web): cuanto han acertado en
el pasado. Solo cuenta predicciones hechas con datos anteriores a cada partido
(walk-forward) que los modelos ya tienen guardadas; aqui no se modela ni se
recalcula ninguna probabilidad.

Fuentes (solo lectura):
- Porcentajes de resultado (docs/RESULTADOS_PROTOCOLO.md), tabla
  `result_predictions`. "Congelada": la fila escrita antes del inicio, tal cual.
  "Reconstruida": la media de su Elo calibrado (logits y temperatura guardados)
  y Dixon-Coles mensual calibrado, como el resumen de la ficha
  (`compute_summary`). Bases: el favorito del mercado sin margen (1X2) y su
  doble oportunidad mas probable. Sin cuota pre-partido guardada, el partido
  sale de la comparacion, del modelo y de la base.
- Alta probabilidad (docs/MODELO_PATRONES.md): las selecciones marcadas del
  modelo de patrones en sus ligas validadas, como GET /recommendations/history.
  Congelada si se escribio antes del inicio. Base: lo que esperaba el mercado
  (probabilidad sin margen).
- Picks probables (docs/PICKS_PROBABLES_PROTOCOLO.md): el ultimo
  `npm run export:picks` (data/reports/picks_probables.csv), reconstruidos con
  el motor de la web. Base: la frecuencia del suceso en la liga.
- Duelo de corners (docs/DUELO_CORNERES_MODELO_PROTOCOLO.md) y predictor de
  estadisticas (docs/PREDICTOR_ESTADISTICAS_PROTOCOLO.md), tabla
  `match_forecasts`. Duelo: su resultado mas probable. Predictor: que equipo
  saca mas en cada estadistica, en los partidos sin empate en ella; y su error
  medio frente a la media simple de la liga, la medida que decide en su
  protocolo (solo por estadistica: entre estadisticas no se suman). Base de
  los dos: el equipo con mas media de esa estadistica en sus ultimos partidos
  de la competicion, antes de ese; si empatan o a uno le falta historial, el
  partido no entra en la comparacion.

Solo las ligas de la web (settings.leagues); las de contexto no salen. La
Champions va "sin calibrar": aparece en su liga, pero no en los totales.

Salida: data/model_cache/hit_rate/<liga|all>/<temporada|all>.json (el export
estatico los publica tal cual), teams/<equipo>.json (sus partidos con lo que
se predijo en cada uno) e index.json. Incremental: solo se reescriben
los ficheros cuyas filas han cambiado (huellas en state.json).
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import unicodedata
from bisect import bisect_left
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session, aliased, joinedload

from app.analysis.stats import REPS, SEED, _per_match
from app.core.competitions import CHAMPIONS_LEAGUE
from app.core.config import PROJECT_ROOT, Settings
from app.db.models import League, Match, MatchForecast, MatchOdds, MatchStatus, ModelPrediction, ResultPrediction
from app.db.models import Season, Team, TeamMatchStats
from app.probability.dc_monthly import load_dc_monthly
from app.probability.match_forecasts import COLUMN as STATS_COLUMN
from app.probability.match_forecasts import CORNER_DUEL, KIND_FROZEN as FORECAST_FROZEN, STATS_PREDICTOR
from app.probability.outcomes import resolve_selection
from app.probability.pattern_model import MODEL_VERSION as PATTERN_MODEL_VERSION
from app.probability.result_model import MARKET_BOOKMAKER, double_chance, market_probabilities, softmax
from app.probability.result_metrics import best_dc_hit, top_hit, wilson
from app.probability.result_predictions import KIND_FROZEN, LEAGUES as RESULT_LEAGUES
from app.probability.result_predictions import MODEL_VERSION as RESULT_MODEL_VERSION
from app.probability.result_predictions import _dc_calibrated
from app.probability.stats_predictor import SHOWN as STATS_SHOWN

# Sube al cambiar el calculo o el formato: se reescriben todos los ficheros.
BUILD_VERSION = 5
OUT_DIR = PROJECT_ROOT / "data" / "model_cache" / "hit_rate"
PICKS_CSV = PROJECT_ROOT / "data" / "reports" / "picks_probables.csv"
ALL = "all"
# Equipos: por debajo de estas predicciones, la web avisa de pocos datos.
MIN_TEAM = 20
# Por debajo, la web avisa de muestra baja.
LOW_SAMPLE = 100
# Remuestreos por bloques: 2000 x partidos de golpe son cientos de MB.
CHUNK = 250

MODELS = ("result_1x2", "result_double", "high_probability", "probable_picks", CORNER_DUEL, STATS_PREDICTOR)
DOCS = {
    "result_1x2": "docs/RESULTADOS_PROTOCOLO.md",
    "result_double": "docs/RESULTADOS_PROTOCOLO.md",
    "high_probability": "docs/MODELO_PATRONES.md",
    "probable_picks": "docs/PICKS_PROBABLES_PROTOCOLO.md",
    CORNER_DUEL: "docs/DUELO_CORNERES_MODELO_PROTOCOLO.md",
    STATS_PREDICTOR: "docs/PREDICTOR_ESTADISTICAS_PROTOCOLO.md",
}
# Tramos de doble oportunidad del protocolo (la mejor nunca baja de 2/3).
DOUBLE_BINS = ((0.6, 0.7), (0.7, 0.75), (0.75, 0.8), (0.8, 0.85), (0.85, 1.0))
# Base del predictor y del duelo: el equipo con mas media en estos partidos
# (o los que tenga, si son menos).
RECENT_MATCHES = 10

# `tie`: la fila no entra en la comparacion (empate en la estadistica o en la
# media de la base, o un equipo sin historial): no cuenta para el acierto, si
# para el error medio. `err`/`err_base`: error absoluto medio de los dos
# equipos, del modelo y de la media de la liga. `pick`: lo que se predijo, para
# la lista de partidos de cada equipo (los textos, en la web): "1"/"X"/"2",
# "1X"/"X2"/"12", [mercado, seleccion], [familia, opcion, lado],
# "home"/"draw"/"away" o [estadistica, lado].
COLUMNS = ["model", "league", "season", "match_id", "date", "home", "away", "origin", "type", "level", "hit", "base",
           "tie", "err", "err_base", "pick"]  # fmt: skip


# --- Filas: una por prediccion evaluable -------------------------------------


def _double_bin(p: float) -> str:
    for low, high in DOUBLE_BINS:
        if low <= p < high or (high >= 1 and p >= low):
            return f"{low:g}-{high:g}" if high < 1 else f"{low:g}+"
    return f"<{DOUBLE_BINS[0][0]:g}"


def _market_1x2(db: Session, kickoff: dict[int, datetime]) -> dict[int, tuple[float, float, float]]:
    """Mercado sin margen (local, empate, visitante) de los partidos con cuota pre-partido."""
    ids = list(kickoff)
    odds: list[MatchOdds] = []
    for start in range(0, len(ids), 500):
        odds += db.query(MatchOdds).filter(
            MatchOdds.match_id.in_(ids[start : start + 500]), MatchOdds.bookmaker == MARKET_BOOKMAKER, MatchOdds.market == "1x2"
        )
    return market_probabilities(odds, kickoff)


def market_bases(market: tuple[float, float, float] | None, y: np.ndarray) -> tuple[float, float]:
    """Acierto del favorito del mercado y de su doble oportunidad mas probable,
    con el criterio del modelo. Sin cuota, NaN: `cell` deja el partido fuera."""
    if market is None:
        return math.nan, math.nan
    M = np.array([market])
    return float(top_hit(M, y)[0]), float(best_dc_hit(M, y)[0])


def result_items(db: Session) -> pd.DataFrame:
    """Resultado mas probable (1X2) y mejor doble oportunidad de cada partido
    jugado con prediccion, la misma poblacion que el resumen de la ficha."""
    rows = (
        db.query(ResultPrediction, Match, League.code, Season.name)
        .join(Match, Match.id == ResultPrediction.match_id)
        .join(League, League.id == Match.league_id)
        .join(Season, Season.id == Match.season_id)
        .options(joinedload(Match.home_team), joinedload(Match.away_team))
        .filter(
            ResultPrediction.score_home.is_not(None),
            Match.status == MatchStatus.HISTORICAL,
            Match.home_goals.is_not(None),
        )
        .all()
    )
    if not rows:
        return pd.DataFrame(columns=COLUMNS)

    # Dixon-Coles calibrado de los reconstruidos, con todos los jugados de cada liga.
    played = (
        db.query(Match.id, Match.date, Match.home_goals, Match.away_goals, League.code, Season.name)
        .join(League, League.id == Match.league_id)
        .join(Season, Season.id == Match.season_id)
        .filter(League.code.in_(RESULT_LEAGUES), Match.status == MatchStatus.HISTORICAL, Match.home_goals.is_not(None))
        .all()
    )
    frame = pd.DataFrame(
        [{"match_id": mid, "league": code, "season": season, "day": datetime(d.year, d.month, d.day),
          "res": 0 if hg > ag else 1 if hg == ag else 2} for mid, d, hg, ag, code, season in played]  # fmt: skip
    )
    dc = load_dc_monthly(RESULT_LEAGUES)
    dc_cal = pd.concat([_dc_calibrated(frame[frame.league == code], dc) for code in frame.league.unique()])
    market = _market_1x2(db, {m.id: m.date for _, m, _, _ in rows})

    out = []
    for r, m, code, season in rows:
        if r.kind == KIND_FROZEN and r.p_home is not None:
            p = np.array([r.p_home, r.p_draw, r.p_away])
        else:
            p = softmax(np.array([[r.score_home, r.score_draw, r.score_away]]) / r.temperature)[0]
            if r.match_id in dc_cal.index:
                p = (p + dc_cal.loc[r.match_id, ["p_home", "p_draw", "p_away"]].to_numpy(float)) / 2
        y = np.array([0 if m.home_goals > m.away_goals else 1 if m.home_goals == m.away_goals else 2])
        P = p[None, :]
        base_1x2, base_double = market_bases(market.get(m.id), y)
        origin = "frozen" if r.kind == KIND_FROZEN else "reconstructed"
        common = {"league": code, "season": season, "match_id": m.id, "date": m.date, "home": m.home_team.name,
                  "away": m.away_team.name, "origin": origin, "level": None}  # fmt: skip
        out.append(common | {"model": "result_1x2", "type": None, "hit": float(top_hit(P, y)[0]),
                             "base": base_1x2, "pick": "1X2"[int(P.argmax())]})  # fmt: skip
        # La mejor doble oportunidad deja fuera el resultado menos probable.
        out.append(common | {"model": "result_double", "type": _double_bin(float(double_chance(P).max())),
                             "hit": float(best_dc_hit(P, y)[0]), "base": base_double,
                             "pick": ("X2", "12", "1X")[int(P.argmin())]})  # fmt: skip
    return pd.DataFrame(out, columns=COLUMNS)


def high_probability_items(db: Session, settings: Settings) -> pd.DataFrame:
    """Las selecciones de GET /recommendations/history (alta probabilidad)."""
    preds = (
        db.query(ModelPrediction)
        .join(Match, Match.id == ModelPrediction.match_id)
        .join(League, League.id == Match.league_id)
        .options(joinedload(ModelPrediction.match).joinedload(Match.league),
                 joinedload(ModelPrediction.match).joinedload(Match.season),
                 joinedload(ModelPrediction.match).joinedload(Match.home_team),
                 joinedload(ModelPrediction.match).joinedload(Match.away_team))  # fmt: skip
        .filter(
            ModelPrediction.is_recommended.is_(True),
            ModelPrediction.model_version == PATTERN_MODEL_VERSION,
            Match.status == MatchStatus.HISTORICAL,
            League.code.in_(settings.pattern_leagues),
        )
        .all()
    )
    out = []
    for p in preds:
        m = p.match
        won = resolve_selection(m, p.market, p.selection)
        out.append({
            "model": "high_probability", "league": m.league.code, "season": m.season.name, "match_id": m.id,
            "date": m.date, "home": m.home_team.name, "away": m.away_team.name,
            "origin": "frozen" if p.created_at < m.date else "reconstructed", "type": p.market, "level": None,
            "hit": math.nan if won is None else float(won),
            "base": math.nan if p.prob_market_implied is None else float(p.prob_market_implied),
            "pick": [p.market, p.selection],
        })  # fmt: skip
    return pd.DataFrame(out, columns=COLUMNS)


def probable_picks_items(path: Path = PICKS_CSV) -> pd.DataFrame:
    """Los picks del ultimo export del motor de la web; vacio si no hay export."""
    if not path.exists():
        return pd.DataFrame(columns=COLUMNS)
    df = pd.read_csv(path, dtype={"season": str})
    return pd.DataFrame({
        "model": "probable_picks", "league": df.league, "season": df.season.str.zfill(4), "match_id": df.match_id,
        "date": pd.to_datetime(df.date), "home": df.home_team, "away": df.away_team, "origin": "reconstructed",
        "type": df.family, "level": df.strength, "hit": df.hit.astype(float), "base": df.league_rate.astype(float),
        # Opcion y lado del pick (un export sin ellas: solo la familia).
        "pick": [[f, o, s] for f, o, s in zip(df.family, df.get("option", pd.Series([None] * len(df))),
                                                df.get("side", pd.Series([None] * len(df))), strict=True)],  # fmt: skip
    }, columns=COLUMNS)  # fmt: skip


def recent_side(
    history: dict[tuple[str, int, str], tuple[list[datetime], list[float]]],
    league: str, home_id: int, away_id: int, stat: str, date: datetime,
) -> str | None:  # fmt: skip
    """El lado con mas media de `stat` en sus ultimos RECENT_MATCHES partidos de
    la competicion, solo anteriores a `date`. None si empatan o a uno le falta
    historial. `history`: fechas (ordenadas) y valores de cada liga, equipo y
    estadistica."""

    def mean(team_id: int) -> float | None:
        dates, values = history.get((league, team_id, stat), ([], []))
        end = bisect_left(dates, date)
        last = values[max(0, end - RECENT_MATCHES) : end]
        return sum(last) / len(last) if last else None

    home, away = mean(home_id), mean(away_id)
    if home is None or away is None or home == away:
        return None
    return "home" if home > away else "away"


def forecast_items(db: Session) -> pd.DataFrame:
    """Duelo de corners y predictor de los partidos jugados con estimacion."""
    home_team, away_team = aliased(Team), aliased(Team)
    rows = (
        db.query(MatchForecast.match_id, MatchForecast.model, MatchForecast.stat, MatchForecast.kind,
                 MatchForecast.home, MatchForecast.away, MatchForecast.p_home, MatchForecast.p_draw,
                 MatchForecast.p_away, MatchForecast.league_home, MatchForecast.league_away, Match.date,
                 Match.home_team_id, Match.away_team_id, home_team.name, away_team.name, League.code, Season.name)  # fmt: skip
        .join(Match, Match.id == MatchForecast.match_id)
        .join(League, League.id == Match.league_id)
        .join(Season, Season.id == Match.season_id)
        .join(home_team, home_team.id == Match.home_team_id)
        .join(away_team, away_team.id == Match.away_team_id)
        .filter(MatchForecast.home.is_not(None), Match.status == MatchStatus.HISTORICAL)
        .filter((MatchForecast.model == CORNER_DUEL) | MatchForecast.stat.in_(STATS_SHOWN))
        .all()
    )
    if not rows:
        return pd.DataFrame(columns=COLUMNS)
    columns = [getattr(TeamMatchStats, STATS_COLUMN.get(k, k)) for k in STATS_SHOWN]
    observed = {
        (match_id, team_id): dict(zip(STATS_SHOWN, values, strict=True))
        for match_id, team_id, *values in db.query(TeamMatchStats.match_id, TeamMatchStats.team_id, *columns)
        .join(Match, Match.id == TeamMatchStats.match_id)
        .filter(Match.status == MatchStatus.HISTORICAL)
    }
    # Lo que saco cada equipo, partido a partido, para la base.
    history: dict[tuple[str, int, str], tuple[list[datetime], list[float]]] = defaultdict(lambda: ([], []))
    played = (
        db.query(Match.id, Match.date, Match.home_team_id, Match.away_team_id, League.code)
        .join(League, League.id == Match.league_id)
        .filter(Match.status == MatchStatus.HISTORICAL)
        .order_by(Match.date)
    )
    for match_id, date, home_id, away_id, code in played:
        for team_id in (home_id, away_id):
            for stat, value in observed.get((match_id, team_id), {}).items():
                if value is not None:
                    dates, values = history[(code, team_id, stat)]
                    dates.append(date)
                    values.append(float(value))

    out = []
    for (match_id, model, stat, kind, h, a, ph, pd_, pa, lh, la, date, home_id, away_id, home, away, code,
         season) in rows:  # fmt: skip
        oh = observed.get((match_id, home_id), {}).get(stat)
        oa = observed.get((match_id, away_id), {}).get(stat)
        side = recent_side(history, code, home_id, away_id, stat, date)
        row = {"model": model, "league": code, "season": season, "match_id": match_id, "date": date, "home": home,
               "away": away, "origin": "frozen" if kind == FORECAST_FROZEN else "reconstructed", "type": None,
               "level": None, "hit": math.nan, "base": math.nan, "tie": False, "err": math.nan,
               "err_base": math.nan}  # fmt: skip
        if model == CORNER_DUEL:
            # El mas probable, con el desempate de la web (local, visitante, mismos).
            best = 0 if ph >= pd_ and ph >= pa else 2 if pa >= pd_ else 1
            row["pick"] = ("home", "draw", "away")[best]
            if oh is not None and oa is not None:
                actual = 0 if oh > oa else 1 if oh == oa else 2
                if side is None:
                    row["tie"] = True
                else:
                    row |= {"hit": float(best == actual), "base": float(actual == (0 if side == "home" else 2))}
        else:
            row["type"] = stat
            row["pick"] = [stat, "home" if h > a else "away"]
            if oh is not None and oa is not None:
                row |= {"err": (abs(oh - h) + abs(oa - a)) / 2, "err_base": (abs(oh - lh) + abs(oa - la)) / 2}
                if oh == oa or side is None:
                    row["tie"] = True
                else:
                    row |= {"hit": float((h > a) == (oh > oa)), "base": float((oh > oa) == (side == "home"))}
        out.append(row)
    return pd.DataFrame(out, columns=COLUMNS)


# --- Cifras --------------------------------------------------------------------


def edge_ci(match_ids: Iterable[int], hit: np.ndarray, base: np.ndarray) -> tuple[float, float] | None:
    """Intervalo al 95 % de acierto - base remuestreando partidos: el mismo
    calculo y la misma semilla que `bootstrap_mean_diff`, por bloques."""
    n, sum_hit, sum_base = _per_match(list(match_ids), hit, base)
    if len(n) < 2:
        return None
    rng = np.random.default_rng(SEED)
    diffs = []
    for start in range(0, REPS, CHUNK):
        draws = rng.integers(0, len(n), size=(min(CHUNK, REPS - start), len(n)))
        diffs.append((sum_hit[draws].sum(axis=1) - sum_base[draws].sum(axis=1)) / n[draws].sum(axis=1))
    low, high = np.percentile(np.concatenate(diffs), [2.5, 97.5])
    return float(low), float(high)


def cell(df: pd.DataFrame, mae: bool = False) -> dict:
    """n, acierto con su Wilson, base media y ventaja con su intervalo. Las
    filas sin dato (sin resultado o sin base) no cuentan, pero se dicen; los
    empates del predictor, ni eso. `mae`: tambien el error medio del modelo y
    de la media de la liga (solo dentro de una estadistica)."""
    counted = df[~df.tie.eq(True)] if "tie" in df else df
    ok = counted[counted.hit.notna() & counted.base.notna()]
    n, hits = len(ok), int(ok.hit.sum())
    low, high = wilson(hits, n)
    rate = hits / n if n else None
    base = float(ok.base.mean()) if n else None
    ci = edge_ci(ok.match_id, ok.hit.to_numpy(float), ok.base.to_numpy(float)) if n else None
    out = {
        "n": n, "hits": hits, "matches": int(ok.match_id.nunique()), "no_data": len(counted) - n,
        "rate": rate, "low": None if math.isnan(low) else low, "high": None if math.isnan(high) else high,
        "base": base, "edge": None if rate is None else rate - base,
        "edge_low": ci[0] if ci else None, "edge_high": ci[1] if ci else None,
    }  # fmt: skip
    if mae:
        err = df[df.err.notna() & df.err_base.notna()]
        out |= {"mae": float(err.err.mean()) if len(err) else None,
                "mae_base": float(err.err_base.mean()) if len(err) else None}  # fmt: skip
    return out


# Los niveles de fuerza, de mas a menos; el resto, por su clave.
LEVEL_ORDER = {"alta": 0, "media": 1, "baja": 2}


def _groups(df: pd.DataFrame, column: str, mae: bool = False) -> list[dict]:
    order = lambda kv: (LEVEL_ORDER.get(kv[0], len(LEVEL_ORDER)), str(kv[0]))  # noqa: E731
    return [{"key": key} | cell(g, mae) for key, g in sorted(df.groupby(column, dropna=True), key=order)]


def _teams(df: pd.DataFrame) -> list[dict]:
    """Todos los equipos: cada prediccion cuenta para los dos equipos de su
    partido. `league`: la de la mayoria de sus filas (para su escudo). Con
    menos de MIN_TEAM, la web avisa de pocos datos."""
    both = pd.concat([df.assign(team=df.home), df.assign(team=df.away)])
    teams = [{"key": team, "league": g.league.mode().iloc[0]} | cell(g) for team, g in both.groupby("team")]
    return sorted(teams, key=lambda t: t["key"])


def calibrated(league: str) -> bool:
    return league != CHAMPIONS_LEAGUE


def model_slice(df: pd.DataFrame, league: str, season: str) -> dict:
    """Las cifras de un modelo en una liga y temporada (o todas)."""
    if league != ALL:
        df = df[df.league == league]
    if season != ALL:
        df = df[df.season == season]
    if df.empty:
        return {"available": False}
    scored = df[df.hit.notna()]
    # En todas las ligas, los totales y desgloses son de las calibradas.
    main = df if league != ALL else df[df.league.map(calibrated)]
    out = {
        "available": True,
        "calibrated": league == ALL or calibrated(league),
        "from": scored.date.min().isoformat() if len(scored) else None,
        "until": scored.date.max().isoformat() if len(scored) else None,
        "total": cell(main),
        "by_origin": _groups(main, "origin"),
        # El error medio, solo en el predictor y por estadistica.
        "by_type": _groups(main, "type", mae="err" in main and bool(main.err.notna().any())),
        "by_level": _groups(main, "level"),
        "by_team": _teams(main),
    }
    if league == ALL:
        out["by_league"] = [g | {"calibrated": calibrated(g["key"])} for g in _groups(df, "league")]
    if season == ALL:
        out["by_season"] = _groups(main, "season")
    return out


# --- Cuanto se repite el orden entre temporadas --------------------------------

# Equipos o ligas en comun entre dos temporadas para comparar su orden.
MIN_COMMON = {"teams": 15, "leagues": 5}


def _season_rates(df: pd.DataFrame, by: str, min_n: int) -> pd.DataFrame:
    """Acierto y ventaja (sin intervalos) de cada temporada y equipo o liga con al menos `min_n`."""
    ok = df[~df.tie.eq(True) & df.hit.notna() & df.base.notna()]
    if by == "team":
        ok = pd.concat([ok.assign(team=ok.home), ok.assign(team=ok.away)])
    g = ok.groupby(["season", by]).agg(n=("hit", "size"), rate=("hit", "mean"), base=("base", "mean"))
    g["edge"] = g.rate - g.base
    return g[g.n >= min_n]


def stability(df: pd.DataFrame) -> dict:
    """Correlacion de Spearman del acierto (y de la ventaja) de cada equipo y de
    cada liga entre una temporada y la siguiente, de media: 0, el orden no se
    repite; 1, se repite igual. Solo ligas calibradas y con la muestra de las
    tablas (MIN_TEAM por equipo, LOW_SAMPLE por liga). None si no hay bastante."""
    df = df[df.league.map(calibrated)]
    out: dict = {}
    for key, by, min_n in (("teams", "team", MIN_TEAM), ("leagues", "league", LOW_SAMPLE)):
        g = _season_rates(df, by, min_n) if len(df) else pd.DataFrame()
        seasons = sorted(g.index.get_level_values("season").unique()) if len(g) else []
        rates, edges, rows = [], [], 0
        for a, b in zip(seasons, seasons[1:], strict=False):
            ga, gb = g.loc[a], g.loc[b]
            common = ga.index.intersection(gb.index)
            if len(common) < MIN_COMMON[key]:
                continue
            rates.append(ga.rate[common].corr(gb.rate[common], method="spearman"))
            edges.append(ga.edge[common].corr(gb.edge[common], method="spearman"))
            rows += len(common)
        out[key] = (
            {"rate": float(np.mean(rates)), "edge": float(np.mean(edges)), "pairs": len(rates), "rows": rows}
            if rates
            else None
        )
    return out


# --- Escritura incremental -------------------------------------------------------


@dataclass
class BuildSummary:
    written: int = 0
    kept: int = 0
    teams: int = 0  # ficheros de equipo reescritos


# Un fichero por equipo con sus partidos y lo que se predijo en cada uno.
TEAMS_DIR = "teams"


def team_slug(name: str) -> str:
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", plain.lower()).strip("-") or "equipo"


def _team_slugs(names: Iterable[str]) -> dict[str, str]:
    """Nombre de fichero de cada equipo, sin repetidos (el segundo, con -2...)."""
    out: dict[str, str] = {}
    used: set[str] = set()
    for name in sorted(names):
        slug, i = team_slug(name), 1
        while (candidate := slug if i == 1 else f"{slug}-{i}") in used:
            i += 1
        out[name] = candidate
        used.add(candidate)
    return out


def _scores(db: Session | None, match_ids: list[int]) -> dict[int, tuple[int, int]]:
    """Marcador de cada partido jugado (sin BD, en los tests: ninguno)."""
    if db is None:
        return {}
    out: dict[int, tuple[int, int]] = {}
    for start in range(0, len(match_ids), 900):
        rows = db.query(Match.id, Match.home_goals, Match.away_goals).filter(Match.id.in_(match_ids[start : start + 900]))
        out |= {mid: (hg, ag) for mid, hg, ag in rows if hg is not None and ag is not None}
    return out


def _plain(value):
    """Lo que se predijo, tal cual para JSON (NaN: nada)."""
    if isinstance(value, float) and math.isnan(value):
        return None
    return list(value) if isinstance(value, tuple | list) else value


def team_payloads(items: pd.DataFrame, scores: dict[int, tuple[int, int]]) -> dict[str, dict]:
    """Los partidos de cada equipo, del mas antiguo al mas reciente, con cada
    prediccion: [modelo, pick, acierto (1/0, "=" empate en el predictor, None
    sin dato), "f" guardada antes del partido o "r" calculada con datos anteriores]."""
    both = pd.concat([items.assign(team=items.home), items.assign(team=items.away)])
    out: dict[str, dict] = {}
    for team, g in both.groupby("team"):
        matches: dict[int, dict] = {}
        for r in g.sort_values(["date", "match_id"]).itertuples(index=False):
            m = matches.get(r.match_id)
            if m is None:
                score = scores.get(int(r.match_id))
                m = matches[r.match_id] = {
                    "id": int(r.match_id), "date": pd.Timestamp(r.date).isoformat(), "league": r.league,
                    "season": r.season, "home": r.home, "away": r.away, "score": list(score) if score else None,
                    "preds": [],
                }  # fmt: skip
            hit = "=" if r.tie else (None if pd.isna(r.hit) else int(r.hit))
            m["preds"].append([r.model, _plain(r.pick), hit, "f" if r.origin == "frozen" else "r"])
        out[team] = {"team": team, "matches": list(matches.values())}
    return out


def _fingerprint(df: pd.DataFrame) -> str:
    rows = df.sort_values(["match_id", "type", "level", "origin"], na_position="first")
    text = rows[["match_id", "origin", "type", "level", "hit", "base", "tie", "err", "err_base", "home", "away"]].to_csv(
        index=False, float_format="%.6f"
    )
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":"), default=str), encoding="utf-8")
    os.replace(tmp, path)


def slice_path(league: str, season: str, out_dir: Path = OUT_DIR) -> Path:
    return out_dir / league / f"{season}.json"


def build(db: Session, settings: Settings, out_dir: Path = OUT_DIR, picks_csv: Path = PICKS_CSV, force: bool = False) -> BuildSummary:
    sources = (result_items(db), high_probability_items(db, settings), probable_picks_items(picks_csv), forecast_items(db))
    # Sin las columnas que una fuente no tiene (todo NaN): pandas avisa si entran al juntar.
    frames = [df.dropna(axis=1, how="all") for df in sources if len(df)]
    items = (pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()).reindex(columns=COLUMNS)
    if settings is not None:  # solo las ligas de la web: las de contexto no tienen pagina
        items = items[items.league.isin(settings.leagues)].reset_index(drop=True)
    items["tie"] = items.tie.eq(True)  # los demas modelos no tienen empates
    items[["err", "err_base"]] = items[["err", "err_base"]].astype(float)
    by_model = {key: items[items.model == key] for key in MODELS}

    state_path = out_dir / "state.json"
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        state = {}
    if state.get("version") != BUILD_VERSION:
        # Otro calculo u otro formato: fuera todo lo anterior, tambien lo que no tiene filas.
        state, force = {}, True
    old = state.get("fingerprints", {})
    new = {f"{model}|{lg}|{s}": _fingerprint(g) for model, df in by_model.items() for (lg, s), g in df.groupby(["league", "season"])}
    changed = {k for k in old.keys() | new.keys() if old.get(k) != new.get(k)}

    leagues = sorted(items.league.unique())
    seasons = sorted(items.season.unique())
    summary = BuildSummary()
    for league in [ALL, *leagues]:
        for season in [ALL, *seasons]:
            path = slice_path(league, season, out_dir)
            touched = any(
                (league in (ALL, lg)) and (season in (ALL, s)) for _, lg, s in (k.split("|") for k in changed)
            )
            if path.exists() and not touched and not force:
                summary.kept += 1
                continue
            data = {"league": league, "season": season, "models": {k: model_slice(df, league, season) for k, df in by_model.items()}}
            _write_json(path, data)
            summary.written += 1

    # Los partidos de cada equipo: solo se reescriben los que han cambiado.
    payloads = team_payloads(items, _scores(db, [int(x) for x in items.match_id.unique()]))
    slugs = _team_slugs(payloads)
    old_teams = state.get("teams", {})
    team_prints = {}
    for name, payload in payloads.items():
        team_prints[name] = hashlib.sha1(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        path = out_dir / TEAMS_DIR / f"{slugs[name]}.json"
        if path.exists() and old_teams.get(name) == team_prints[name] and not force:
            continue
        _write_json(path, payload)
        summary.teams += 1

    sources = {
        "picks_csv": datetime.fromtimestamp(picks_csv.stat().st_mtime, UTC).isoformat() if picks_csv.exists() else None,
    }
    index = {
        "version": BUILD_VERSION,
        "generated_at": datetime.now(UTC).isoformat(),
        "seed": SEED,
        "reps": REPS,
        "min_team": MIN_TEAM,
        "low_sample": LOW_SAMPLE,
        "result_version": RESULT_MODEL_VERSION,
        "sources": sources,
        "leagues": [{"code": lg, "calibrated": calibrated(lg), "seasons": sorted(items[items.league == lg].season.unique())}
                    for lg in leagues],  # fmt: skip
        "seasons": seasons,
        "models": {
            key: {"doc": DOCS[key], "available": len(df) > 0, "origins": sorted(df.origin.unique()),
                  "until": df[df.hit.notna()].date.max().isoformat() if df.hit.notna().any() else None}  # fmt: skip
            for key, df in by_model.items()
        },
        # La pagina lo dice junto a las tablas de ligas y equipos.
        "stability": {key: stability(df) for key, df in by_model.items()},
        # Fichero de cada equipo (teams/<slug>.json): la API solo sirve estos.
        "teams": slugs,
    }
    _write_json(out_dir / "index.json", index)
    _write_json(state_path, {"version": BUILD_VERSION, "fingerprints": new, "teams": team_prints})
    return summary


# --- Lectura (API): solo ficheros ------------------------------------------------

_cache: dict[Path, tuple[float, dict]] = {}


def _read(path: Path) -> dict | None:
    try:
        mtime = path.stat().st_mtime
    except FileNotFoundError:
        return None
    cached = _cache.get(path)
    if cached is None or cached[0] != mtime:
        cached = (mtime, json.loads(path.read_text(encoding="utf-8")))
        _cache[path] = cached
    return cached[1]


def read_index(out_dir: Path = OUT_DIR) -> dict | None:
    return _read(out_dir / "index.json")


def read_slice(league: str, season: str, out_dir: Path = OUT_DIR) -> dict | None:
    """Solo ligas y temporadas del indice: el nombre llega de la URL."""
    index = read_index(out_dir)
    if index is None:
        return None
    if league != ALL and league not in {lg["code"] for lg in index["leagues"]}:
        return None
    if season != ALL and season not in index["seasons"]:
        return None
    return _read(slice_path(league, season, out_dir))


def read_team(name: str, out_dir: Path = OUT_DIR) -> dict | None:
    """Los partidos de un equipo; solo equipos del indice (el nombre llega de la URL)."""
    slug = (read_index(out_dir) or {}).get("teams", {}).get(name)
    return None if slug is None else _read(out_dir / TEAMS_DIR / f"{slug}.json")
