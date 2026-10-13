"""pinnacle: capturas de cuotas solo de anadir, con apertura y cierre

Tablas propias (no match_odds, que se reescribe en cada ingesta) y tres
vistas: primera aparicion de cada mercado, apertura y cierre. El SQL de las
vistas es una copia fija del de app/db/models/pinnacle.py (un test comprueba
que coinciden).

Revision ID: e4b7c2d9f1a6
Revises: b9f2d6e4a8c3
Create Date: 2026-10-10 00:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e4b7c2d9f1a6'
down_revision: str | None = 'b9f2d6e4a8c3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_KEY = "o.matchup_id, o.units, o.period, o.market, o.team, o.selection, o.line"

FIRST_SEEN_SQL = """
SELECT o.matchup_id AS matchup_id, MAX(o.match_id) AS match_id, o.units AS units, o.period AS period,
       o.market AS market, MIN(o.captured_at) AS first_seen_at
FROM pinnacle_odds o
WHERE o.is_removed = 0
GROUP BY o.matchup_id, o.units, o.period, o.market
"""

OPENING_SQL = f"""
SELECT * FROM (
  SELECT o.*, ROW_NUMBER() OVER (PARTITION BY {_KEY} ORDER BY o.captured_at, o.id) AS rn
  FROM pinnacle_odds o
  WHERE o.is_removed = 0
) WHERE rn = 1
"""

CLOSING_SQL = f"""
SELECT * FROM (
  SELECT o.*, cl.closed_at AS closed_at,
         ROW_NUMBER() OVER (PARTITION BY {_KEY} ORDER BY o.captured_at DESC, o.id DESC) AS rn
  FROM pinnacle_odds o
  JOIN (
    SELECT s.matchup_id AS matchup_id, MAX(c.captured_at) AS closed_at
    FROM pinnacle_match_snapshots s
    JOIN pinnacle_captures c ON c.id = s.capture_id
    JOIN pinnacle_match_snapshots last ON last.id = (
      SELECT MAX(s2.id) FROM pinnacle_match_snapshots s2 WHERE s2.matchup_id = s.matchup_id
    )
    WHERE c.captured_at < last.start_time
    GROUP BY s.matchup_id
  ) cl ON cl.matchup_id = o.matchup_id
  WHERE o.captured_at <= cl.closed_at
) WHERE rn = 1 AND is_removed = 0
"""

VIEWS = {
    "pinnacle_market_first_seen": FIRST_SEEN_SQL,
    "pinnacle_opening_odds": OPENING_SQL,
    "pinnacle_closing_odds": CLOSING_SQL,
}


def upgrade() -> None:
    op.create_table(
        'pinnacle_captures',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('source', sa.String(length=32), nullable=False),
        sa.Column('league_code', sa.String(length=64), nullable=False),
        sa.Column('captured_at', sa.DateTime(), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('requests', sa.Integer(), nullable=False),
        sa.Column('n_matchups', sa.Integer(), nullable=False),
        sa.Column('n_matched', sa.Integer(), nullable=False),
        sa.Column('n_live_skipped', sa.Integer(), nullable=False),
        sa.Column('n_prices', sa.Integer(), nullable=False),
        sa.Column('n_rows_written', sa.Integer(), nullable=False),
        sa.Column('n_removed', sa.Integer(), nullable=False),
        sa.Column('warnings', sa.Text(), nullable=True),
        sa.Column('raw_path', sa.String(length=512), nullable=True),
        sa.Column('raw_bytes', sa.Integer(), nullable=True),
    )
    op.create_index('ix_pinnacle_captures_league_code', 'pinnacle_captures', ['league_code'])
    op.create_index('ix_pinnacle_captures_captured_at', 'pinnacle_captures', ['captured_at'])

    op.create_table(
        'pinnacle_match_snapshots',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('capture_id', sa.Integer(), sa.ForeignKey('pinnacle_captures.id'), nullable=False),
        sa.Column('matchup_id', sa.BigInteger(), nullable=False),
        sa.Column('match_id', sa.Integer(), sa.ForeignKey('matches.id'), nullable=True),
        sa.Column('home', sa.String(length=100), nullable=False),
        sa.Column('away', sa.String(length=100), nullable=False),
        sa.Column('start_time', sa.DateTime(), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=True),
        sa.Column('is_live', sa.Boolean(), nullable=False),
        sa.Column('cutoff_at', sa.DateTime(), nullable=True),
        sa.Column('version', sa.BigInteger(), nullable=True),
        sa.Column('max_stake', sa.Float(), nullable=True),
        sa.Column('n_prices', sa.Integer(), nullable=False),
        sa.UniqueConstraint('capture_id', 'matchup_id', name='uq_pinnacle_snapshot_capture_matchup'),
    )
    op.create_index('ix_pinnacle_match_snapshots_capture_id', 'pinnacle_match_snapshots', ['capture_id'])
    op.create_index('ix_pinnacle_match_snapshots_matchup_id', 'pinnacle_match_snapshots', ['matchup_id'])
    op.create_index('ix_pinnacle_match_snapshots_match_id', 'pinnacle_match_snapshots', ['match_id'])

    op.create_table(
        'pinnacle_odds',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('capture_id', sa.Integer(), sa.ForeignKey('pinnacle_captures.id'), nullable=False),
        sa.Column('captured_at', sa.DateTime(), nullable=False),
        sa.Column('matchup_id', sa.BigInteger(), nullable=False),
        sa.Column('match_id', sa.Integer(), sa.ForeignKey('matches.id'), nullable=True),
        sa.Column('units', sa.String(length=16), nullable=False),
        sa.Column('period', sa.Integer(), nullable=False),
        sa.Column('market', sa.String(length=32), nullable=False),
        sa.Column('team', sa.String(length=8), nullable=True),
        sa.Column('selection', sa.String(length=16), nullable=False),
        sa.Column('line', sa.Float(), nullable=True),
        sa.Column('odds', sa.Float(), nullable=True),
        sa.Column('max_stake', sa.Float(), nullable=True),
        sa.Column('market_key', sa.String(length=64), nullable=True),
        sa.Column('market_version', sa.BigInteger(), nullable=True),
        sa.Column('alternate', sa.Boolean(), nullable=True),
        sa.Column('is_removed', sa.Boolean(), nullable=False),
    )
    # La tabla que mas crece: solo el indice por partido de la BD y el de la
    # clave de cada cuota (empieza por matchup_id).
    op.create_index('ix_pinnacle_odds_match_id', 'pinnacle_odds', ['match_id'])
    op.create_index(
        'ix_pinnacle_odds_key',
        'pinnacle_odds',
        ['matchup_id', 'units', 'period', 'market', 'team', 'selection', 'line'],
    )

    for name, sql in VIEWS.items():
        op.execute(f"CREATE VIEW {name} AS {sql}")


def downgrade() -> None:
    for name in VIEWS:
        op.execute(f"DROP VIEW IF EXISTS {name}")
    op.drop_table('pinnacle_odds')
    op.drop_table('pinnacle_match_snapshots')
    op.drop_table('pinnacle_captures')
