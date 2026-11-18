"""Alta probabilidad en el programador: solo los partidos que aun no han empezado."""

from datetime import datetime

from app.core.config import get_settings
from app.db.models import Match, MatchStatus
from app.db.session import SessionLocal
from app.probability import pattern_refresh


def test_only_matches_not_started_are_refreshed(monkeypatch) -> None:
    seen: list[Match] = []
    monkeypatch.setattr(pattern_refresh, "load_params", lambda: {"fake": True})
    monkeypatch.setattr(pattern_refresh, "build_tracker", lambda db, league_id, before: None)
    monkeypatch.setattr(pattern_refresh, "get_cached_league_model", lambda db, league_id, as_of_date: None)
    monkeypatch.setattr(
        pattern_refresh,
        "generate_pattern_predictions_for_match",
        lambda db, match, model, tracker, params: seen.append(match) or True,
    )
    with SessionLocal() as db:
        scheduled = db.query(Match).filter(Match.status == MatchStatus.SCHEDULED).order_by(Match.date).all()
        if len(scheduled) < 2:
            return
        # Un "ahora" en mitad de los programados: los de antes cuentan como empezados.
        now = scheduled[len(scheduled) // 2].date
        summary = pattern_refresh.refresh_predictions(db, get_settings(), now=now)
        leagues = set(get_settings().pattern_leagues)
        assert seen and all(m.date > now and m.status == MatchStatus.SCHEDULED for m in seen)
        assert all(m.league.code in leagues for m in seen)
        assert summary.matches == len(seen) == summary.with_odds
