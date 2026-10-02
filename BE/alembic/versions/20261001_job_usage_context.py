"""persist usage reservation references on durable guided jobs."""
from alembic import op

revision = "20261001_job_usage_ctx"
down_revision = "20261001_usage_ledger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE guided_mindmap_jobs "
        "ADD COLUMN IF NOT EXISTS usage_reservation_id TEXT"
    )
    op.execute(
        "ALTER TABLE guided_mindmap_jobs "
        "ADD COLUMN IF NOT EXISTS usage_summary_json JSONB"
    )
    op.create_index(
        "ix_guided_jobs_usage_reservation",
        "guided_mindmap_jobs",
        ["usage_reservation_id"],
        if_not_exists=True,
    )


def downgrade() -> None:
    # Forward-only: older workers ignore these nullable fields, while keeping
    # them preserves restart/reconciliation state during a controlled rollback.
    pass
