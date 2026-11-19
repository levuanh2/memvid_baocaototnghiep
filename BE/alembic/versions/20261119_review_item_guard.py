"""Database guard for archived review topics (issue #18, owner decision 2026-11-19).

Migration 20261118 archives topics instead of deleting them, but code older than it (a
rollback, a mixed-version window) or a hand-written DELETE still deletes the plan, and
the foreign key cascade then takes the archived topics with every practice quiz, attempt,
answer and mastery row made from them. Application code cannot patch older code, so the
database refuses, fail closed (SQLSTATE 23001, restrict_violation; the hint names the
runbook; no row data in the message). The function bodies are the contract in
`shared.db_schema_checks.ARCHIVE_GUARD_FUNCTIONS`, which `verify_db_schema` compares:

History = a topic that is archived, or that has a practice quiz made from it.

1. BEFORE DELETE on review_plans, per row: refused when the plan holds history and its
   attempt, user and document all still exist (old-code regeneration, also before any
   archive exists; a hand delete). A plan removed because its attempt, document or
   account is being deleted still goes, exactly as before #194.
2. BEFORE DELETE OR UPDATE on review_plan_items, per row: a topic with history cannot be
   deleted while its plan exists (direct, or an ORM deleting children first) and is
   read-only, except archiving an active topic and FK ON DELETE SET NULL on its three
   nullable references.
3. BEFORE INSERT OR DELETE OR UPDATE OF source_review_item_id, source_attempt_id,
   quiz_type on quizzes: no new practice quiz from an archived topic, whatever path
   inserts it (Codex task53: a late worker); a practice quiz with history, or any quiz
   whose attempts own a plan with history, cannot be deleted while user and document
   exist; a practice quiz's provenance is read-only.
4. BEFORE TRUNCATE on review_plans, review_plan_items and quizzes while history exists.

Lock order (Codex task50/54/56/57): every guard decision first locks the attempt that
owns the plan (a regeneration holds it FOR UPDATE, a practice insert takes FOR KEY SHARE,
the delete guards FOR UPDATE), then judges history with a fresh snapshot, so a delete or
insert racing a regeneration waits and is refused instead of deadlocking or losing
history. Only an old-code plan delete racing a regeneration can still deadlock;
PostgreSQL aborts one transaction and nothing is lost (owner decision 2026-11-19, item 5).

Every guard function pins `search_path = <schema>, pg_temp`: a caller's temporary
shadow tables cannot answer its EXISTS checks (Codex task52).

No automatic bypass. Disabling the triggers is a manual, owner-approved DDL step
(docs/RUNBOOK_REVIEW_ITEM_ARCHIVE.md). Rerun-safe: CREATE OR REPLACE and drop/create of
the named triggers. The downgrade locks review_plans, review_plan_items and quizzes
against writes, refuses while any history exists, and keeps the lock until the triggers
are gone.
"""
from alembic import op
import sqlalchemy as sa

from shared.db_schema_checks import (
    ARCHIVE_GUARD_FUNCTIONS,
    ARCHIVE_GUARD_TRIGGERS,
    HISTORY_LOCK_SQL,
    history_topics,
    archive_guard_function_sql,
    archive_guard_problems,
)

revision = "20261119_review_item_guard"
down_revision = "20261118_review_item_archive"
branch_labels = None
depends_on = None


def upgrade() -> None:
    schema = op.get_bind().execute(sa.text("SELECT current_schema()")).scalar()
    for name in ARCHIVE_GUARD_FUNCTIONS:
        op.execute(archive_guard_function_sql(name, schema))
    for name, table, function, _tgtype, event in ARCHIVE_GUARD_TRIGGERS:
        op.execute(f"DROP TRIGGER IF EXISTS {name} ON {table}")
        op.execute(f"CREATE TRIGGER {name} {event} EXECUTE FUNCTION {function}()")
    problems = archive_guard_problems(op.get_bind())
    if problems:
        raise RuntimeError("archive guard failed verification: " + "; ".join(problems))


def downgrade() -> None:
    conn = op.get_bind()
    # No history may appear between the count and the drops (Codex task50/53): block every
    # write on the plans, topics and quizzes until this transaction ends.
    conn.execute(sa.text(HISTORY_LOCK_SQL))
    history = history_topics(conn)
    if history:
        raise RuntimeError(
            f"refusing downgrade: {history} review topic(s) hold practice history (archived, "
            "or with practice quizzes) and the guard protects it. Keep this schema and roll "
            "forward. See docs/RUNBOOK_REVIEW_ITEM_ARCHIVE.md.")
    for name, table, _function, _tgtype, _event in ARCHIVE_GUARD_TRIGGERS:
        op.execute(f"DROP TRIGGER IF EXISTS {name} ON {table}")
    for fn in ARCHIVE_GUARD_FUNCTIONS:
        op.execute(f"DROP FUNCTION IF EXISTS {fn}()")
