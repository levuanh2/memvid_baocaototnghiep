"""Schema facts a deploy must prove from the PostgreSQL catalogs, not from `alembic_version`.

`alembic upgrade head` exiting 0 means the revision was stamped. It does not mean every
object the revision promised exists and works: a `CREATE INDEX CONCURRENTLY` that is
interrupted leaves an INVALID index under the right name, and an index can be dropped or
replaced by hand after the stamp. These checks read `pg_index` directly and return a list
of problems (empty = OK). They never change anything.

Recovery for a failed check: `docs/RUNBOOK_SUBMIT_KEY_INDEX.md`.
"""
from __future__ import annotations

from typing import List

import sqlalchemy as sa

SUBMIT_KEY_INDEX = "uq_quiz_attempts_user_submit_key"
SUBMIT_KEY_TABLE = "quiz_attempts"
SUBMIT_KEY_COLUMNS = ["user_id", "submit_key"]
SUBMIT_KEY_PREDICATE = "submit_key IS NOT NULL"
RUNBOOK = "docs/RUNBOOK_SUBMIT_KEY_INDEX.md"

# One row per index of that name in the schema the app uses (current_schema(), the same
# search_path the migration created it under).
_SQL = sa.text("""
SELECT tn.nspname AS table_schema, t.relname AS table_name, am.amname AS method,
       i.indisvalid, i.indisready, i.indisunique,
       i.indexprs IS NOT NULL AS has_expressions,
       pg_get_expr(i.indpred, i.indrelid) AS predicate,
       ARRAY(SELECT a.attname::text
               FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
              ORDER BY k.ord) AS columns
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_index i ON i.indexrelid = c.oid
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace tn ON tn.oid = t.relnamespace
  JOIN pg_am am ON am.oid = c.relam
 WHERE c.relname = :name AND n.nspname = current_schema()
""")


def _normalise(expr: str) -> str:
    s = " ".join((expr or "").split())
    while s.startswith("(") and s.endswith(")"):
        s = s[1:-1].strip()
    return s


def submit_key_index_problems(conn) -> List[str]:
    """Everything wrong with the practice submit-key unique index (empty list = OK)."""
    return _unique_index_problems(conn, SUBMIT_KEY_INDEX, SUBMIT_KEY_TABLE,
                                  SUBMIT_KEY_COLUMNS, SUBMIT_KEY_PREDICATE)


def _unique_index_problems(conn, name: str, table: str, columns: List[str],
                           predicate: str) -> List[str]:
    row = conn.execute(_SQL, {"name": name}).mappings().first()
    schema = conn.execute(sa.text("SELECT current_schema()")).scalar()
    if row is None:
        return [f"index {schema}.{name} is missing"]
    problems = []
    if row["table_schema"] != schema or row["table_name"] != table:
        problems.append(f"index is on {row['table_schema']}.{row['table_name']}, "
                        f"expected {schema}.{table}")
    if not row["indisvalid"]:
        problems.append("index is INVALID (pg_index.indisvalid = false): an interrupted "
                        "concurrent build; it enforces nothing")
    if not row["indisready"]:
        problems.append("index is not ready (pg_index.indisready = false)")
    if not row["indisunique"]:
        problems.append("index is not UNIQUE")
    if row["method"] != "btree":
        problems.append(f"index method is {row['method']}, expected btree")
    if row["has_expressions"] or list(row["columns"]) != columns:
        problems.append(f"index columns are {list(row['columns'])}"
                        f"{' with expressions' if row['has_expressions'] else ''}, "
                        f"expected {columns}")
    if _normalise(row["predicate"]) != predicate:
        problems.append(f"index predicate is {row['predicate']!r}, "
                        f"expected WHERE {predicate}")
    return problems


def submit_key_index_exists(conn) -> bool:
    return conn.execute(_SQL, {"name": SUBMIT_KEY_INDEX}).first() is not None


# Issue #18 (owner option B, 2026-11-18): regenerating a review plan archives its topics
# instead of deleting them. Archived and current topics of one plan share priorities, so
# the priority rule holds for current topics only.
ARCHIVE_TABLE = "review_plan_items"
ARCHIVE_INDEX = "uq_review_plan_items_priority_active"
ARCHIVE_COLUMNS = ["review_plan_id", "priority"]
ARCHIVE_PREDICATE = "archived_at IS NULL"
OLD_PRIORITY_CONSTRAINT = "uq_review_plan_items_priority"
ARCHIVE_RUNBOOK = "docs/RUNBOOK_REVIEW_ITEM_ARCHIVE.md"

