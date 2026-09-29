"""model_predictions: prob_market_implied/ev nullable (predicciones sin cuotas)

Revision ID: a1c4f9d2e0b3
Revises: 6b88b1e471a7
Create Date: 2026-09-13 00:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1c4f9d2e0b3'
down_revision: str | None = '6b88b1e471a7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('model_predictions') as batch_op:
        batch_op.alter_column('prob_market_implied', existing_type=sa.Float(), nullable=True)
        batch_op.alter_column('ev', existing_type=sa.Float(), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table('model_predictions') as batch_op:
        batch_op.alter_column('ev', existing_type=sa.Float(), nullable=False)
        batch_op.alter_column('prob_market_implied', existing_type=sa.Float(), nullable=False)
