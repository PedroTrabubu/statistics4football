"""matches: jornada (exacta de football-data.org o deducida de las fechas)

Revision ID: b9f2d6e4a8c3
Revises: c5e8a2d4f6b1
Create Date: 2026-10-08 00:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b9f2d6e4a8c3'
down_revision: str | None = 'c5e8a2d4f6b1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('matches') as batch_op:
        batch_op.add_column(sa.Column('matchday', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('matchday_estimated', sa.Boolean(), nullable=False, server_default='0'))
        batch_op.create_index('ix_matches_matchday', ['matchday'])


def downgrade() -> None:
    with op.batch_alter_table('matches') as batch_op:
        batch_op.drop_index('ix_matches_matchday')
        batch_op.drop_column('matchday_estimated')
        batch_op.drop_column('matchday')
