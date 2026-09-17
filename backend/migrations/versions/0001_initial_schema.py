"""initial schema

Revision ID: 0001_initial_schema
Revises: 
Create Date: 2026-09-17 20:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0001_initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Stations table
    op.create_table(
        'stations',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=50), nullable=False),
        sa.Column('tier', sa.String(length=20), nullable=False),
        sa.Column('hourly_rate', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('status', sa.String(length=20), server_default='AVAILABLE', nullable=False),
        sa.CheckConstraint(
            "status IN ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE')",
            name='ck_station_status'
        ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_stations_name'), 'stations', ['name'], unique=True)

    # 2. Sessions table
    op.create_table(
        'sessions',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('station_id', sa.UUID(), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.String(length=20), server_default='ACTIVE', nullable=False),
        sa.Column('total_amount', sa.Numeric(precision=10, scale=2), server_default='0.00', nullable=False),
        sa.CheckConstraint(
            "status IN ('ACTIVE', 'COMPLETED', 'TRANSFERRED', 'CANCELLED')",
            name='ck_session_status'
        ),
        sa.ForeignKeyConstraint(['station_id'], ['stations.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(
        'uq_active_station_session',
        'sessions',
        ['station_id'],
        unique=True,
        postgresql_where=sa.text("status = 'ACTIVE'")
    )

    # 3. Menu items table
    op.create_table(
        'menu_items',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('category', sa.String(length=50), nullable=False),
        sa.Column('price', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('is_available', sa.Boolean(), server_default='true', nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name')
    )

    # 4. Orders table
    op.create_table(
        'orders',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('session_id', sa.UUID(), nullable=False),
        sa.Column('status', sa.String(length=20), server_default='QUEUED', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint(
            "status IN ('QUEUED', 'PREPARING', 'SERVED', 'CANCELLED')",
            name='ck_order_status'
        ),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )

    # 5. Order items table
    op.create_table(
        'order_items',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('order_id', sa.UUID(), nullable=False),
        sa.Column('menu_item_id', sa.UUID(), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('unit_price', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.CheckConstraint('quantity > 0', name='ck_order_item_quantity_positive'),
        sa.ForeignKeyConstraint(['menu_item_id'], ['menu_items.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )

    # 6. Payments table
    op.create_table(
        'payments',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('session_id', sa.UUID(), nullable=False),
        sa.Column('amount', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('method', sa.String(length=20), nullable=False),
        sa.Column('status', sa.String(length=20), server_default='PENDING', nullable=False),
        sa.Column('idempotency_key', sa.String(length=64), nullable=False),
        sa.CheckConstraint("method IN ('CASH', 'UPI')", name='ck_payment_method'),
        sa.CheckConstraint("status IN ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED')", name='ck_payment_status'),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_payments_idempotency_key'), 'payments', ['idempotency_key'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_payments_idempotency_key'), table_name='payments')
    op.drop_table('payments')
    op.drop_table('order_items')
    op.drop_table('orders')
    op.drop_table('menu_items')
    op.drop_index('uq_active_station_session', table_name='sessions')
    op.drop_table('sessions')
    op.drop_index(op.f('ix_stations_name'), table_name='stations')
    op.drop_table('stations')
