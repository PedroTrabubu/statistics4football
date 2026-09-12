"""Enriquecimiento con rating de fuerza de equipo (soccerdata.ClubElo).

Guarda la serie temporal completa de Elo por equipo en `elo_ratings`. El Elo
pre/post de un partido concreto se calcula en el modulo de stats (Fase 3)
consultando esta serie por fecha, no aqui: la ingesta solo guarda los datos
crudos de la fuente.
"""

import logging
from datetime import datetime

from sqlalchemy.orm import Session

from app.db.models import EloRating, IngestionRun, IngestionStatus, Team
from app.ingestion.soccerdata_client import get_clubelo_reader
from app.ingestion.team_names import TeamResolver

logger = logging.getLogger(__name__)


def backfill_clubelo(db: Session) -> IngestionRun:
    run = IngestionRun(source="soccerdata.clubelo", status=IngestionStatus.RUNNING)
    db.add(run)
    db.commit()

    rows_ingested = 0
    try:
        reader = get_clubelo_reader()
        today = reader.read_by_date()
        resolver = TeamResolver(db)

        resolved: dict[str, Team] = {}
        for clubelo_name in today.index:
            team = resolver.resolve(clubelo_name)
            if team is not None:
                resolved[clubelo_name] = team

        for clubelo_name, team in resolved.items():
            history = reader.read_team_history(clubelo_name)
            db.query(EloRating).filter_by(team_id=team.id).delete()
            for from_date, hrow in history.iterrows():
                db.add(EloRating(team_id=team.id, date=from_date.date(), elo=float(hrow["elo"])))
                rows_ingested += 1
            db.commit()

        run.status = IngestionStatus.SUCCESS
        run.rows_ingested = rows_ingested
        run.notes = f"equipos_resueltos={len(resolved)}/{len(today)}"[:2000]
        run.finished_at = datetime.utcnow()
        db.commit()
        logger.info("ClubElo backfill: %d filas de %d equipos", rows_ingested, len(resolved))
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        run.status = IngestionStatus.FAILED
        run.notes = str(exc)[:2000]
        run.finished_at = datetime.utcnow()
        db.commit()
        raise

    return run
