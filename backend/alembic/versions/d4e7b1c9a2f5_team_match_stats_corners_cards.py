"""team_match_stats: corners/tarjetas/faltas (ya venian en el CSV de MatchHistory,
sin usar hasta ahora)

Revision ID: d4e7b1c9a2f5
Revises: a1c4f9d2e0b3
Create Date: 2026-09-16 00:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e7b1c9a2f5'
down_revision: str | None = 'a1c4f9d2e0b3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('team_match_stats') as batch_op:
        batch_op.add_column(sa.Column('corners_for', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('corners_against', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('fouls', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('yellow_cards', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('red_cards', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('team_match_stats') as batch_op:
        batch_op.drop_column('red_cards')
        batch_op.drop_column('yellow_cards')
        batch_op.drop_column('fouls')
        batch_op.drop_column('corners_against')
        batch_op.drop_column('corners_for')
