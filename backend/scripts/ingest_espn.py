"""Árbitros de las temporadas pasadas y calendario de LaLiga Hypermotion,
desde ESPN.

ESPN tiene el árbitro de algunos partidos de la 21/22 y de todos desde la
22/23; de la 20/21, de ninguno. La primera vez son unas 8.000 peticiones (una
por partido sin árbitro) y tarda alrededor de una hora. Lo descargado queda
en data/espn_cache/, así que se puede cortar y volver a lanzar. Después,
`ingest_fixtures.py` lo mantiene al día en la temporada en curso.

Uso (desde backend/, con el venv activado):
    python scripts/ingest_espn.py
"""

import logging
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func

from app.core.config import get_settings
from app.db.models import League, Match
from app.db.session import SessionLocal
from app.ingestion.espn import sync_espn
from app.ingestion.historical_backfill import season_name_for, seasons_until

FIRST_SEASON_WITH_REFEREES = "2122"


def _referee_coverage(db) -> dict[str, str]:
    rows = (
        db.query(League.code, func.count(Match.referee), func.count(Match.id))
        .join(Match, Match.league_id == League.id)
        .group_by(League.code)
        .all()
    )
    return {code: f"{with_referee}/{total}" for code, with_referee, total in rows}


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    settings = get_settings()
    db = SessionLocal()
    try:
        before = _referee_coverage(db)
        today = date.today()
        seasons = [s for s in seasons_until(today) if s >= FIRST_SEASON_WITH_REFEREES]
        run = sync_espn(db, settings.leagues, seasons, season_name_for(today))
        print(f"ESPN: status={run.status.value} {run.notes}")
        after = _referee_coverage(db)
        for code in after:
            print(f"  {code}: partidos con árbitro {before.get(code, '0/0')} -> {after[code]}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
