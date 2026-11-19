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


# Migration 20261119: the database refuses deletes that would cascade-delete review
# history (code older than #194, a hand delete) and rewrites of archived topics. The
# function bodies live HERE, used by the migration and by the verifier, so the verifier
# compares the installed body with the exact contract (Codex task50).
#
# History = an archived topic OR a practice quiz made from a topic (Codex task52: an
# old-code delete taking the plan lock before any archive existed still erased the
# current topics' practice). Every function pins `search_path = <schema>, pg_temp`, so a
# caller's temporary shadow tables cannot answer the EXISTS checks (Codex task52).
ARCHIVE_GUARD_HINT = ("Review plans with practice history are kept (issue #18). Use code "
                      "that archives instead of deleting; see "
                      "docs/RUNBOOK_REVIEW_ITEM_ARCHIVE.md.")

ARCHIVE_GUARD_FUNCTIONS = {
    "studymap_guard_review_plan_delete": f"""
BEGIN
  IF (EXISTS (SELECT 1 FROM review_plan_items i
               WHERE i.review_plan_id = OLD.id AND i.archived_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM review_plan_items i
                   JOIN quizzes q ON q.source_review_item_id = i.id
                  WHERE i.review_plan_id = OLD.id))
     AND EXISTS (SELECT 1 FROM quiz_attempts WHERE id = OLD.attempt_id)
     AND EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id)
     AND EXISTS (SELECT 1 FROM documents WHERE id = OLD.document_id) THEN
    RAISE EXCEPTION 'refused: this review plan holds practice history'
      USING ERRCODE = 'restrict_violation', HINT = '{ARCHIVE_GUARD_HINT}';
  END IF;
  RETURN OLD;
END
""",
    # An archived topic is read-only history: only the FK maintenance of its three
    # nullable references (ON DELETE SET NULL) may change it, and only to NULL. A topic
    # with practice, or an archived one, cannot be deleted while its plan exists.
    "studymap_guard_archived_review_item": f"""
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF (OLD.archived_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM quizzes WHERE source_review_item_id = OLD.id))
       AND EXISTS (SELECT 1 FROM review_plans WHERE id = OLD.review_plan_id) THEN
      RAISE EXCEPTION 'refused: a review topic with practice history cannot be deleted'
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
    # No new practice from an archived topic, whatever path inserts it (Codex task53: the
    # request checked before enqueueing, the worker inserted later). FOR SHARE on the topic
    # row waits for an archiving transaction (its UPDATE holds FOR NO KEY UPDATE), then
    # reads the committed archive.
    "studymap_guard_practice_source": f"""
DECLARE
  topic_archived_at timestamptz;
  plan_attempt uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- A practice quiz is history: it goes only when its topic, plan, attempt, account or
    -- document goes (those cascades reach it after the parent row is gone).
    IF OLD.source_review_item_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM review_plan_items i JOIN review_plans p ON p.id = i.review_plan_id
          WHERE i.id = OLD.source_review_item_id
            AND EXISTS (SELECT 1 FROM quiz_attempts WHERE id = p.attempt_id)
            AND EXISTS (SELECT 1 FROM users WHERE id = p.user_id)
            AND EXISTS (SELECT 1 FROM documents WHERE id = p.document_id)) THEN
      RAISE EXCEPTION 'refused: a practice quiz is review history'
        USING ERRCODE = 'restrict_violation', HINT = '{ARCHIVE_GUARD_HINT}';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.source_review_item_id IS NOT NULL
     AND NEW.source_review_item_id IS DISTINCT FROM OLD.source_review_item_id THEN
    RAISE EXCEPTION 'refused: a practice quiz cannot be detached from its topic'
      USING ERRCODE = 'restrict_violation', HINT = '{ARCHIVE_GUARD_HINT}';
  END IF;
  IF NEW.source_review_item_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.source_review_item_id IS DISTINCT FROM OLD.source_review_item_id) THEN
    -- Same lock order as a regeneration (attempt, then plan/topic; Codex task54): take
    -- the plan's attempt first, so an insert that starts while a regeneration holds the
    -- attempt waits for it instead of locking the topic and deadlocking on the FK check.
    SELECT p.attempt_id INTO plan_attempt FROM review_plan_items i
      JOIN review_plans p ON p.id = i.review_plan_id WHERE i.id = NEW.source_review_item_id;
    IF plan_attempt IS NOT NULL THEN
      PERFORM 1 FROM quiz_attempts WHERE id = plan_attempt FOR KEY SHARE;
    END IF;
    -- Lock the topic row unconditionally: a predicate on archived_at would be judged on
    -- the old snapshot and skip the row without waiting or re-reading it.
    SELECT archived_at INTO topic_archived_at FROM review_plan_items
      WHERE id = NEW.source_review_item_id
      FOR SHARE;
    IF topic_archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'refused: no new practice from an archived review topic'
        USING ERRCODE = 'restrict_violation', HINT = '{ARCHIVE_GUARD_HINT}';
    END IF;
  END IF;
  RETURN NEW;
END
""",
    "studymap_guard_review_truncate": f"""
BEGIN
  IF EXISTS (SELECT 1 FROM review_plan_items WHERE archived_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM quizzes WHERE source_review_item_id IS NOT NULL) THEN
    RAISE EXCEPTION 'refused: review plans hold practice history'
      USING ERRCODE = 'restrict_violation', HINT = '{ARCHIVE_GUARD_HINT}';
  END IF;
  RETURN NULL;
