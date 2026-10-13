"""Consultas sobre las capturas de Pinnacle: apertura, cierre, primera
aparicion de cada mercado y lo que necesita el programador de capturas.

Definiciones (las mismas que las vistas pinnacle_opening_odds,
pinnacle_closing_odds y pinnacle_market_first_seen, ver
app/db/models/pinnacle.py):
- Apertura de una cuota: su primera captura.
- Cierre: su estado en la ultima captura del partido anterior a su hora de
  inicio (la de Pinnacle en su ultima captura). Si en esa captura estaba
  retirada, no tiene cierre.
- Primera aparicion de un mercado: la primera captura con alguna cuota suya.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.models import PinnacleCapture, PinnacleMatchSnapshot
from app.db.models.pinnacle import CLOSING_SQL, FIRST_SEEN_SQL, OPENING_SQL


# SQLite devuelve como texto las fechas de una consulta en SQL directo.
_DATETIME_COLUMNS = ("captured_at", "closed_at", "first_seen_at")


def _rows(db: Session, sql: str) -> list[dict]:
    rows = []
    for row in db.execute(text(sql)).mappings():
        row = dict(row)
        for col in _DATETIME_COLUMNS:
            if isinstance(row.get(col), str):
                row[col] = datetime.fromisoformat(row[col])
        rows.append(row)
    return rows


def first_seen(db: Session) -> list[dict]:
    return _rows(db, FIRST_SEEN_SQL)


def opening_prices(db: Session) -> list[dict]:
    return _rows(db, OPENING_SQL)


def closing_prices(db: Session) -> list[dict]:
    return _rows(db, CLOSING_SQL)


def matchup_match_ids(db: Session) -> dict[int, int]:
    """Partido de Pinnacle -> partido de la BD, con el ultimo cruce conocido
    (un partido sin cruzar al principio puede cruzarse despues)."""
    rows = (
        db.query(PinnacleMatchSnapshot.matchup_id, PinnacleMatchSnapshot.match_id)
        .filter(PinnacleMatchSnapshot.match_id.is_not(None))
        .order_by(PinnacleMatchSnapshot.id)
        .all()
    )
    return {matchup_id: match_id for matchup_id, match_id in rows}


def closing_max_stakes(db: Session) -> dict[int, float | None]:
    """Apuesta maxima del 1X2 en la captura de cierre de cada partido de Pinnacle."""
    out: dict[int, float | None] = {}
    rows = (
        db.query(PinnacleMatchSnapshot, PinnacleCapture.captured_at)
        .join(PinnacleCapture, PinnacleCapture.id == PinnacleMatchSnapshot.capture_id)
        .order_by(PinnacleMatchSnapshot.id)
        .all()
    )
    starts = {snap.matchup_id: snap.start_time for snap, _ in rows}
    for snap, captured_at in rows:
        if captured_at < starts[snap.matchup_id]:
            out[snap.matchup_id] = snap.max_stake
    return out


def last_captures(db: Session, league_code: str) -> tuple[PinnacleCapture | None, PinnacleCapture | None]:
    """La ultima pasada buena y la ultima fallida de una liga."""
    base = db.query(PinnacleCapture).filter(PinnacleCapture.league_code == league_code)
    ok = base.filter(PinnacleCapture.status == "ok").order_by(PinnacleCapture.captured_at.desc()).first()
    failed = base.filter(PinnacleCapture.status == "failed").order_by(PinnacleCapture.captured_at.desc()).first()
    return ok, failed


def upcoming_starts(db: Session, capture: PinnacleCapture | None, now: datetime) -> list[datetime]:
    """Horas de inicio aun por llegar de los partidos de una pasada (la ultima
    buena de la liga): de ahi sale cuando toca la siguiente."""
    if capture is None:
        return []
    rows = (
        db.query(PinnacleMatchSnapshot.start_time)
        .filter(PinnacleMatchSnapshot.capture_id == capture.id, PinnacleMatchSnapshot.start_time > now)
        .all()
    )
    return sorted({start for (start,) in rows})
