"""Genera el Elo propio previo a cada partido (`own_elo_pre`, ver
app/stats/own_elo.py y docs/ELO_PROPIO.md) para que la ficha lo lea sin
calcular nada en cada peticion.

Incremental: escribe las filas finales de los partidos jugados que aun no la
tienen y reescribe las provisionales de los programados con el rating actual.
Las finales ya escritas no se tocan; si hoy saldrian distintas (un resultado
anterior corregido en la BD) se cuentan como discrepancias. El programador lo
hace solo tras cada actualizacion (paso "Elo propio" de app/ingestion/update.py);
cada pasada queda en `ingestion_runs` con source "own_elo.refresh".

Uso (desde backend/, con el venv activado):
    python scripts/refresh_own_elo.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.session import SessionLocal
from app.stats.own_elo import refresh_own_elo


def main() -> None:
    db = SessionLocal()
    try:
        run = refresh_own_elo(db)
        print(f"status={run.status.value} {run.notes}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
