"""Least-privilege roles (owner decision after task59): the contract, and what the app
role can and cannot do on a real database.

The database tests run only when the suite itself runs as the app role:
`TEST_DATABASE_URL` logs in as `studymap_app` and `TEST_MIGRATION_DATABASE_URL` as the
table owner (docs/RUNBOOK_DB_ROLES.md, "Run the tests as the app role"). Everywhere else
they skip; the contract tests always run.
"""
from __future__ import annotations

import os

import pytest
import sqlalchemy as sa

from shared.db_roles import (
    READ_ONLY_BY_DESIGN,
    APP_ROLE,
    APP_TABLE_PRIVILEGES,
    FORBIDDEN_TABLE_PRIVILEGES,
    READONLY_ROLE,
    RLS_POLICIES,
    apply_statements,
    role_problems,
)

HISTORY = ("quiz_questions", "quiz_answers", "review_item_chunks", "concept_masteries")


# ── contract (no database) ──────────────────────────────────────────────────────

def test_every_model_table_has_a_contract_row():
    from app.db.models import Base

    # usage_* are migration-only tables (no ORM model); the live check covers them.
    assert set(Base.metadata.tables) | {"alembic_version"} <= set(APP_TABLE_PRIVILEGES)


def test_the_contract_never_grants_truncate_trigger_references_or_ddl():
    grants = [s for s in apply_statements(set(APP_TABLE_PRIVILEGES)) if s.startswith("GRANT")]
    assert grants
    for stmt in grants:
        privilege = stmt.split()[1]
        assert privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "USAGE"), stmt
        assert privilege not in FORBIDDEN_TABLE_PRIVILEGES + ("ALL", "CREATE"), stmt
        if privilege == "USAGE":
            assert " ON SCHEMA public " in stmt, stmt


def test_history_tables_get_only_what_current_code_does():
    assert APP_TABLE_PRIVILEGES["quiz_questions"] == ("SELECT", "INSERT")
    assert APP_TABLE_PRIVILEGES["review_item_chunks"] == ("SELECT", "INSERT")
    assert APP_TABLE_PRIVILEGES["concept_masteries"] == ("SELECT", "INSERT", "DELETE")
    answers = APP_TABLE_PRIVILEGES["quiz_answers"]
    assert "DELETE" not in answers and "UPDATE" not in answers
    assert any(p.startswith("UPDATE(") and "attempt_id" not in p and "question_id" not in p
               for p in answers)



# ── migration URL selection (no database) ───────────────────────────────────────

_PROD = {"ALEMBIC_ALLOW_PRODUCTION": "1",
         "DATABASE_URL": "postgresql://studymap_app.ref:p@pooler.example:5432/postgres"}
_OWNER = "postgresql://postgres.ref:q@pooler.example:5432/postgres"


def test_separation_requires_the_owner_migration_url():
    from shared.migration_guard import MigrationTargetRejected, chon_dich

    with pytest.raises(MigrationTargetRejected, match="MIGRATION_DATABASE_URL"):
        chon_dich({**_PROD, "DB_ROLE_SEPARATION": "1"})
    with pytest.raises(MigrationTargetRejected, match="cùng một user"):
        chon_dich({**_PROD, "DB_ROLE_SEPARATION": "1",
                   "MIGRATION_DATABASE_URL": _PROD["DATABASE_URL"]})
    with pytest.raises(MigrationTargetRejected, match="hai database khác nhau"):
        chon_dich({**_PROD, "DB_ROLE_SEPARATION": "1",
                   "MIGRATION_DATABASE_URL": _OWNER.rsplit("/", 1)[0] + "/other"})
    url, mode = chon_dich({**_PROD, "DB_ROLE_SEPARATION": "1",
                           "MIGRATION_DATABASE_URL": _OWNER})
    assert "postgres.ref" in url and "studymap_app" not in url and mode == "production"


def test_a_migration_never_uses_the_runtime_url():
    """Owner decision: the runtime DATABASE_URL is never a migration target, flag or not."""
    from shared.migration_guard import MigrationTargetRejected, chon_dich

    with pytest.raises(MigrationTargetRejected, match="MIGRATION_DATABASE_URL"):
        chon_dich(_PROD)
    assert "postgres.ref" in chon_dich({**_PROD, "MIGRATION_DATABASE_URL": _OWNER})[0]
    # Before the roles exist both may still log in as `postgres`: a separate variable.
    same = {**_PROD, "DATABASE_URL": _OWNER, "MIGRATION_DATABASE_URL": _OWNER}
    assert chon_dich(same)[0].endswith("/postgres")


