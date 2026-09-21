"""durable Guided Mind Map job ledger and worker heartbeat"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260921_guided_job_ledger"
down_revision = "08eb199dc5e0"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "guided_mindmap_jobs",
        sa.Column("job_id", sa.Text(), primary_key=True),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("map_id", sa.Text()),
        sa.Column("result_map_id", sa.Text()),
        sa.Column("idempotency_key", sa.Text(), nullable=False),
        sa.Column("request_fingerprint", sa.Text(), nullable=False),
        sa.Column("source_ids_json", postgresql.JSONB(), nullable=False),
        sa.Column("guided_config_json", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="queued"),
        sa.Column("stage", sa.Text(), nullable=False, server_default="queued"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("current_node", sa.Text()),
        sa.Column("lease_owner", sa.Text()),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True)),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True)),
        sa.Column("not_before", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("error_code", sa.Text()),
        sa.Column("error_message", sa.Text()),
        sa.Column("result_json", postgresql.JSONB()),
        sa.UniqueConstraint("user_id", "idempotency_key", name="uq_guided_job_user_idempotency"),
    )
    op.create_index("ix_guided_jobs_status_lease", "guided_mindmap_jobs", ["status", "lease_expires_at"])
    op.create_table(
        "guided_mindmap_worker_heartbeats",
        sa.Column("worker_id", sa.Text(), primary_key=True),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ttl_seconds", sa.Integer(), nullable=False, server_default="90"),
    )
    # Every table in this schema gets RLS enabled with zero policies right
    # after create_table (deny-all for the Supabase publishable/anon key —
    # the backend's own service-role key bypasses RLS entirely, see
    # 102c36a01548 and b1d7a4c9e210). 08eb199dc5e0 fixed one migration that
    # missed this; doing it here directly since this migration has not
    # shipped anywhere yet.
    op.execute('ALTER TABLE public."guided_mindmap_jobs" ENABLE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE public."guided_mindmap_worker_heartbeats" ENABLE ROW LEVEL SECURITY')


def downgrade():
    # Forward-only: rollback keeps the additive ledger so an older web release
    # can safely coexist during a controlled rollback. Cleanup is a separate,
    # explicitly approved migration after all jobs are terminal.
    pass
