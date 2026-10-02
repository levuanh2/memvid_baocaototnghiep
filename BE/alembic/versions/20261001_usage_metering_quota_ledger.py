"""usage metering ledger in PostgreSQL.

The ledger is migration-owned. Request handling must never create or alter
these tables; row locks on the entitlement and a single transaction protect
monthly reservations and commits across processes.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261001_usage_ledger"
down_revision = "20260923_guided_job_force_flag"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "usage_entitlements",
        sa.Column("user_id", sa.Text(), primary_key=True),
        sa.Column("plan_code", sa.Text(), nullable=False, server_default="free"),
        sa.Column("monthly_token_limit", sa.BigInteger(), nullable=False),
        sa.Column("per_request_token_limit", sa.BigInteger(), nullable=False),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reset_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        if_not_exists=True,
    )
    op.create_index("ix_usage_entitlements_period", "usage_entitlements", ["user_id", "period_start", "period_end"], if_not_exists=True)

    op.create_table(
        "usage_reservations",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("feature", sa.Text(), nullable=False),
        sa.Column("operation", sa.Text(), nullable=False),
        sa.Column("provider", sa.Text()),
        sa.Column("model", sa.Text()),
        sa.Column("request_id", sa.Text()),
        sa.Column("job_id", sa.Text()),
        sa.Column("idempotency_key", sa.Text(), nullable=False),
        sa.Column("reserved_tokens", sa.BigInteger(), nullable=False),
        sa.Column("monthly_token_limit", sa.BigInteger(), nullable=False),
        sa.Column("per_request_token_limit", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="reserved"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lease_owner", sa.Text()),
        sa.Column("committed_at", sa.DateTime(timezone=True)),
        sa.Column("released_at", sa.DateTime(timezone=True)),
        sa.Column("expired_at", sa.DateTime(timezone=True)),
        sa.Column("failed_at", sa.DateTime(timezone=True)),
        sa.Column("terminal_at", sa.DateTime(timezone=True)),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "idempotency_key", name="uq_usage_reservations_user_idempotency"),
        sa.CheckConstraint("status IN ('reserved','committed','released','expired','failed','overage')", name="ck_usage_reservations_status"),
        if_not_exists=True,
    )
    op.create_index("ix_usage_res_user_status", "usage_reservations", ["user_id", "status"], if_not_exists=True)
    op.create_index("ix_usage_res_expiry", "usage_reservations", ["status", "expires_at"], if_not_exists=True)
    op.create_index("ix_usage_res_lookup", "usage_reservations", ["request_id", "job_id"], if_not_exists=True)

    op.create_table(
        "usage_events",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column(
            "reservation_id",
            sa.Text(),
            sa.ForeignKey("usage_reservations.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("attempt_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("account_id", sa.Text()),
        sa.Column("feature", sa.Text(), nullable=False),
        sa.Column("operation", sa.Text(), nullable=False),
        sa.Column("provider", sa.Text()),
        sa.Column("model", sa.Text()),
        sa.Column("request_id", sa.Text()),
        sa.Column("job_id", sa.Text()),
        sa.Column("idempotency_key", sa.Text(), nullable=False),
        sa.Column("input_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("embedding_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("cached_input_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("usage_source", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("metadata_json", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "reservation_id", "attempt_id", name="uq_usage_events_reservation_attempt"
        ),
        sa.CheckConstraint("usage_source IN ('provider','estimated','system')", name="ck_usage_events_source"),
        if_not_exists=True,
    )
    op.create_index("ix_usage_events_period", "usage_events", ["user_id", "period_start", "period_end"], if_not_exists=True)
    op.create_index("ix_usage_events_recent", "usage_events", ["user_id", "created_at"], if_not_exists=True)
    op.create_index("ix_usage_events_lookup", "usage_events", ["request_id", "job_id"], if_not_exists=True)

    # Same deny-by-default convention as the rest of the application schema.
    # The backend database owner bypasses RLS; publishable/client roles get no
    # direct access because no policy is created here.
    op.execute("ALTER TABLE usage_entitlements ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE usage_reservations ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    # Forward-only durable ledger. Rolling application code back must preserve
    # quota history and in-flight reservations; destructive cleanup requires a
    # separately reviewed migration after every reservation is terminal.
    pass
