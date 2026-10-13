"""Ingesta historica manual: resultados + cuotas via MatchHistory.

Uso (desde backend/, con el venv activado):
    python scripts/ingest_historical.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.ingestion.referee_overrides import apply_referee_overrides
from app.ingestion.historical_backfill import backfill_match_history
from app.ingestion.soccerdata_client import leagues_with_source


def main() -> None:
    settings = get_settings()
    db = SessionLocal()
    try:
        # La Champions no está en Football-Data.co.uk: scripts/ingest_champions.py.
        leagues = leagues_with_source(settings.leagues + settings.context, "MatchHistory")
        run = backfill_match_history(db, leagues=leagues)
        print(f"MatchHistory: status={run.status.value} filas_procesadas={run.rows_ingested}")
        updated, unmatched = apply_referee_overrides(db)
        print(f"Arbitros corregidos a mano: {updated} actualizados")
        for label in unmatched:
            print(f"  AVISO: arbitros_manual.csv sin partido para {label}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
