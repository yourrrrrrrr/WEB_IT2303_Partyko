"""create recommended_playlists

Revision ID: 1f2337e9ecc9
Revises: 
Create Date: 2026-03-05 01:35:37.057951

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1f2337e9ecc9'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():
    op.create_table(
        'recommended_playlists',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('customer_id', sa.Integer, sa.ForeignKey('customer.customer_id')),
        sa.Column('track_id', sa.Integer, sa.ForeignKey('track.track_id')),
        sa.Column('reason', sa.String),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now()),
    )

    op.create_index('idx_customer_track', 'recommended_playlists', ['customer_id', 'track_id'])
    op.create_index('ix_customer_id', 'recommended_playlists', ['customer_id'])
    op.create_index('ix_track_id', 'recommended_playlists', ['track_id'])


def downgrade():
    op.drop_table('recommended_playlists')
