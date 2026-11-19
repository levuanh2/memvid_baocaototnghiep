"""Migration 20261118 (issue #18): archive column, partial priority index, old constraint.

Run for real against the disposable test database through `scripts.run_migrations`,
`alembic downgrade` and the read-only `scripts.verify_db_schema`. Rules under test: the
upgrade is rerun-safe; the verifier fails closed when the schema is not what the
revision promised; the downgrade refuses while archived topics exist and restores the
old schema exactly when none do.
"""
from __future__ import annotations

import pytest
import sqlalchemy as sa

import os
import subprocess
import sys
import uuid
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from tests.test_attempt_submit_concurrency import owner, pytestmark  # noqa: F401
from tests.test_attempt_submit_key_migration import _migrate, _run, _stamp, _verify, _version

BE_ROOT = Path(__file__).resolve().parents[1]

HEAD = "20261119_review_item_guard"
PREVIOUS = "20261115_attempt_submit_key"
INDEX = "uq_review_plan_items_priority_active"
OLD = "uq_review_plan_items_priority"


@pytest.fixture()
def db():
    from app.db import get_engine

    with get_engine().connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        yield conn
    # Whatever a test did (also one that failed half-way and left the index dropped),
    # rerun the revision: every step checks first, so this restores the full contract.
    _stamp(PREVIOUS)
    r = _migrate()
    assert r.returncode == 0, r.stdout + r.stderr


def _state(conn):
    column = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() "
        "AND table_name = 'review_plan_items' AND column_name = 'archived_at'")).first()
    index = conn.execute(sa.text(
        "SELECT i.indexrelid::oid::int, i.indisvalid FROM pg_index i "
        "WHERE i.indexrelid = to_regclass(:n)"), {"n": INDEX}).first()
    old = conn.execute(sa.text(
        "SELECT 1 FROM pg_constraint WHERE conname = :c"), {"c": OLD}).first()
    return {"column": bool(column), "index": tuple(index) if index else None,
            "old_constraint": bool(old)}


def _one_archived_topic(conn, owner):
    """A plan with one archived and one current topic sharing priority 1 (what a
    regeneration leaves), on a fresh attempt of `owner`."""
    from app.domains.attempts import repository
    from tests.test_provisional_grading_recovery import _quiz

    quiz_id, _ = _quiz(owner)
    attempt_id = repository.open_attempt(quiz_id, owner)["attempt_id"]
    plan = conn.execute(sa.text(
        "INSERT INTO review_plans (id, attempt_id, user_id, document_id, summary) "
        "SELECT gen_random_uuid(), a.id, a.user_id, q.document_id, 'migration test' "
        "FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id WHERE a.id = :a "
        "RETURNING id"), {"a": attempt_id}).scalar()
    for archived in ("now()", "NULL"):
        conn.execute(sa.text(
            "INSERT INTO review_plan_items (id, review_plan_id, topic, priority, reason, "
            "status, mastery_score, review_tasks_json, archived_at) VALUES "
            f"(gen_random_uuid(), :p, 't', 1, 'r', 'review_needed', 0.5, '[]', {archived})"),
            {"p": plan})
    return plan


@contextmanager
def _fresh_database(conn):
    """An empty `*_test` database next to the test one, migrated by the real scripts."""
    name = f"mig_{uuid.uuid4().hex[:10]}_test"
    conn.execute(sa.text(f'CREATE DATABASE "{name}"'))
    parts = urlsplit(os.environ["TEST_DATABASE_URL"])
    url = urlunsplit(parts._replace(path=f"/{name}"))
    try:
        yield url
    finally:
        conn.execute(sa.text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))


def _run_on(url, *args):
    env = {k: v for k, v in os.environ.items() if k != "ALEMBIC_ALLOW_PRODUCTION"}
    env.update({"TEST_DATABASE_URL": url, "PYTHONUTF8": "1",
                "PGOPTIONS": "-c lock_timeout=20s"})
    return subprocess.run([sys.executable, "-m", *args], cwd=BE_ROOT, env=env,
                          capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=180)


def _state_of(url):
    eng = sa.create_engine(url.replace("postgresql://", "postgresql+psycopg://", 1)
                           if url.startswith("postgresql://") else url,
                           poolclass=sa.pool.NullPool)
    try:
        with eng.connect() as c:
            return _state(c), c.execute(sa.text("SELECT version_num FROM alembic_version")).scalar()
    finally:
        eng.dispose()


