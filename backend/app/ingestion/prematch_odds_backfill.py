"""Cuotas pre-partido reales para partidos futuros, via the-odds-api.com.

Sin esto, /matches/{id}/predictions y /recommendations no tienen con que
comparar prob_model para partidos que aun no se han jugado (compute_ev
necesita una cuota real de mercado). Complementa a historical_backfill.py
(que trae cuotas de cierre, pero solo para partidos YA jugados, via
football-data.co.uk).

Convenciones de cuotas reutilizadas de engine.py (ver REFERENCE_BOOKMAKER/
BEST_PRICE_BOOKMAKER/INDIVIDUAL_BOOKMAKERS en app/probability/engine.py): se
calculan "Market Average" (media de las casas devueltas) y "Market Max"
(mejor precio) igual que football-data.co.uk trae precalculado en su CSV,
mas las casas individuales que coinciden con las que ya usa el motor
(Bet365, Pinnacle, William Hill) para el indicador de coincidencia entre
casas. Solo h2h (1x2) y totals (over/under 2.5): btts requiere el plan de
pago de the-odds-api.com, se deja para mas adelante.
"""

import logging
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import IngestionRun, IngestionStatus, League, Match, MatchOdds
from app.ingestion.odds_api_client import LEAGUE_SPORT_KEY_MAP, OddsApiClient
from app.ingestion.team_names import TeamResolver

logger = logging.getLogger(__name__)

KNOWN_BOOKMAKER_TITLES = {"Bet365", "Pinnacle", "William Hill"}

H2H_LINE = None
TOTALS_LINE = 2.5


def _find_match(db: Session, home_team_id: int, away_team_id: int, commence_time: str) -> Match | None:
    day = datetime.fromisoformat(commence_time.replace("Z", "+00:00")).date()
    return (
        db.query(Match)
        .filter(
            Match.home_team_id == home_team_id,
            Match.away_team_id == away_team_id,
            func.date(Match.date) == day,
        )
        .one_or_none()
    )


def _h2h_rows(event: dict) -> list[dict]:
    selection_map = {event["home_team"]: "home", event["away_team"]: "away", "Draw": "draw"}
    per_selection: dict[str, list[tuple[str, float]]] = {"home": [], "draw": [], "away": []}

    for bookmaker in event.get("bookmakers", []):
        for market in bookmaker.get("markets", []):
            if market["key"] != "h2h":
                continue
            for outcome in market.get("outcomes", []):
                selection = selection_map.get(outcome["name"])
                if selection is None:
                    continue
                per_selection[selection].append((bookmaker["title"], float(outcome["price"])))

    return _build_rows("1x2", per_selection, line=H2H_LINE)


def _totals_rows(event: dict) -> list[dict]:
    per_selection: dict[str, list[tuple[str, float]]] = {"over": [], "under": []}

    for bookmaker in event.get("bookmakers", []):
        for market in bookmaker.get("markets", []):
            if market["key"] != "totals":
                continue
            for outcome in market.get("outcomes", []):
                point = outcome.get("point")
                if point is None or float(point) != TOTALS_LINE:
                    continue
                selection = "over" if outcome["name"] == "Over" else "under" if outcome["name"] == "Under" else None
                if selection is None:
                    continue
                per_selection[selection].append((bookmaker["title"], float(outcome["price"])))

    return _build_rows("over_under_2.5", per_selection, line=TOTALS_LINE)


def _build_rows(market: str, per_selection: dict[str, list[tuple[str, float]]], line: float | None) -> list[dict]:
    rows = []
    for selection, prices in per_selection.items():
        if not prices:
            continue
        values = [p for _, p in prices]
        for title, price in prices:
            if title in KNOWN_BOOKMAKER_TITLES:
                rows.append({"bookmaker": title, "market": market, "selection": selection, "odds": price, "line": line})
        rows.append(
            {"bookmaker": "Market Average", "market": market, "selection": selection, "odds": sum(values) / len(values), "line": line}
        )
        rows.append({"bookmaker": "Market Max", "market": market, "selection": selection, "odds": max(values), "line": line})
    return rows


def backfill_prematch_odds(db: Session, settings: Settings, leagues: list[str]) -> IngestionRun:
    run = IngestionRun(source="the_odds_api.prematch_odds", status=IngestionStatus.RUNNING)
    db.add(run)
    db.commit()

    matched = 0
    unmatched_events = 0
    resolver = TeamResolver(db)
    now = datetime.utcnow()

    try:
        with OddsApiClient(settings) as client:
            available_sports = client.list_sport_keys()

            for league_code in leagues:
                sport_key = LEAGUE_SPORT_KEY_MAP.get(league_code)
                if sport_key is None:
                    logger.warning("%s: sin sport key de the-odds-api.com configurado, se omite.", league_code)
                    continue
                if sport_key not in available_sports:
                    logger.warning(
                        "%s: sport key '%s' no existe (o ya no esta activo) en the-odds-api.com, se omite.",
                        league_code,
                        sport_key,
                    )
                    continue

                events = client.get_odds(sport_key)
                for event in events:
                    home = resolver.resolve(event["home_team"])
                    away = resolver.resolve(event["away_team"])
                    if home is None or away is None:
                        unmatched_events += 1
                        continue

                    match = _find_match(db, home.id, away.id, event["commence_time"])
                    if match is None:
                        unmatched_events += 1
                        continue

                    db.query(MatchOdds).filter_by(match_id=match.id).delete()
                    for row in _h2h_rows(event) + _totals_rows(event):
                        db.add(MatchOdds(match_id=match.id, snapshot_time=now, **row))
                    matched += 1

                db.commit()
                logger.info("%s (%s): %d eventos con cuotas", league_code, sport_key, len(events))

        run.status = IngestionStatus.SUCCESS
        run.rows_ingested = matched
        run.notes = (
            f"equipos_no_resueltos={sorted(resolver.unresolved)} eventos_sin_partido={unmatched_events}"
        )[:2000]
        run.finished_at = datetime.utcnow()
        db.commit()
        logger.info(
            "the-odds-api prematch odds: %d partidos actualizados, %d eventos sin match, equipos no resueltos: %s",
            matched,
            unmatched_events,
            sorted(resolver.unresolved),
        )
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        run.status = IngestionStatus.FAILED
        run.notes = str(exc)[:2000]
        run.finished_at = datetime.utcnow()
        db.commit()
        raise

    return run
