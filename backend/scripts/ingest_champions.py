"""Champions League desde ESPN: calendario, resultados, estadísticas y árbitros
de la 25/26 y la temporada en curso (ver app/ingestion/champions.py).

La primera vez son unas 900 peticiones (un día por petición y un resumen por
partido) y tarda varios minutos. Lo descargado queda en data/espn_cache/, así
que se puede cortar y volver a lanzar. Después, `ingest_fixtures.py` (y el
programador) mantiene al día la temporada en curso.

Uso (desde backend/, con el venv activado):
    python scripts/ingest_champions.py
    python scripts/ingest_champions.py 2526
"""

import logging
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.session import SessionLocal
from app.ingestion.champions import sync_champions
from app.ingestion.historical_backfill import season_name_for

FIRST_SEASON = "2526"


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    current = season_name_for(date.today())
    seasons = sys.argv[1:] or sorted({FIRST_SEASON, current})
    db = SessionLocal()
    try:
        run = sync_champions(db, seasons)
        print(f"Champions {', '.join(seasons)}: status={run.status.value} {run.notes}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
