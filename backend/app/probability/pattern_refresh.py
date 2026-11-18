"""Predicciones de alta probabilidad (y de valor, con ENABLE_EV=true) de los
partidos por jugar. La usan scripts/refresh_predictions.py (a mano) y el
programador (app/ingestion/update.py) en cada actualizacion: se recalculan con
lo jugado y las cuotas de ese momento hasta que empieza el partido.

Un partido ya empezado no se toca aunque siga como programado (el resultado
llega despues): su ultima prediccion anterior al inicio queda congelada, y la
pagina Aciertos solo la cuenta como hecha antes del partido si se creo antes
del inicio (app/analysis/hit_rate.py).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import League, Match, MatchStatus
from app.probability.engine import generate_predictions_for_match, get_cached_league_model
from app.probability.pattern_engine import build_tracker, generate_pattern_predictions_for_match
from app.probability.pattern_model import load_params


@dataclass
class RefreshSummary:
    matches: int = 0
    with_odds: int = 0
    lines: list[str] = field(default_factory=list)


def refresh_predictions(db: Session, settings: Settings, now: datetime | None = None) -> RefreshSummary:
    """Sobrescribe las predicciones de cada partido programado que aun no ha
    empezado con la version mas reciente del modelo (idempotente)."""
    now = now or datetime.utcnow()
    summary = RefreshSummary()
    pattern_params = load_params()
    if pattern_params is None:
        summary.lines.append("Sin pattern_model_params.json: no se generan las de alta probabilidad.")
    # Alta probabilidad, en sus ligas; las de valor, solo con el flag y en las validadas.
    value_leagues = settings.model_leagues if settings.enable_ev else []
    codes = set(settings.pattern_leagues) | set(value_leagues)
    for league in db.query(League).filter(League.code.in_(codes)).order_by(League.code).all():
        with_value = league.code in value_leagues
        with_pattern = pattern_params is not None and league.code in settings.pattern_leagues
        matches = (
            db.query(Match)
            .filter(Match.league_id == league.id, Match.status == MatchStatus.SCHEDULED, Match.date > now)
            .order_by(Match.date.asc())
            .all()
        )
        if not matches:
            summary.lines.append(f"{league.code}: sin partidos por empezar")
            continue
        # Patrones: todo lo jugado hasta ahora (se predice con la informacion de hoy).
        tracker = build_tracker(db, league.id, before=now) if with_pattern else None
        with_odds = 0
        for match in matches:
            model = get_cached_league_model(db, league.id, as_of_date=match.date)
            if with_value:
                generate_predictions_for_match(db, match, model, settings.ev_threshold)
            if with_pattern and generate_pattern_predictions_for_match(db, match, model, tracker, pattern_params):
                with_odds += 1
        db.commit()
        summary.matches += len(matches)
        summary.with_odds += with_odds
        summary.lines.append(f"{league.code}: {len(matches)} por empezar, {with_odds} con cuotas")
    return summary