_CONSTRAINT_SQL = sa.text(
    "SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid "
    "JOIN pg_namespace n ON n.oid = t.relnamespace "
    "WHERE c.conname = :c AND t.relname = :t AND n.nspname = current_schema()")
_COLUMN_SQL = sa.text(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() "
    "AND table_name = :t AND column_name = 'archived_at'")


def archive_index_exists(conn) -> bool:
    return conn.execute(_SQL, {"name": ARCHIVE_INDEX}).first() is not None


def archive_index_problems(conn) -> List[str]:
    """The partial unique index over current topics (empty list = OK)."""
    return _unique_index_problems(conn, ARCHIVE_INDEX, ARCHIVE_TABLE, ARCHIVE_COLUMNS,
                                  ARCHIVE_PREDICATE)


def old_priority_constraint_exists(conn) -> bool:
    return conn.execute(_CONSTRAINT_SQL, {"c": OLD_PRIORITY_CONSTRAINT,
                                          "t": ARCHIVE_TABLE}).first() is not None


def archived_at_column_exists(conn) -> bool:
    return conn.execute(_COLUMN_SQL, {"t": ARCHIVE_TABLE}).first() is not None


def review_item_archive_problems(conn) -> List[str]:
    """Everything the archive migration promised: the column, the partial index, and the
    old whole-table priority constraint gone (it would refuse a regeneration)."""
    problems = []
    if not archived_at_column_exists(conn):
        problems.append(f"column {ARCHIVE_TABLE}.archived_at is missing")
    problems += archive_index_problems(conn)
    if old_priority_constraint_exists(conn):
        problems.append(f"constraint {OLD_PRIORITY_CONSTRAINT} still exists: a regeneration "
                        "would fail on archived topics")
    return problems


# Migration 20261119: the database refuses deletes that would cascade-delete archived
# topics (code older than #194, a hand delete) and rewrites of archived topics. The
# function bodies live HERE, used by the migration and by the verifier, so the verifier
# compares the installed body with the exact contract (Codex task50: a same-name
# `RETURN OLD` body or a trigger on the wrong event used to pass).
ARCHIVE_GUARD_HINT = ("Archived review topics keep practice history (issue #18). Use code "
                      "that archives instead of deleting; see "
                      "docs/RUNBOOK_REVIEW_ITEM_ARCHIVE.md.")

ARCHIVE_GUARD_FUNCTIONS = {
    "studymap_guard_review_plan_delete": f"""
BEGIN
  IF EXISTS (SELECT 1 FROM review_plan_items
              WHERE review_plan_id = OLD.id AND archived_at IS NOT NULL)
     AND EXISTS (SELECT 1 FROM quiz_attempts WHERE id = OLD.attempt_id)
     AND EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id)
     AND EXISTS (SELECT 1 FROM documents WHERE id = OLD.document_id) THEN
    RAISE EXCEPTION 'refused: this review plan holds archived topics'
      USING ERRCODE = 'restrict_violation', HINT = '{ARCHIVE_GUARD_HINT}';
  END IF;
  RETURN OLD;
END
""",
    # An archived topic is read-only history: only the FK maintenance of its three
    # nullable references (ON DELETE SET NULL) may change it, and only to NULL.
    "studymap_guard_archived_review_item": f"""
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.archived_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM review_plans WHERE id = OLD.review_plan_id) THEN
      RAISE EXCEPTION 'refused: an archived review topic cannot be deleted'
        USING ERRCODE = 'restrict_violation', HINT = '{ARCHIVE_GUARD_HINT}';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.archived_at IS NOT NULL AND (
       (NEW.id, NEW.review_plan_id, NEW.topic, NEW.priority, NEW.reason, NEW.status,
        NEW.mastery_score, NEW.review_tasks_json, NEW.created_at, NEW.archived_at)
         IS DISTINCT FROM
       (OLD.id, OLD.review_plan_id, OLD.topic, OLD.priority, OLD.reason, OLD.status,
        OLD.mastery_score, OLD.review_tasks_json, OLD.created_at, OLD.archived_at)
       OR (NEW.concept_mastery_id IS DISTINCT FROM OLD.concept_mastery_id
           AND NEW.concept_mastery_id IS NOT NULL)
       OR (NEW.section_id IS DISTINCT FROM OLD.section_id AND NEW.section_id IS NOT NULL)
       OR (NEW.knowledge_node_id IS DISTINCT FROM OLD.knowledge_node_id
           AND NEW.knowledge_node_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'refused: an archived review topic is read-only'
      USING ERRCODE = 'restrict_violation', HINT = '{ARCHIVE_GUARD_HINT}';
  END IF;
  RETURN NEW;
END
""",
    "studymap_guard_review_truncate": f"""
BEGIN
  IF EXISTS (SELECT 1 FROM review_plan_items WHERE archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'refused: review plans hold archived topics'
      USING ERRCODE = 'restrict_violation', HINT = '{ARCHIVE_GUARD_HINT}';
  END IF;
  RETURN NULL;
END
""",
}

