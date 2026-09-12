"""Orquestacion DB: ajusta Dixon-Coles por liga y genera predicciones/EV
para un partido concreto, usando las cuotas reales ya ingeridas.

Convenciones de cuotas usadas aqui:
- "Market Average" (ya vig-stripped con Shin) como referencia de la
  probabilidad "real" de mercado: es un consenso de varias casas, mas
  estable que una sola.
- "Market Max" como precio al que realmente se apostaria (el mejor precio
  disponible entre las casas trackeadas), usado para calcular el EV.
- Bet365/Bet&Win/Pinnacle/William Hill/VC Bet (individuales, no de cierre)
  para medir cuanto coinciden las casas entre si (bookmaker_agreement).
"""

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.db.models import Match, MatchOdds, MatchStatus, ModelPrediction
from app.probability.ev import build_recommendation
from app.probability.market import bookmaker_agreement, implied_probabilities_shin
from app.probability.poisson_model import DixonColesModel, MatchResult, fit_dixon_coles
from app.probability.score_markets import (
    probabilities_1x2,
    probabilities_asian_handicap,
    probabilities_over_under,
)

REFERENCE_BOOKMAKER = "Market Average"
BEST_PRICE_BOOKMAKER = "Market Max"
INDIVIDUAL_BOOKMAKERS = ["Bet365", "Bet&Win", "Pinnacle", "William Hill", "VC Bet"]

ONEXTWO_SELECTIONS = ["home", "draw", "away"]
OU25_SELECTIONS = ["over", "under"]
AH_SELECTIONS = ["home", "away"]

MODEL_VERSION = "dixon_coles_v1"


def load_league_matches(
    db: Session,
    league_id: int,
    before_date: datetime | None = None,
    max_age_days: int | None = 1100,
) -> list[MatchResult]:
    """Partidos historicos de una liga, opcionalmente acotados a una ventana.

    max_age_days (~3 temporadas por defecto): un equipo sin ningun partido
    dentro de la ventana queda fuera del ajuste por completo (tratado luego
    como "sin historico", ver DixonColesModel.expected_goals) en vez de
    quedar dentro con un puñado de partidos muy antiguos y un peso casi nulo
    por el decaimiento temporal, lo que puede dejar su parametro mal
    determinado. Pasar None para no acotar (usar todo el historico
    disponible, solo con decaimiento temporal).
    """
    query = db.query(Match).filter(
        Match.league_id == league_id,
        Match.status == MatchStatus.HISTORICAL,
        Match.home_goals.is_not(None),
        Match.away_goals.is_not(None),
    )
    if before_date is not None:
        query = query.filter(Match.date < before_date)
        if max_age_days is not None:
            query = query.filter(Match.date >= before_date - timedelta(days=max_age_days))

    return [
        MatchResult(
            home_team_id=m.home_team_id,
            away_team_id=m.away_team_id,
            home_goals=m.home_goals,
            away_goals=m.away_goals,
            date=m.date,
        )
        for m in query.all()
    ]


def fit_league_model(
    db: Session,
    league_id: int,
    before_date: datetime | None = None,
    xi: float = 0.0018,
    max_age_days: int | None = 1100,
) -> DixonColesModel:
    matches = load_league_matches(db, league_id, before_date=before_date, max_age_days=max_age_days)
    return fit_dixon_coles(matches, xi=xi, as_of=before_date)


_model_cache: dict[tuple[int, str], DixonColesModel] = {}


def get_cached_league_model(db: Session, league_id: int, as_of_date: datetime) -> DixonColesModel:
    """Ajusta (o reutiliza) el modelo de una liga para una fecha dada.

    Cache en memoria de proceso, una entrada por (liga, dia): ajustar
    Dixon-Coles tarda varios segundos, no tiene sentido repetirlo en cada
    request para partidos del mismo dia. Se pierde al reiniciar el proceso;
    suficiente para esta fase (sin workers/Redis todavia).
    """
    key = (league_id, as_of_date.date().isoformat())
    if key not in _model_cache:
        _model_cache[key] = fit_league_model(db, league_id, before_date=as_of_date)
    return _model_cache[key]


def _odds_map(db: Session, match_id: int, market: str, bookmaker: str) -> dict[str, MatchOdds]:
    rows = db.query(MatchOdds).filter_by(match_id=match_id, market=market, bookmaker=bookmaker).all()
    return {r.selection: r for r in rows}


