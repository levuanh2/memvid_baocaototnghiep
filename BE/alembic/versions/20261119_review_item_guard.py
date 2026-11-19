"""Database guard for archived review topics (issue #18, owner decision 2026-11-19).

Migration 20261118 archives topics instead of deleting them, but code older than it (a
rollback, a mixed-version window) or a hand-written DELETE still deletes the plan, and
the foreign key cascade then takes the archived topics with every practice quiz, attempt,
answer and mastery row made from them. Application code cannot patch older code, so the
database refuses, fail closed (SQLSTATE 23001, restrict_violation; the hint names the
runbook; no row data in the message):

1. BEFORE DELETE on review_plans, per row: refused when the plan holds archived topics
   and its attempt, user and document all still exist (a regeneration by old code, or a
   hand delete). A plan removed because its attempt, document or account was deleted
   still goes, exactly as before #194 (the parent row is already gone when the cascade
   reaches the plan).
2. BEFORE DELETE OR UPDATE on review_plan_items, per row: an archived topic cannot be
   deleted while its plan exists (a direct delete, or an ORM deleting children first),
   un-archived, or moved to another plan. FK SET NULL updates (section, knowledge node,
   concept mastery) and the new code's archiving UPDATE are not affected.
3. BEFORE TRUNCATE on both tables: refused while any archived topic exists.

Race: the new code archives in a transaction that also updates the plan row. An old-code
DELETE that started earlier waits for that row lock; its row trigger then runs with a
fresh snapshot, sees the committed archive, and refuses.

No automatic bypass. Disabling the triggers is a manual, owner-approved DDL step
(docs/RUNBOOK_REVIEW_ITEM_ARCHIVE.md). Rerun-safe: CREATE OR REPLACE and drop/create of
the named triggers. The downgrade refuses while archived topics exist.
"""
from alembic import op
import sqlalchemy as sa

revision = "20261119_review_item_guard"
down_revision = "20261118_review_item_archive"
branch_labels = None
depends_on = None

_HINT = ("Archived review topics keep practice history (issue #18). Use code that "
         "archives instead of deleting; see docs/RUNBOOK_REVIEW_ITEM_ARCHIVE.md.")

FUNCTIONS = f"""
CREATE OR REPLACE FUNCTION studymap_guard_review_plan_delete() RETURNS trigger
LANGUAGE plpgsql AS $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM review_plan_items
              WHERE review_plan_id = OLD.id AND archived_at IS NOT NULL)
     AND EXISTS (SELECT 1 FROM quiz_attempts WHERE id = OLD.attempt_id)
     AND EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id)
     AND EXISTS (SELECT 1 FROM documents WHERE id = OLD.document_id) THEN
    RAISE EXCEPTION 'refused: this review plan holds archived topics'
      USING ERRCODE = 'restrict_violation', HINT = '{_HINT}';
  END IF;
  RETURN OLD;
END
$guard$;

CREATE OR REPLACE FUNCTION studymap_guard_archived_review_item() RETURNS trigger
LANGUAGE plpgsql AS $guard$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.archived_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM review_plans WHERE id = OLD.review_plan_id) THEN
      RAISE EXCEPTION 'refused: an archived review topic cannot be deleted'
        USING ERRCODE = 'restrict_violation', HINT = '{_HINT}';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.archived_at IS NOT NULL
     AND (NEW.archived_at IS DISTINCT FROM OLD.archived_at
          OR NEW.review_plan_id IS DISTINCT FROM OLD.review_plan_id) THEN
    RAISE EXCEPTION 'refused: an archived review topic cannot be un-archived or moved'
      USING ERRCODE = 'restrict_violation', HINT = '{_HINT}';
  END IF;
  RETURN NEW;
END
$guard$;

CREATE OR REPLACE FUNCTION studymap_guard_review_truncate() RETURNS trigger
LANGUAGE plpgsql AS $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM review_plan_items WHERE archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'refused: review plans hold archived topics'
      USING ERRCODE = 'restrict_violation', HINT = '{_HINT}';
  END IF;
  RETURN NULL;
END
$guard$;
"""

TRIGGERS = [
    ("trg_guard_review_plan_delete", "review_plans",
     "BEFORE DELETE ON review_plans FOR EACH ROW "
     "EXECUTE FUNCTION studymap_guard_review_plan_delete()"),
    ("trg_guard_archived_review_item", "review_plan_items",
     "BEFORE DELETE OR UPDATE ON review_plan_items FOR EACH ROW "
     "EXECUTE FUNCTION studymap_guard_archived_review_item()"),
    ("trg_guard_review_items_truncate", "review_plan_items",
     "BEFORE TRUNCATE ON review_plan_items FOR EACH STATEMENT "
     "EXECUTE FUNCTION studymap_guard_review_truncate()"),
    ("trg_guard_review_plans_truncate", "review_plans",
     "BEFORE TRUNCATE ON review_plans FOR EACH STATEMENT "
     "EXECUTE FUNCTION studymap_guard_review_truncate()"),
]
FUNCTION_NAMES = ["studymap_guard_review_plan_delete", "studymap_guard_archived_review_item",
                  "studymap_guard_review_truncate"]


def upgrade() -> None:
    op.execute(FUNCTIONS)
    for name, table, body in TRIGGERS:
        op.execute(f"DROP TRIGGER IF EXISTS {name} ON {table}")
        op.execute(f"CREATE TRIGGER {name} {body}")
    from shared.db_schema_checks import archive_guard_problems

    problems = archive_guard_problems(op.get_bind())
    if problems:
        raise RuntimeError("archive guard failed verification: " + "; ".join(problems))


def downgrade() -> None:
    archived = op.get_bind().execute(sa.text(
        "SELECT count(*) FROM review_plan_items WHERE archived_at IS NOT NULL")).scalar()
    if archived:
        raise RuntimeError(
            f"refusing downgrade: {archived} archived review plan topic(s) exist and the "
            "guard protects their practice history. Keep this schema and roll forward. "
            "See docs/RUNBOOK_REVIEW_ITEM_ARCHIVE.md.")
    for name, table, _ in TRIGGERS:
        op.execute(f"DROP TRIGGER IF EXISTS {name} ON {table}")
    for fn in FUNCTION_NAMES:
        op.execute(f"DROP FUNCTION IF EXISTS {fn}()")
