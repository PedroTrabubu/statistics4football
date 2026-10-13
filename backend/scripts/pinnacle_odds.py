"""Cuotas actuales de Pinnacle de los proximos partidos, cruzadas con los de la BD.

Solo lee, no guarda nada: sirve para comprobar que la API responde, que los
nombres de equipo cuadran y que cuotas hay (goles, corners y tarjetas). Para
guardarlas con su hora, scripts/pinnacle_capture.py. Hace dos peticiones por
liga.

Uso (desde backend/, con el venv activado):
    python scripts/pinnacle_odds.py                  # las cuatro ligas
    python scripts/pinnacle_odds.py "ESP-La Liga"
"""

import logging
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.models import League
from app.db.session import SessionLocal
from app.ingestion.pinnacle import LEAGUE_IDS, PinnacleClient, main_total, moneyline
from app.ingestion.pinnacle_capture import find_match
from app.ingestion.team_names import TeamResolver


def _total(line: tuple[float, float, float] | None) -> str:
    return "—" if line is None else f"{line[0]:g}: {line[1]:.2f}/{line[2]:.2f}"


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    leagues = sys.argv[1:] or list(LEAGUE_IDS)

    db = SessionLocal()
    try:
        resolver = TeamResolver(db)
        with PinnacleClient() as client:
            for code in leagues:
                league = db.query(League).filter_by(code=code).one()
                matches, odds = client.league_odds(code)
                by_units = Counter(o.units for o in odds)
                print(f"\n{code}: {len(matches)} partidos · cuotas: {dict(by_units)}")
                print("  partido | 1X2 | goles (más/menos) | córners | tarjetas")
                for pm in sorted(matches.values(), key=lambda m: m.start):
                    ours = find_match(db, league.id, resolver, pm)
                    label = f"#{ours.id}" if ours else "sin partido en la BD"
                    ml = moneyline(odds, pm.matchup_id)
                    onextwo = " ".join(f"{ml[s]:.2f}" for s in ("home", "draw", "away") if s in ml) or "—"
                    print(
                        f"  {pm.start:%d/%m %H:%M} {pm.home} - {pm.away} [{label}] | {onextwo} | "
                        f"{_total(main_total(odds, pm.matchup_id, 'goals'))} | "
                        f"{_total(main_total(odds, pm.matchup_id, 'corners'))} | "
                        f"{_total(main_total(odds, pm.matchup_id, 'bookings'))}"
                    )
            print(f"\nPeticiones a Pinnacle: {client.requests}")
        if resolver.unresolved:
            print(f"Nombres sin equipo en la BD: {sorted(resolver.unresolved)}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
