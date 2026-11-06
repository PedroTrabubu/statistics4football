"""Genera el duelo de corners y el predictor de estadisticas de la ficha
(`match_forecasts`, ver app/probability/match_forecasts.py), para que la API
solo lea y Aciertos tenga su historico.

Incremental: reconstruye en walk-forward los partidos jugados sin fila
("reconstruida con datos anteriores") y escribe la de los programados hasta su
inicio ("congelada antes del partido"); desde el inicio, una fila no se toca.
El programador lo hace solo tras cada actualizacion (paso "Duelo y predictor"
de app/ingestion/update.py); cada pasada queda en `ingestion_runs` con source
"match_forecasts.refresh".

Uso (desde backend/, con el venv activado):
    python scripts/refresh_match_forecasts.py
    python scripts/refresh_match_forecasts.py --liga "ENG-Premier League"   # solo esa liga (prueba)
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.session import SessionLocal
from app.probability.match_forecasts import refresh_match_forecasts


def main() -> None:
    parser = argparse.ArgumentParser(description="Duelo de corners y predictor de estadisticas de la ficha.")
    parser.add_argument("--liga", action="append", help="solo esta liga (se puede repetir)")
    args = parser.parse_args()
    db = SessionLocal()
    try:
        run = refresh_match_forecasts(db, leagues=args.liga)
        print(f"status={run.status.value} {run.notes}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
