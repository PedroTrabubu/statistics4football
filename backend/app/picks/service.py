"""Orquestacion DB de los picks: generar la proxima jornada, guardar y resolver."""

from datetime import datetime

from sqlalchemy.orm import Session

from app.db.models import League, Match, MatchStatus, PickCombo, PickLeg, TeamMatchStats
from app.picks.combos import TIERS, Combo, build_same_match_combo, build_tier_combo
from app.picks.count_model import STATS, CountTracker
from app.picks.engine import PATTERN_TO_LEG, PicksParams, market_goals, window_key
from app.picks.legs import Leg, match_legs, resolve_leg
from app.probability.engine import get_cached_league_model
from app.probability.pattern_engine import build_tracker, pattern_features, prematch_odds
from app.probability.pattern_model import load_params as load_pattern_params

SCOPE_ALL = "todas"
SCOPE_SAME_MATCH = "mismo_partido"


def delete_combos(db: Session, **filters) -> None:
    """Borra combinadas y sus selecciones.

    SQLite no aplica el ON DELETE CASCADE sin activar las claves foraneas, y
    reutiliza los ids borrados: si se borran solo las combinadas, sus
    selecciones quedan huerfanas y se "pegan" a la siguiente combinada que
    reciba el mismo id. Por eso se borran primero las selecciones, y de paso
    cualquier huerfana que quedara de antes."""
    ids = [cid for (cid,) in db.query(PickCombo.id).filter_by(**filters)]
    if ids:
        db.query(PickLeg).filter(PickLeg.combo_id.in_(ids)).delete(synchronize_session=False)
        db.query(PickCombo).filter(PickCombo.id.in_(ids)).delete(synchronize_session=False)
    db.query(PickLeg).filter(~PickLeg.combo_id.in_(db.query(PickCombo.id))).delete(synchronize_session=False)


def save_combos(db: Session, source: str, window: str, combos: list[tuple[str, Combo]]) -> None:
    for scope, combo in combos:
        db.add(
            PickCombo(
                source=source,
                window=window,
                scope=scope,
                kind=combo.kind,
                prob=combo.prob,
                odds=combo.odds,
                odds_kind=combo.odds_kind,
                legs=[
                    PickLeg(
                        match_id=l.match_id,
                        market=l.market,
                        selection=l.selection,
                        line=l.line,
                        family=l.family,
                        prob=l.prob,
                        odds=l.odds,
                        odds_kind=l.odds_kind,
                    )
                    for l in combo.legs
                ],
            )
        )


def build_window_combos(
    legs_by_match: dict[int, tuple], league_of: dict[int, str]
) -> list[tuple[str, Combo]]:
    """legs_by_match: {match_id: (MatchDistributions, patas mismo partido, patas niveles)}.
    Mismas reglas que el backtest."""
    combos: list[tuple[str, Combo]] = []
    all_legs: list[Leg] = []
    for dist, same_legs, tier_legs in legs_by_match.values():
        all_legs += tier_legs
        same = build_same_match_combo(dist, same_legs)
        if same:
            combos.append((SCOPE_SAME_MATCH, same))
    for scope in [SCOPE_ALL, *sorted(set(league_of.values()))]:
        scoped = [l for l in all_legs if scope == SCOPE_ALL or league_of[l.match_id] == scope]
        for tier in TIERS:
            combo = build_tier_combo(scoped, tier)
            if combo:
                combos.append((scope, combo))
    return combos


def _count_trackers(db: Session, league_id: int) -> dict[str, CountTracker]:
    trackers = {stat: CountTracker() for stat in STATS}
    matches = (
        db.query(Match)
        .filter(Match.league_id == league_id, Match.status == MatchStatus.HISTORICAL)
        .order_by(Match.date.asc(), Match.id.asc())
        .all()
    )
    stats = {
        (s.match_id, s.team_id): s
        for s in db.query(TeamMatchStats).filter(TeamMatchStats.match_id.in_([m.id for m in matches]))
    }
    for m in matches:
        hs, as_ = stats.get((m.id, m.home_team_id)), stats.get((m.id, m.away_team_id))
        if not (hs and as_):
            continue
        if hs.corners_for is not None and as_.corners_for is not None:
            trackers["corners"].add(m.home_team_id, m.away_team_id, hs.corners_for, as_.corners_for)
        if hs.yellow_cards is not None and as_.yellow_cards is not None:
            trackers["yellow"].add(m.home_team_id, m.away_team_id, hs.yellow_cards, as_.yellow_cards)
    return trackers


