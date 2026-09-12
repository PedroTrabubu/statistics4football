"""Reconciliacion de nombres de equipo entre fuentes.

soccerdata solo armoniza nombres entre fuentes si se le configura un fichero
`teamname_replacements.json` (vacio por defecto). Como aqui cruzamos varias
fuentes (Football-Data.co.uk, Understat, Club Elo...) que nombran a los
equipos de forma distinta ("Man United" vs "Manchester United" vs
"ManUnited"), resolvemos nosotros mismos el nombre-de-la-fuente -> Team ya
existente en la BD (creada a partir de MatchHistory, nuestra fuente canonica).

Estrategia: (1) alias explicitos conocidos para los casos que una
normalizacion generica no resuelve (abreviaturas, prefijos "Real"/"Athletic
Club"/"Rayo"...), luego (2) normalizacion generica (sin acentos, sin
mayusculas/puntuacion) como fallback. Lo que no resuelva ninguna de las dos
se reporta como no encontrado en vez de fallar silenciosamente.
"""

import re
import unicodedata

from sqlalchemy.orm import Session

from app.db.models import Team

# nombre-en-la-fuente -> nombre canonico (tal cual esta en `teams.name`,
# heredado de MatchHistory). Detectados comparando los nombres reales
# devueltos por soccerdata.Understat/ClubElo contra los ya cargados en BD.
TEAM_ALIASES: dict[str, str] = {
    # Understat -> MatchHistory
    "Athletic Club": "Ath Bilbao",
    "Atletico Madrid": "Ath Madrid",
    "Real Betis": "Betis",
    "Celta Vigo": "Celta",
    "Espanyol": "Espanol",
    "SD Huesca": "Huesca",
    "Manchester City": "Man City",
    "Manchester United": "Man United",
    "Newcastle United": "Newcastle",
    "Nottingham Forest": "Nott'm Forest",
    "Real Oviedo": "Oviedo",
    "Real Sociedad": "Sociedad",
    "Real Valladolid": "Valladolid",
    "Rayo Vallecano": "Vallecano",
    "West Bromwich Albion": "West Brom",
    "Wolverhampton Wanderers": "Wolves",
}


def normalize(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


class TeamResolver:
    """Resuelve un nombre de equipo de cualquier fuente al Team ya existente en BD."""

    def __init__(self, db: Session):
        teams = db.query(Team).all()
        self._by_name: dict[str, Team] = {t.name: t for t in teams}
        self._by_normalized: dict[str, Team] = {normalize(t.name): t for t in teams}
        self.unresolved: set[str] = set()

    def resolve(self, source_name: str) -> Team | None:
        canonical = TEAM_ALIASES.get(source_name, source_name)
        team = self._by_name.get(canonical)
        if team is not None:
            return team

        team = self._by_normalized.get(normalize(canonical))
        if team is not None:
            return team

        self.unresolved.add(source_name)
        return None
