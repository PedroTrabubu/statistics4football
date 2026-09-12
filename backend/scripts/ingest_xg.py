"""Enriquecimiento con xG real (Understat). Requiere haber corrido antes
ingest_historical.py (los partidos deben existir ya en la BD).

Uso (desde backend/, con el venv activado):
    python scripts/ingest_xg.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.ingestion.xg_backfill import backfill_understat_xg


def main() -> None:
    settings = get_settings()
    db = SessionLocal()
    try:
        run = backfill_understat_xg(db, leagues=settings.leagues)
        print(f"Understat xG: status={run.status.value} partidos_actualizados={run.rows_ingested}")
        print(run.notes)
    finally:
        db.close()


if __name__ == "__main__":
    main()
