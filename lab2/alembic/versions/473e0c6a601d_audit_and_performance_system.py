"""audit and performance system

Revision ID: 473e0c6a601d
Revises: 1f2337e9ecc9
Create Date: 2026-03-05 02:11:44.440543

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '473e0c6a601d'
down_revision: Union[str, Sequence[str], None] = '1f2337e9ecc9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():

    # ======================================
    # Таблицы
    # ======================================

    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("timestamp", sa.DateTime, server_default=sa.func.now()),
        sa.Column("operation_type", sa.String(10), nullable=False),
        sa.Column("table_name", sa.String(100), nullable=False),
        sa.Column("record_id", sa.Integer),
        sa.Column("old_values", sa.JSON),
        sa.Column("new_values", sa.JSON),
        sa.Column("user_id", sa.String(100))
    )

    op.create_table(
        "invoice_history",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("invoice_id", sa.Integer),
        sa.Column("operation_type", sa.String(10)),
        sa.Column("changed_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("old_data", sa.JSON),
        sa.Column("new_data", sa.JSON)
    )

    op.create_table(
        "customer_activity",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("customer_id", sa.Integer),
        sa.Column("activity_type", sa.String(50)),
        sa.Column("activity_time", sa.DateTime, server_default=sa.func.now()),
        sa.Column("activity_metadata", sa.JSON)
    )

    op.create_table(
        "query_performance",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("query_hash", sa.String(64), unique=True),
        sa.Column("query_text", sa.Text),
        sa.Column("execution_count", sa.Integer),
        sa.Column("total_time", sa.Float),
        sa.Column("min_time", sa.Float),
        sa.Column("max_time", sa.Float),
        sa.Column("last_executed", sa.DateTime)
    )

    # ======================================
    # 1️⃣ Trigger: Новый Invoice
    # ======================================

    op.execute("""
    CREATE OR REPLACE FUNCTION log_invoice_insert()
    RETURNS TRIGGER AS $$
    BEGIN
        INSERT INTO audit_log (
            operation_type,
            table_name,
            record_id,
            new_values
        )
        VALUES (
            'INSERT',
            'invoice',
            NEW."InvoiceId",
            row_to_json(NEW)
        );

        INSERT INTO invoice_history (
            invoice_id,
            operation_type,
            new_data
        )
        VALUES (
            NEW."InvoiceId",
            'INSERT',
            row_to_json(NEW)
        );

        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    """)

    op.execute("""
    CREATE TRIGGER trg_invoice_insert
    AFTER INSERT ON invoice
    FOR EACH ROW
    EXECUTE FUNCTION log_invoice_insert();
    """)

    # ======================================
    # 2️⃣ Trigger: UPDATE Customer
    # ======================================

    op.execute("""
    CREATE OR REPLACE FUNCTION log_customer_update()
    RETURNS TRIGGER AS $$
    BEGIN
        INSERT INTO audit_log (
            operation_type,
            table_name,
            record_id,
            old_values,
            new_values
        )
        VALUES (
            'UPDATE',
            'customer',
            NEW."CustomerId",
            row_to_json(OLD),
            row_to_json(NEW)
        );

        INSERT INTO customer_activity (
            customer_id,
            activity_type,
            activity_metadata
        )
        VALUES (
            NEW."CustomerId",
            'PROFILE_UPDATE',
            row_to_json(NEW)
        );

        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    """)

    op.execute("""
    CREATE TRIGGER trg_customer_update
    AFTER UPDATE ON customer
    FOR EACH ROW
    EXECUTE FUNCTION log_customer_update();
    """)

    # ======================================
    # 3️⃣ Trigger: DELETE из recommended_playlists
    # ======================================

    op.execute("""
    CREATE OR REPLACE FUNCTION log_playlist_delete()
    RETURNS TRIGGER AS $$
    BEGIN
        INSERT INTO audit_log (
            operation_type,
            table_name,
            record_id,
            old_values
        )
        VALUES (
            'DELETE',
            'recommended_playlists',
            OLD.id,
            row_to_json(OLD)
        );

        RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;
    """)

    op.execute("""
    CREATE TRIGGER trg_playlist_delete
    AFTER DELETE ON recommended_playlists
    FOR EACH ROW
    EXECUTE FUNCTION log_playlist_delete();
    """)
    

def downgrade():

    op.execute("DROP TRIGGER IF EXISTS trg_invoice_insert ON invoice;")
    op.execute("DROP FUNCTION IF EXISTS log_invoice_insert;")

    op.execute("DROP TRIGGER IF EXISTS trg_customer_update ON customer;")
    op.execute("DROP FUNCTION IF EXISTS log_customer_update;")

    op.execute("DROP TRIGGER IF EXISTS trg_playlist_delete ON recommended_playlists;")
    op.execute("DROP FUNCTION IF EXISTS log_playlist_delete;")

    op.drop_table("query_performance")
    op.drop_table("customer_activity")
    op.drop_table("invoice_history")
    op.drop_table("audit_log")