END
""",
}

# (trigger, table, function, pg_trigger.tgtype, event). tgtype bits: ROW 1, BEFORE 2,
# INSERT 4, DELETE 8, UPDATE 16, TRUNCATE 32.
ARCHIVE_GUARD_TRIGGERS = [
    ("trg_guard_review_plan_delete", "review_plans", "studymap_guard_review_plan_delete",
     1 | 2 | 8, "BEFORE DELETE ON review_plans FOR EACH ROW"),
    ("trg_guard_archived_review_item", "review_plan_items",
     "studymap_guard_archived_review_item", 1 | 2 | 8 | 16,
     "BEFORE DELETE OR UPDATE ON review_plan_items FOR EACH ROW"),
    ("trg_guard_review_items_truncate", "review_plan_items", "studymap_guard_review_truncate",
     2 | 32, "BEFORE TRUNCATE ON review_plan_items FOR EACH STATEMENT"),
    ("trg_guard_practice_source", "quizzes", "studymap_guard_practice_source",
     1 | 2 | 4 | 8 | 16,
     "BEFORE INSERT OR DELETE OR UPDATE OF source_review_item_id ON quizzes FOR EACH ROW"),
    ("trg_guard_quizzes_truncate", "quizzes", "studymap_guard_review_truncate",
     2 | 32, "BEFORE TRUNCATE ON quizzes FOR EACH STATEMENT"),
    ("trg_guard_review_plans_truncate", "review_plans", "studymap_guard_review_truncate",
     2 | 32, "BEFORE TRUNCATE ON review_plans FOR EACH STATEMENT"),
]


def _guard_search_path(schema: str) -> str:
    return f"{schema}, pg_temp"


def archive_guard_function_sql(name: str, schema: str) -> str:
    """CREATE OR REPLACE for one guard function, search_path pinned to `schema` with
    pg_temp LAST (an explicit pg_temp is searched where it is listed, not first)."""
    if not schema.replace("_", "").isalnum():
        raise ValueError(f"unexpected schema name {schema!r}")
    return (f"CREATE OR REPLACE FUNCTION {name}() RETURNS trigger LANGUAGE plpgsql "
            f"SET search_path = {_guard_search_path(schema)} "
            f"AS $guard${ARCHIVE_GUARD_FUNCTIONS[name]}$guard$")


def _same_body(installed: str, expected: str) -> bool:
    return " ".join((installed or "").split()) == " ".join(expected.split())


def archive_guard_problems(conn) -> List[str]:
    """Each guard trigger exists, is enabled, fires on the exact event/timing/level, and
    the EXACT function it calls (pg_trigger.tgfoid, never a lookup by name, so an
    overload cannot answer for it) has the contract body, no arguments, returns
    trigger, is plpgsql and pins search_path to the schema with pg_temp last."""
    problems = []
    schema = conn.execute(sa.text("SELECT current_schema()")).scalar()
    want_path = f"search_path={_guard_search_path(schema)}"
    for name, table, function, tgtype, _ in ARCHIVE_GUARD_TRIGGERS:
        row = conn.execute(sa.text(
            "SELECT tg.tgenabled, p.proname, tg.tgtype, p.prosrc, p.pronargs, "
            "p.prorettype::regtype::text, l.lanname, p.proconfig "
            "FROM pg_trigger tg "
            "JOIN pg_class t ON t.oid = tg.tgrelid JOIN pg_namespace n ON n.oid = t.relnamespace "
            "JOIN pg_proc p ON p.oid = tg.tgfoid JOIN pg_language l ON l.oid = p.prolang "
            "WHERE tg.tgname = :n AND t.relname = :t AND n.nspname = current_schema() "
            "AND NOT tg.tgisinternal"), {"n": name, "t": table}).first()
        if row is None:
            problems.append(f"guard trigger {name} on {table} is missing")
            continue
        enabled, proname, got_type, body, nargs, rettype, lang, config = row
        if enabled not in ("O", "A"):
            problems.append(f"guard trigger {name} on {table} is disabled (tgenabled={enabled})")
        if proname != function:
            problems.append(f"guard trigger {name} calls {proname}, expected {function}")
        if int(got_type) != tgtype:
            problems.append(f"guard trigger {name} fires on tgtype {got_type}, expected {tgtype}")
        if not _same_body(body, ARCHIVE_GUARD_FUNCTIONS.get(function, "")):
            problems.append(f"guard function {function} called by {name}: body differs "
                            "from the contract")
        if nargs != 0 or rettype != "trigger" or lang != "plpgsql":
            problems.append(f"guard function {function} called by {name}: not a zero-argument "
                            "plpgsql trigger function")
        if list(config or []) != [want_path]:
            problems.append(f"guard function {function} called by {name}: search_path is "
                            f"{list(config or [])}, expected [{want_path!r}]")
    return problems


# Review history = a topic that is archived, or that has a practice quiz. Code older than
# #194 deletes such a plan on regeneration (the guard now refuses that), so both the
# rollback floor and the downgrades count it, not archived topics only (Codex task53).
HISTORY_TOPICS_SQL = (
    "SELECT count(*) FROM review_plan_items i WHERE i.archived_at IS NOT NULL "
    "OR EXISTS (SELECT 1 FROM quizzes q WHERE q.source_review_item_id = i.id)")
HISTORY_TOPICS_SQL_NO_ARCHIVE = (
    "SELECT count(*) FROM review_plan_items i "
    "WHERE EXISTS (SELECT 1 FROM quizzes q WHERE q.source_review_item_id = i.id)")
HISTORY_LOCK_SQL = ("LOCK TABLE review_plans, review_plan_items, quizzes "
                    "IN SHARE ROW EXCLUSIVE MODE")


def history_topics(conn) -> int:
    """Topics holding review history (archived, or with practice)."""
    sql = HISTORY_TOPICS_SQL if archived_at_column_exists(conn) else HISTORY_TOPICS_SQL_NO_ARCHIVE
    return int(conn.execute(sa.text(sql)).scalar() or 0)
