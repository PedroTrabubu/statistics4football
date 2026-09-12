"""Enriquecimiento con rating Elo (Club Elo).

Uso (desde backend/, con el venv activado):
    python scripts/ingest_elo.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.session import SessionLocal
from app.ingestion.elo_backfill import backfill_clubelo


def main() -> None:
    db = SessionLocal()
    try:
        run = backfill_clubelo(db)
        print(f"ClubElo: status={run.status.value} filas_ingestadas={run.rows_ingested}")
        print(run.notes)
    finally:
        db.close()


if __name__ == "__main__":
    main()
