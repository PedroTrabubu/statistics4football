"""Genera y persiste predicciones/EV para los partidos programados (aun no
jugados) de las ligas activas, para que GET /recommendations tenga contenido
real sin depender de que alguien visite cada partido individualmente en
/matches/{id}/predictions.

Re-ejecutable en cualquier momento: sobrescribe las predicciones de cada
partido con la version mas reciente del modelo (idempotente, mismo criterio
que el resto de scripts/ingest_*.py). Conviene correrlo despues de
ingest_fixtures.py cuando hay partidos nuevos o resultados recien
actualizados.

Uso (desde backend/, con el venv activado):
    python scripts/refresh_predictions.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings
from app.db.models import League, Match, MatchStatus
from app.db.session import SessionLocal
from app.probability.engine import generate_predictions_for_match, get_cached_league_model


def main() -> None:
    settings = get_settings()
    db = SessionLocal()
    try:
        leagues = db.query(League).filter(League.code.in_(settings.leagues)).all()
        total = 0
        for league in leagues:
            matches = (
                db.query(Match)
                .filter(Match.league_id == league.id, Match.status == MatchStatus.SCHEDULED)
                .order_by(Match.date.asc())
                .all()
            )
            if not matches:
                print(f"{league.code}: sin partidos programados, se omite.")
                continue

            for match in matches:
                model = get_cached_league_model(db, league.id, as_of_date=match.date)
                generate_predictions_for_match(db, match, model, settings.ev_threshold)
                total += 1
            db.commit()
            print(f"{league.code}: {len(matches)} partidos programados con predicciones actualizadas")

        print(f"Total: {total} partidos procesados")
    finally:
        db.close()


if __name__ == "__main__":
    main()
