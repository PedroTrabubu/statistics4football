"""Programador: actualiza los datos antes y después de cada partido (resultados,
estadísticas, cuotas, árbitros y designaciones) y captura las cuotas de
Pinnacle, sin tener que ejecutar nada a mano. Cuándo toca cada cosa:
app/ingestion/scheduler.py.

Uso (desde backend/, con el venv activado):
    python scripts/scheduler.py --loop           # en marcha: hace cada cosa cuando toca
    python scripts/scheduler.py                  # una vuelta: hace lo que toque ahora y termina
    python scripts/scheduler.py --update-now     # actualiza ya, toque o no
    python scripts/scheduler.py --status         # última actualización, próxima y partidos sin árbitro
    python scripts/scheduler.py --loop --no-pinnacle

Arranque automático en Windows: docs/PROGRAMADOR.md (Programador de tareas).
Solo puede haber uno en marcha (fichero de bloqueo data/scheduler.lock).
Registro: backend/logs/scheduler.log.
"""

import argparse
import logging
import os
import sys
import time
from datetime import timedelta
from logging.handlers import RotatingFileHandler
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
# Las rutas relativas de .env (SOCCERDATA_DIR...) son desde backend/, y el
# Programador de tareas de Windows arranca en otra carpeta.
os.chdir(_BACKEND)

from app.core.config import BACKEND_DIR, PROJECT_ROOT, get_settings  # noqa: E402
from app.db.models import IngestionRun, IngestionStatus, League, Match, MatchStatus  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.ingestion.pinnacle import PinnacleClient  # noqa: E402
from app.ingestion.scheduler import (  # noqa: E402
    UPDATE_SOURCE,
    SingleInstance,
    last_update,
    match_times,
    next_update_at,
    pinnacle_leagues,
    pinnacle_next_at,
    run_pinnacle,
    update_checkpoints,
    update_due,
    utcnow,
)
from app.ingestion.update import run_update  # noqa: E402

LOG_PATH = BACKEND_DIR / "logs" / "scheduler.log"
LOCK_PATH = PROJECT_ROOT / "data" / "scheduler.lock"
MIN_SLEEP = timedelta(seconds=20)
MAX_SLEEP = timedelta(minutes=10)

logger = logging.getLogger("scheduler")


