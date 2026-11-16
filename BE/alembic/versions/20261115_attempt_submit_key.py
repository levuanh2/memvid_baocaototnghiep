"""Idempotency key for practice submits, stored on the attempt it created.

Additive and nullable: running code that does not know the columns keeps working, and
rows written before this migration have no key (they were never retried by key).
"""
import sqlalchemy as sa
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
    # CONCURRENTLY: no write lock on a live quiz_attempts while it builds (it cannot run in
    # a transaction, hence the autocommit block). Every existing row has a NULL key.
    with op.get_context().autocommit_block():
        ensure_submit_key_index(op.get_bind())


INDEX = "uq_quiz_attempts_user_submit_key"


def _index_valid(conn):
    """True / False (exists but INVALID) / None (absent)."""
    return conn.execute(sa.text(
        "SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass(:n)"), {"n": INDEX}
    ).scalar()


def ensure_submit_key_index(conn) -> None:
    """One key per owner. Partial: the many keyless rows must not collide on NULL.

    A CONCURRENTLY build that is interrupted (lost connection, timeout, a duplicate) leaves
    the index behind marked INVALID: it enforces nothing, and `IF NOT EXISTS` would skip it
    on the next run and report success. So: drop an invalid leftover, build, and fail
    unless the result is valid. Safe to run again. `conn` must be in autocommit.
    """
    if _index_valid(conn) is False:
        conn.execute(sa.text(f"DROP INDEX CONCURRENTLY IF EXISTS {INDEX}"))
    if _index_valid(conn) is None:
        conn.execute(sa.text(
            f"CREATE UNIQUE INDEX CONCURRENTLY {INDEX} "
            "ON quiz_attempts (user_id, submit_key) WHERE submit_key IS NOT NULL"))
    if _index_valid(conn) is not True:
        raise RuntimeError(f"{INDEX} is not valid after the build; it would not enforce one key per owner")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS uq_quiz_attempts_user_submit_key")
    op.execute("ALTER TABLE quiz_attempts DROP COLUMN IF EXISTS grading_claimed_at")
    op.execute("ALTER TABLE quiz_attempts DROP COLUMN IF EXISTS submit_fingerprint")
    op.execute("ALTER TABLE quiz_attempts DROP COLUMN IF EXISTS submit_key")
