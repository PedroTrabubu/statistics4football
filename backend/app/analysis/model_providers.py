"""Resultados de los partidos y distribuciones del modelo para la evaluacion
por linea. Todo point-in-time: solo partidos anteriores al que se evalua.

- Goles: Dixon-Coles de la web (app/probability/engine.py), ajustado con los
  partidos de la liga anteriores a la fecha del partido.
- Corners: el modelo de conteos de las combinadas (app/picks), con su
  historial de cada equipo alimentado en orden de fecha.
"""

from __future__ import annotations

from collections.abc import Iterable

import numpy as np
from sqlalchemy.orm import Session

from app.analysis.pinnacle_lines import MatchResultData, ModelDists, ModelProvider
from app.db.models import Match, MatchStatus, TeamMatchStats
from app.picks.count_model import CountTracker
from app.picks.engine import load_params
from app.probability.engine import get_cached_league_model


def match_results(db: Session, match_ids: Iterable[int]) -> dict[int, MatchResultData]:
    ids = list(match_ids)
    matches = (
        db.query(Match)
        .filter(Match.id.in_(ids), Match.status == MatchStatus.HISTORICAL, Match.home_goals.is_not(None))
        .all()
    )
    corners = {
        (s.match_id, s.team_id): s.corners_for
        for s in db.query(TeamMatchStats).filter(TeamMatchStats.match_id.in_(ids))
    }
    return {
        m.id: MatchResultData(
            home_goals=m.home_goals,
            away_goals=m.away_goals,
            home_ht_goals=m.home_ht_goals,
            away_ht_goals=m.away_ht_goals,
            home_corners=corners.get((m.id, m.home_team_id)),
            away_corners=corners.get((m.id, m.away_team_id)),
        )
        for m in matches
    }


def dixon_coles_goals(db: Session, match_ids: Iterable[int]) -> dict[int, np.ndarray]:
    """Matriz de marcadores de cada partido, con el modelo ajustado antes de su fecha."""
    out = {}
    for m in db.query(Match).filter(Match.id.in_(list(match_ids))).all():
        model = get_cached_league_model(db, m.league_id, as_of_date=m.date)
        out[m.id] = model.score_matrix(m.home_team_id, m.away_team_id)
    return out


def count_model_corners(db: Session, match_ids: Iterable[int]) -> dict[int, np.ndarray]:
    """Matriz conjunta de corners (local x visitante) del modelo de las
    combinadas, con el historial de cada equipo hasta antes del partido."""
    params = load_params()
    if params is None:
        return {}
    targets = db.query(Match).filter(Match.id.in_(list(match_ids))).all()
    out: dict[int, np.ndarray] = {}
    for league_id in {m.league_id for m in targets}:
        league_targets = sorted((m for m in targets if m.league_id == league_id), key=lambda m: m.date)
        history = (
            db.query(Match)
            .filter(Match.league_id == league_id, Match.status == MatchStatus.HISTORICAL)
            .order_by(Match.date.asc(), Match.id.asc())
            .all()
        )
        stats = {
            (s.match_id, s.team_id): s.corners_for
            for s in db.query(TeamMatchStats).filter(TeamMatchStats.match_id.in_([m.id for m in history]))
        }
        tracker = CountTracker()
        nxt = 0
        for target in league_targets:
            while nxt < len(history) and history[nxt].date < target.date:
                h = history[nxt]
                home, away = stats.get((h.id, h.home_team_id)), stats.get((h.id, h.away_team_id))
                if home is not None and away is not None:
                    tracker.add(h.home_team_id, h.away_team_id, home, away)
                nxt += 1
            features = tracker.features(target.home_team_id, target.away_team_id)
            out[target.id] = np.outer(
                params.models[("corners", "home")].pmf(features["home"]),
                params.models[("corners", "away")].pmf(features["away"]),
            )
    return out


def db_model_provider(db: Session, match_ids: Iterable[int]) -> ModelProvider:
    ids = list(match_ids)
    goals = dixon_coles_goals(db, ids)
    corners = count_model_corners(db, ids)
    return lambda match_id: ModelDists(goals=goals.get(match_id), corners=corners.get(match_id))
