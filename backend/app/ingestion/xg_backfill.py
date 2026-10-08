"""Enriquecimiento de partidos historicos con xG real (soccerdata.Understat).

Cruza los partidos de Understat con los ya existentes en `matches` (creados
desde MatchHistory) por equipos (resueltos via TeamResolver) + fecha.
"""

import logging
from datetime import datetime, timedelta

import pandas as pd
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import IngestionRun, IngestionStatus, Match, TeamMatchStats
from app.ingestion.soccerdata_client import get_understat_reader
from app.ingestion.team_names import TeamResolver

logger = logging.getLogger(__name__)


MAX_DATE_GAP = timedelta(days=3)


def _find_match(db: Session, home_team_id: int, away_team_id: int, match_date: pd.Timestamp) -> Match | None:
    day = match_date.date()
    match = (
        db.query(Match)
        .filter(
            Match.home_team_id == home_team_id,
            Match.away_team_id == away_team_id,
            func.date(Match.date) == day,
        )
        .one_or_none()
    )
    if match is not None:
        return match
    # Understat a veces da a toda una jornada la misma fecha o se desvía un par
    # de días. El mismo local-visitante solo se juega una vez por temporada, así
    # que el más cercano a pocos días es ese partido.
    when = match_date.to_pydatetime()
    nearby = (
        db.query(Match)
        .filter(
            Match.home_team_id == home_team_id,
            Match.away_team_id == away_team_id,
            Match.date.between(when - MAX_DATE_GAP, when + MAX_DATE_GAP),
        )
        .all()
    )
    return min(nearby, key=lambda m: abs(m.date - when), default=None)


def _upsert_team_stats(
    db: Session, match_id: int, team_id: int, xg: float | None, xga: float | None
) -> None:
    stats = db.query(TeamMatchStats).filter_by(match_id=match_id, team_id=team_id).one_or_none()
    if stats is None:
        stats = TeamMatchStats(match_id=match_id, team_id=team_id)
        db.add(stats)
    stats.xg = xg
    stats.xga = xga


def backfill_understat_xg(
    db: Session, leagues: list[str], seasons: list[str] | str | None = None
) -> IngestionRun:
    run = IngestionRun(source="soccerdata.understat_xg", status=IngestionStatus.RUNNING)
    db.add(run)
    db.commit()

    matched = 0
    unmatched_matches = 0
    resolver = TeamResolver(db)
    try:
        reader = get_understat_reader(leagues=leagues, seasons=seasons)
        df = reader.read_team_match_stats().reset_index()

        for _, row in df.iterrows():
            home_team = resolver.resolve(row["home_team"])
            away_team = resolver.resolve(row["away_team"])
            if home_team is None or away_team is None:
                continue

            match_date = pd.to_datetime(row["date"])
            match = _find_match(db, home_team.id, away_team.id, match_date)
            if match is None:
                unmatched_matches += 1
                continue

            home_xg = row.get("home_xg")
            away_xg = row.get("away_xg")
            _upsert_team_stats(
                db,
                match.id,
                home_team.id,
                xg=float(home_xg) if pd.notna(home_xg) else None,
                xga=float(away_xg) if pd.notna(away_xg) else None,
            )
            _upsert_team_stats(
                db,
                match.id,
                away_team.id,
                xg=float(away_xg) if pd.notna(away_xg) else None,
                xga=float(home_xg) if pd.notna(home_xg) else None,
            )
            matched += 1

        db.commit()
        run.status = IngestionStatus.SUCCESS
        run.rows_ingested = matched
        run.notes = (
            f"equipos_no_resueltos={sorted(resolver.unresolved)} "
            f"partidos_no_encontrados={unmatched_matches}"
        )[:2000]
        run.finished_at = datetime.utcnow()
        db.commit()
        logger.info(
            "Understat xG backfill: %d partidos actualizados, %d sin match, "
            "equipos no resueltos: %s",
            matched,
            unmatched_matches,
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
