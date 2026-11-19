"""Database guard for archived review topics (issue #18, owner decision 2026-11-19).

Migration 20261118 archives topics instead of deleting them, but code older than it (a
rollback, a mixed-version window) or a hand-written DELETE still deletes the plan, and
the foreign key cascade then takes the archived topics with every practice quiz, attempt,
answer and mastery row made from them. Application code cannot patch older code, so the
database refuses, fail closed (SQLSTATE 23001, restrict_violation; the hint names the
runbook; no row data in the message). The function bodies are the contract in
`shared.db_schema_checks.ARCHIVE_GUARD_FUNCTIONS`, which `verify_db_schema` compares:

1. BEFORE DELETE on review_plans, per row: refused when the plan holds archived topics
   and its attempt, user and document all still exist (a regeneration by old code, or a
   hand delete). A plan removed because its attempt, document or account was deleted
   still goes, exactly as before #194 (the parent row is already gone when the cascade
   reaches the plan).
2. BEFORE DELETE OR UPDATE on review_plan_items, per row: an archived topic cannot be
   deleted while its plan exists (a direct delete, or an ORM deleting children first),
   and is read-only: only its three nullable references may change, and only to NULL
   (FK ON DELETE SET NULL). The new code's archiving UPDATE (on rows not yet archived)
   is not affected.
3. BEFORE TRUNCATE on both tables: refused while any archived topic exists.

Race: the new code locks the plan row (SELECT ... FOR UPDATE) before archiving its
topics. An old-code DELETE of that plan waits for the lock; its row trigger then runs
with a fresh snapshot, sees the committed archive, and refuses (Codex task50).

No automatic bypass. Disabling the triggers is a manual, owner-approved DDL step
(docs/RUNBOOK_REVIEW_ITEM_ARCHIVE.md). Rerun-safe: CREATE OR REPLACE and drop/create of
the named triggers. The downgrade locks both tables against writes, then refuses while
archived topics exist, and keeps the lock until the triggers are gone.
"""
from alembic import op
import sqlalchemy as sa

from shared.db_schema_checks import (
    ARCHIVE_GUARD_FUNCTIONS,
    ARCHIVE_GUARD_TRIGGERS,
    archive_guard_function_sql,
    archive_guard_problems,
)

revision = "20261119_review_item_guard"
down_revision = "20261118_review_item_archive"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name in ARCHIVE_GUARD_FUNCTIONS:
        op.execute(archive_guard_function_sql(name))
    for name, table, function, _tgtype, event in ARCHIVE_GUARD_TRIGGERS:
        op.execute(f"DROP TRIGGER IF EXISTS {name} ON {table}")
        op.execute(f"CREATE TRIGGER {name} {event} EXECUTE FUNCTION {function}()")
    problems = archive_guard_problems(op.get_bind())
    if problems:
        raise RuntimeError("archive guard failed verification: " + "; ".join(problems))


def downgrade() -> None:
    conn = op.get_bind()
    # No archive may commit between the count and the drops (Codex task50): SHARE ROW
    # EXCLUSIVE blocks every INSERT/UPDATE/DELETE on both tables until this transaction
    # (the whole downgrade step) ends.
    conn.execute(sa.text(
        "LOCK TABLE review_plans, review_plan_items IN SHARE ROW EXCLUSIVE MODE"))
    archived = conn.execute(sa.text(
        "SELECT count(*) FROM review_plan_items WHERE archived_at IS NOT NULL")).scalar()
    if archived:
        raise RuntimeError(
            f"refusing downgrade: {archived} archived review plan topic(s) exist and the "
            "guard protects their practice history. Keep this schema and roll forward. "
            "See docs/RUNBOOK_REVIEW_ITEM_ARCHIVE.md.")
    for name, table, _function, _tgtype, _event in ARCHIVE_GUARD_TRIGGERS:
        op.execute(f"DROP TRIGGER IF EXISTS {name} ON {table}")
    for fn in ARCHIVE_GUARD_FUNCTIONS:
        op.execute(f"DROP FUNCTION IF EXISTS {fn}()")
