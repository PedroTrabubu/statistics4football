"""Genera y persiste las predicciones de alta probabilidad (y las de valor,
solo con ENABLE_EV=true: modelo retirado) para los partidos programados que aun
no han empezado de las ligas activas, para que GET /recommendations tenga
contenido real sin depender de que alguien visite cada partido individualmente
en /matches/{id}/predictions.

Re-ejecutable en cualquier momento: sobrescribe las predicciones de cada
partido con la version mas reciente del modelo (idempotente, mismo criterio
que el resto de scripts/ingest_*.py). El programador ya lo hace en cada
actualizacion (paso "Alta probabilidad", app/probability/pattern_refresh.py);
a mano, solo para no esperar a la siguiente.

Uso (desde backend/, con el venv activado):
    python scripts/refresh_predictions.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.probability.pattern_refresh import refresh_predictions


def main() -> None:
    settings = get_settings()
    if not settings.enable_ev:
        # Dixon-Coles se sigue ajustando: es una de las entradas del modelo de patrones.
        print("Modelo de valor retirado (ENABLE_EV=false): no se generan sus predicciones.")
    db = SessionLocal()
    try:
        summary = refresh_predictions(db, settings)
        for line in summary.lines:
            print(line)
        print(f"Total: {summary.matches} partidos procesados")
    finally:
        db.close()


if __name__ == "__main__":
    main()
