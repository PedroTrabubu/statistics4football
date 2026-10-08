from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.models import League, Match, MatchStatus, ModelPrediction, RiskLevel
from app.db.session import get_db
from app.probability.engine import MODEL_VERSION as VALUE_MODEL_VERSION
from app.probability.pattern_model import MODEL_VERSION as PATTERN_MODEL_VERSION
from app.probability.outcomes import realized_pnl_units, resolve_selection
from app.schemas.prediction import (
    RecommendationHistoryBreakdown,
    RecommendationHistoryListOut,
    RecommendationHistorySummary,
    RecommendationOut,
    recommendation_history_to_out,
    recommendation_to_out,
)

router = APIRouter(prefix="/recommendations", tags=["recommendations"])

# "valor": Dixon-Coles + EV contra la cuota. "alta_probabilidad": modelo de
# patrones (docs/MODELO_PATRONES.md), una seleccion como maximo por partido.
Strategy = Literal["valor", "alta_probabilidad"]
MODEL_VERSIONS: dict[str, str] = {"valor": VALUE_MODEL_VERSION, "alta_probabilidad": PATTERN_MODEL_VERSION}


def _recommended(db: Session, settings: Settings, strategy: Strategy, status: MatchStatus):
    """Selecciones marcadas por el modelo, solo en ligas validadas: la ficha de
    un partido guarda predicciones de cualquier liga, validada o no."""
    return (
        db.query(ModelPrediction)
        .join(Match, Match.id == ModelPrediction.match_id)
        .join(League, League.id == Match.league_id)
        .filter(
            ModelPrediction.is_recommended.is_(True),
            ModelPrediction.model_version == MODEL_VERSIONS[strategy],
            Match.status == status,
            League.code.in_(settings.model_leagues),
        )
    )


@router.get("", response_model=list[RecommendationOut])
def list_recommendations(
    league_id: int | None = None,
    market: str | None = None,
    risk_level: RiskLevel | None = None,
    min_ev: float | None = None,
    strategy: Strategy = "valor",
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> list[RecommendationOut]:
    """Recomendaciones para partidos aun por jugar (nunca partidos ya
    finalizados: esos son historico, ver GET /recommendations/history).
    Nunca se devuelve el EV solo: siempre viene con confidence/risk_level.

    Requiere que las predicciones de los partidos programados esten
    generadas de antemano — ver scripts/refresh_predictions.py, re-ejecutable
    en cualquier momento."""
    query = _recommended(db, settings, strategy, MatchStatus.SCHEDULED)
    if league_id is not None:
        query = query.filter(Match.league_id == league_id)
    if market is not None:
        query = query.filter(ModelPrediction.market == market)
    if risk_level is not None:
        query = query.filter(ModelPrediction.risk_level == risk_level)
    if min_ev is not None:
        query = query.filter(ModelPrediction.ev >= min_ev)

    order = ModelPrediction.ev.desc() if strategy == "valor" else Match.date.asc()
    predictions = query.order_by(order).limit(limit).all()
    return [recommendation_to_out(p) for p in predictions]


def _breakdown(key: str, rows: list[tuple[ModelPrediction, bool | None, float | None]]) -> RecommendationHistoryBreakdown:
    won = sum(1 for _, w, _ in rows if w is True)
    lost = sum(1 for _, w, _ in rows if w is False)
    pending = sum(1 for _, w, _ in rows if w is None)
    settled = won + lost
    # ROI solo sobre selecciones con cuota real (las de "alta probabilidad"
    # en mercados sin cuota en los datos no tienen PnL y no cuentan).
    with_pnl = [pnl for _, _, pnl in rows if pnl is not None]
    pnl = sum(with_pnl)
    # Lo que el mercado esperaba acertar en esas mismas selecciones: el
    # acierto solo es merito del modelo si lo supera.
    market_probs = [p.prob_market_implied for p, w, _ in rows if w is not None and p.prob_market_implied is not None]
    return RecommendationHistoryBreakdown(
        key=key,
        total=len(rows),
        won=won,
        lost=lost,
        pending=pending,
        hit_rate=round(100 * won / settled, 1) if settled else None,
        market_expected_hit_rate=round(100 * sum(market_probs) / len(market_probs), 1) if market_probs else None,
        with_odds=len(with_pnl),
        pnl_units=round(pnl, 2),
        roi=round(100 * pnl / len(with_pnl), 1) if with_pnl else None,
    )


@router.get("/history", response_model=RecommendationHistoryListOut)
def list_recommendation_history(
    league_id: int | None = None,
    market: str | None = None,
    strategy: Strategy = "valor",
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> RecommendationHistoryListOut:
    """Historico de recomendaciones sobre partidos ya jugados: que se marco
    como valor (is_recommended) y si acerto o no, con el PnL real (no solo
    el % de acierto — una seleccion de baja probabilidad con EV positivo
    real se espera que pierda la mayoria de las veces; el ROI es la metrica
    que importa, ver glosario). Transparencia por diseno — nunca se ocultan
    ni se excluyen los fallos de este listado ni del resumen.

    Se alimenta de scripts/generate_predictions.py (backtest walk-forward
    sobre la temporada mas reciente ya jugada)."""
    query = _recommended(db, settings, strategy, MatchStatus.HISTORICAL)
    if league_id is not None:
        query = query.filter(Match.league_id == league_id)
    if market is not None:
        query = query.filter(ModelPrediction.market == market)

    predictions = query.order_by(Match.date.desc()).all()
    resolved = [
        (p, w, realized_pnl_units(p.prob_model, p.ev, w))
        for p in predictions
        for w in [resolve_selection(p.match, p.market, p.selection)]
    ]

    summary_breakdown = _breakdown("total", resolved)
    summary = RecommendationHistorySummary(**summary_breakdown.model_dump(exclude={"key"}))

    by_market_keys = sorted({p.market for p, _, _ in resolved})
    by_market = [_breakdown(m, [row for row in resolved if row[0].market == m]) for m in by_market_keys]

    items = [recommendation_history_to_out(p, w, pnl) for p, w, pnl in resolved[:limit]]
    return RecommendationHistoryListOut(summary=summary, by_market=by_market, items=items)
