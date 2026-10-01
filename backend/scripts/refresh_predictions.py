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
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings
from app.db.models import League, Match, MatchStatus
from app.db.session import SessionLocal
from app.probability.engine import generate_predictions_for_match, get_cached_league_model
from app.probability.pattern_engine import build_tracker, generate_pattern_predictions_for_match
from app.probability.pattern_model import load_params


def main() -> None:
    settings = get_settings()
    pattern_params = load_params()
    if pattern_params is None:
        print("Sin pattern_model_params.json: solo se generan predicciones de valor (Dixon-Coles).")
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

            # Patrones: todo lo jugado hasta ahora (se predice con la informacion de hoy).
            tracker = build_tracker(db, league.id, before=datetime.now()) if pattern_params else None
            with_patterns = 0
            for match in matches:
                model = get_cached_league_model(db, league.id, as_of_date=match.date)
                generate_predictions_for_match(db, match, model, settings.ev_threshold)
                if pattern_params is not None and generate_pattern_predictions_for_match(
                    db, match, model, tracker, pattern_params
                ):
                    with_patterns += 1
                total += 1
            db.commit()
            print(
                f"{league.code}: {len(matches)} partidos programados con predicciones actualizadas "
                f"({with_patterns} con cuotas para el modelo de alta probabilidad)"
            )

        print(f"Total: {total} partidos procesados")
    finally:
        db.close()


if __name__ == "__main__":
    main()
