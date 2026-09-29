"""model_predictions: matches_used (tamano de muestra real, no solo confidence)

Revision ID: f2a8c6d1b7e3
Revises: d4e7b1c9a2f5
Create Date: 2026-09-17 00:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f2a8c6d1b7e3'
down_revision: str | None = 'd4e7b1c9a2f5'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('model_predictions') as batch_op:
        batch_op.add_column(sa.Column('matches_used', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    with op.batch_alter_table('model_predictions') as batch_op:
        batch_op.drop_column('matches_used')
