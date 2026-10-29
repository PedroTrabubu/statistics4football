"""result_predictions: porcentajes de resultado congelados por partido

Revision ID: f6a2c8e4d1b3
Revises: b1e6c4a8d2f7
Create Date: 2026-10-28 00:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f6a2c8e4d1b3'
down_revision: str | None = 'b1e6c4a8d2f7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'result_predictions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('match_id', sa.Integer(), nullable=False),
        sa.Column('version', sa.String(length=32), nullable=False),
        sa.Column('p_home', sa.Float(), nullable=True),
        sa.Column('p_draw', sa.Float(), nullable=True),
        sa.Column('p_away', sa.Float(), nullable=True),
        sa.Column('score_home', sa.Float(), nullable=True),
        sa.Column('score_draw', sa.Float(), nullable=True),
        sa.Column('score_away', sa.Float(), nullable=True),
        sa.Column('temperature', sa.Float(), nullable=True),
        sa.Column('elo_matches', sa.Integer(), nullable=True),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('kickoff', sa.DateTime(), nullable=False),
        sa.Column('generated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['match_id'], ['matches.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('match_id', 'version', name='uq_result_prediction_match_version'),
    )
    op.create_index(op.f('ix_result_predictions_match_id'), 'result_predictions', ['match_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_result_predictions_match_id'), table_name='result_predictions')
    op.drop_table('result_predictions')
