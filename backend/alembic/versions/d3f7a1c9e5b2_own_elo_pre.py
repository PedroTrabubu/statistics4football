"""own_elo_pre: Elo propio de cada equipo antes de cada partido

Revision ID: d3f7a1c9e5b2
Revises: e4b7c2d9f1a6
Create Date: 2026-10-28 00:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3f7a1c9e5b2'
down_revision: str | None = 'e4b7c2d9f1a6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'own_elo_pre',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('match_id', sa.Integer(), nullable=False),
        sa.Column('team_id', sa.Integer(), nullable=False),
        sa.Column('elo', sa.Float(), nullable=False),
        sa.Column('matches_rated', sa.Integer(), nullable=False),
        sa.Column('is_final', sa.Boolean(), nullable=False),
        sa.Column('version', sa.String(length=32), nullable=False),
        sa.Column('generated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['match_id'], ['matches.id']),
        sa.ForeignKeyConstraint(['team_id'], ['teams.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('match_id', 'team_id', name='uq_own_elo_pre_match_team'),
    )
    op.create_index(op.f('ix_own_elo_pre_match_id'), 'own_elo_pre', ['match_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_own_elo_pre_match_id'), table_name='own_elo_pre')
    op.drop_table('own_elo_pre')
