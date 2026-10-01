"""Arbitros corregidos a mano (data/arbitros_manual.csv).

football-data.org a veces devuelve la lista de arbitros vacia en partidos ya
jugados, y el CSV de MatchHistory no trae arbitro para LaLiga: esos partidos
quedan sin arbitro en ninguna fuente. Este fichero los completa, con dos
fuentes por fila para poder comprobar cada dato. Se aplica al final de cada
ingesta y siempre prevalece sobre lo que traigan las fuentes automaticas.

El nombre debe ir en el mismo formato que el resto ("A Quintero González"),
para que el arbitro no quede partido en dos en la pagina de arbitros.
"""

import csv
import logging
from pathlib import Path

from sqlalchemy import func
from sqlalchemy.orm import Session, aliased

from app.db.models import League, Match, Team

logger = logging.getLogger(__name__)

OVERRIDES_PATH = Path(__file__).resolve().parents[3] / "data" / "arbitros_manual.csv"


def apply_referee_overrides(db: Session, path: Path = OVERRIDES_PATH) -> tuple[int, list[str]]:
    """Devuelve (partidos actualizados, filas que no encajan con ningun partido)."""
    if not path.exists():
        return 0, []

    home, away = aliased(Team), aliased(Team)
    updated, unmatched = 0, []
    with path.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            label = f"{row['fecha']} {row['local']} - {row['visitante']}"
            match = (
                db.query(Match)
                .join(League, League.id == Match.league_id)
                .join(home, home.id == Match.home_team_id)
                .join(away, away.id == Match.away_team_id)
                .filter(
                    League.code == row["liga"],
                    func.date(Match.date) == row["fecha"],
                    home.name == row["local"],
                    away.name == row["visitante"],
                )
                .one_or_none()
            )
            if match is None:
                unmatched.append(label)
                continue
            if match.referee != row["arbitro"]:
                match.referee = row["arbitro"]
                updated += 1

    db.commit()
    for label in unmatched:
        logger.warning("arbitros_manual.csv: sin partido para %s", label)
    return updated, unmatched
