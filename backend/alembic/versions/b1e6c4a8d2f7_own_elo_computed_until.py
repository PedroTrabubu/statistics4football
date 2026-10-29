"""own_elo_pre: ultimo resultado incluido en cada rating ("Elo calculado hasta")

Revision ID: b1e6c4a8d2f7
Revises: d3f7a1c9e5b2
Create Date: 2026-10-28 00:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1e6c4a8d2f7'
down_revision: str | None = 'd3f7a1c9e5b2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('own_elo_pre') as batch_op:
        batch_op.add_column(sa.Column('computed_until', sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('own_elo_pre') as batch_op:
        batch_op.drop_column('computed_until')