def test_head_is_verified_and_the_old_constraint_is_gone(db):
    assert _version(db) == HEAD
    s = _state(db)
    assert s["column"] and s["index"] and s["index"][1] is True and not s["old_constraint"]
    r = _verify()
    assert r.returncode == 0, r.stdout + r.stderr
    assert "uq_review_plan_items_priority_active valid" in r.stdout


def test_the_upgrade_is_rerun_safe(db):
    before = _state(db)
    _stamp(PREVIOUS)
    r = _migrate()
    assert r.returncode == 0, r.stdout + r.stderr
    assert _version(db) == HEAD and _state(db) == before, "rerun rebuilt or dropped something"


def test_the_partial_index_allows_archived_and_current_topics_to_share_a_priority(db, owner):
    plan = _one_archived_topic(db, owner)
    try:
        with pytest.raises(sa.exc.IntegrityError):
            db.execute(sa.text(
                "INSERT INTO review_plan_items (id, review_plan_id, topic, priority, reason, "
                "status, mastery_score, review_tasks_json) VALUES (gen_random_uuid(), :p, "
                "'t2', 1, 'r', 'review_needed', 0.5, '[]')"), {"p": plan})
    finally:
        db.execute(sa.text(  # the attempt's delete cascades; the guard refuses a plan delete
            "DELETE FROM quiz_attempts WHERE id = (SELECT attempt_id FROM review_plans "
            "WHERE id = :p)"), {"p": plan})


def test_the_downgrade_refuses_while_archived_topics_exist(db, owner):
    plan = _one_archived_topic(db, owner)
    try:
        before = _state(db)
        r = _run("alembic", "downgrade", PREVIOUS)
        assert r.returncode != 0
        out = r.stdout + r.stderr
        assert "refusing downgrade" in out
        assert "Roll back code only" not in out, "older code would cascade-delete the history"
        assert _version(db) == HEAD and _state(db) == before
    finally:
        db.execute(sa.text(  # the attempt's delete cascades; the guard refuses a plan delete
            "DELETE FROM quiz_attempts WHERE id = (SELECT attempt_id FROM review_plans "
            "WHERE id = :p)"), {"p": plan})


def test_the_downgrade_restores_the_old_schema_when_nothing_is_archived(db):
    with _fresh_database(db) as url:
        r = _run_on(url, "scripts.run_migrations", "--moi-truong", "test")
        assert r.returncode == 0, r.stdout + r.stderr
        r = _run_on(url, "alembic", "downgrade", PREVIOUS)
        assert r.returncode == 0, r.stdout + r.stderr
        assert _state_of(url) == ({"column": False, "index": None, "old_constraint": True},
                                  PREVIOUS)
        r = _run_on(url, "scripts.run_migrations", "--moi-truong", "test")
        assert r.returncode == 0, r.stdout + r.stderr
        state, version = _state_of(url)
        assert version == HEAD and state["index"][1] is True and not state["old_constraint"]
        r = _run_on(url, "scripts.verify_db_schema", "--moi-truong", "test")
        assert r.returncode == 0, r.stdout + r.stderr


def test_the_verifier_fails_closed_on_the_old_constraint_or_a_missing_index(db):
    db.execute(sa.text(f"DROP INDEX CONCURRENTLY IF EXISTS {INDEX}"))
    r = _verify()
    assert r.returncode != 0 and f"index public.{INDEX} is missing" in r.stderr, r.stderr
    # Its own recovery procedure, not the submit-key one (Codex task46 P3).
    assert "docs/RUNBOOK_REVIEW_ITEM_ARCHIVE.md" in r.stderr, r.stderr
    assert "RUNBOOK_SUBMIT_KEY_INDEX" not in r.stderr, r.stderr
    db.execute(sa.text(
        f"CREATE UNIQUE INDEX CONCURRENTLY {INDEX} ON review_plan_items "
        "(review_plan_id, priority) WHERE archived_at IS NULL"))
    archived = db.execute(sa.text(
        "SELECT count(*) FROM review_plan_items WHERE archived_at IS NOT NULL")).scalar()
    if not archived:
        db.execute(sa.text(f"ALTER TABLE review_plan_items ADD CONSTRAINT {OLD} "
                           "UNIQUE (review_plan_id, priority)"))
        r = _verify()
        assert r.returncode != 0 and f"constraint {OLD} still exists" in r.stderr, r.stderr
        db.execute(sa.text(f"ALTER TABLE review_plan_items DROP CONSTRAINT {OLD}"))
    assert _verify().returncode == 0
