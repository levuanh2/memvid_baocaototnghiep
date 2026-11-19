"""Review plan topics are archived on regeneration instead of deleted (issue #18, option B).

"Tạo lại kế hoạch" used to delete the plan, and the database cascade then deleted every
practice quiz made from its topics, their attempts, answers and mastery. Regeneration now
keeps the plan row and marks its current topics `archived_at`; the new topics join the
same plan. No foreign key changes.

Expand only and rerun-safe (every step checks first):
1. `archived_at` nullable, no default: metadata only, no rewrite, no backfill.
2. The priority rule moves to current topics: a partial unique index built CONCURRENTLY
   (no write lock) and verified from the catalogs; fail closed when it is broken.
3. Only then the old whole-table constraint is dropped: archived and current topics of
   one plan share priorities, so it would refuse every regeneration.

Old code on this schema behaves as before while nothing is archived: every row is NULL
and the partial index enforces the old rule.

The downgrade refuses while archived topics exist: recreating the old constraint would
fail on them, and dropping the column would silently merge history into current plans.

Code rollback is NOT safe below this release once a topic is archived (Codex task46):
older code deletes the plan on regeneration and the cascade then deletes the archived
topics with their practice history. Roll back only to code that contains this revision,
or roll forward. See docs/RUNBOOK_REVIEW_ITEM_ARCHIVE.md.
"""
from alembic import op
import sqlalchemy as sa

from shared.db_schema_checks import (
    ARCHIVE_INDEX,
    HISTORY_LOCK_SQL,
    history_topics,
    OLD_PRIORITY_CONSTRAINT,
    archive_index_exists,
    archive_index_problems,
    old_priority_constraint_exists,
)

revision = "20261118_review_item_archive"
down_revision = "20261115_attempt_submit_key"
branch_labels = None
depends_on = None

CREATE_INDEX = (
    f"CREATE UNIQUE INDEX CONCURRENTLY {ARCHIVE_INDEX} "
    "ON review_plan_items (review_plan_id, priority) WHERE archived_at IS NULL"
)


def upgrade() -> None:
    op.execute("ALTER TABLE review_plan_items ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ")
    with op.get_context().autocommit_block():
        conn = op.get_bind()
        if not archive_index_exists(conn):
            conn.exec_driver_sql(CREATE_INDEX)
        problems = archive_index_problems(conn)
        if problems:
            raise RuntimeError(
                f"{ARCHIVE_INDEX} failed verification: " + "; ".join(problems)
                + f". Nothing was dropped and {OLD_PRIORITY_CONSTRAINT} is kept. Recover by "
                "hand: DROP INDEX CONCURRENTLY the broken index, then rerun the migration.")
        if old_priority_constraint_exists(conn):
            conn.exec_driver_sql(
                f"ALTER TABLE review_plan_items DROP CONSTRAINT {OLD_PRIORITY_CONSTRAINT}")


def downgrade() -> None:
    conn = op.get_bind()
    # No archive may commit between the count and restoring the old constraint (Codex
    # task50): block writes on both tables for the rest of this transaction.
    conn.execute(sa.text(HISTORY_LOCK_SQL))
    # Practice history counts, not archived topics only (Codex task53): below this
    # revision, code regenerates by deleting the plan and the cascade takes the practice.
    archived = history_topics(conn)
    if archived:
        raise RuntimeError(
            f"refusing downgrade: {archived} review topic(s) hold practice history. "
            f"{OLD_PRIORITY_CONSTRAINT} would fail on them and dropping archived_at would "
            "merge history into current plans. Keep this schema and roll forward; code older "
            "than this revision must not serve either (its regeneration cascade-deletes the "
            "archived history). See docs/RUNBOOK_REVIEW_ITEM_ARCHIVE.md.")
    if not old_priority_constraint_exists(conn):
        op.execute(f"ALTER TABLE review_plan_items ADD CONSTRAINT {OLD_PRIORITY_CONSTRAINT} "
                   "UNIQUE (review_plan_id, priority)")
    # One transaction from the lock to the dropped column (Codex task52: an autocommit
    # block for DROP INDEX CONCURRENTLY committed and released the lock, and an archive
    # could commit before the column went). A plain DROP INDEX on this small table is fine.
    op.execute(f"DROP INDEX IF EXISTS {ARCHIVE_INDEX}")
    op.execute("ALTER TABLE review_plan_items DROP COLUMN IF EXISTS archived_at")
