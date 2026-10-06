"""pick_combos y pick_legs: combinadas de la seccion Picks

Revision ID: a7c3e9f1b2d4
Revises: b7d3e5a9c1f4
Create Date: 2026-10-01 00:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c3e9f1b2d4'
down_revision: str | None = 'b7d3e5a9c1f4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'pick_combos',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('source', sa.String(16), nullable=False),
        sa.Column('window', sa.String(10), nullable=False),
        sa.Column('scope', sa.String(32), nullable=False),
        sa.Column('kind', sa.String(16), nullable=False),
        sa.Column('prob', sa.Float(), nullable=False),
        sa.Column('odds', sa.Float(), nullable=False),
        sa.Column('odds_kind', sa.String(16), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    for column in ('source', 'window', 'scope', 'kind'):
        op.create_index(f'ix_pick_combos_{column}', 'pick_combos', [column])

    op.create_table(
        'pick_legs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('combo_id', sa.Integer(), sa.ForeignKey('pick_combos.id', ondelete='CASCADE'), nullable=False),
        sa.Column('match_id', sa.Integer(), sa.ForeignKey('matches.id'), nullable=False),
        sa.Column('market', sa.String(32), nullable=False),
        sa.Column('selection', sa.String(16), nullable=False),
        sa.Column('line', sa.Float(), nullable=True),
        sa.Column('family', sa.String(32), nullable=False),
        sa.Column('prob', sa.Float(), nullable=False),
        sa.Column('odds', sa.Float(), nullable=False),
        sa.Column('odds_kind', sa.String(16), nullable=False),
    )
    op.create_index('ix_pick_legs_combo_id', 'pick_legs', ['combo_id'])
    op.create_index('ix_pick_legs_match_id', 'pick_legs', ['match_id'])


def downgrade() -> None:
    op.drop_table('pick_legs')
    op.drop_table('pick_combos')