def test_test_mode_migrates_as_the_owner_on_the_same_database():
    from shared.migration_guard import MigrationTargetRejected, chon_dich

    app = "postgresql://studymap_app:a@127.0.0.1:5432/x_test"
    owner = "postgresql://studymap_owner:o@127.0.0.1:5432/x_test"
    assert "studymap_owner" in chon_dich({"TEST_DATABASE_URL": app,
                                          "TEST_MIGRATION_DATABASE_URL": owner})[0]
    with pytest.raises(MigrationTargetRejected):
        chon_dich({"TEST_DATABASE_URL": app,
                   "TEST_MIGRATION_DATABASE_URL": owner.replace("x_test", "y_test")})


def test_runtime_url_must_be_the_app_role_and_not_the_migration_user():
    from shared.db_roles import runtime_url_problems

    assert runtime_url_problems({**_PROD, "MIGRATION_DATABASE_URL": _OWNER}) == []
    assert runtime_url_problems({"DATABASE_URL": _OWNER, "MIGRATION_DATABASE_URL": _OWNER})
    assert runtime_url_problems({"DATABASE_URL": _PROD["DATABASE_URL"]})   # no migration URL


# ── live database, suite running as the app role ────────────────────────────────

def _owner_url():
    return (os.getenv("TEST_MIGRATION_DATABASE_URL") or "").strip()


@pytest.fixture()
def app_conn():
    from shared.migration_guard import chuan_hoa_driver

    url = (os.getenv("TEST_DATABASE_URL") or "").strip()
    if not url or not _owner_url():
        pytest.skip("needs TEST_DATABASE_URL (app role) and TEST_MIGRATION_DATABASE_URL (owner)")
    engine = sa.create_engine(chuan_hoa_driver(url), poolclass=sa.pool.NullPool)
    with engine.connect() as conn:
        who = conn.execute(sa.text("SELECT current_user")).scalar()
        conn.rollback()
        if who != APP_ROLE:
            pytest.skip(f"TEST_DATABASE_URL does not log in as {APP_ROLE}")
        yield conn
    engine.dispose()


@pytest.fixture()
def owner_conn():
    from shared.migration_guard import chuan_hoa_driver

    from tests._owner_db import owner_url

    url = owner_url()   # the owner's, or the ordinary test URL when not split
    if not url:
        pytest.skip("needs TEST_DATABASE_URL")
    engine = sa.create_engine(chuan_hoa_driver(url), poolclass=sa.pool.NullPool)
    with engine.connect() as conn:
        yield conn
    engine.dispose()


def _sqlstate(conn, sql):
    if conn.in_transaction():
        conn.rollback()
    try:
        with conn.begin():
            conn.execute(sa.text(sql))
        return "ok"
    except sa.exc.DBAPIError as exc:
        return getattr(exc.orig, "sqlstate", repr(exc.orig))


def _mode():
    return (os.getenv("DB_RLS_MODE") or RLS_POLICIES).strip()


def test_the_live_database_matches_the_contract(app_conn, owner_conn):
    assert role_problems(owner_conn, _mode()) == []
    assert role_problems(app_conn, _mode()) == []   # the catalogs are readable as the app


GUARD_ATTACKS = [
    "ALTER TABLE review_plans DISABLE TRIGGER ALL",
    "ALTER TABLE review_plan_items DISABLE TRIGGER trg_guard_archived_review_item",
    "ALTER TABLE quizzes DISABLE TRIGGER trg_guard_practice_source",
    "DROP TRIGGER trg_guard_review_plan_delete ON review_plans",
    "DROP TRIGGER trg_guard_quizzes_truncate ON quizzes",
    "CREATE OR REPLACE FUNCTION studymap_guard_review_plan_delete() RETURNS trigger "
    "LANGUAGE plpgsql AS $$BEGIN RETURN OLD; END$$",
    "DROP FUNCTION studymap_guard_review_plan_delete() CASCADE",
    "ALTER FUNCTION studymap_guard_archived_review_item() SET search_path = pg_temp",
    "ALTER FUNCTION studymap_guard_practice_source() OWNER TO studymap_app",
    "ALTER TABLE review_plans DISABLE ROW LEVEL SECURITY",
    "DROP POLICY studymap_app_access ON review_plans",
    "CREATE TABLE public.review_plans_shadow (id uuid)",
    "SET session_replication_role = replica",
    f"ALTER ROLE {APP_ROLE} BYPASSRLS",
    f"ALTER ROLE {APP_ROLE} SUPERUSER",
    f"SET ROLE {READONLY_ROLE}",
]


