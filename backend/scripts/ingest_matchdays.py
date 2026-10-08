"""Jornada de todos los partidos: exacta de football-data.org en las temporadas
pasadas que da su plan gratuito, y deducida de las fechas en el resto (ver
app/ingestion/matchdays.py). Requiere FOOTBALL_DATA_ORG_API_KEY.

Basta con ejecutarlo una vez: las temporadas pasadas no cambian, y la jornada
de la temporada en curso ya la mantienen ingest_historical.py e
ingest_fixtures.py.

Uso (desde backend/, con el venv activado):
    python scripts/ingest_matchdays.py
"""

import sys
from collections import Counter
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings
from app.db.models import League, Match, Season
from app.db.session import SessionLocal
from app.ingestion.matchdays import backfill_exact_matchdays, refresh_estimated_matchdays


def main() -> None:
    settings = get_settings()
    today = date.today()
    current_start_year = today.year if today.month >= 7 else today.year - 1
    db = SessionLocal()
    try:
        summary = backfill_exact_matchdays(db, settings, settings.leagues, current_start_year)
        for key, value in summary.items():
            print(f"football-data.org {key}: {value}")
        changed = refresh_estimated_matchdays(db)
        db.commit()
        print(f"Jornadas deducidas actualizadas: {changed}")

        counts: Counter = Counter()
        rows = (
            db.query(League.code, Season.name, Match.matchday, Match.matchday_estimated)
            .join(Match, Match.league_id == League.id)
            .join(Season, Season.id == Match.season_id)
        )
        for code, season, matchday, estimated in rows:
            kind = "sin jornada" if matchday is None else "deducida" if estimated else "exacta"
            counts[(code, season, kind)] += 1
        for code, season in sorted({(c, s) for c, s, _ in counts}):
            detail = ", ".join(f"{kind}={counts[(code, season, kind)]}" for kind in ("exacta", "deducida", "sin jornada") if counts[(code, season, kind)])
            print(f"  {code:20} {season}: {detail}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