def setup_logging() -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    handlers: list[logging.Handler] = [RotatingFileHandler(LOG_PATH, maxBytes=5_000_000, backupCount=5, encoding="utf-8")]
    if sys.stderr is not None:  # con pythonw.exe no hay consola
        handlers.append(logging.StreamHandler())
    for h in handlers:
        h.setFormatter(fmt)
    root = logging.getLogger()
    root.handlers[:] = handlers
    root.setLevel(logging.INFO)
    for noisy in ("httpx", "soccerdata", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def do_update(db, settings) -> None:
    run = IngestionRun(source=UPDATE_SOURCE, status=IngestionStatus.RUNNING)
    db.add(run)
    db.commit()
    logger.info("Actualización: empieza")
    failures = run_update(db, settings, log=lambda line: logger.info("  %s", line))
    run = db.get(IngestionRun, run.id)
    run.status = IngestionStatus.FAILED if failures else IngestionStatus.SUCCESS
    run.notes = f"pasos con aviso: {', '.join(failures)}" if failures else "todo bien"
    run.finished_at = utcnow()
    db.commit()
    logger.info("Actualización: termina (%s)", run.notes)


def tick(client: PinnacleClient | None, settings, force_update: bool = False):
    """Una vuelta: captura Pinnacle si toca, actualiza si toca. Devuelve
    cuándo hay que volver a mirar."""
    leagues = settings.leagues
    db = SessionLocal()
    try:
        if client is not None:
            run_pinnacle(db, client, pinnacle_leagues(leagues))
        now = utcnow()
        checkpoints = update_checkpoints(match_times(db, leagues, now))
        if force_update or update_due(last_update(db), checkpoints, now):
            try:
                do_update(db, settings)
            except Exception:  # noqa: BLE001  (el programador no se para)
                db.rollback()
                logger.exception("Actualización: error inesperado")
        now = utcnow()
        wakes = [next_update_at(update_checkpoints(match_times(db, leagues, now)), now)]
        if client is not None:
            wakes.append(pinnacle_next_at(db, pinnacle_leagues(leagues), now))
        wakes = [w for w in wakes if w is not None]
        return min(wakes) if wakes else now + MAX_SLEEP
    finally:
        db.close()


def loop(with_pinnacle: bool) -> None:
    settings = get_settings()
    lock = SingleInstance(LOCK_PATH)
    if not lock.acquire():
        logger.info("Ya hay un programador en marcha; este se cierra")
        return
    logger.info("Programador en marcha (Pinnacle: %s)", "sí" if with_pinnacle else "no")
    client = PinnacleClient() if with_pinnacle else None
    try:
        while True:
            try:
                wake = tick(client, settings)
            except Exception:  # noqa: BLE001
                logger.exception("Error inesperado en la vuelta; se reintenta")
                wake = utcnow() + MIN_SLEEP * 3
            pause = min(max(wake - utcnow(), MIN_SLEEP), MAX_SLEEP)
            time.sleep(pause.total_seconds())
    finally:
        if client is not None:
            client.__exit__(None, None, None)
        lock.release()


def status() -> None:
    settings = get_settings()
    db = SessionLocal()
    now = utcnow()
    try:
        last = (
            db.query(IngestionRun)
            .filter(IngestionRun.source == UPDATE_SOURCE)
            .order_by(IngestionRun.started_at.desc())
            .first()
        )
        print(f"Hora actual (UTC): {now:%Y-%m-%d %H:%M}")
        if last:
            print(f"Última actualización: {last.started_at:%Y-%m-%d %H:%M} UTC · {last.status.value} · {last.notes}")
        else:
            print("Todavía no ha habido ninguna actualización programada")
        nxt = next_update_at(update_checkpoints(match_times(db, settings.leagues, now)), now)
        print(f"Próxima actualización: {nxt:%Y-%m-%d %H:%M} UTC" if nxt else "Próxima actualización: sin partidos cerca")
        pending = (
            db.query(Match, League.code)
            .join(League, League.id == Match.league_id)
            .filter(
                League.code.in_(settings.leagues),
                Match.status == MatchStatus.SCHEDULED,
                Match.date.between(now, now + timedelta(days=3)),
            )
            .order_by(Match.date)
            .all()
        )
        print(f"\nPróximos 3 días: {len(pending)} partidos, {sum(1 for m, _ in pending if m.referee)} con árbitro")
        for m, code in pending:
            print(f"  {m.date:%a %d %H:%M} UTC  {code:<19} {m.home_team.name} - {m.away_team.name}: {m.referee or 'sin árbitro'}")
        print(f"\nRegistro: {LOG_PATH}")
        probe = SingleInstance(LOCK_PATH)
        running = not probe.acquire()
        probe.release()
        print(f"Programador en marcha: {'sí' if running else 'no'}")
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--loop", action="store_true", help="quedarse en marcha")
    parser.add_argument("--update-now", action="store_true", help="actualizar ya, toque o no")
    parser.add_argument("--status", action="store_true", help="ver la última actualización y la próxima")
    parser.add_argument("--no-pinnacle", action="store_true", help="sin capturas de Pinnacle")
    args = parser.parse_args()
    if args.status:
        status()
        return
    setup_logging()
    if args.loop:
        try:
            loop(with_pinnacle=not args.no_pinnacle)
        except KeyboardInterrupt:
            logger.info("Programador parado")
        return
    client = None if args.no_pinnacle else PinnacleClient()
    try:
        tick(client, get_settings(), force_update=args.update_now)
    finally:
        if client is not None:
            client.__exit__(None, None, None)


if __name__ == "__main__":
    main()
