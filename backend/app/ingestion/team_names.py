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
    "Deportivo La Coruna": "La Coruna",
    "Racing Santander": "Santander",
    "Clermont Foot": "Clermont",
    "Paris Saint Germain": "Paris SG",
    "Saint-Etienne": "St Etienne",
    # football-data.org -> MatchHistory (o nombre corto elegido para equipos
    # nuevos sin historico en BD, siguiendo la convencion de football-data.co.uk)
    "AFC Bournemouth": "Bournemouth",
    "Burnley FC": "Burnley",
    "Luton Town FC": "Luton",
    "Sheffield United FC": "Sheffield United",
    "Cádiz CF": "Cadiz",
    "Granada CF": "Granada",
    "UD Almería": "Almeria",
    "Clermont Foot 63": "Clermont",
    "Leicester City FC": "Leicester",
    "Southampton FC": "Southampton",
    "West Ham United FC": "West Ham",
    "Wolverhampton Wanderers FC": "Wolves",
    "CD Leganés": "Leganes",
    "Girona FC": "Girona",
    "RCD Mallorca": "Mallorca",
    "Real Valladolid CF": "Valladolid",
    "UD Las Palmas": "Las Palmas",
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
    "Andorra CF": "Andorra",
    "Celta Fortuna": "Celta B",
    "Real Sociedad B": "Sociedad B",
    "Sabadell FC": "Sabadell",
    "Inter Milan": "Inter",
    # ESPN -> MatchHistory (el resto resuelven por su nombre corto o normalize())
    "AC Ajaccio": "Ajaccio",
    "AD Alcorcón": "Alcorcon",
    "CD Sabadell": "Sabadell",
    "Deportivo": "La Coruna",
    "FC Andorra": "Andorra",
    "FC Cartagena": "Cartagena",
    "Norwich City": "Norwich",
    "Paris Saint-Germain": "Paris SG",
    "Racing Ferrol": "Ferrol",
    "RC Celta Fortuna": "Celta B",
    "Real Sociedad II": "Sociedad B",
    "Real Zaragoza": "Zaragoza",
    "Sporting Gijón": "Sp Gijon",
    # Pinnacle (guest API) -> MatchHistory
    "Celta Vigo II": "Celta B",
    "Sporting Gijon": "Sp Gijon",
    # API de laliga.com (designaciones arbitrales) -> MatchHistory
    "R. Racing Club": "Santander",
    "RC Deportivo": "La Coruna",
    "Atlético de Madrid": "Ath Madrid",
    "CD Tenerife": "Tenerife",
    "SD Eibar": "Eibar",
    "Burgos CF": "Burgos",
    "Albacete BP": "Albacete",
    "Real Sporting": "Sp Gijon",
    "CD Castellón": "Castellon",
    "R. Sociedad B": "Sociedad B",
    "CD Eldense": "Eldense",
    "Córdoba CF": "Cordoba",
    "AD Ceuta FC": "Ceuta",
    "CE Sabadell": "Sabadell",
    # Bundesliga: football-data.org, Understat y ESPN -> MatchHistory
    "1. FC Heidenheim 1846": "Heidenheim",
    "1. FC Köln": "FC Koln",
    "1. FC Union Berlin": "Union Berlin",
    "1. FSV Mainz 05": "Mainz",
    "Arminia Bielefeld": "Bielefeld",
    "Bayer 04 Leverkusen": "Leverkusen",
    "Bayer Leverkusen": "Leverkusen",
    "Borussia Dortmund": "Dortmund",
    "Borussia M.Gladbach": "M'gladbach",
    "Borussia Mönchengladbach": "M'gladbach",
    "Eintracht Frankfurt": "Ein Frankfurt",
    "FC Augsburg": "Augsburg",
    "FC Bayern München": "Bayern Munich",
    "FC Cologne": "FC Koln",
    "FC Heidenheim": "Heidenheim",
    "FC Schalke 04": "Schalke 04",
    "FC St. Pauli 1910": "St Pauli",
    "Greuther Fuerth": "Greuther Furth",
    "Hamburger SV": "Hamburg",
    "Hertha Berlin": "Hertha",
    "Mainz 05": "Mainz",
    "RasenBallsport Leipzig": "RB Leipzig",
    "SC Freiburg": "Freiburg",
    "SC Paderborn 07": "Paderborn",
    "SV 07 Elversberg": "Elversberg",
    "SV Darmstadt 98": "Darmstadt",
    "SV Werder Bremen": "Werder Bremen",
    "TSG 1899 Hoffenheim": "Hoffenheim",
    "VfB Stuttgart": "Stuttgart",
    "VfL Bochum 1848": "Bochum",
    "VfL Wolfsburg": "Wolfsburg",
    # Serie A: football-data.org, Understat y ESPN -> MatchHistory
    "AC Milan": "Milan",
    "AC Monza": "Monza",
    "AC Pisa 1909": "Pisa",
    "ACF Fiorentina": "Fiorentina",
    "AS Roma": "Roma",
    "Atalanta BC": "Atalanta",
    "Bologna FC 1909": "Bologna",
    "Cagliari Calcio": "Cagliari",
    "Como 1907": "Como",
    "Empoli FC": "Empoli",
    "FC Internazionale Milano": "Inter",
    "Frosinone Calcio": "Frosinone",
    "Genoa CFC": "Genoa",
    "Hellas Verona FC": "Verona",
    "Internazionale": "Inter",
    "Juventus FC": "Juventus",
    "Parma Calcio 1913": "Parma",
    "SS Lazio": "Lazio",
    "SSC Napoli": "Napoli",
    "Spezia Calcio": "Spezia",
    "Torino FC": "Torino",
    "UC Sampdoria": "Sampdoria",
    "US Cremonese": "Cremonese",
    "US Lecce": "Lecce",
    "US Salernitana 1919": "Salernitana",
    "US Sassuolo Calcio": "Sassuolo",
    "Udinese Calcio": "Udinese",
    "Venezia FC": "Venezia",
    # Ligas de contexto: ESPN y Pinnacle (Champions) -> MatchHistory
    "AEK Athens": "AEK",
    "Ajax Amsterdam": "Ajax",
    "FC Porto": "Porto",
    "Feyenoord Rotterdam": "Feyenoord",
    "Olympiacos": "Olympiakos",
    "Sporting CP": "Sp Lisbon",
    "Union St.-Gilloise": "St. Gilloise",
    "PSV": "PSV Eindhoven",
    # Pinnacle (Champions) -> ESPN, equipos de ligas que no cargamos
    "Viking": "Viking FK",
    # API de UEFA (designaciones de la Champions) -> ESPN
    "Bodø/Glimt": "Bodo/Glimt",
    "LASK": "LASK Linz",
    "Sabah": "Sabah FK",
    "Slavia Praha": "Slavia Prague",
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
