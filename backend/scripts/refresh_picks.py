"""Genera las combinadas (Picks) de la proxima jornada.

Usa el modelo probado en el backtest (app/picks/picks_params.json, ver
docs/PICKS_PROTOCOLO.md). Conviene correrlo despues de ingest_fixtures.py y
refresh_odds.py: sin cuotas pre-partido un partido no tiene patas de goles,
solo de corners y amarillas. Re-ejecutable: sustituye las combinadas de esa
jornada.

Uso (desde backend/, con el venv activado):
    python scripts/refresh_picks.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.session import SessionLocal
from app.picks.engine import load_params
from app.picks.service import generate_live_picks


def main() -> None:
    params = load_params()
    if params is None:
        sys.exit("Falta app/picks/picks_params.json: ejecuta `python scripts/backtest_picks.py export`.")
    db = SessionLocal()
    try:
        window, n = generate_live_picks(db, params)
        if window is None:
            print("No hay partidos programados: no se generan picks.")
        else:
            print(f"Jornada del {window}: {n} combinadas generadas")
    finally:
        db.close()


if __name__ == "__main__":
    main()