# (trigger, table, function, pg_trigger.tgtype). tgtype bits: ROW 1, BEFORE 2, INSERT 4,
# DELETE 8, UPDATE 16, TRUNCATE 32.
ARCHIVE_GUARD_TRIGGERS = [
    ("trg_guard_review_plan_delete", "review_plans", "studymap_guard_review_plan_delete",
     1 | 2 | 8, "BEFORE DELETE ON review_plans FOR EACH ROW"),
    ("trg_guard_archived_review_item", "review_plan_items",
     "studymap_guard_archived_review_item", 1 | 2 | 8 | 16,
     "BEFORE DELETE OR UPDATE ON review_plan_items FOR EACH ROW"),
    ("trg_guard_review_items_truncate", "review_plan_items", "studymap_guard_review_truncate",
     2 | 32, "BEFORE TRUNCATE ON review_plan_items FOR EACH STATEMENT"),
    ("trg_guard_review_plans_truncate", "review_plans", "studymap_guard_review_truncate",
     2 | 32, "BEFORE TRUNCATE ON review_plans FOR EACH STATEMENT"),
]


def archive_guard_function_sql(name: str) -> str:
    return (f"CREATE OR REPLACE FUNCTION {name}() RETURNS trigger LANGUAGE plpgsql "
            f"AS $guard${ARCHIVE_GUARD_FUNCTIONS[name]}$guard$")


def _same_body(installed: str, expected: str) -> bool:
    return " ".join((installed or "").split()) == " ".join(expected.split())


def archive_guard_problems(conn) -> List[str]:
    """Each guard trigger exists, is enabled, fires on the exact event/timing/level and
    calls its own function; each function's body is exactly the contract above."""
    problems = []
    for name, table, function, tgtype, _ in ARCHIVE_GUARD_TRIGGERS:
        row = conn.execute(sa.text(
            "SELECT tg.tgenabled, p.proname, tg.tgtype FROM pg_trigger tg "
            "JOIN pg_class t ON t.oid = tg.tgrelid JOIN pg_namespace n ON n.oid = t.relnamespace "
            "JOIN pg_proc p ON p.oid = tg.tgfoid "
            "WHERE tg.tgname = :n AND t.relname = :t AND n.nspname = current_schema() "
            "AND NOT tg.tgisinternal"), {"n": name, "t": table}).first()
        if row is None:
            problems.append(f"guard trigger {name} on {table} is missing")
        elif row[0] not in ("O", "A"):
            problems.append(f"guard trigger {name} on {table} is disabled (tgenabled={row[0]})")
        elif row[1] != function:
            problems.append(f"guard trigger {name} calls {row[1]}, expected {function}")
        elif int(row[2]) != tgtype:
            problems.append(f"guard trigger {name} fires on tgtype {row[2]}, expected {tgtype}")
    for fn, body in ARCHIVE_GUARD_FUNCTIONS.items():
        row = conn.execute(sa.text(
            "SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
            "WHERE p.proname = :f AND n.nspname = current_schema()"), {"f": fn}).first()
        if row is None:
            problems.append(f"guard function {fn} is missing")
        elif not _same_body(row[0], body):
            problems.append(f"guard function {fn} body differs from the contract")
    return problems