def _individual_odds(db: Session, match_id: int, market: str, selection: str) -> list[float]:
    rows = (
        db.query(MatchOdds.odds)
        .filter(
            MatchOdds.match_id == match_id,
            MatchOdds.market == market,
            MatchOdds.selection == selection,
            MatchOdds.bookmaker.in_(INDIVIDUAL_BOOKMAKERS),
        )
        .all()
    )
    return [r[0] for r in rows]


def _sane_price(candidate: float, individual_odds: list[float], max_ratio: float = 1.8) -> float:
    """Corrige precios agregados (Market Average/Max) que se disparan
    respecto a lo que muestran las casas individuales trackeadas.

    football-data.co.uk trae de vez en cuando un valor claramente erroneo en
    estas columnas agregadas (visto en handicap asiatico: "Market Max" de
    22.0 cuando Bet365/Pinnacle marcaban ~1.9 para la misma seleccion). Sin
    este filtro, un solo dato corrupto de la fuente puede generar un EV
    absurdo. Si no hay casas individuales con las que comparar, se deja el
    precio tal cual (no hay forma de detectar el error).
    """
    if not individual_odds:
        return candidate
    ceiling = max(individual_odds) * max_ratio
    return candidate if candidate <= ceiling else max(individual_odds)


def _build_predictions_for_market(
    db: Session,
    match: Match,
    market: str,
    selections: list[str],
    model_probs: dict[str, float],
    ev_threshold: float,
    matches_used: int,
) -> list[ModelPrediction]:
    reference = _odds_map(db, match.id, market, REFERENCE_BOOKMAKER)
    best_price = _odds_map(db, match.id, market, BEST_PRICE_BOOKMAKER)

    ordered_selections = [s for s in selections if s in reference]
    if len(ordered_selections) < 2:
        return []

    individual_odds_by_selection = {
        s: _individual_odds(db, match.id, market, s) for s in ordered_selections
    }

    reference_prices = [
        _sane_price(reference[s].odds, individual_odds_by_selection[s]) for s in ordered_selections
    ]
    market_probs = dict(
        zip(ordered_selections, implied_probabilities_shin(reference_prices), strict=True)
    )

    predictions = []
    for selection in ordered_selections:
        individual_odds = individual_odds_by_selection[selection]
        candidate_price = (best_price.get(selection) or reference[selection]).odds
        price = _sane_price(candidate_price, individual_odds)
        agreement = bookmaker_agreement(individual_odds)

        rec = build_recommendation(
            prob_model=model_probs[selection],
            prob_market_implied=market_probs[selection],
            odds=price,
            ev_threshold=ev_threshold,
            matches_used=matches_used,
            bookmaker_agreement=agreement,
        )
        predictions.append(
            ModelPrediction(
                match_id=match.id,
                model_version=MODEL_VERSION,
                market=market,
                selection=selection,
                prob_market_implied=rec.prob_market_implied,
                prob_model=rec.prob_model,
                ev=rec.ev,
                confidence=rec.confidence,
                risk_level=rec.risk_level,
                is_recommended=rec.is_recommended,
            )
        )
    return predictions


def generate_predictions_for_match(
    db: Session, match: Match, model: DixonColesModel, ev_threshold: float
) -> list[ModelPrediction]:
    matrix = model.score_matrix(match.home_team_id, match.away_team_id)
    matches_used = min(
        model.matches_played.get(match.home_team_id, 0),
        model.matches_played.get(match.away_team_id, 0),
    )

    predictions = list(
        _build_predictions_for_market(
            db,
            match,
            "1x2",
            ONEXTWO_SELECTIONS,
            probabilities_1x2(matrix),
            ev_threshold,
            matches_used,
        )
    )

    if _odds_map(db, match.id, "over_under_2.5", REFERENCE_BOOKMAKER):
        predictions += _build_predictions_for_market(
            db,
            match,
            "over_under_2.5",
            OU25_SELECTIONS,
            probabilities_over_under(matrix, 2.5),
            ev_threshold,
            matches_used,
        )

    ah_ref = _odds_map(db, match.id, "asian_handicap", REFERENCE_BOOKMAKER)
    if ah_ref:
        line = next(iter(ah_ref.values())).line
        predictions += _build_predictions_for_market(
            db,
            match,
            "asian_handicap",
            AH_SELECTIONS,
            probabilities_asian_handicap(matrix, line),
            ev_threshold,
            matches_used,
        )

    db.query(ModelPrediction).filter_by(match_id=match.id, model_version=MODEL_VERSION).delete()
    db.add_all(predictions)
    db.flush()
    return predictions
