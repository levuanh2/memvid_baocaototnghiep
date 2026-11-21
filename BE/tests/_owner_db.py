"""The table owner's database connection, for tests doing owner-only work.

When the suite runs as the least-privilege app role (`TEST_DATABASE_URL` = studymap_app,
`TEST_MIGRATION_DATABASE_URL` = the owner; docs/RUNBOOK_DB_ROLES.md), DDL, TRUNCATE and
disabling a trigger are refused to the app (that is the point). Test set-up and the
guard/verifier tests that need them use this engine. Without `TEST_MIGRATION_DATABASE_URL`
it is the ordinary test engine, as before.
"""
from __future__ import annotations

import os

import sqlalchemy as sa

_engine = None


def owner_engine():
    global _engine
    url = (os.getenv("TEST_MIGRATION_DATABASE_URL") or "").strip()
    if not url:
        from app.db import get_engine
        return get_engine()
    if _engine is None:
        from shared.migration_guard import chuan_hoa_driver, kiem_tra_dich, CHE_DO_TEST
        kiem_tra_dich(url, CHE_DO_TEST)   # local *_test database only
        _engine = sa.create_engine(chuan_hoa_driver(url), pool_pre_ping=True)
    return _engine


def owner_url() -> str:
    return ((os.getenv("TEST_MIGRATION_DATABASE_URL") or "").strip()
            or (os.getenv("TEST_DATABASE_URL") or "").strip())


from contextlib import contextmanager


@contextmanager
def owner_session_scope():
    """`app.db.session_scope`, as the table owner: test clean-up of rows the app role may
    not delete (users, quizzes, attempts, plans; shared.db_roles)."""
    from sqlalchemy.orm import Session

    s = Session(bind=owner_engine(), expire_on_commit=False)
    try:
        yield s
        s.commit()
    except BaseException:
        s.rollback()
        raise
    finally:
        s.close()


def reapply_role_contract() -> None:
    """After a test that dropped and re-created columns (a downgrade then upgrade): column
    grants die with the column, so the app role would lose UPDATE on the new ones. Only
    when the suite runs as the app role (TEST_MIGRATION_DATABASE_URL set)."""
    if not (os.getenv("TEST_MIGRATION_DATABASE_URL") or "").strip():
        return
    from shared.db_roles import APP_ROLE, apply_statements

    with owner_engine().begin() as conn:
        if not conn.execute(sa.text("SELECT 1 FROM pg_roles WHERE rolname = :r"),
                            {"r": APP_ROLE}).first():
            return
        rls = {r[0] for r in conn.execute(sa.text(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity"))}
        for stmt in apply_statements(rls, os.getenv("DB_RLS_MODE") or "policies"):
            conn.execute(sa.text(stmt))
