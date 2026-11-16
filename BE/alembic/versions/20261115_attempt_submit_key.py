"""Idempotency key for practice submits, stored on the attempt it created.

Additive and nullable: running code that does not know the columns keeps working, and
rows written before this migration have no key (they were never retried by key).
"""
from alembic import op

from shared.db_schema_checks import (
    RUNBOOK,
    SUBMIT_KEY_INDEX,
    submit_key_index_exists,
    submit_key_index_problems,
)

revision = "20261115_attempt_submit_key"
down_revision = "20261001_job_usage_ctx"
branch_labels = None
depends_on = None

CREATE_INDEX = (
    f"CREATE UNIQUE INDEX CONCURRENTLY {SUBMIT_KEY_INDEX} "
    "ON quiz_attempts (user_id, submit_key) WHERE submit_key IS NOT NULL"
)


def upgrade() -> None:
    op.execute("ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS submit_key TEXT")
    op.execute("ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS submit_fingerprint TEXT")
    op.execute(
        "ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS grading_claimed_at TIMESTAMPTZ"
    )
    # CONCURRENTLY: no write lock on a live quiz_attempts while it builds (it cannot run in
    # a transaction, hence the autocommit block). Every existing row has a NULL key.
    with op.get_context().autocommit_block():
        build_and_verify_submit_key_index(op.get_bind())


def build_and_verify_submit_key_index(conn) -> None:
    """Build the index if absent, then prove it from the catalogs; fail closed.

    An index of that name that already exists is never dropped or rebuilt here: on
    production that is a manual, approved step (RUNBOOK). A broken one stops the
    migration, so Alembic does not stamp the revision and the deploy does not start the
    new backend. `conn` must be in autocommit.
    """
    if not submit_key_index_exists(conn):
        conn.exec_driver_sql(CREATE_INDEX)
    problems = submit_key_index_problems(conn)
    if problems:
        raise RuntimeError(
            f"{SUBMIT_KEY_INDEX} failed verification: " + "; ".join(problems)
            + f". Nothing was dropped. Recover by hand: {RUNBOOK}")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {SUBMIT_KEY_INDEX}")
    op.execute("ALTER TABLE quiz_attempts DROP COLUMN IF EXISTS grading_claimed_at")
    op.execute("ALTER TABLE quiz_attempts DROP COLUMN IF EXISTS submit_fingerprint")
    op.execute("ALTER TABLE quiz_attempts DROP COLUMN IF EXISTS submit_key")