def test_the_app_role_cannot_grant_itself_anything(app_conn, owner_conn):
    """A non-owner GRANT is not an error (PostgreSQL only warns "no privileges were
    granted"): check the effect, not the SQLSTATE."""
    assert _sqlstate(app_conn, "GRANT TRUNCATE ON quizzes TO PUBLIC") == "ok"
    assert _sqlstate(app_conn, f"GRANT DELETE ON quiz_answers TO {APP_ROLE}") == "ok"
    for role, priv, table in (("public", "TRUNCATE", "quizzes"),
                              (APP_ROLE, "DELETE", "quiz_answers")):
        assert owner_conn.execute(sa.text("SELECT has_table_privilege(:r, :t, :p)"),
                                  {"r": role, "t": table, "p": priv}).scalar() is False


@pytest.mark.parametrize("sql", GUARD_ATTACKS)
def test_the_app_role_cannot_disable_the_database_guard(app_conn, sql):
    if "POLICY" in sql and _mode() != RLS_POLICIES:
        pytest.skip("no policies in BYPASSRLS mode")
    assert _sqlstate(app_conn, sql) == "42501", sql


@pytest.mark.parametrize("table", sorted(APP_TABLE_PRIVILEGES))
def test_the_app_role_cannot_truncate(app_conn, table):
    assert _sqlstate(app_conn, f'TRUNCATE public."{table}" CASCADE') == "42501"


@pytest.mark.parametrize("sql", [
    "DELETE FROM quiz_questions WHERE false",
    "UPDATE quiz_questions SET question_text = question_text WHERE false",
    "DELETE FROM quiz_answers WHERE false",
    "UPDATE quiz_answers SET attempt_id = attempt_id WHERE false",
    "UPDATE quiz_answers SET question_id = question_id WHERE false",
    "DELETE FROM review_item_chunks WHERE false",
    "UPDATE review_item_chunks SET review_item_id = review_item_id WHERE false",
    "UPDATE concept_masteries SET mastery_score = mastery_score WHERE false",
    "DELETE FROM quiz_question_chunks WHERE false",
    # R2: identity columns are read-only for the app (moving history to another parent).
    "UPDATE quiz_attempts SET user_id = user_id WHERE false",
    "UPDATE quiz_attempts SET quiz_id = quiz_id WHERE false",
    "UPDATE review_plans SET attempt_id = attempt_id WHERE false",
    "UPDATE review_plans SET user_id = user_id WHERE false",
    "UPDATE review_plans SET document_id = document_id WHERE false",
    "UPDATE quizzes SET user_id = user_id WHERE false",
    "UPDATE quizzes SET document_id = document_id WHERE false",
    "UPDATE quizzes SET source_review_item_id = source_review_item_id WHERE false",
    "UPDATE review_plan_items SET review_plan_id = review_plan_id WHERE false",
    "UPDATE documents SET user_id = user_id WHERE false",
    "UPDATE quiz_answers SET created_at = created_at WHERE false",
    # Rows the app never deletes (their cascades run as the owner).
    "DELETE FROM users WHERE false",
    "DELETE FROM quizzes WHERE false",
    "DELETE FROM quiz_attempts WHERE false",
    "DELETE FROM review_plans WHERE false",
    "DELETE FROM review_plan_items WHERE false",
    "DELETE FROM usage_events WHERE false",
    "UPDATE usage_events SET total_tokens = total_tokens WHERE false",
])
def test_the_app_role_cannot_rewrite_history_rows(app_conn, sql):
    """R1 and R2 narrowed: refused even with `WHERE false` (privilege, not rows)."""
    assert _sqlstate(app_conn, sql) == "42501", sql


