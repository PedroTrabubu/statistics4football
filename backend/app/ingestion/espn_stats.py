"""Estadísticas provisionales de los partidos recién jugados, de ESPN.

Football-Data.co.uk publica córners, tarjetas, faltas y tiros un par de veces
por semana; ESPN los tiene al acabar el partido (boxscore del resumen). Aquí
solo se rellenan los partidos jugados en los últimos días que aún no los
tienen. Cuando llega el CSV de Football-Data, sus valores los sustituyen
(historical_backfill escribe todos los campos), y sigue siendo la referencia.

Comprobado el 2026-10-13: en 12 partidos, córners y amarillas coinciden con
Football-Data en 11 y faltas y tiros en los 12.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import IngestionRun, IngestionStatus, League, Match, MatchStatus, Season, TeamMatchStats
from app.ingestion.espn import CACHE_DIR, EspnClient, _JsonLinesCache, _resolve, espn_code
from app.ingestion.historical_backfill import _upsert_team_match_stats
from app.ingestion.team_names import TeamResolver

logger = logging.getLogger(__name__)

LOOK_BACK = timedelta(days=10)
# Estadística de ESPN -> campo de team_match_stats.
ESPN_FIELDS = {
    "wonCorners": "corners_for",
    "yellowCards": "yellow_cards",
    "redCards": "red_cards",
    "foulsCommitted": "fouls",
    "totalShots": "shots",
    "shotsOnTarget": "shots_on_target",
}


def parse_boxscore(summary: dict) -> dict[str, dict[str, int]] | None:
    """{"home": {"corners_for": 8, ...}, "away": {...}} del resumen de ESPN, o
    None si le faltan los córners de algún equipo (aún no hay estadísticas)."""
    out: dict[str, dict[str, int]] = {}
    for team in (summary.get("boxscore") or {}).get("teams") or []:
        side = team.get("homeAway")
        if side not in ("home", "away"):
            continue
        values = {}
        for stat in team.get("statistics") or []:
            field = ESPN_FIELDS.get(stat.get("name"))
            try:
                if field:
                    values[field] = int(float(stat.get("displayValue")))
            except (TypeError, ValueError):
                continue
        out[side] = values
    if not all("corners_for" in out.get(side, {}) for side in ("home", "away")):
        return None
    return out


def missing_stats(db: Session, leagues: list[str], now: datetime) -> list[tuple[Match, str]]:
    """Partidos jugados en los últimos días, enlazados con ESPN y sin córners."""
    complete = (
        db.query(TeamMatchStats.match_id)
        .filter(TeamMatchStats.corners_for.is_not(None))
        .group_by(TeamMatchStats.match_id)
        .having(func.count() >= 2)
    )
    rows = (
        db.query(Match, League.code)
        .join(League, League.id == Match.league_id)
        .filter(
            League.code.in_(leagues),
            Match.status == MatchStatus.HISTORICAL,
            Match.date.between(now - LOOK_BACK, now),
            Match.id.not_in(complete),
        )
        .all()
    )
    return [(m, code) for m, code in rows if (m.source_ids or {}).get("espn_event_id")]


def fill_stats_from_espn(db: Session, leagues: list[str], now: datetime | None = None) -> IngestionRun:
    now = now or datetime.utcnow()
    run = IngestionRun(source="espn.stats", status=IngestionStatus.RUNNING)
    db.add(run)
    db.commit()
    filled = waiting = 0
    try:
        targets = missing_stats(db, leagues, now)
        with EspnClient() as client:
            for match, code in targets:
                league = espn_code(code)
                if league is None:
                    continue
                stats = parse_boxscore(client._get(f"{league}/summary", {"event": match.source_ids["espn_event_id"]}))
                if stats is None:
                    waiting += 1
                    continue
                for side, team_id, rival in (("home", match.home_team_id, "away"), ("away", match.away_team_id, "home")):
                    _upsert_team_match_stats(
                        db, match.id, team_id, corners_against=stats[rival]["corners_for"], **stats[side]
                    )
                filled += 1
        db.commit()
        run.status = IngestionStatus.SUCCESS
        run.rows_ingested = filled
        run.notes = f"partidos_sin_estadisticas={len(targets)} rellenados={filled} sin_datos_en_espn={waiting}"
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        run.status = IngestionStatus.FAILED
        run.notes = str(exc)[:2000]
    run.finished_at = datetime.utcnow()
    db.commit()
    return run


# --- Correcciones: errores claros de Football-Data -------------------------------
#
# Comparación del 2026-10-13 (scripts/compare_stats_sources.py, 1780 partidos):
# córners, faltas, tiros y rojas coinciden en un 97-99 %; las amarillas en un
# 94 %, sobre todo por cómo cuenta cada fuente en España y Francia (no se
# toca). Lo que sí son errores: partidos con cero tarjetas en los dos equipos
# que ESPN sí tiene (9 de 37) y datos que faltan. Solo eso se corrige.

CARD_FIELDS = ("yellow_cards", "red_cards")
BOXSCORE_CACHE = "boxscores.jsonl"


def _zero_cards(home: TeamMatchStats, away: TeamMatchStats) -> bool:
    return all(getattr(s, f) == 0 for s in (home, away) for f in CARD_FIELDS)


def _missing(stats: TeamMatchStats) -> bool:
    return any(getattr(stats, f) is None for f in ESPN_FIELDS.values())


def corrections(home: TeamMatchStats, away: TeamMatchStats, box: dict[str, dict[str, int]]) -> list[tuple[str, str, int | None, int]]:
    """(lado, campo, antes, después) a cambiar: datos que faltan y, si
    Football-Data da cero tarjetas a los dos, las tarjetas de ESPN."""
    zero = _zero_cards(home, away)
    out = []
    for side, stats in (("home", home), ("away", away)):
        for field in ESPN_FIELDS.values():
            old, new = getattr(stats, field), box.get(side, {}).get(field)
            if new is None or old == new:
                continue
            if old is None or (zero and field in CARD_FIELDS):
                out.append((side, field, old, new))
    return out


def correct_stats_from_espn(db: Session, leagues: list[str], seasons: list[str]) -> IngestionRun:
    """Corrige con ESPN los errores claros de Football-Data en esas temporadas
    (después de cada carga del CSV, que vuelve a escribir sus valores)."""
    run = IngestionRun(source="espn.corrections", status=IngestionStatus.RUNNING)
    db.add(run)
    db.commit()
    fixed: list[str] = []
    try:
        rows = (
            db.query(Match, League.code)
            .join(League, League.id == Match.league_id)
            .join(Season, Season.id == Match.season_id)
            .filter(League.code.in_(leagues), Season.name.in_(seasons), Match.status == MatchStatus.HISTORICAL)
            .all()
        )
        stats = {
            (s.match_id, s.team_id): s
            for s in db.query(TeamMatchStats).filter(TeamMatchStats.match_id.in_([m.id for m, _ in rows]))
        }
        targets = []
        for m, code in rows:
            h, a = stats.get((m.id, m.home_team_id)), stats.get((m.id, m.away_team_id))
            if h and a and h.corners_for is not None and (_zero_cards(h, a) or _missing(h) or _missing(a)):
                targets.append((m, code, h, a))
        cache = _JsonLinesCache(CACHE_DIR / BOXSCORE_CACHE)
        resolver = TeamResolver(db)
        with EspnClient() as client:
            for m, code, h, a in targets:
                league = espn_code(code)
                event = (m.source_ids or {}).get("espn_event_id")
                if not event and league:
                    for e in client.day_events(league, m.date.date(), cacheable=True):
                        home, away = _resolve(resolver, e.home_names), _resolve(resolver, e.away_names)
                        if home and away and (home.id, away.id) == (m.home_team_id, m.away_team_id):
                            event = e.id
                if not event or not league:
                    continue
                key = f"{code}|{event}"
                if key in cache:
                    box = cache.get(key)
                else:
                    box = parse_boxscore(client._get(f"{league}/summary", {"event": event}))
                    if box:
                        cache.put(key, box)
                if not box:
                    continue
                changes = corrections(h, a, box)
                for side, field, _, new in changes:
                    setattr(h if side == "home" else a, field, new)
                if changes:
                    h.corners_against, a.corners_against = a.corners_for, h.corners_for
                    fixed.append(f"{m.date:%Y-%m-%d} {m.id}: " + ", ".join(f"{s} {f} {o}->{n}" for s, f, o, n in changes))
        db.commit()
        run.status = IngestionStatus.SUCCESS
        run.rows_ingested = len(fixed)
        run.notes = f"revisados={len(targets)} corregidos={len(fixed)} " + " | ".join(fixed)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        run.status = IngestionStatus.FAILED
        run.notes = str(exc)
    run.notes = (run.notes or "")[:2000]
    run.finished_at = datetime.utcnow()
    db.commit()
    return run
