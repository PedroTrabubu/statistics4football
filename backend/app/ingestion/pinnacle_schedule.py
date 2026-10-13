"""Cuando toca capturar una liga de Pinnacle (funciones puras).

Frecuencia segun lo que falta para el proximo partido de la liga:
- mas de 24 h: cada 6 h;
- en las ultimas 24 h: cada hora;
- en la ultima hora: cada 12 min;
- y una captura final ~3 min antes de cada hora de inicio (sera el cierre).

Una pasada captura la liga entera (dos peticiones), asi que los partidos que
empiezan a la vez comparten pasada, y un partido cercano al inicio no dispara
otra si ya hay una captura en sus ultimos 6 minutos. Nunca dos pasadas de una
misma liga con menos de 2 minutos entre ellas. Tras una pasada fallida se
reintenta a los 10 minutos, no antes.
"""

from datetime import datetime, timedelta

FAR_INTERVAL = timedelta(hours=6)
DAY_INTERVAL = timedelta(hours=1)
LAST_HOUR_INTERVAL = timedelta(minutes=12)
FINAL_LEAD = timedelta(minutes=3)
FINAL_WINDOW = timedelta(minutes=6)
MIN_GAP = timedelta(minutes=2)
RETRY_AFTER_FAILURE = timedelta(minutes=10)


def capture_interval(until_start: timedelta | None) -> timedelta:
    """Cada cuanto capturar con el proximo partido a `until_start` (None: no hay)."""
    if until_start is None or until_start > timedelta(hours=24):
        return FAR_INTERVAL
    if until_start > timedelta(hours=1):
        return DAY_INTERVAL
    return LAST_HOUR_INTERVAL


def next_capture_at(last: datetime | None, starts: list[datetime], now: datetime) -> datetime:
    """Cuando toca la siguiente pasada de una liga, dada la ultima (None: nunca)
    y las horas de inicio de sus partidos."""
    if last is None:
        return now
    upcoming = sorted(s for s in starts if s > now)
    nearest = upcoming[0] if upcoming else None
    due = last + capture_interval(nearest - now if nearest else None)
    for start in upcoming:
        if last >= start - FINAL_WINDOW:
            continue  # ya hay una captura en los ultimos minutos antes de ese inicio
        due = min(due, start - FINAL_LEAD)
    return max(due, last + MIN_GAP)


def is_due(
    last: datetime | None,
    starts: list[datetime],
    now: datetime,
    last_failure: datetime | None = None,
) -> bool:
    """`last`: ultima pasada buena; `last_failure`: ultima fallida, si es posterior."""
    if last_failure is not None and (last is None or last_failure > last):
        if now - last_failure < RETRY_AFTER_FAILURE:
            return False
    return next_capture_at(last, starts, now) <= now
