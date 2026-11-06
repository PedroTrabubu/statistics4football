"""match_forecasts: duelo de corners y predictor de estadisticas por partido

Revision ID: a7d3e9b2c4f1
Revises: f6a2c8e4d1b3
Create Date: 2026-11-03 00:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7d3e9b2c4f1'
down_revision: str | None = 'f6a2c8e4d1b3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'match_forecasts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('match_id', sa.Integer(), nullable=False),
        sa.Column('model', sa.String(length=16), nullable=False),
        sa.Column('stat', sa.String(length=16), nullable=False),
        sa.Column('version', sa.String(length=32), nullable=False),
        sa.Column('home', sa.Float(), nullable=True),
        sa.Column('away', sa.Float(), nullable=True),
        sa.Column('p_home', sa.Float(), nullable=True),
        sa.Column('p_draw', sa.Float(), nullable=True),
        sa.Column('p_away', sa.Float(), nullable=True),
        sa.Column('home_matches', sa.Integer(), nullable=True),
        sa.Column('away_matches', sa.Integer(), nullable=True),
        sa.Column('scope', sa.String(length=8), nullable=True),
        sa.Column('referee_factor', sa.Float(), nullable=True),
        sa.Column('referee_matches', sa.Integer(), nullable=True),
        sa.Column('league_home', sa.Float(), nullable=True),
        sa.Column('league_away', sa.Float(), nullable=True),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('kickoff', sa.DateTime(), nullable=False),
        sa.Column('generated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['match_id'], ['matches.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('match_id', 'model', 'stat', name='uq_match_forecast_match_model_stat'),
    )
    op.create_index(op.f('ix_match_forecasts_match_id'), 'match_forecasts', ['match_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_match_forecasts_match_id'), table_name='match_forecasts')
    op.drop_table('match_forecasts')
