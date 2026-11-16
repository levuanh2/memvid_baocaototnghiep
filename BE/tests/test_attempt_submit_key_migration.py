"""Migration 20261115: an interrupted CONCURRENTLY build must not pass for a working index.

A failed `CREATE UNIQUE INDEX CONCURRENTLY` leaves the index behind marked INVALID: it
exists by name but enforces nothing. `IF NOT EXISTS` only looks at the name, so a rerun
reported success and the "one key per owner" rule silently did not hold. The failure is
produced for real here (a duplicate key makes the build fail half-way), not faked in the
catalog.
"""
from __future__ import annotations

import importlib.util
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa

from tests.test_practice_idempotency import _submit, practice  # noqa: F401  (fixture)
from tests.test_attempt_submit_concurrency import owner, pytestmark  # noqa: F401

_MIG = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20261115_attempt_submit_key.py"


def _migration():
    spec = importlib.util.spec_from_file_location("mig_20261115", _MIG)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _valid(conn, mod):
    return mod._index_valid(conn)


@pytest.fixture()
def autocommit():
    from app.db import get_engine

    with get_engine().connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        yield conn


def test_an_interrupted_index_build_is_rebuilt_not_reported_as_done(owner, practice, autocommit):
    mod = _migration()
    conn = autocommit
    quiz_id, qids = practice
    k1, k2 = str(uuid.uuid4()), str(uuid.uuid4())
    _submit(quiz_id, owner, {qids[0]: "dung"}, k1)
    _submit(quiz_id, owner, {qids[0]: "sai"}, k2)
    try:
        # Interrupt a build: a duplicate key makes CONCURRENTLY fail after it created the index.
        conn.execute(sa.text(f"DROP INDEX CONCURRENTLY IF EXISTS {mod.INDEX}"))
        conn.execute(sa.text("UPDATE quiz_attempts SET submit_key = :a WHERE submit_key = :b"),
                     {"a": k1, "b": k2})
        with pytest.raises(sa.exc.IntegrityError):
            conn.execute(sa.text(
                f"CREATE UNIQUE INDEX CONCURRENTLY {mod.INDEX} "
                "ON quiz_attempts (user_id, submit_key) WHERE submit_key IS NOT NULL"))
        assert _valid(conn, mod) is False

        # The bug: the old statement skips it by name and "succeeds"; the index stays useless.
        conn.execute(sa.text(
            f"CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS {mod.INDEX} "
            "ON quiz_attempts (user_id, submit_key) WHERE submit_key IS NOT NULL"))
        assert _valid(conn, mod) is False

        # While the duplicate is there, the migration fails loudly instead of passing.
        with pytest.raises(sa.exc.IntegrityError):
            mod.ensure_submit_key_index(conn)

        # Data fixed: a rerun drops the invalid leftover and builds a valid index.
        conn.execute(sa.text(
            "UPDATE quiz_attempts SET submit_key = :b "
            "WHERE submit_key = :a AND submit_fingerprint <> "
            "(SELECT min(submit_fingerprint) FROM quiz_attempts WHERE submit_key = :a)"),
            {"a": k1, "b": k2})
        mod.ensure_submit_key_index(conn)
        assert _valid(conn, mod) is True
        mod.ensure_submit_key_index(conn)  # and again: nothing to do
        assert _valid(conn, mod) is True

        # It enforces the rule again.
        with pytest.raises(sa.exc.IntegrityError):
            conn.execute(sa.text("UPDATE quiz_attempts SET submit_key = :a WHERE submit_key = :b"),
                         {"a": k1, "b": k2})
    finally:
        if _valid(conn, mod) is not True:
            conn.execute(sa.text(
                "UPDATE quiz_attempts SET submit_key = :b WHERE submit_key = :a AND "
                "submit_fingerprint <> (SELECT min(submit_fingerprint) FROM quiz_attempts "
                "WHERE submit_key = :a)"), {"a": k1, "b": k2})
            conn.execute(sa.text(f"DROP INDEX CONCURRENTLY IF EXISTS {mod.INDEX}"))
            conn.execute(sa.text(
                f"CREATE UNIQUE INDEX CONCURRENTLY {mod.INDEX} "
                "ON quiz_attempts (user_id, submit_key) WHERE submit_key IS NOT NULL"))