def next_window_matches(db: Session, now: datetime | None = None) -> tuple[str | None, list[Match]]:
    """Partidos programados de la proxima jornada (ventana martes-lunes del primer partido por jugar)."""
    now = now or datetime.utcnow()  # la base guarda UTC
    upcoming = (
        db.query(Match)
        .filter(Match.status == MatchStatus.SCHEDULED, Match.date >= now)
        .order_by(Match.date.asc())
        .all()
    )
    if not upcoming:
        return None, []
    window = window_key(upcoming[0].date)
    return window, [m for m in upcoming if window_key(m.date) == window]


def _pattern_overrides(db: Session, matches: list[Match]) -> dict[int, dict]:
    """Probabilidades del modelo de patrones para las patas de goles (v3, opcion B)."""
    pattern_params = load_pattern_params()
    if pattern_params is None:
        return {}
    trackers = {lid: build_tracker(db, lid, before=datetime.utcnow()) for lid in {m.league_id for m in matches}}
    out: dict[int, dict] = {}
    for m in matches:
        dc_model = get_cached_league_model(db, m.league_id, as_of_date=m.date)
        computed = pattern_features(db, m, dc_model, trackers[m.league_id])
        if computed is None:
            continue
        probs = pattern_params.predict(computed[0])
        out[m.id] = {PATTERN_TO_LEG[k]: p for k, p in probs.items()}
    return out


def generate_live_picks(db: Session, params: PicksParams, now: datetime | None = None) -> tuple[str | None, int]:
    """Regenera las combinadas "live" de la proxima jornada. Devuelve (jornada, nº combinadas)."""
    window, matches = next_window_matches(db, now)
    if window is None:
        return None, 0

    league_code = {l.id: l.code for l in db.query(League).all()}
    trackers = {lid: _count_trackers(db, lid) for lid in {m.league_id for m in matches}}
    excluded = set(params.excluded_families)

    pattern_overrides = _pattern_overrides(db, matches) if params.use_pattern_probs else {}

    legs_by_match: dict[int, tuple] = {}
    for m in matches:
        odds = prematch_odds(db, m.id)
        features = {stat: trackers[m.league_id][stat].features(m.home_team_id, m.away_team_id) for stat in STATS}
        dist = params.distributions(m.id, odds, features, market_goals(odds))
        legs_by_match[m.id] = (
            dist,
            match_legs(dist, excluded),
            match_legs(dist, excluded, params.tier_min_prob, pattern_overrides.get(m.id)),
        )

    combos = build_window_combos(legs_by_match, {m.id: league_code[m.league_id] for m in matches})
    delete_combos(db, source="live", window=window)
    save_combos(db, "live", window, combos)
    db.commit()
    return window, len(combos)


# --- resolucion --------------------------------------------------------------


def leg_outcome(leg: PickLeg, stats: dict[tuple[int, int], TeamMatchStats]) -> bool | None:
    m = leg.match
    if m.status != MatchStatus.HISTORICAL or m.home_goals is None or m.away_goals is None:
        return None
    hs, as_ = stats.get((m.id, m.home_team_id)), stats.get((m.id, m.away_team_id))
    corners = (hs.corners_for, as_.corners_for) if hs and as_ else None
    yellow = (hs.yellow_cards, as_.yellow_cards) if hs and as_ else None
    return resolve_leg(leg.market, leg.selection, leg.line, (m.home_goals, m.away_goals), corners, yellow)


def combo_outcome(leg_results: list[bool | None]) -> bool | None:
    """Falla en cuanto falla una pata; acierta solo si aciertan todas."""
    if any(r is False for r in leg_results):
        return False
    return None if any(r is None for r in leg_results) else True


def stats_for_matches(db: Session, match_ids: list[int]) -> dict[tuple[int, int], TeamMatchStats]:
    return {(s.match_id, s.team_id): s for s in db.query(TeamMatchStats).filter(TeamMatchStats.match_id.in_(match_ids))}
