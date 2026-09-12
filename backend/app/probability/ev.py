"""Expected Value: compara probabilidad real (modelo) vs cuota de mercado,
siempre acompañado de un nivel de confianza/riesgo (nunca solo el EV)."""

from dataclasses import dataclass

from app.db.models import RiskLevel


def compute_ev(prob_model: float, odds: float) -> float:
    """EV fraccional: cuanto se espera ganar/perder por unidad apostada."""
    return prob_model * odds - 1


def compute_confidence(
    matches_used: int,
    bookmaker_agreement: float | None,
    min_matches_for_full_confidence: int = 20,
) -> float:
    """Confianza (0-1) en la estimacion: mitad "cuantos datos respaldan el
    modelo para estos equipos", mitad "cuanto coinciden las casas de apuestas
    entre si" (mercado disperso = precio menos fiable)."""
    data_confidence = min(1.0, matches_used / min_matches_for_full_confidence)
    if bookmaker_agreement is None:
        return round(data_confidence, 3)
    return round(0.5 * data_confidence + 0.5 * bookmaker_agreement, 3)


def compute_risk_level(confidence: float, odds: float) -> RiskLevel:
    """Nivel de riesgo: baja confianza o cuota muy alta (mayor varianza) sube
    el riesgo, aunque el EV puntual sea bueno."""
    if confidence >= 0.66:
        risk = RiskLevel.LOW
    elif confidence >= 0.33:
        risk = RiskLevel.MEDIUM
    else:
        risk = RiskLevel.HIGH

    if odds >= 10.0:
        return RiskLevel.HIGH
    if odds >= 6.0 and risk == RiskLevel.LOW:
        return RiskLevel.MEDIUM

    return risk


@dataclass
class Recommendation:
    prob_market_implied: float
    prob_model: float
    ev: float
    confidence: float
    risk_level: RiskLevel
    is_recommended: bool


def build_recommendation(
    prob_model: float,
    prob_market_implied: float,
    odds: float,
    ev_threshold: float,
    matches_used: int,
    bookmaker_agreement: float | None = None,
    min_confidence_to_recommend: float = 0.3,
) -> Recommendation:
    ev = compute_ev(prob_model, odds)
    confidence = compute_confidence(matches_used, bookmaker_agreement)
    risk_level = compute_risk_level(confidence, odds)
    is_recommended = ev >= ev_threshold and confidence >= min_confidence_to_recommend

    return Recommendation(
        prob_market_implied=prob_market_implied,
        prob_model=prob_model,
        ev=ev,
        confidence=confidence,
        risk_level=risk_level,
        is_recommended=is_recommended,
    )
