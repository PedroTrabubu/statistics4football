from app.db.models import Match
from app.probability.outcomes import realized_pnl_units, resolve_selection


def _match(home_goals: int | None, away_goals: int | None) -> Match:
    return Match(home_goals=home_goals, away_goals=away_goals)


def test_1x2_resolves_each_selection():
    m = _match(2, 1)
    assert resolve_selection(m, "1x2", "home") is True
    assert resolve_selection(m, "1x2", "away") is False
    assert resolve_selection(m, "1x2", "draw") is False


def test_1x2_draw():
    m = _match(1, 1)
    assert resolve_selection(m, "1x2", "draw") is True
    assert resolve_selection(m, "1x2", "home") is False


def test_over_under_2_5():
    assert resolve_selection(_match(2, 1), "over_under_2.5", "over") is True
    assert resolve_selection(_match(2, 1), "over_under_2.5", "under") is False
    assert resolve_selection(_match(1, 1), "over_under_2.5", "under") is True


def test_btts():
    assert resolve_selection(_match(1, 1), "btts", "yes") is True
    assert resolve_selection(_match(1, 1), "btts", "no") is False
    assert resolve_selection(_match(2, 0), "btts", "yes") is False
    assert resolve_selection(_match(2, 0), "btts", "no") is True


def test_unplayed_match_is_none():
    assert resolve_selection(_match(None, None), "1x2", "home") is None


def test_unsupported_market_is_none():
    # Handicap asiatico: requiere resolver push, deliberadamente no soportado.
    assert resolve_selection(_match(2, 1), "asian_handicap", "home") is None


def test_realized_pnl_recovers_price_from_ev():
    # prob_model=0.25, ev=+0.25 -> price=(0.25+1)/0.25=5.0
    assert realized_pnl_units(prob_model=0.25, ev=0.25, won=True) == 4.0
    assert realized_pnl_units(prob_model=0.25, ev=0.25, won=False) == -1.0


def test_realized_pnl_none_when_unresolved_or_no_ev():
    assert realized_pnl_units(prob_model=0.5, ev=0.1, won=None) is None
    assert realized_pnl_units(prob_model=0.5, ev=None, won=True) is None


def test_referee_short_name_matches_match_history_format() -> None:
    from app.ingestion.fixtures_backfill import referee_short_name

    assert referee_short_name("Anthony Taylor") == "A Taylor"
    assert referee_short_name("Manuel Orellana Cid") == "M Orellana Cid"
    assert referee_short_name("Taylor") == "Taylor"
