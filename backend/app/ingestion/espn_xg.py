"""xG de respaldo de ESPN para los partidos jugados que Understat no tiene.

Understat es la fuente del xG (xg_backfill.py), pero puede faltar: desde el
2026-11-02 su web entera responde «We will come back soon». ESPN da el xG de
cada equipo en su core API (EspnClient.team_statistics), solo desde la
temporada 2026-27 y solo en las cinco grandes ligas y la Champions. Aquí se
rellena el de los partidos de la temporada en curso que siguen sin él. Si
Understat vuelve, su carga escribe todos los partidos que tiene y sustituye
estos valores.

Los dos modelos de xG no dan lo mismo. Comparación del 2026-11-12, con 110
partidos de las cinco ligas del 18 de octubre al 1 de noviembre de 2026 (220
cifras de equipo): correlación de 0,92, pero ESPN da de media 1,46 por equipo
y partido y Understat 1,64. Se guarda en la escala de Understat (por
ESPN_TO_UNDERSTAT) para que las medias y los modelos, hechos con Understat, no
bajen al mezclar las dos fuentes.
"""

from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import IngestionRun, IngestionStatus, League, Match, MatchStatus, Season, TeamMatchStats
from app.ingestion.espn import EspnClient, espn_code, match_event_id
from app.ingestion.team_names import TeamResolver
from app.ingestion.xg_backfill import _upsert_team_stats

logger = logging.getLogger(__name__)

# Understat / ESPN en la comparación del docstring (1,64 / 1,46).
ESPN_TO_UNDERSTAT = 1.12


def parse_xg(stats: dict[str, dict[str, float | None]]) -> tuple[float, float] | None:
    """(xG del local, xG del visitante) en la escala de Understat, o None si
    ESPN aún no lo tiene de alguno de los dos."""
    values = [(stats.get(side) or {}).get("expectedGoals") for side in ("home", "away")]
    try:
        home, away = (float(v) for v in values)
    except (TypeError, ValueError):
        return None
    return round(home * ESPN_TO_UNDERSTAT, 3), round(away * ESPN_TO_UNDERSTAT, 3)


def missing_xg(db: Session, leagues: list[str], season: str) -> list[tuple[Match, str]]:
    """Partidos jugados de esa temporada sin el xG de alguno de los dos equipos."""
    complete = (
        db.query(TeamMatchStats.match_id)
        .filter(TeamMatchStats.xg.is_not(None))
        .group_by(TeamMatchStats.match_id)
        .having(func.count() >= 2)
    )
    return (
        db.query(Match, League.code)
        .join(League, League.id == Match.league_id)
        .join(Season, Season.id == Match.season_id)
        .filter(
            League.code.in_(leagues),
            Season.name == season,
            Match.status == MatchStatus.HISTORICAL,
            Match.id.not_in(complete),
        )
        .order_by(Match.date)
        .all()
    )


def fill_xg_from_espn(db: Session, leagues: list[str], season: str) -> IngestionRun:
    run = IngestionRun(source="espn.xg", status=IngestionStatus.RUNNING)
    db.add(run)
    db.commit()
    filled = waiting = no_event = 0
    try:
        targets = missing_xg(db, leagues, season)
        resolver = TeamResolver(db)
        with EspnClient() as client:
            for match, code in targets:
                league = espn_code(code)
                event = match_event_id(client, resolver, league, match) if league else None
                if event is None:
                    no_event += 1
                    continue
                xg = parse_xg(client.team_statistics(league, event))
                if xg is None:
                    waiting += 1
                    continue
                home_xg, away_xg = xg
                _upsert_team_stats(db, match.id, match.home_team_id, xg=home_xg, xga=away_xg)
                _upsert_team_stats(db, match.id, match.away_team_id, xg=away_xg, xga=home_xg)
                filled += 1
        db.commit()
        run.status = IngestionStatus.SUCCESS
        run.rows_ingested = filled
        run.notes = (
            f"partidos_sin_xg={len(targets)} rellenados={filled} sin_xg_en_espn={waiting} "
            f"sin_partido_en_espn={no_event}"
        )
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        run.status = IngestionStatus.FAILED
        run.notes = str(exc)[:2000]
    run.finished_at = datetime.utcnow()
    db.commit()
    logger.info("xG de ESPN: %s", run.notes)
    return run
