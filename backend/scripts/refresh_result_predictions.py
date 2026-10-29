"""Genera los porcentajes de resultado de la ficha (`result_predictions`, ver
app/probability/result_predictions.py y docs/RESULTADOS_PROTOCOLO.md) y su
resumen (data/model_cache/result_summary.json), para que la API solo lea.

Antes actualiza Dixon-Coles mensual (app/probability/dc_monthly.py). Incremental: reconstruye en walk-forward los partidos jugados sin prediccion
("reconstruida con datos anteriores") y escribe la de los programados hasta su
inicio ("congelada antes del partido"); desde el inicio, una fila no se toca.
El programador lo hace solo tras cada actualizacion, despues del Elo propio
(paso "Porcentajes de resultado" de app/ingestion/update.py); cada pasada queda
en `ingestion_runs` con source "result_predictions.refresh".

Uso (desde backend/, con el venv activado):
    python scripts/refresh_result_predictions.py
    python scripts/refresh_result_predictions.py --liga "ENG-Premier League"   # solo esa liga (prueba)
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.session import SessionLocal
from app.probability.dc_monthly import refresh_dc_monthly
from app.probability.result_predictions import LEAGUES, refresh_result_predictions


def main() -> None:
    parser = argparse.ArgumentParser(description="Porcentajes de resultado de la ficha.")
    parser.add_argument("--liga", action="append", help="solo esta liga (se puede repetir)")
    args = parser.parse_args()
    db = SessionLocal()
    try:
        try:
            dc = refresh_dc_monthly(db, args.liga or LEAGUES)
            print(f"Dixon-Coles mensual: {dc.notes}")
        except RuntimeError as exc:  # esas ligas usan solo Elo
            print(f"AVISO {exc}")
        run = refresh_result_predictions(db, leagues=args.liga)
        print(f"status={run.status.value} {run.notes}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
