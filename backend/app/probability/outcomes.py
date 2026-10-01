"""Resuelve si una seleccion de un mercado acerto, dado el resultado real de
un partido ya jugado. Logica compartida entre scripts/generate_predictions.py
(backtest) y el endpoint de historico de recomendaciones — una sola fuente de
verdad para "gano o no gano esta seleccion"."""

from app.db.models import Match


def resolve_selection(match: Match, market: str, selection: str) -> bool | None:
    """None = no se puede resolver: partido no jugado, o mercado/seleccion no
    soportados aqui (handicap asiatico: requiere resolver push, se omite)."""
    if match.home_goals is None or match.away_goals is None:
        return None

    home, away = match.home_goals, match.away_goals
    total_goals = home + away

    if market == "1x2":
        if selection == "home":
            return home > away
        if selection == "away":
            return home < away
        if selection == "draw":
            return home == away
    if market == "double_chance":
        if selection == "1X":
            return home >= away
        if selection == "X2":
            return home <= away
        if selection == "12":
            return home != away
    if market in ("over_under_1.5", "over_under_2.5", "over_under_3.5"):
        line = float(market.rsplit("_", 1)[1])
        if selection == "over":
            return total_goals > line
        if selection == "under":
            return total_goals < line
    if market == "team_scores":
        if selection == "home":
            return home > 0
        if selection == "away":
            return away > 0
    if market == "btts":
        both_scored = home > 0 and away > 0
        if selection == "yes":
            return both_scored
        if selection == "no":
            return not both_scored
    return None


def realized_pnl_units(prob_model: float, ev: float | None, won: bool | None, stake: float = 1.0) -> float | None:
    """PnL en unidades de stake para una seleccion ya resuelta. Recupera la
    cuota realmente usada en el calculo de EV invirtiendo la formula de
    app/probability/ev.py::compute_ev (ev = prob_model*price - 1, luego
    price = (ev+1)/prob_model) en vez de tener que guardar la cuota aparte.

    None si la seleccion no esta resuelta (partido no jugado / mercado no
    soportado por resolve_selection) o no hay EV (partido sin cuotas
    ingeridas: nunca se calcula un PnL sin una cuota real de por medio)."""
    if won is None or ev is None or not prob_model:
        return None
    price = (ev + 1) / prob_model
    return stake * ((price - 1) if won else -1.0)
