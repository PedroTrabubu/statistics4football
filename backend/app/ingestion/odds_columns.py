"""Extraccion de cuotas desde las columnas crudas de Football-Data.co.uk.

Los CSV de football-data.co.uk no tienen un esquema fijo: cada casa de apuestas
aporta sus propias columnas (con sufijo H/D/A para 1x2, >2.5/<2.5 para
over/under, AHH/AHA para hancicap asiatico) y no todas las columnas existen en
todas las temporadas/ligas. Por eso comprobamos la presencia de cada columna en
vez de asumir un set fijo: lo que no este en el CSV simplemente se omite.

Ver http://www.football-data.co.uk/notes.txt para el glosario de columnas.
"""

import pandas as pd

ONEXTWO_PREFIXES = {
    "B365": "Bet365",
    "BW": "Bet&Win",
    "PS": "Pinnacle",
    "WH": "William Hill",
    "VC": "VC Bet",
    "Avg": "Market Average",
    "Max": "Market Max",
    "B365C": "Bet365 (closing)",
    "PSC": "Pinnacle (closing)",
    "AvgC": "Market Average (closing)",
    "MaxC": "Market Max (closing)",
}

OU25_PREFIXES = {
    "B365": "Bet365",
    "P": "Pinnacle",
    "Avg": "Market Average",
    "Max": "Market Max",
    "B365C": "Bet365 (closing)",
    "PC": "Pinnacle (closing)",
    "AvgC": "Market Average (closing)",
    "MaxC": "Market Max (closing)",
}

AH_PREFIXES = {
    "B365": "Bet365",
    "P": "Pinnacle",
    "Avg": "Market Average",
    "Max": "Market Max",
    "B365C": "Bet365 (closing)",
    "PC": "Pinnacle (closing)",
    "AvgC": "Market Average (closing)",
    "MaxC": "Market Max (closing)",
}


def extract_1x2(row: pd.Series) -> list[dict]:
    odds = []
    for prefix, bookmaker in ONEXTWO_PREFIXES.items():
        for suffix, selection in (("H", "home"), ("D", "draw"), ("A", "away")):
            col = f"{prefix}{suffix}"
            if col in row.index and pd.notna(row[col]):
                odds.append(
                    {
                        "bookmaker": bookmaker,
                        "market": "1x2",
                        "selection": selection,
                        "odds": float(row[col]),
                        "line": None,
                    }
                )
    return odds


def extract_over_under_2_5(row: pd.Series) -> list[dict]:
    odds = []
    for prefix, bookmaker in OU25_PREFIXES.items():
        for suffix, selection in ((">2.5", "over"), ("<2.5", "under")):
            col = f"{prefix}{suffix}"
            if col in row.index and pd.notna(row[col]):
                odds.append(
                    {
                        "bookmaker": bookmaker,
                        "market": "over_under_2.5",
                        "selection": selection,
                        "odds": float(row[col]),
                        "line": 2.5,
                    }
                )
    return odds


def extract_asian_handicap(row: pd.Series) -> list[dict]:
    odds = []
    opening_line = row.get("AHh")
    closing_line = row.get("AHCh")
    for prefix, bookmaker in AH_PREFIXES.items():
        used_line = closing_line if prefix.endswith("C") else opening_line
        if used_line is None or pd.isna(used_line):
            continue
        for suffix, selection in (("AHH", "home"), ("AHA", "away")):
            col = f"{prefix}{suffix}"
            if col in row.index and pd.notna(row[col]):
                odds.append(
                    {
                        "bookmaker": bookmaker,
                        "market": "asian_handicap",
                        "selection": selection,
                        "odds": float(row[col]),
                        "line": float(used_line),
                    }
                )
    return odds


def extract_all_odds(row: pd.Series) -> list[dict]:
    return extract_1x2(row) + extract_over_under_2_5(row) + extract_asian_handicap(row)
