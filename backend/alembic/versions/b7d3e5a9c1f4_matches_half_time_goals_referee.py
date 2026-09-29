"""matches: goles al descanso y arbitro (HTHG/HTAG/Referee del CSV de
MatchHistory y score.halfTime/referees de football-data.org)

Revision ID: b7d3e5a9c1f4
Revises: f2a8c6d1b7e3
Create Date: 2026-09-29 00:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7d3e5a9c1f4'
down_revision: str | None = 'f2a8c6d1b7e3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('matches') as batch_op:
        batch_op.add_column(sa.Column('home_ht_goals', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('away_ht_goals', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('referee', sa.String(length=100), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('matches') as batch_op:
        batch_op.drop_column('referee')
        batch_op.drop_column('away_ht_goals')
        batch_op.drop_column('home_ht_goals')
