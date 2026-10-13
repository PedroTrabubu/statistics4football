"""Capturas de cuotas de Pinnacle (apertura a cierre), solo de anadir.

Uso (desde backend/, con el venv activado):
    python scripts/pinnacle_capture.py              # una pasada: solo las ligas a las que les toca
    python scripts/pinnacle_capture.py --force      # todas las ligas, ya
    python scripts/pinnacle_capture.py --loop       # se queda en marcha y captura cuando toca
    python scripts/pinnacle_capture.py --status     # ultimas pasadas, fallos y espacio en disco
    python scripts/pinnacle_capture.py --league "ESP-La Liga" --force

Cuando toca: ver app/ingestion/pinnacle_schedule.py (cada 6 h, cada hora en
las ultimas 24 h, cada 12 min en la ultima hora y una final ~3 min antes del
inicio). El programador (scripts/scheduler.py) ya las hace junto con la
actualizacion de datos: este script es para lanzarlas por separado.

Registro: backend/logs/pinnacle_capture.log (y la consola). Cada pasada
queda en la tabla pinnacle_captures con su estado ("ok"/"failed"), el error,
los avisos y cuantos partidos y cuotas ha guardado.
"""

import argparse
import json
import logging
import sys
import time
from datetime import timedelta
from logging.handlers import RotatingFileHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import BACKEND_DIR, get_settings  # noqa: E402
from app.db.models import PinnacleCapture, PinnaclePrice  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.ingestion.pinnacle import LEAGUE_IDS, PinnacleClient  # noqa: E402
from app.ingestion.pinnacle_capture import RAW_DIR, utcnow  # noqa: E402
from app.ingestion.pinnacle_queries import last_captures, upcoming_starts  # noqa: E402
from app.ingestion.pinnacle_schedule import next_capture_at  # noqa: E402
from app.ingestion.scheduler import pinnacle_next_at, run_pinnacle  # noqa: E402

LOG_PATH = BACKEND_DIR / "logs" / "pinnacle_capture.log"
MIN_SLEEP = timedelta(seconds=20)
MAX_SLEEP = timedelta(minutes=10)

logger = logging.getLogger("pinnacle_capture")


def setup_logging() -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    file_handler = RotatingFileHandler(LOG_PATH, maxBytes=5_000_000, backupCount=5, encoding="utf-8")
    file_handler.setFormatter(fmt)
    console = logging.StreamHandler()
    console.setFormatter(fmt)
    root = logging.getLogger()
    root.handlers[:] = [file_handler, console]
    root.setLevel(logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)


def leagues_to_capture(selected: list[str] | None) -> list[str]:
    active = [code for code in get_settings().leagues if code in LEAGUE_IDS]
    return [code for code in active if not selected or code in selected]


def run_pass(client: PinnacleClient, leagues: list[str], force: bool) -> int:
    """Captura las ligas a las que les toca (o todas con force). Devuelve
    cuantas fallaron."""
    db = SessionLocal()
    try:
        return run_pinnacle(db, client, leagues, force)
    finally:
        db.close()


def loop(leagues: list[str]) -> None:
    logger.info("Capturas de Pinnacle en marcha: %s (Ctrl+C para parar)", ", ".join(leagues))
    with PinnacleClient() as client:
        while True:
            run_pass(client, leagues, force=False)
            db = SessionLocal()
            try:
                wake = pinnacle_next_at(db, leagues, utcnow()) or utcnow() + MAX_SLEEP
            finally:
                db.close()
            pause = min(max(wake - utcnow(), MIN_SLEEP), MAX_SLEEP)
            time.sleep(pause.total_seconds())


def _dir_size(path: Path) -> int:
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file()) if path.exists() else 0


def status(leagues: list[str]) -> None:
    db = SessionLocal()
    now = utcnow()
    try:
        print(f"Hora actual (UTC): {now:%Y-%m-%d %H:%M}")
        for code in leagues:
            ok, failed = last_captures(db, code)
            total = db.query(PinnacleCapture).filter_by(league_code=code).count()
            recent_failed = (
                db.query(PinnacleCapture)
                .filter(
                    PinnacleCapture.league_code == code,
                    PinnacleCapture.status == "failed",
                    PinnacleCapture.captured_at >= now - timedelta(hours=24),
                )
                .count()
            )
            print(f"\n{code}: {total} pasadas, {recent_failed} fallidas en las últimas 24 h")
            if ok:
                warnings = json.loads(ok.warnings) if ok.warnings else []
                print(
                    f"  última buena: {ok.captured_at:%Y-%m-%d %H:%M} UTC · {ok.n_matchups} partidos "
                    f"({ok.n_matched} cruzados, {ok.n_live_skipped} ya empezados) · {ok.n_prices} cuotas · "
                    f"{ok.n_rows_written} filas nuevas · {ok.n_removed} retiradas · {len(warnings)} avisos"
                )
                for warning in warnings[:5]:
                    print(f"    aviso: {warning}")
            else:
                print("  sin ninguna pasada buena todavía")
            if failed and (ok is None or failed.captured_at > ok.captured_at):
                print(f"  ÚLTIMA PASADA FALLIDA {failed.captured_at:%Y-%m-%d %H:%M} UTC: {failed.error}")
            starts = upcoming_starts(db, ok, now)
            nxt = max(next_capture_at(ok.captured_at if ok else None, starts, now), now)
            first = f" · próximo partido: {starts[0]:%Y-%m-%d %H:%M} UTC" if starts else " · sin partidos próximos"
            print(f"  próxima pasada: {nxt:%Y-%m-%d %H:%M} UTC{first}")
        rows = db.query(PinnaclePrice).count()
        print(f"\nFilas de cuotas guardadas: {rows} · crudos en disco: {_dir_size(RAW_DIR) / 1e6:.1f} MB ({RAW_DIR})")
        print(f"Registro: {LOG_PATH}")
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--league", action="append", help="solo esta liga (se puede repetir)")
    parser.add_argument("--force", action="store_true", help="capturar ya, aunque no toque")
    parser.add_argument("--loop", action="store_true", help="quedarse en marcha capturando cuando toca")
    parser.add_argument("--status", action="store_true", help="ver las últimas pasadas y los fallos")
    args = parser.parse_args()
    leagues = leagues_to_capture(args.league)

    if args.status:
        status(leagues)
        return
    setup_logging()
    if args.loop:
        try:
            loop(leagues)
        except KeyboardInterrupt:
            logger.info("Capturas de Pinnacle paradas")
        return
    with PinnacleClient() as client:
        failures = run_pass(client, leagues, force=args.force)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
