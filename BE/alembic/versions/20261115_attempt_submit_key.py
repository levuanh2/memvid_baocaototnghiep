"""Idempotency key for practice submits, stored on the attempt it created.

Additive and nullable: running code that does not know the columns keeps working, and
rows written before this migration have no key (they were never retried by key).
"""
from alembic import op

revision = "20261115_attempt_submit_key"
down_revision = "20261001_job_usage_ctx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS submit_key TEXT")
    op.execute("ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS submit_fingerprint TEXT")
    op.execute(
        "ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS grading_claimed_at TIMESTAMPTZ"
    )
    # One key per owner. Partial: the many keyless rows must not collide on NULL.
    # CONCURRENTLY: no write lock on a live quiz_attempts while it builds (it cannot run in
    # a transaction, hence the autocommit block). Every existing row has a NULL key.
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_quiz_attempts_user_submit_key "
            "ON quiz_attempts (user_id, submit_key) WHERE submit_key IS NOT NULL"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS uq_quiz_attempts_user_submit_key")
    op.execute("ALTER TABLE quiz_attempts DROP COLUMN IF EXISTS grading_claimed_at")
    op.execute("ALTER TABLE quiz_attempts DROP COLUMN IF EXISTS submit_fingerprint")
    op.execute("ALTER TABLE quiz_attempts DROP COLUMN IF EXISTS submit_key")
