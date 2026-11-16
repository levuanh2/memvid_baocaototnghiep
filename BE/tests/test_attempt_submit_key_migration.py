"""Migration 20261115 + `scripts.verify_db_schema`: a broken unique index must stop the deploy.

`alembic upgrade head` exiting 0 is not proof: an interrupted `CREATE INDEX CONCURRENTLY`
leaves an INVALID index under the right name, `IF NOT EXISTS` skips it by name, and an index
can be dropped or replaced after the revision is stamped. Every failure here is produced
for real (a writer that outlives `lock_timeout`, a duplicate key, a hand-made index), never
by editing the catalogs. The entry point is the real `scripts.run_migrations`, run from the
previous revision (`alembic stamp`), so the same test runs against old and new code.

Rules under test: fail closed (non-zero exit, revision NOT stamped); never DROP or rebuild an
existing index (same OID before and after); the read-only verifier catches a missing index
even when `alembic_version` is already at head.
"""
from __future__ import annotations

import os
import subprocess
import sys
import threading
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa

from tests.test_attempt_submit_concurrency import owner, pytestmark  # noqa: F401
from tests.test_practice_idempotency import _submit, practice  # noqa: F401  (fixture)

BE_ROOT = Path(__file__).resolve().parents[1]
INDEX = "uq_quiz_attempts_user_submit_key"
HEAD = "20261115_attempt_submit_key"
PREVIOUS = "20261001_job_usage_ctx"
CREATE = (f"CREATE UNIQUE INDEX CONCURRENTLY {INDEX} "
          "ON quiz_attempts (user_id, submit_key) WHERE submit_key IS NOT NULL")
CLEAR_DUPLICATE_KEYS = (
    "UPDATE quiz_attempts SET submit_key = NULL WHERE id IN (SELECT id FROM ("
    " SELECT id, row_number() OVER (PARTITION BY user_id, submit_key ORDER BY id) AS n"
    " FROM quiz_attempts WHERE submit_key IS NOT NULL) d WHERE d.n > 1)")


def _run(*args):
    env = {k: v for k, v in os.environ.items() if k != "ALEMBIC_ALLOW_PRODUCTION"}
    env["PGOPTIONS"] = "-c lock_timeout=20s"  # never hang the suite behind a stray lock
    # The scripts print Vietnamese. Without an explicit encoding a Windows parent decodes
    # with cp1252, the reader thread dies on a byte like 0x9d and `stdout` comes back None.
    env["PYTHONUTF8"] = "1"
    return subprocess.run([sys.executable, "-m", *args], cwd=BE_ROOT, env=env,
                          capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=180)


def _migrate():
    return _run("scripts.run_migrations", "--moi-truong", "test")


def _verify():
    return _run("scripts.verify_db_schema", "--moi-truong", "test")


def _stamp(rev):
    r = _run("alembic", "stamp", rev)
    assert r.returncode == 0, r.stdout + r.stderr


@pytest.fixture()
def db():
    """An autocommit connection; afterwards the index is valid again and Alembic at head."""
    from app.db import get_engine

    with get_engine().connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        yield conn
        # Runs after a failed test too. A test that stops half-way can leave duplicate keys
        # (the runbook test makes them on purpose); the rebuild below would then fail and
        # leave an INVALID index for the next test file. Test database only.
        conn.execute(sa.text("RESET lock_timeout"))
        conn.execute(sa.text(CLEAR_DUPLICATE_KEYS))
        conn.execute(sa.text(f"DROP INDEX CONCURRENTLY IF EXISTS {INDEX}"))
        conn.execute(sa.text(CREATE))
    _stamp(HEAD)


def _state(conn):
    """(oid, indisvalid) of the index, or None when it is absent."""
    row = conn.execute(sa.text(
        "SELECT i.indexrelid::oid::int, i.indisvalid FROM pg_index i "
        "WHERE i.indexrelid = to_regclass(:n)"), {"n": INDEX}).first()
    return tuple(row) if row else None


def _version(conn):
    return conn.execute(sa.text("SELECT version_num FROM alembic_version")).scalar()


def _interrupt_a_build(conn):
    """A real interrupted CONCURRENTLY build: a writer holds the table, lock_timeout fires."""
    from app.db import get_engine

    conn.execute(sa.text(f"DROP INDEX CONCURRENTLY IF EXISTS {INDEX}"))
    locked, release = threading.Event(), threading.Event()

    def writer():
        with get_engine().connect() as w:  # one open transaction with RowExclusiveLock
            w.execute(sa.text("UPDATE quiz_attempts SET submit_key = submit_key WHERE false"))
            locked.set()
            release.wait(30)
            w.rollback()

    t = threading.Thread(target=writer)
    t.start()
    try:
        assert locked.wait(30)
        conn.execute(sa.text("SET lock_timeout = '300ms'"))
        with pytest.raises(sa.exc.OperationalError, match="lock timeout"):
            conn.execute(sa.text(CREATE))
    finally:
        conn.execute(sa.text("RESET lock_timeout"))
        release.set()
        t.join(30)
    state = _state(conn)
    assert state is not None and state[1] is False, "the interrupted build left no INVALID index"
    return state


def _assert_failed_closed(conn, before, result, needle):
    out = result.stdout + result.stderr
    assert result.returncode != 0, f"migration reported success on a broken index:\n{out}"
    assert needle in out, out
    assert _version(conn) == PREVIOUS, "the revision was stamped although the index is broken"
    assert _state(conn) == before, "an existing index was dropped or rebuilt automatically"


