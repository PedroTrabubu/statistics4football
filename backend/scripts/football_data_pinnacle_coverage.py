"""Cobertura de las cuotas de Pinnacle en los CSV de Football-Data.co.uk y en
la base, por liga y temporada.

Las cuotas ya se importan con la ingesta historica (scripts/ingest_historical.py
y, la temporada en curso, scripts/ingest_fixtures.py) en match_odds, cruzadas
por liga, fecha y equipos con el mapa de alias. Origen y momento quedan en el
nombre de la casa (ver app/ingestion/odds_columns.py):
- "Pinnacle (closing)": columnas PSCH/PSCD/PSCA (1X2), PC>2.5/PC<2.5 y
  PCAHH/PCAHA con la linea AHCh. Es el cierre.
- "Pinnacle": PSH/PSD/PSA, P>2.5/P<2.5 y PAHH/PAHA con AHh. Es la toma de
  Football-Data: viernes por la tarde (fin de semana) o martes (entre semana).

Este script no descarga ni escribe nada: lee los CSV de la cache de
soccerdata (sus nombres de columna reales) y comprueba que lo importado
coincide con ellos.

Uso (desde backend/, con el venv activado):
    python scripts/football_data_pinnacle_coverage.py
"""

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.db.models import League, Match, MatchOdds, Season  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402

FILE_CODE = {"ENG-Premier League": "E0", "ESP-La Liga": "SP1", "ESP-La Liga 2": "SP2", "FRA-Ligue 1": "F1"}
PINNACLE_PREFIXES = ("PS", "PSC", "P>", "P<", "PC>", "PC<", "PAH", "PCAH")


def read_csv(path: Path) -> pd.DataFrame:
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            return pd.read_csv(path, encoding=encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError(f"no se pudo leer {path}")


def main() -> None:
    cache = Path(get_settings().soccerdata_dir) / "data" / "MatchHistory"
    db = SessionLocal()
    try:
        print("liga | temporada | partidos CSV | columnas de Pinnacle en el CSV | cierre 1X2 (CSV / BD) | "
              "cierre más/menos 2.5 (CSV / BD) | último partido con cierre")  # fmt: skip
        for code, file_code in FILE_CODE.items():
            league = db.query(League).filter_by(code=code).one_or_none()
            if league is None:
                continue
            for season in db.query(Season).filter_by(league_id=league.id).order_by(Season.name):
                path = cache / f"{file_code}_{season.name}.csv"
                if not path.exists():
                    print(f"{code} | {season.name} | sin CSV en la caché")
                    continue
                df = read_csv(path)
                cols = [c for c in df.columns if c.startswith(PINNACLE_PREFIXES)]
                close_1x2 = int(df["PSCH"].notna().sum()) if "PSCH" in df else 0
                close_ou = int(df["PC>2.5"].notna().sum()) if "PC>2.5" in df else 0
                last = df.loc[df["PSCH"].notna(), "Date"].iloc[-1] if close_1x2 else "—"

                def in_db(market: str) -> int:
                    return (
                        db.query(MatchOdds.match_id)
                        .join(Match, Match.id == MatchOdds.match_id)
                        .filter(
                            Match.season_id == season.id,
                            MatchOdds.bookmaker == "Pinnacle (closing)",
                            MatchOdds.market == market,
                        )
                        .distinct()
                        .count()
                    )

                print(
                    f"{code} | {season.name} | {len(df)} | {' '.join(cols) or 'ninguna'} | "
                    f"{close_1x2} / {in_db('1x2')} | {close_ou} / {in_db('over_under_2.5')} | {last}"
                )
    finally:
        db.close()


if __name__ == "__main__":
    main()
