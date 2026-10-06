"""matches.date a UTC en los partidos cargados del CSV (hora de Reino Unido)

Los partidos de football-data.org ya estaban en UTC; los que solo vienen del
CSV de Football-Data.co.uk guardaban la hora de Reino Unido. Desde ahora toda
la base guarda UTC sin zona.

Revision ID: c5e8a2d4f6b1
Revises: a7c3e9f1b2d4
Create Date: 2026-10-01 00:00:00.000000

"""
import json
from collections.abc import Sequence
from datetime import datetime
from zoneinfo import ZoneInfo

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c5e8a2d4f6b1'
down_revision: str | None = 'a7c3e9f1b2d4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UK = ZoneInfo("Europe/London")
UTC = ZoneInfo("UTC")


def _csv_only_matches(bind) -> list[tuple[int, datetime]]:
    rows = bind.execute(sa.text("SELECT id, date, source_ids FROM matches")).fetchall()
    out = []
    for match_id, date, source_ids in rows:
        ids = json.loads(source_ids) if isinstance(source_ids, str) else (source_ids or {})
        if "football_data_org_match_id" in ids:
            continue
        if isinstance(date, str):
            date = datetime.fromisoformat(date)
        out.append((match_id, date))
    return out


def _shift(convert) -> None:
    bind = op.get_bind()
    for match_id, date in _csv_only_matches(bind):
        new_date = convert(date)
        bind.execute(sa.text("UPDATE matches SET date = :d WHERE id = :i"), {"d": new_date, "i": match_id})
        # Las cuotas del CSV usan la hora del partido como momento de captura.
        bind.execute(
            sa.text("UPDATE match_odds SET snapshot_time = :d WHERE match_id = :i AND snapshot_time = :old"),
            {"d": new_date, "i": match_id, "old": date},
        )


def upgrade() -> None:
    _shift(lambda d: d.replace(tzinfo=UK).astimezone(UTC).replace(tzinfo=None))


def downgrade() -> None:
    _shift(lambda d: d.replace(tzinfo=UTC).astimezone(UK).replace(tzinfo=None))