def test_normal_upgrade_and_rerun_are_safe_and_verified(db):
    before = _state(db)
    assert before is not None and before[1] is True
    r = _migrate()  # already at head: a no-op
    assert r.returncode == 0, r.stdout + r.stderr
    _stamp(PREVIOUS)  # rerun the revision over a valid index: it builds nothing, verifies
    r = _migrate()
    assert r.returncode == 0, r.stdout + r.stderr
    assert _version(db) == HEAD and _state(db) == before
    v = _verify()
    assert v.returncode == 0, v.stdout + v.stderr
    assert "valid, ready, unique" in v.stdout


def test_full_downgrade_then_upgrade_builds_a_verified_index(db):
    r = _run("scripts.run_migrations", "--moi-truong", "test", "--go-lui", PREVIOUS)
    assert r.returncode == 0, r.stdout + r.stderr
    assert _state(db) is None
    r = _migrate()
    assert r.returncode == 0, r.stdout + r.stderr
    assert _state(db)[1] is True
    assert _verify().returncode == 0


def test_an_interrupted_build_fails_the_migration_and_the_deploy_gate(db):
    before = _interrupt_a_build(db)
    _stamp(PREVIOUS)
    _assert_failed_closed(db, before, _migrate(), "INVALID")
    v = _verify()
    assert v.returncode == 3, v.stdout + v.stderr
    assert "INVALID" in v.stderr and "RUNBOOK_SUBMIT_KEY_INDEX" in v.stderr


@pytest.mark.parametrize("ddl, needle", [
    (f"CREATE INDEX CONCURRENTLY {INDEX} ON quiz_attempts (user_id, submit_key) "
     "WHERE submit_key IS NOT NULL", "not UNIQUE"),
    (f"CREATE UNIQUE INDEX CONCURRENTLY {INDEX} ON quiz_attempts (user_id, submit_key)",
     "predicate"),
    (f"CREATE UNIQUE INDEX CONCURRENTLY {INDEX} ON quiz_attempts (submit_key, user_id) "
     "WHERE submit_key IS NOT NULL", "columns"),
    (f"CREATE UNIQUE INDEX CONCURRENTLY {INDEX} ON quiz_attempts (user_id, lower(submit_key)) "
     "WHERE submit_key IS NOT NULL", "expressions"),
], ids=["not-unique", "no-predicate", "wrong-column-order", "expression"])
def test_right_name_wrong_definition_fails_closed(db, ddl, needle):
    db.execute(sa.text(f"DROP INDEX CONCURRENTLY IF EXISTS {INDEX}"))
    db.execute(sa.text(ddl))
    before = _state(db)
    _stamp(PREVIOUS)
    _assert_failed_closed(db, before, _migrate(), needle)
    v = _verify()
    assert v.returncode == 3 and needle in v.stderr, v.stdout + v.stderr


def test_index_missing_while_alembic_is_at_head_is_caught_by_the_verifier(db):
    db.execute(sa.text(f"DROP INDEX CONCURRENTLY IF EXISTS {INDEX}"))
    assert _version(db) == HEAD
    r = _migrate()  # Alembic sees head and does nothing: it cannot notice
    assert r.returncode == 0
    v = _verify()
    assert v.returncode == 3, v.stdout + v.stderr
    assert "missing" in v.stderr


def test_recovery_by_the_runbook_after_a_duplicate_key_broke_the_build(owner, practice, db):
    quiz_id, qids = practice
    k1, k2 = str(uuid.uuid4()), str(uuid.uuid4())
    _submit(quiz_id, owner, {qids[0]: "dung"}, k1)
    a2 = _submit(quiz_id, owner, {qids[0]: "sai"}, k2)["attempt_id"]
    db.execute(sa.text(f"DROP INDEX CONCURRENTLY IF EXISTS {INDEX}"))
    db.execute(sa.text("UPDATE quiz_attempts SET submit_key = :a WHERE id = :id"),
               {"a": k1, "id": a2})
    with pytest.raises(sa.exc.IntegrityError):  # the build fails half-way: INVALID leftover
        db.execute(sa.text(CREATE))
    before = _state(db)
    assert before[1] is False
    _stamp(PREVIOUS)
    _assert_failed_closed(db, before, _migrate(), "INVALID")

    # Runbook 3b: clear the key on one of the two attempts (no attempt is deleted).
    db.execute(sa.text("UPDATE quiz_attempts SET submit_key = NULL WHERE id = :id"), {"id": a2})
    # Runbook 3a: drop the broken index by hand; then rerun the migration (it builds, verifies).
    db.execute(sa.text(f"DROP INDEX CONCURRENTLY IF EXISTS {INDEX}"))
    r = _migrate()
    assert r.returncode == 0, r.stdout + r.stderr
    assert _version(db) == HEAD and _state(db)[1] is True
    assert _verify().returncode == 0
    # And it enforces the rule again.
    with pytest.raises(sa.exc.IntegrityError):
        db.execute(sa.text("UPDATE quiz_attempts SET submit_key = :a WHERE id = :id"),
                   {"a": k1, "id": a2})


def test_the_verifier_never_writes():
    """Read-only by construction: the session is READ ONLY, and the source has no DDL."""
    src = (BE_ROOT / "scripts" / "verify_db_schema.py").read_text(encoding="utf-8")
    assert "SET TRANSACTION READ ONLY" in src
    for word in ("DROP ", "REINDEX", "CREATE ", "ALTER "):
        assert word not in src.split('"""', 2)[2], word
