"""Precalcula la pagina "Aciertos" (app/analysis/hit_rate.py): un JSON por liga
y temporada en data/model_cache/hit_rate/, para que la API solo lea.

Solo lee lo que los modelos ya guardan (porcentajes de resultado, alta
probabilidad y el ultimo export de picks probables); no recalcula ningun
modelo. Incremental: solo reescribe los ficheros cuyas filas han cambiado. El
programador lo lanza tras "Porcentajes de resultado". Los picks probables se
ponen al dia al reexportarlos (desde frontend/, con el backend en marcha):
    npm run export:picks

Uso (desde backend/, con el venv activado):
    python scripts/report_hit_rate.py
    python scripts/report_hit_rate.py --force             # reescribe todos
    python scripts/report_hit_rate.py --out <carpeta>     # en otra carpeta (prueba)
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.analysis.hit_rate import OUT_DIR, build
from app.core.config import get_settings
from app.db.session import SessionLocal


def main() -> None:
    parser = argparse.ArgumentParser(description="Precalcula la pagina Aciertos.")
    parser.add_argument("--force", action="store_true", help="reescribe todos los ficheros")
    parser.add_argument("--out", type=Path, default=OUT_DIR, help=f"carpeta de salida (por defecto {OUT_DIR})")
    args = parser.parse_args()
    start = time.perf_counter()
    db = SessionLocal()
    try:
        summary = build(db, get_settings(), out_dir=args.out, force=args.force)
    finally:
        db.close()
    print(
        f"{summary.written} ficheros escritos, {summary.kept} sin cambios, {summary.teams} equipos reescritos "
        f"({time.perf_counter() - start:.1f} s) en {args.out}"
    )


if __name__ == "__main__":
    main()