def test_the_app_role_may_do_what_current_code_does(app_conn):
    for sql in ("UPDATE quiz_answers SET score = score, feedback = feedback WHERE false",
                "DELETE FROM concept_masteries WHERE false",
                "DELETE FROM documents WHERE false",
                "UPDATE review_plan_items SET archived_at = archived_at WHERE false",
                "UPDATE review_plans SET created_at = created_at WHERE false",
                "UPDATE documents SET collection_id = collection_id WHERE false",
                "UPDATE quiz_attempts SET status = status, score = score WHERE false",
                "SELECT count(*) FROM review_plans"):
        assert _sqlstate(app_conn, sql) == "ok", sql


def test_rls_shows_the_app_and_readonly_roles_every_row(app_conn, owner_conn):
    """Not an exit code: every RLS table, the same row count for owner and app (and for
    the read-only role when its URL is given). A role without a policy would see 0."""
    tables = [r[0] for r in owner_conn.execute(sa.text(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity ORDER BY 1"))]
    assert len(tables) == 26, tables
    ro_url = (os.getenv("TEST_READONLY_DATABASE_URL") or "").strip()
    ro_engine = None
    if ro_url:
        from shared.migration_guard import chuan_hoa_driver
        ro_engine = sa.create_engine(chuan_hoa_driver(ro_url), poolclass=sa.pool.NullPool)
    try:
        for t in tables:
            q = sa.text(f'SELECT count(*) FROM public."{t}"')
            want = owner_conn.execute(q).scalar()
            assert app_conn.execute(q).scalar() == want, t
            if ro_engine is not None:
                with ro_engine.connect() as ro:
                    assert ro.execute(q).scalar() == want, t
    finally:
        if ro_engine is not None:
            ro_engine.dispose()


def test_every_column_has_a_decided_update_right(owner_conn):
    """A migration adding a column must say whether the app may update it: UPDATE list,
    or READ_ONLY_BY_DESIGN. Identity columns (id, foreign keys, created_at) are read-only
    unless the contract lists them on purpose. Fails in CI, before any deploy."""
    from shared.db_roles import _split

    rows = owner_conn.execute(sa.text(
        "SELECT c.relname, a.attname, EXISTS (SELECT 1 FROM pg_constraint k WHERE "
        "k.conrelid = c.oid AND k.contype IN ('p', 'f') AND a.attnum = ANY(k.conkey)) "
        "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped "
        "WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'alembic_version'"
    )).all()
    undecided = []
    for table, col, is_key in rows:
        if is_key or col == "created_at":
            continue
        updatable = set()
        for p in APP_TABLE_PRIVILEGES.get(table, ()):
            name, cols = _split(p)
            if name == "UPDATE":
                updatable |= {c.strip() for c in cols.split(",")}
        if col not in updatable and col not in READ_ONLY_BY_DESIGN.get(table, ()):
            undecided.append(f"{table}.{col}")
    assert undecided == [], ("columns with no UPDATE decision in shared.db_roles: "
                             f"{undecided}")


_SEED = [
    ("users", "INSERT INTO users (id, full_name, email, password_hash) VALUES (:user, 'RLS seed', :email, 'x')"),
    ("identities", "INSERT INTO identities (id, provider, provider_user_id, user_id) VALUES (:ident, 'nks', :tag, :user)"),
    ("collections", "INSERT INTO collections (id, user_id, name) VALUES (:coll, :user, 'Seed collection')"),
    ("documents", "INSERT INTO documents (id, user_id, title, file_type, file_path, status, collection_id) "
                  "VALUES (:doc, :user, 'Seed doc', 'md', 'seed.md', 'completed', :coll)"),
    ("sections", "INSERT INTO sections (id, document_id, title, level, order_index) VALUES (:section, :doc, 'S1', 1, 0)"),
    ("document_chunks", "INSERT INTO document_chunks (id, document_id, section_id, chunk_index, text) "
                        "VALUES (:chunk, :doc, :section, 0, 'Chunk text')"),
    ("jobs", "INSERT INTO jobs (id, user_id, job_type, status) VALUES (:job, :user, 'seed', 'completed')"),
    ("knowledge_maps", "INSERT INTO knowledge_maps (id, document_id, user_id, title, status) "
                       "VALUES (:map, :doc, :user, 'Map', 'completed')"),
    ("knowledge_nodes", "INSERT INTO knowledge_nodes (id, map_id, document_id, title, node_type, level, order_index) "
                        "VALUES (:node1, :map, :doc, 'N1', 'concept', 1, 0), (:node2, :map, :doc, 'N2', 'concept', 1, 1)"),
    ("knowledge_edges", "INSERT INTO knowledge_edges (id, map_id, source_node_id, target_node_id, relation_type) "
                        "VALUES (:edge, :map, :node1, :node2, 'related')"),
    ("knowledge_node_chunks", "INSERT INTO knowledge_node_chunks (id, node_id, chunk_id) VALUES (:nchunk, :node1, :chunk)"),
    ("quizzes", "INSERT INTO quizzes (id, user_id, document_id, title, quiz_type, question_count, difficulty, status) "
                "VALUES (:quiz, :user, :doc, 'Diag', 'diagnostic', 1, 'easy', 'ready')"),
    ("quiz_questions", "INSERT INTO quiz_questions (id, quiz_id, question_text, question_type, correct_answer, "
                       "explanation, difficulty, concept_tags_json, order_index) "
                       "VALUES (:q, :quiz, 'Q?', 'short_answer', 'A', 'Because', 'easy', '[]', 0)"),
    ("quiz_question_chunks", "INSERT INTO quiz_question_chunks (id, question_id, chunk_id) VALUES (:qchunk, :q, :chunk)"),
    ("quiz_attempts", "INSERT INTO quiz_attempts (id, quiz_id, user_id, total_questions, max_score, status) "
                      "VALUES (:att, :quiz, :user, 1, 1, 'graded')"),
    ("quiz_answers", "INSERT INTO quiz_answers (id, attempt_id, question_id, user_answer, verdict, is_correct, score) "
                     "VALUES (:ans, :att, :q, 'B', 'incorrect', false, 0)"),
    ("concept_masteries", "INSERT INTO concept_masteries (id, user_id, document_id, attempt_id, concept_name, "
                          "correct_count, earned_score, total_count, mastery_score, status) "
                          "VALUES (:cm, :user, :doc, :att, 'C', 0, 0, 1, 0, 'critical_gap')"),
    ("review_plans", "INSERT INTO review_plans (id, attempt_id, user_id, document_id, summary) "
                     "VALUES (:plan, :att, :user, :doc, 'Plan')"),
    ("review_plan_items", "INSERT INTO review_plan_items (id, review_plan_id, topic, priority, reason, status, "
                          "mastery_score, review_tasks_json) VALUES (:item, :plan, 'T', 1, 'r', 'critical_gap', 0, '[]')"),
    ("review_item_chunks", "INSERT INTO review_item_chunks (id, review_item_id, chunk_id) VALUES (:ichunk, :item, :chunk)"),
    ("quizzes (practice)", "INSERT INTO quizzes (id, user_id, document_id, title, quiz_type, question_count, difficulty, "
                           "status, source_review_item_id, source_attempt_id) "
                           "VALUES (:pquiz, :user, :doc, 'Practice', 'practice', 1, 'easy', 'ready', :item, :att)"),
    ("ai_validation_logs", "INSERT INTO ai_validation_logs (id, target_type, target_ref, rule_code, severity) "
                           "VALUES (:aval, 'review_item', :tag, 'seed', 'warning')"),
    ("guided_mindmap_jobs", "INSERT INTO guided_mindmap_jobs (job_id, user_id, idempotency_key, request_fingerprint, "
                            "source_ids_json, guided_config_json) VALUES (:tag, :user, :tag, 'fp', '[]', '{}')"),
    ("guided_mindmap_worker_heartbeats", "INSERT INTO guided_mindmap_worker_heartbeats (worker_id, heartbeat_at) "
                                         "VALUES (:tag, now())"),
    ("usage_entitlements", "INSERT INTO usage_entitlements (user_id, monthly_token_limit, per_request_token_limit, "
                           "period_start, period_end, reset_at) VALUES (:tag, 1000, 100, now(), now() + interval '30 days', "
                           "now() + interval '30 days')"),
    ("usage_reservations", "INSERT INTO usage_reservations (id, user_id, feature, operation, idempotency_key, "
                           "reserved_tokens, monthly_token_limit, per_request_token_limit, expires_at, period_start, "
                           "period_end, status) VALUES (:tag, :tag, 'chat', 'ask', :tag, 10, 1000, 100, "
                           "now() + interval '5 minutes', now(), now() + interval '30 days', 'committed')"),
    ("usage_events", "INSERT INTO usage_events (id, reservation_id, attempt_id, user_id, feature, operation, "
                     "idempotency_key, usage_source, status, period_start, period_end) VALUES (:tag, :tag, '1', :tag, "
                     "'chat', 'ask', :tag, 'estimated', 'committed', now(), now() + interval '30 days')"),
]


def test_every_table_with_a_row_seeded_as_the_app_role_is_seen_by_every_role(app_conn,
                                                                            owner_conn):
    """Real data on all 26 RLS tables (and alembic_version), inserted by the app role
    (each policy's WITH CHECK runs), then counted by owner, app and read-only."""
    import uuid

    ids = {k: str(uuid.uuid4()) for k in (
        "user", "doc", "section", "chunk", "coll", "ident", "job", "map", "node1", "node2",
        "edge", "nchunk", "quiz", "q", "qchunk", "att", "ans", "cm", "plan", "item",
        "ichunk", "pquiz", "aval")}
    tag = "rls_seed_" + ids["user"][:8]
    params = {**ids, "email": f"{tag}@example.com", "tag": tag}
    ro_url = (os.getenv("TEST_READONLY_DATABASE_URL") or "").strip()
    try:
        with app_conn.begin():
            for _label, sql in _SEED:
                app_conn.execute(sa.text(sql), params)
        owner_conn.rollback()
        tables = [t for (t,) in owner_conn.execute(sa.text(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1"))]
        assert len(tables) == 27, tables
        ro = None
        if ro_url:
            from shared.migration_guard import chuan_hoa_driver
            ro = sa.create_engine(chuan_hoa_driver(ro_url), poolclass=sa.pool.NullPool)
        try:
            for t in tables:
                q = sa.text(f'SELECT count(*) FROM public."{t}"')
                want = owner_conn.execute(q).scalar()
                assert want > 0, f"{t} is empty: the seed must reach every table"
                assert app_conn.execute(q).scalar() == want, t
                if ro is not None:
                    with ro.connect() as r:
                        assert r.execute(q).scalar() == want, t
        finally:
            if ro is not None:
                ro.dispose()
    finally:
        from tests._owner_db import owner_engine
        with owner_engine().begin() as c:   # the owner cleans up; cascades do the rest
            c.execute(sa.text("DELETE FROM users WHERE id = :user"), params)
            for table, col in (("guided_mindmap_jobs", "job_id"),
                               ("guided_mindmap_worker_heartbeats", "worker_id"),
                               ("usage_events", "id"), ("usage_reservations", "id"),
                               ("usage_entitlements", "user_id")):
                c.execute(sa.text(f"DELETE FROM {table} WHERE {col} = :tag"), params)
            c.execute(sa.text("DELETE FROM ai_validation_logs WHERE id = :aval"), params)



def _table_owner(conn):
    return conn.execute(sa.text(
        "SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.review_plans'::regclass"
    )).scalar()


def test_the_app_role_cannot_switch_to_the_owner(app_conn, owner_conn):
    assert _sqlstate(app_conn, f'SET ROLE "{_table_owner(owner_conn)}"') == "42501"


def test_any_role_membership_fails_verification_even_without_inherit(app_conn, owner_conn):
    """Codex task60: `pg_has_role(.., 'USAGE')` misses a NOINHERIT membership, and the app
    could then `SET ROLE` to the owner. Predefined roles (pg_write_all_data, ...) bypass
    table grants the same way. The app and read-only roles must be members of nothing."""
    owner = _table_owner(owner_conn)
    owner_conn.rollback()
    try:
        with owner_conn.begin():
            owner_conn.execute(sa.text(f'GRANT "{owner}" TO {APP_ROLE} WITH INHERIT FALSE'))
    except sa.exc.DBAPIError as exc:
        if getattr(exc.orig, "sqlstate", "") == "42501":
            pytest.skip("this owner cannot grant membership in itself (CI runs it as postgres)")
        raise
    try:
        problems = role_problems(owner_conn, _mode())
        owner_conn.rollback()
        assert any("member of" in p and APP_ROLE in p for p in problems), problems
        # The escalation the check exists for: with the membership, SET ROLE works.
        assert _sqlstate(app_conn, f'SET ROLE "{owner}"') == "ok"
    finally:
        app_conn.rollback()
        app_conn.execute(sa.text("RESET ROLE"))
        app_conn.commit()
        with owner_conn.begin():
            owner_conn.execute(sa.text(f'REVOKE "{owner}" FROM {APP_ROLE}'))
    assert role_problems(owner_conn, _mode()) == []
