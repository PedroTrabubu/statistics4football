"""Sincroniza la temporada en curso: resultados, estadísticas, xG, próxima
jornada con sus cuotas, árbitros (ESPN, designaciones oficiales y
data/arbitros_manual.csv). Los pasos, en app/ingestion/update.py.

Idempotente y re-ejecutable en cualquier momento para reflejar los
resultados mas recientes. El programador (scripts/scheduler.py) lo ejecuta
solo antes y después de cada partido.

Uso (desde backend/, con el venv activado):
    python scripts/ingest_fixtures.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.ingestion.update import run_update  # noqa: E402


def main() -> None:
    db = SessionLocal()
    try:
        failures = run_update(db, get_settings())
    finally:
        db.close()
    if failures:
        print(f"Pasos con aviso: {', '.join(failures)}")


if __name__ == "__main__":
    main()
