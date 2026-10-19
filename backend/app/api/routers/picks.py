import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.core.config import PROJECT_ROOT
from app.db.models import Match, MatchStatus, PickCombo, PickLeg, TeamMatchStats
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


# Indice de predecibilidad: lo precalcula backend/scripts/report_predictability.py
# (protocolo: docs/PREDECIBILIDAD_PROTOCOLO.md). Se relee si el archivo cambia.
PREDICTABILITY_PATH = PROJECT_ROOT / "data" / "model_cache" / "predictability.json"
_predictability_cache: dict = {"mtime": None, "data": None}


@router.get("/predictability")
def get_predictability() -> dict:
    """Modelo final, indice fuera de muestra de cada partido jugado y acierto por
    banda y temporada. Sin calcular todavia: {"available": false}."""
    if not PREDICTABILITY_PATH.exists():
        return {"available": False}
    mtime = PREDICTABILITY_PATH.stat().st_mtime
    if _predictability_cache["mtime"] != mtime:
        _predictability_cache["data"] = json.loads(PREDICTABILITY_PATH.read_text(encoding="utf-8"))
        _predictability_cache["mtime"] = mtime
    return {"available": True, **_predictability_cache["data"]}


# Pick del partido: el historico lo precalcula backend/scripts/report_match_pick.py
# (protocolo: docs/PICK_DEL_PARTIDO_PROTOCOLO.md); los partidos por jugar (o
# jugados despues) se calculan aqui con el mismo codigo, solo con lo anterior.
MATCH_PICK_PATH = PROJECT_ROOT / "data" / "model_cache" / "match_pick.json"
MATCH_PICK_LEAGUES = {"ESP-La Liga", "ESP-La Liga 2", "ENG-Premier League", "FRA-Ligue 1", "GER-Bundesliga", "ITA-Serie A"}
_match_pick_cache: dict = {"mtime": None, "data": None}
# (partido, partidos jugados de su liga) -> pick calculado en vivo
_live_picks: dict[tuple[int, int], dict | None] = {}


def _stored_match_picks() -> dict:
    if not MATCH_PICK_PATH.exists():
        return {"matches": {}, "kinds": {}}
    mtime = MATCH_PICK_PATH.stat().st_mtime
    if _match_pick_cache["mtime"] != mtime:
        _match_pick_cache["data"] = json.loads(MATCH_PICK_PATH.read_text(encoding="utf-8"))
        _match_pick_cache["mtime"] = mtime
    return _match_pick_cache["data"]


def _live_match_picks(db: Session, matches: list[Match]) -> dict[int, dict | None]:
    from app.picks.match_pick import outcome, pick_text
    from app.picks.match_pick_data import run

    out: dict[int, dict | None] = {}
    for league_id in {m.league_id for m in matches}:
        league_matches = [m for m in matches if m.league_id == league_id]
        version = db.query(func.count(Match.id)).filter(Match.league_id == league_id, Match.status == MatchStatus.HISTORICAL).scalar()
        pending = [m for m in league_matches if (m.id, version) not in _live_picks]
        if pending:
            for item in run(db, league_id, {m.id for m in pending}):
                pick = item.pick
                if pick is None:
                    _live_picks[(item.match.match_id, version)] = None
                    continue
                c, hit = pick.candidate, outcome(pick.candidate, item.match)
                _live_picks[(item.match.match_id, version)] = {
                    "text": pick_text(c, item.match.home_team, item.match.away_team),
                    "family": c.family,
                    "side": c.side,
                    "option": c.option,
                    "kind": c.kind,
                    "p": pick.p,
                    "base": pick.base,
                    "n": pick.n,
                    "hit": hit,
                }
        for m in league_matches:
            out[m.id] = _live_picks.get((m.id, version))
    return out


@router.get("/match-pick")
def get_match_picks(match_ids: str = Query(..., max_length=2000), db: Session = Depends(get_db)) -> dict:
    """Pick del partido de cada partido pedido ("1,2,3"), con el acierto
    historico de cada tipo de pick. status: pick | none | uncalibrated."""
    ids = [int(x) for x in match_ids.split(",") if x.strip().isdigit()][:60]
    stored = _stored_match_picks()
    matches = db.query(Match).filter(Match.id.in_(ids)).options(selectinload(Match.league)).all()
    result: dict[str, dict] = {}
    live: list[Match] = []
    for m in matches:
        if m.league.code not in MATCH_PICK_LEAGUES:
            result[str(m.id)] = {"status": "uncalibrated"}
        elif m.status == MatchStatus.HISTORICAL and str(m.id) in stored["matches"]:
            pick = stored["matches"][str(m.id)]
            result[str(m.id)] = {"status": "pick" if pick else "none", "pick": pick, "before_match": True}
        else:
            live.append(m)
    for match_id, pick in _live_match_picks(db, live).items():
        result[str(match_id)] = {"status": "pick" if pick else "none", "pick": pick, "before_match": True}
    return {"matches": result, "kinds": stored.get("kinds", {})}
