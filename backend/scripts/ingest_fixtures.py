"""Sincroniza la temporada en curso via football-data.org: partidos ya
jugados (con marcador real) y por jugar. Requiere FOOTBALL_DATA_ORG_API_KEY
en .env. Idempotente y re-ejecutable en cualquier momento para reflejar los
resultados mas recientes.

Uso (desde backend/, con el venv activado):
    python scripts/ingest_fixtures.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.ingestion.fixtures_backfill import sync_current_season_matches


def main() -> None:
    settings = get_settings()
    db = SessionLocal()
    try:
        run = sync_current_season_matches(db, settings, leagues=settings.leagues)
        print(f"football-data.org: status={run.status.value} partidos_procesados={run.rows_ingested}")
        if run.notes:
            print(run.notes)
    finally:
        db.close()


if __name__ == "__main__":
    main()
