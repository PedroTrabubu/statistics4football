"""Sincroniza la temporada en curso:

1. football-data.org: partidos jugados (con marcador real) y por jugar de
   las ligas que da su plan gratuito. Requiere FOOTBALL_DATA_ORG_API_KEY.
2. CSV de la temporada en Football-Data.co.uk: resultados, cuotas, córners y
   tarjetas de los partidos ya jugados, en todas las ligas activas.
3. fixtures.csv de Football-Data.co.uk: la próxima jornada con sus cuotas
   pre-partido (único calendario de LaLiga Hypermotion).

Idempotente y re-ejecutable en cualquier momento para reflejar los
resultados mas recientes.

Uso (desde backend/, con el venv activado):
    python scripts/ingest_fixtures.py
"""

import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.ingestion.fixtures_backfill import sync_current_season_matches
from app.ingestion.fixtures_csv import sync_fixtures_csv
from app.ingestion.historical_backfill import backfill_match_history, season_name_for
from app.ingestion.odds_api_client import LEAGUE_SPORT_KEY_MAP
from app.ingestion.referee_overrides import apply_referee_overrides


def main() -> None:
    settings = get_settings()
    db = SessionLocal()
    try:
        run = sync_current_season_matches(db, settings, leagues=settings.leagues)
        print(f"football-data.org: status={run.status.value} partidos_procesados={run.rows_ingested}")
        if run.notes:
            print(run.notes)

        season = season_name_for(date.today())
        try:
            run = backfill_match_history(db, leagues=settings.leagues, seasons=[season])
            print(f"Football-Data.co.uk {season}: status={run.status.value} partidos_procesados={run.rows_ingested}")
        except ConnectionError as exc:
            # Al empezar la temporada su CSV aún no existe.
            print(f"AVISO Football-Data.co.uk {season}: {exc}")

        odds_api_leagues = (
            {code for code in settings.model_leagues if code in LEAGUE_SPORT_KEY_MAP}
            if settings.the_odds_api_key
            else set()
        )
        run = sync_fixtures_csv(db, settings.leagues, odds_api_leagues)
        print(f"fixtures.csv: status={run.status.value} {run.notes}")

        updated, unmatched = apply_referee_overrides(db)
        print(f"Arbitros corregidos a mano: {updated} actualizados")
        for label in unmatched:
            print(f"  AVISO: arbitros_manual.csv sin partido para {label}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
