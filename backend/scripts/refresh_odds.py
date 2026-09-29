"""Cuotas pre-partido reales para partidos futuros via the-odds-api.com.
Requiere THE_ODDS_API_KEY en .env. Re-ejecutable en cualquier momento
(idempotente, sobrescribe las cuotas de cada partido con el ultimo precio).

Conviene correr esto y luego scripts/refresh_predictions.py, en ese orden:
primero las cuotas, despues el recalculo de EV que las usa.

Uso (desde backend/, con el venv activado):
    python scripts/refresh_odds.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.ingestion.prematch_odds_backfill import backfill_prematch_odds


def main() -> None:
    settings = get_settings()
    db = SessionLocal()
    try:
        run = backfill_prematch_odds(db, settings, leagues=settings.leagues)
        print(f"the-odds-api: status={run.status.value} partidos_actualizados={run.rows_ingested}")
        if run.notes:
            print(run.notes)
    finally:
        db.close()


if __name__ == "__main__":
    main()
