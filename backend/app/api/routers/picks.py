from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.db.models import PickCombo, PickLeg, TeamMatchStats
from app.db.session import get_db
from app.picks.combos import TIERS
from app.picks.legs import LEG_DEF_BY_KEY
from app.picks.service import SCOPE_ALL, SCOPE_SAME_MATCH, combo_outcome, leg_outcome, stats_for_matches
from app.schemas.pick import PickComboOut, PickKindSummary, PickLegOut, PicksHistoryOut, PicksUpcomingOut

router = APIRouter(prefix="/picks", tags=["picks"])

KIND_ORDER = [t.key for t in TIERS] + [SCOPE_SAME_MATCH]


def _outcome_label(won: bool | None) -> str:
    return "pending" if won is None else ("won" if won else "lost")


def _actual(leg: PickLeg, stats: dict[tuple[int, int], TeamMatchStats]) -> str | None:
    m = leg.match
    if m.home_goals is None or m.away_goals is None:
        return None
    component = LEG_DEF_BY_KEY[(leg.market, leg.selection, leg.line)].component
    if component == "goals":
        return f"{m.home_goals}-{m.away_goals}"
    hs, as_ = stats.get((m.id, m.home_team_id)), stats.get((m.id, m.away_team_id))
    if not (hs and as_):
        return None
    field = "corners_for" if component == "corners" else "yellow_cards"
    home, away = getattr(hs, field), getattr(as_, field)
    return None if home is None or away is None else f"{home}-{away}"


def _combo_out(combo: PickCombo, stats: dict) -> tuple[PickComboOut, bool | None]:
    legs, results = [], []
    for leg in combo.legs:
        won = leg_outcome(leg, stats)
        results.append(won)
        m = leg.match
        legs.append(
            PickLegOut(
                match_id=m.id,
                date=m.date,
                league_code=m.league.code,
                matchday=m.matchday,
                home_team=m.home_team.name,
                away_team=m.away_team.name,
                market=leg.market,
                selection=leg.selection,
                line=leg.line,
                family=leg.family,
                prob=leg.prob,
                odds=leg.odds,
                odds_kind=leg.odds_kind,
                outcome=_outcome_label(won),
                actual=_actual(leg, stats),
            )
        )
    won = combo_outcome(results)
    out = PickComboOut(
        id=combo.id,
        source=combo.source,
        window=combo.window,
        scope=combo.scope,
        kind=combo.kind,
        prob=combo.prob,
        odds=combo.odds,
        odds_kind=combo.odds_kind,
        outcome=_outcome_label(won),
        legs=legs,
    )
    return out, won


def _scope_filter(combos: list[PickCombo], scope: str | None) -> list[PickCombo]:
    """Sin liga: combinadas mezcladas + todas las del mismo partido. Con liga:
    las de esa liga + las del mismo partido de sus partidos."""
    if scope is None:
        return [c for c in combos if c.scope in (SCOPE_ALL, SCOPE_SAME_MATCH)]
    return [
        c
        for c in combos
        if c.scope == scope or (c.scope == SCOPE_SAME_MATCH and c.legs[0].match.league.code == scope)
    ]


def _load(db: Session, **filters) -> list[PickCombo]:
    return (
        db.query(PickCombo)
        .filter_by(**filters)
        .options(selectinload(PickCombo.legs).selectinload(PickLeg.match))
        .all()
    )


def _sort_key(c: PickComboOut) -> tuple:
    first = min(l.date for l in c.legs)
    return (KIND_ORDER.index(c.kind) if c.kind in KIND_ORDER else 99, first)


@router.get("", response_model=PicksUpcomingOut)
def upcoming_picks(league: str | None = None, db: Session = Depends(get_db)) -> PicksUpcomingOut:
    """Combinadas de la proxima jornada (generadas por scripts/refresh_picks.py)."""
    window = db.query(func.max(PickCombo.window)).filter(PickCombo.source == "live").scalar()
    if window is None:
        return PicksUpcomingOut(window=None, combos=[])
    combos = _scope_filter(_load(db, source="live", window=window), league)
    stats = stats_for_matches(db, [l.match_id for c in combos for l in c.legs])
    outs = sorted((_combo_out(c, stats)[0] for c in combos), key=_sort_key)
    return PicksUpcomingOut(window=window, combos=outs)


@router.get("/history", response_model=PicksHistoryOut)
def picks_history(
    league: str | None = None,
    kind: str | None = None,
    limit: int = Query(60, le=500),
    db: Session = Depends(get_db),
) -> PicksHistoryOut:
    """Combinadas pasadas con su resultado real: las del test fuera de muestra
    (25/26 y 26/27) y las de jornadas ya jugadas. Nunca se ocultan los fallos."""
    latest_live = db.query(func.max(PickCombo.window)).filter(PickCombo.source == "live").scalar()
    combos = _load(db)
    # La jornada "live" en curso no es historico todavia.
    combos = [c for c in combos if not (c.source == "live" and c.window == latest_live)]
    combos = _scope_filter(combos, league)
    if kind is not None:
        combos = [c for c in combos if c.kind == kind]

    stats = stats_for_matches(db, [l.match_id for c in combos for l in c.legs])
    resolved = [_combo_out(c, stats) for c in combos]

    summary = []
    for k in KIND_ORDER:
        rows = [(c, w) for c, w in resolved if c.kind == k]
        if not rows:
            continue
        settled = [(c, w) for c, w in rows if w is not None]
        won = sum(1 for _, w in settled if w)
        pnl = sum((c.odds - 1) if w else -1 for c, w in settled)
        summary.append(
            PickKindSummary(
                kind=k,
                total=len(rows),
                won=won,
                lost=len(settled) - won,
                pending=len(rows) - len(settled),
                hit_rate=round(100 * won / len(settled), 1) if settled else None,
                predicted_hit_rate=round(100 * sum(c.prob for c, _ in settled) / len(settled), 1) if settled else None,
                avg_odds=round(sum(c.odds for c, _ in settled) / len(settled), 2) if settled else None,
                roi_shown_odds=round(100 * pnl / len(settled), 1) if settled else None,
            )
        )

    items = sorted((c for c, _ in resolved), key=lambda c: (c.window, -KIND_ORDER.index(c.kind)), reverse=True)
    return PicksHistoryOut(summary=summary, combos=items[:limit])
