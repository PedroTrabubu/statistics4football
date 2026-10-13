"""Programador: cuándo actualizar los datos y cuándo capturar Pinnacle.

Actualización (app/ingestion/update.py), según los partidos de las ligas
activas:
- antes de cada partido: 36 h, 24 h, 18 h, 12 h y 6 h antes del inicio. Las
  designaciones salen la víspera de cada día de partido (la RFEF publica las
  del sábado el viernes a las 13:00) y la Premier y la Ligue 1, días antes;
- después: a las 3 h y a las 12 h del inicio (resultado y árbitro), y
  mientras le falten las estadísticas (córners, tarjetas...), una vez al día
  hasta 5 días después: Football-Data las publica un par de veces por semana.

Una pasada actualiza todo: toca si ha pasado algún punto de control desde la
última. Así varios partidos a la misma hora comparten pasada.

Pinnacle: app/ingestion/pinnacle_schedule.py.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import IngestionRun, League, Match, TeamMatchStats
from app.ingestion.pinnacle import LEAGUE_IDS
from app.ingestion.pinnacle_capture import OddsSource, capture_league
from app.ingestion.pinnacle_queries import last_captures, upcoming_starts
from app.ingestion.pinnacle_schedule import is_due, next_capture_at

logger = logging.getLogger(__name__)

UPDATE_SOURCE = "scheduler.update"
BEFORE_HOURS = (36, 24, 18, 12, 6)
AFTER_HOURS = (3, 12)
STATS_RETRY_HOURS = (36, 60, 84, 108)  # sin estadísticas: una vez al día hasta ~5 días
LOOK_BACK = timedelta(days=6)
LOOK_AHEAD = timedelta(days=3)


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


@dataclass(frozen=True)
class MatchTimes:
    kickoff: datetime
    has_stats: bool


def update_checkpoints(matches: list[MatchTimes]) -> list[datetime]:
    """Puntos de control de la actualización para esos partidos."""
    points: set[datetime] = set()
    for m in matches:
        points.update(m.kickoff - timedelta(hours=h) for h in BEFORE_HOURS)
        points.update(m.kickoff + timedelta(hours=h) for h in AFTER_HOURS)
        if not m.has_stats:
            points.update(m.kickoff + timedelta(hours=h) for h in STATS_RETRY_HOURS)
    return sorted(points)


def update_due(last_run: datetime | None, checkpoints: list[datetime], now: datetime) -> bool:
    """Toca si nunca se ha actualizado o ha pasado un punto de control desde la última vez."""
    if last_run is None:
        return True
    return any(last_run < c <= now for c in checkpoints)


def next_update_at(checkpoints: list[datetime], now: datetime) -> datetime | None:
    future = [c for c in checkpoints if c > now]
    return min(future) if future else None


def match_times(db: Session, leagues: list[str], now: datetime) -> list[MatchTimes]:
    """Partidos de los últimos días y de los próximos, y si ya tienen estadísticas."""
    with_stats = (
        db.query(TeamMatchStats.match_id)
        .filter(TeamMatchStats.corners_for.is_not(None))
        .group_by(TeamMatchStats.match_id)
        .having(func.count() >= 2)
    )
    rows = (
        db.query(Match.date, Match.id.in_(with_stats))
        .join(League, League.id == Match.league_id)
        .filter(League.code.in_(leagues), Match.date.between(now - LOOK_BACK, now + LOOK_AHEAD))
        .all()
    )
    return [MatchTimes(kickoff, bool(has_stats)) for kickoff, has_stats in rows]


def last_update(db: Session) -> datetime | None:
    row = db.query(func.max(IngestionRun.started_at)).filter(IngestionRun.source == UPDATE_SOURCE).one()
    return row[0]


# --- Pinnacle ----------------------------------------------------------------


def pinnacle_leagues(active: list[str]) -> list[str]:
    return [code for code in active if code in LEAGUE_IDS]


def pinnacle_due(db: Session, leagues: list[str], now: datetime) -> list[str]:
    due = []
    for code in leagues:
        ok, failed = last_captures(db, code)
        last = ok.captured_at if ok else None
        if is_due(last, upcoming_starts(db, ok, now), now, failed.captured_at if failed else None):
            due.append(code)
    return due


def pinnacle_next_at(db: Session, leagues: list[str], now: datetime) -> datetime | None:
    times = []
    for code in leagues:
        ok, _ = last_captures(db, code)
        times.append(next_capture_at(ok.captured_at if ok else None, upcoming_starts(db, ok, now), now))
    return min(times) if times else None


def run_pinnacle(db: Session, client: OddsSource, leagues: list[str], force: bool = False) -> int:
    """Captura las ligas a las que les toca (o todas con force). Devuelve
    cuántas fallaron; una liga que falla no para las demás."""
    failures = 0
    for code in leagues if force else pinnacle_due(db, leagues, utcnow()):
        try:
            failures += capture_league(db, client, code).status != "ok"
        except Exception:  # noqa: BLE001
            db.rollback()
            failures += 1
            logger.exception("Pinnacle %s: error inesperado en la pasada", code)
    return failures


# --- Una sola instancia ----------------------------------------------------------


class SingleInstance:
    """Bloqueo de un fichero mientras el proceso vive: un segundo programador
    (lanzado a mano o por el Programador de tareas) ve que ya hay uno y sale.
    El sistema lo suelta si el proceso muere."""

    def __init__(self, path: Path):
        self.path = path
        self._file = None

    def acquire(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._file = open(self.path, "a+")  # noqa: SIM115
        try:
            if os.name == "nt":
                import msvcrt

                self._file.seek(0)
                msvcrt.locking(self._file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(self._file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self._file.close()
            self._file = None
            return False
        return True

    def release(self) -> None:
        if self._file is not None:
            self._file.close()
            self._file = None
