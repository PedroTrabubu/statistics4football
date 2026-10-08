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
    "Clermont Foot": "Clermont",
    "Paris Saint Germain": "Paris SG",
    "Saint-Etienne": "St Etienne",
    # football-data.org -> MatchHistory (o nombre corto elegido para equipos
    # nuevos sin historico en BD, siguiendo la convencion de football-data.co.uk)
    "AFC Bournemouth": "Bournemouth",
    "Arsenal FC": "Arsenal",
    "Aston Villa FC": "Aston Villa",
    "Brentford FC": "Brentford",
    "Brighton & Hove Albion FC": "Brighton",
    "Chelsea FC": "Chelsea",
    "Coventry City FC": "Coventry",
    "Crystal Palace FC": "Crystal Palace",
    "Everton FC": "Everton",
    "Fulham FC": "Fulham",
    "Hull City AFC": "Hull",
    "Ipswich Town FC": "Ipswich",
    "Leeds United FC": "Leeds",
    "Liverpool FC": "Liverpool",
    "Manchester City FC": "Man City",
    "Manchester United FC": "Man United",
    "Newcastle United FC": "Newcastle",
    "Nottingham Forest FC": "Nott'm Forest",
    "Sunderland AFC": "Sunderland",
    "Tottenham Hotspur FC": "Tottenham",
    "Athletic Club": "Ath Bilbao",
    "CA Osasuna": "Osasuna",
    "Club Atlético de Madrid": "Ath Madrid",
    "Deportivo Alavés": "Alaves",
    "Elche CF": "Elche",
    "FC Barcelona": "Barcelona",
    "Getafe CF": "Getafe",
    "Levante UD": "Levante",
    "Málaga CF": "Malaga",
    "RC Celta de Vigo": "Celta",
    "RC Deportivo La Coruña": "La Coruna",
    "RCD Espanyol de Barcelona": "Espanol",
    "Rayo Vallecano de Madrid": "Vallecano",
    "Real Betis Balompié": "Betis",
    "Real Madrid CF": "Real Madrid",
    "Real Racing Club de Santander": "Santander",
    "Real Sociedad de Fútbol": "Sociedad",
    "Sevilla FC": "Sevilla",
    "Valencia CF": "Valencia",
    "Villarreal CF": "Villarreal",
    "AJ Auxerre": "Auxerre",
    "AS Monaco FC": "Monaco",
    "Angers SCO": "Angers",
    "ES Troyes AC": "Troyes",
    "FC Lorient": "Lorient",
    "Le Havre AC": "Le Havre",
    "Le Mans FC": "Le Mans",
    "Lille OSC": "Lille",
    "OGC Nice": "Nice",
    "Olympique Lyonnais": "Lyon",
    "Olympique de Marseille": "Marseille",
    "Paris Saint-Germain FC": "Paris SG",
    "RC Strasbourg Alsace": "Strasbourg",
    "Racing Club de Lens": "Lens",
    "Stade Brestois 29": "Brest",
    "Stade Rennais FC 1901": "Rennes",
    "Toulouse FC": "Toulouse",
    "AS Saint-Étienne": "St Etienne",
    "FC Metz": "Metz",
    "FC Nantes": "Nantes",
    "Montpellier HSC": "Montpellier",
    "Stade de Reims": "Reims",
    # the-odds-api.com -> MatchHistory (nombres largos/oficiales distintos a
    # los ya cubiertos arriba; el resto de equipos de the-odds-api.com ya
    # resuelven via alias existentes o via normalize())
    "Brighton and Hove Albion": "Brighton",
    "Coventry City": "Coventry",
    "Hull City": "Hull",
    "Ipswich Town": "Ipswich",
    "Leeds United": "Leeds",
    "Tottenham Hotspur": "Tottenham",
    "Athletic Bilbao": "Ath Bilbao",
    "Atlético Madrid": "Ath Madrid",
    "Deportivo La Coruña": "La Coruna",
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
