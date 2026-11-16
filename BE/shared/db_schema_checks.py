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
    row = conn.execute(_SQL, {"name": SUBMIT_KEY_INDEX}).mappings().first()
    schema = conn.execute(sa.text("SELECT current_schema()")).scalar()
    if row is None:
        return [f"index {schema}.{SUBMIT_KEY_INDEX} is missing"]
    problems = []
    if row["table_schema"] != schema or row["table_name"] != SUBMIT_KEY_TABLE:
        problems.append(f"index is on {row['table_schema']}.{row['table_name']}, "
                        f"expected {schema}.{SUBMIT_KEY_TABLE}")
    if not row["indisvalid"]:
        problems.append("index is INVALID (pg_index.indisvalid = false): an interrupted "
                        "concurrent build; it enforces nothing")
    if not row["indisready"]:
        problems.append("index is not ready (pg_index.indisready = false)")
    if not row["indisunique"]:
        problems.append("index is not UNIQUE")
    if row["method"] != "btree":
        problems.append(f"index method is {row['method']}, expected btree")
    if row["has_expressions"] or list(row["columns"]) != SUBMIT_KEY_COLUMNS:
        problems.append(f"index columns are {list(row['columns'])}"
                        f"{' with expressions' if row['has_expressions'] else ''}, "
                        f"expected {SUBMIT_KEY_COLUMNS}")
    if _normalise(row["predicate"]) != SUBMIT_KEY_PREDICATE:
        problems.append(f"index predicate is {row['predicate']!r}, "
                        f"expected WHERE {SUBMIT_KEY_PREDICATE}")
    return problems


def submit_key_index_exists(conn) -> bool:
    return conn.execute(_SQL, {"name": SUBMIT_KEY_INDEX}).first() is not None
