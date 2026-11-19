"""Database guard for archived review topics (migration 20261119, owner decision 2026-11-19).

Once #194 archives a topic, code older than #194 (or a hand-written DELETE) would delete
the plan on regeneration, and the foreign key cascade would take the archived topics
with every practice quiz, attempt, answer and mastery row made from them. Code cannot
patch older code, so PostgreSQL refuses it:

- DELETE of a review plan that holds archived topics while its attempt, user and
  document all still exist (a regeneration or a hand delete). A plan removed because its
  attempt, document or account was deleted still goes, as before #194.
- DELETE of an archived topic while its plan exists (a direct delete, or an ORM that
  deletes children first); UPDATE that un-archives it or moves it to another plan.
- TRUNCATE of either table while archived topics exist.

Fail closed with SQLSTATE 23001 (restrict_violation), a hint naming the runbook, and no
row data. Real PostgreSQL only; old code is simulated by its exact statements.
"""
from __future__ import annotations

import threading

import pytest
import sqlalchemy as sa

from tests.test_review_plan_archive import (  # noqa: F401  (fixtures)
    GUIDE_2, _counts, _fake_guide, _need_db, _plan, _protect, be, owner, planned)

RUNBOOK = "docs/RUNBOOK_REVIEW_ITEM_ARCHIVE.md"


def _archived(client, planned, monkeypatch):
    """The state after one regeneration by the new code: one archived topic, practice
    history made from it, one current topic."""
    _fake_guide(monkeypatch, GUIDE_2)
    forced = _plan(client, planned["attempt_id"], force=True)
    assert len(forced["archived_items"]) == 1
    return forced


def _raw():
    from app.db import get_engine

    return get_engine().connect()


def _refused(exc_info):
    orig = getattr(exc_info.value, "orig", exc_info.value)
    assert getattr(orig, "sqlstate", None) == "23001", repr(orig)
    text = str(orig)
    assert RUNBOOK in text, text
    return text


def test_old_code_regeneration_is_refused_and_history_stays(client, planned, monkeypatch):
    """What code before #194 runs on "Tạo lại kế hoạch": `s.delete(old)` (no ORM
    relationships: one DELETE on review_plans, the children go by FK cascade)."""
    from app.db import session_scope
    from app.db.models import ReviewPlan

    forced = _archived(client, planned, monkeypatch)
    before = _counts(planned["pq"])
    with pytest.raises(sa.exc.DBAPIError) as exc_info:
        with session_scope() as s:
            s.delete(s.get(ReviewPlan, forced["review_plan_id"]))
            s.flush()
    text = _refused(exc_info)
    assert forced["review_plan_id"] not in text and "quy tac ham hop" not in text, "no row data"
    assert _counts(planned["pq"]) == before
    again = client.get(f"/api/review-plans/{planned['attempt_id']}").get_json()
    assert len(again["archived_items"]) == 1


def test_a_direct_sql_delete_of_the_plan_is_refused(client, planned, monkeypatch):
    forced = _archived(client, planned, monkeypatch)
    with _raw() as c, pytest.raises(sa.exc.DBAPIError) as exc_info:
        c.execute(sa.text("DELETE FROM review_plans WHERE id = :p"),
                  {"p": forced["review_plan_id"]})
    _refused(exc_info)
    assert _counts(planned["pq"])["attempts"] == 1


def test_deleting_an_archived_topic_directly_or_children_first_is_refused(client, planned,
                                                                           monkeypatch):
    forced = _archived(client, planned, monkeypatch)
    old = forced["archived_items"][0]["review_item_id"]
    with _raw() as c, pytest.raises(sa.exc.DBAPIError) as exc_info:
        c.execute(sa.text("DELETE FROM review_plan_items WHERE id = :i"), {"i": old})
    _refused(exc_info)
    with _raw() as c, pytest.raises(sa.exc.DBAPIError):   # an ORM deleting children first
        c.execute(sa.text("DELETE FROM review_plan_items WHERE review_plan_id = :p"),
                  {"p": forced["review_plan_id"]})
    assert _counts(planned["pq"])["quiz"] is True


def test_unarchiving_or_moving_an_archived_topic_is_refused(client, planned, monkeypatch):
    forced = _archived(client, planned, monkeypatch)
    old = forced["archived_items"][0]["review_item_id"]
    with _raw() as c, pytest.raises(sa.exc.DBAPIError) as exc_info:
        c.execute(sa.text("UPDATE review_plan_items SET archived_at = NULL WHERE id = :i"),
                  {"i": old})
    _refused(exc_info)


def test_truncate_is_refused_while_archived_topics_exist(client, planned, monkeypatch):
    _archived(client, planned, monkeypatch)
    for table in ("review_plan_items", "review_plans"):
        with _raw() as c, pytest.raises(sa.exc.DBAPIError) as exc_info:
            c.execute(sa.text(f"TRUNCATE {table} CASCADE"))
        _refused(exc_info)


def test_the_new_code_regenerates_many_times(client, planned, monkeypatch):
    from tests.test_review_plan_archive import GUIDE_1

    for guide in (GUIDE_2, GUIDE_1, GUIDE_2):
        _fake_guide(monkeypatch, guide)
        _plan(client, planned["attempt_id"], force=True)
    final = client.get(f"/api/review-plans/{planned['attempt_id']}").get_json()
    assert len(final["archived_items"]) == 3 and len(final["items"]) == 1
    assert _counts(planned["pq"])["attempts"] == 1


def test_deleting_the_attempt_or_the_document_still_removes_its_plan(client, planned,
                                                                     monkeypatch):
    """Deleting a document (Library) or an account removes everything made from it, as
    before #194: the guard refuses only a plan whose attempt, user and document remain."""
    forced = _archived(client, planned, monkeypatch)
    with _raw() as c:
        c.execute(sa.text("DELETE FROM quiz_attempts WHERE id = :a"),
                  {"a": planned["attempt_id"]})
        c.commit()
        assert c.execute(sa.text("SELECT count(*) FROM review_plans WHERE id = :p"),
                         {"p": forced["review_plan_id"]}).scalar() == 0
        c.execute(sa.text("DELETE FROM documents WHERE id = :d"),
                  {"d": planned["item"]["document_id"]})
        c.commit()


def test_a_document_delete_removes_a_plan_with_archived_topics(client, planned, monkeypatch):
    forced = _archived(client, planned, monkeypatch)
    with _raw() as c:
        c.execute(sa.text("DELETE FROM documents WHERE id = :d"),
                  {"d": planned["item"]["document_id"]})
        c.commit()
        assert c.execute(sa.text("SELECT count(*) FROM review_plan_items WHERE "
                                 "review_plan_id = :p"), {"p": forced["review_plan_id"]}
                         ).scalar() == 0


def test_an_old_code_delete_racing_the_real_archive_is_refused(client, planned, owner,
                                                               monkeypatch):
    """The REAL regeneration path (Codex task50: the first test locked the plan in the
    opposite order from production). It is paused right after its archiving UPDATE, with
    its transaction open; an old-code DELETE of the plan then starts. It must wait for
    the plan row lock the archive holds, then see the committed archive and refuse; the
    archive must commit (no deadlock, no lost archive)."""
    from sqlalchemy import event

    from app.db import get_engine

    plan_id = planned["first"]["review_plan_id"]
    archived, release = threading.Event(), threading.Event()

    def _pause(conn, cursor, statement, *a):
        # Only the first archiving UPDATE (the regeneration may run on a worker thread).
        if (statement.lstrip().upper().startswith("UPDATE REVIEW_PLAN_ITEMS SET ARCHIVED_AT")
                and not archived.is_set()):
            archived.set()
            release.wait(30)

    engine = get_engine()
    event.listen(engine, "after_cursor_execute", _pause)
    outcome = {}

    from app.application import review_plans as review_uc

    _fake_guide(monkeypatch, GUIDE_2)

    def _archiver():   # the real use case and _persist, without the Flask test client
        try:
            review_uc.generate(planned["attempt_id"], owner, force=True,
                               bat_buoc_chu_so_huu=True)
            outcome["archive"] = 200
        except Exception as exc:   # surfaced by the assertion below
            outcome["archive"] = repr(exc)

    def _old_code_delete():
        with _raw() as c:
            try:
                c.execute(sa.text("SET lock_timeout = '20s'"))
                c.execute(sa.text("DELETE FROM review_plans WHERE id = :p"), {"p": plan_id})
                c.commit()
                outcome["delete"] = "deleted"
            except sa.exc.DBAPIError as exc:
                outcome["delete"] = getattr(exc.orig, "sqlstate", repr(exc.orig))

    try:
        arch = threading.Thread(target=_archiver, name="archiver")
        arch.start()
        if not archived.wait(30):
            arch.join(30)
            pytest.fail(f"the regeneration did not reach its archiving UPDATE: {outcome}")
        dele = threading.Thread(target=_old_code_delete)
        dele.start()
        dele.join(2)
        assert dele.is_alive(), "the delete must wait for the archiving transaction's plan lock"
        release.set()
        arch.join(60)
        dele.join(60)
    finally:
        release.set()
        event.remove(engine, "after_cursor_execute", _pause)
    assert outcome.get("archive") in (200, 201), outcome
    assert outcome.get("delete") == "23001", outcome
    assert _counts(planned["pq"])["attempts"] == 1


def test_an_archived_topic_is_read_only_except_fk_set_null(client, planned, monkeypatch):
    """Codex task50: changing only `archived_at`/`review_plan_id` was refused, but an
    UPDATE or an upsert could rewrite the history's content."""
    forced = _archived(client, planned, monkeypatch)
    old = forced["archived_items"][0]["review_item_id"]
    for sql in ("UPDATE review_plan_items SET topic = 'khac' WHERE id = :i",
                "UPDATE review_plan_items SET reason = 'khac', priority = 9 WHERE id = :i",
                "UPDATE review_plan_items SET review_tasks_json = '[]' WHERE id = :i",
                "INSERT INTO review_plan_items (id, review_plan_id, topic, priority, reason, "
                "status, mastery_score, review_tasks_json) SELECT id, review_plan_id, 'x', 7, "
                "'x', status, 0.1, '[]' FROM review_plan_items WHERE id = :i "
                "ON CONFLICT (id) DO UPDATE SET topic = EXCLUDED.topic"):
        with _raw() as c, pytest.raises(sa.exc.DBAPIError) as exc_info:
            c.execute(sa.text(sql), {"i": old})
        _refused(exc_info)
    with _raw() as c:   # FK maintenance (ON DELETE SET NULL) still works
        c.execute(sa.text("UPDATE review_plan_items SET concept_mastery_id = NULL, "
                          "section_id = NULL, knowledge_node_id = NULL WHERE id = :i"),
                  {"i": old})
        c.commit()


# ── the verifier proves the guard from the catalogs ───────────────────────

def _verify_and_restore():
    from tests.test_attempt_submit_key_migration import _migrate, _stamp, _verify

    r = _verify()
    _stamp("20261118_review_item_archive")   # rerun the guard revision: it rebuilds
    m = _migrate()
    assert m.returncode == 0, m.stdout + m.stderr
    assert _verify().returncode == 0
    return r


def test_the_verifier_fails_closed_when_a_guard_trigger_is_missing():
    with _raw() as c:
        c.execute(sa.text("DROP TRIGGER trg_guard_review_plan_delete ON review_plans"))
        c.commit()
    r = _verify_and_restore()
    assert r.returncode != 0
    assert "guard trigger trg_guard_review_plan_delete on review_plans is missing" in r.stderr
    assert RUNBOOK in r.stderr and "RUNBOOK_SUBMIT_KEY_INDEX" not in r.stderr


def test_the_verifier_fails_closed_when_a_guard_trigger_is_disabled():
    with _raw() as c:
        c.execute(sa.text("ALTER TABLE review_plan_items DISABLE TRIGGER "
                          "trg_guard_archived_review_item"))
        c.commit()
    r = _verify_and_restore()
    assert r.returncode != 0
    assert "trg_guard_archived_review_item on review_plan_items is disabled" in r.stderr


def test_the_guard_downgrade_refuses_while_archived_topics_exist(client, planned, monkeypatch):
    from tests.test_attempt_submit_key_migration import _run, _version

    _archived(client, planned, monkeypatch)
    r = _run("alembic", "downgrade", "20261118_review_item_archive")
    assert r.returncode != 0 and "refusing downgrade" in (r.stdout + r.stderr)
    with _raw() as c:
        assert _version(c) == "20261119_review_item_guard"


def test_the_verifier_fails_closed_on_a_same_name_body_or_a_wrong_event():
    """Codex task50: names and enabled flags were not proof."""
    with _raw() as c:
        c.execute(sa.text("CREATE OR REPLACE FUNCTION studymap_guard_review_plan_delete() "
                          "RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD; END $$"))
        c.commit()
    r = _verify_and_restore()
    assert r.returncode != 0
    assert "guard function studymap_guard_review_plan_delete" in r.stderr
    assert "body differs" in r.stderr
    with _raw() as c:
        c.execute(sa.text("DROP TRIGGER trg_guard_review_plan_delete ON review_plans"))
        c.execute(sa.text("CREATE TRIGGER trg_guard_review_plan_delete AFTER DELETE ON "
                          "review_plans FOR EACH ROW EXECUTE FUNCTION "
                          "studymap_guard_review_plan_delete()"))
        c.commit()
    r = _verify_and_restore()
    assert r.returncode != 0 and "fires on tgtype" in r.stderr, r.stderr


def _downgrade_statements(module_file):
    """Run a migration's downgrade() against a recording stand-in for the connection."""
    import contextlib
    import importlib.util
    from pathlib import Path

    seen = []

    class _Result:
        def scalar(self):
            return 0

        def first(self):
            return None

    class _Conn:
        def execute(self, stmt, *a, **k):
            seen.append(str(stmt))
            return _Result()

    class _Ctx:
        def autocommit_block(self):
            seen.append("AUTOCOMMIT (commits and releases locks)")
            return contextlib.nullcontext()

    class _Op:
        def get_bind(self):
            return _Conn()

        def execute(self, sql):
            seen.append(str(sql))

        def get_context(self):
            return _Ctx()

    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / module_file
    spec = importlib.util.spec_from_file_location("mig_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.op = _Op()
    if hasattr(mod, "archived_at_column_exists"):
        mod.archived_at_column_exists = lambda conn: True
    if hasattr(mod, "old_priority_constraint_exists"):
        mod.old_priority_constraint_exists = lambda conn: False
    mod.downgrade()
    return seen


def test_each_downgrade_locks_both_tables_before_it_counts_archived_topics():
    """Codex task50: a count before a lock let an archive commit between the count and
    the drop. The lock must come first and cover both tables."""
    lock = "LOCK TABLE review_plans, review_plan_items, quizzes IN SHARE ROW EXCLUSIVE MODE"
    for module_file in ("20261119_review_item_guard.py", "20261118_review_item_archive.py"):
        seen = _downgrade_statements(module_file)
        first_count = next(i for i, x in enumerate(seen) if "count(*)" in x)
        assert any(lock in x for x in seen[:first_count]), (module_file, seen[:first_count + 1])
        # Practice history counts, not archived topics only (Codex task53).
        assert "quizzes" in seen[first_count], (module_file, seen[first_count])


def test_downgrade_20261118_keeps_its_lock_until_the_column_is_dropped():
    """Codex task52: an autocommit block for DROP INDEX CONCURRENTLY committed and
    released the lock, and an archive could commit before the column was dropped."""
    seen = _downgrade_statements("20261118_review_item_archive.py")
    lock = next(i for i, x in enumerate(seen) if x.startswith("LOCK TABLE"))
    drop = next(i for i, x in enumerate(seen) if "DROP COLUMN" in x)
    assert lock < drop
    assert not any(x.startswith("AUTOCOMMIT") for x in seen[lock:drop]), seen[lock:drop + 1]


# ── task52: history before any archive, shadow tables, overloads ──────────

def test_old_code_deleting_a_plan_with_practice_but_nothing_archived_is_refused(client,
                                                                               planned):
    """Codex task52 reverse interleaving: an old-code delete that takes the plan lock
    before any archive exists found no archived topic and let the cascade erase the
    current topic's practice. Practice history alone now protects the plan."""
    from app.db import session_scope
    from app.db.models import ReviewPlan

    before = _counts(planned["pq"])
    with pytest.raises(sa.exc.DBAPIError) as exc_info:
        with session_scope() as s:
            s.delete(s.get(ReviewPlan, planned["first"]["review_plan_id"]))
            s.flush()
    _refused(exc_info)
    with _raw() as c, pytest.raises(sa.exc.DBAPIError):
        c.execute(sa.text("DELETE FROM review_plan_items WHERE id = :i"),
                  {"i": planned["item"]["review_item_id"]})
    assert _counts(planned["pq"]) == before


def test_temporary_shadow_tables_cannot_answer_for_the_guard(client, planned, monkeypatch):
    """Codex task52: unqualified names let a caller's pg_temp tables (searched first)
    make every EXISTS false while the real rows were deleted."""
    forced = _archived(client, planned, monkeypatch)
    with _raw() as c:
        try:
            for ddl in ("CREATE TEMP TABLE review_plan_items (review_plan_id uuid, "
                        "archived_at timestamptz, id uuid)",
                        "CREATE TEMP TABLE quizzes (source_review_item_id uuid)",
                        "SET search_path = pg_temp, public"):
                c.execute(sa.text(ddl))
            with pytest.raises(sa.exc.DBAPIError) as exc_info:
                c.execute(sa.text("DELETE FROM public.review_plans WHERE id = :p"),
                          {"p": forced["review_plan_id"]})
            _refused(exc_info)
        finally:
            c.rollback()
    assert _counts(planned["pq"])["attempts"] == 1


def test_the_verifier_reads_the_function_the_trigger_calls_not_a_same_name_overload():
    """Codex task52: a lookup by name could read an overload with the contract body while
    the zero-argument function the trigger calls was a no-op."""
    from shared.db_schema_checks import ARCHIVE_GUARD_FUNCTIONS

    body = ARCHIVE_GUARD_FUNCTIONS["studymap_guard_review_plan_delete"]
    with _raw() as c:
        # Trigger functions cannot take arguments: the overload is an ordinary function
        # carrying the contract text (bodies are not validated with this setting).
        c.execute(sa.text("SET check_function_bodies = off"))
        c.execute(sa.text("CREATE FUNCTION studymap_guard_review_plan_delete(dummy integer) "
                          "RETURNS integer LANGUAGE plpgsql AS $guard$" + body + "$guard$"))
        c.execute(sa.text("CREATE OR REPLACE FUNCTION studymap_guard_review_plan_delete() "
                          "RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD; END $$"))
        c.commit()
    try:
        r = _verify_and_restore()
    finally:
        with _raw() as c:
            c.execute(sa.text("DROP FUNCTION IF EXISTS studymap_guard_review_plan_delete(integer)"))
            c.commit()
    assert r.returncode != 0 and "body differs" in r.stderr, r.stderr


def test_the_verifier_requires_the_pinned_search_path():
    with _raw() as c:
        c.execute(sa.text("ALTER FUNCTION studymap_guard_archived_review_item() RESET search_path"))
        c.commit()
    r = _verify_and_restore()
    assert r.returncode != 0 and "search_path" in r.stderr, r.stderr


# ── task53: no new practice from an archived topic, whatever path inserts it ──

def _new_practice_quiz(item, owner):
    from app.domains.quiz import repository as quiz_repo

    return quiz_repo.create_quiz(
        user_id=owner, document_id=item["document_id"], title="Luyện tập muộn",
        scope={"type": "review_item", "section_ids": []}, question_count=1,
        difficulty="easy", quiz_type="practice", source_review_item_id=item["review_item_id"],
        source_attempt_id=item["attempt_id"])


def test_a_late_worker_cannot_insert_practice_from_an_archived_topic(client, planned, owner,
                                                                     monkeypatch):
    """Codex task53: the request checks the topic before enqueueing; the worker inserts
    the quiz later, after a regeneration may have archived the topic."""
    _archived(client, planned, monkeypatch)
    with pytest.raises(sa.exc.DBAPIError) as exc_info:
        _new_practice_quiz(planned["item"], owner)
    _refused(exc_info)


def test_a_worker_racing_the_archive_waits_and_is_refused(client, planned, owner, monkeypatch):
    from sqlalchemy import event

    from app.application import review_plans as review_uc
    from app.db import get_engine

    archived, release = threading.Event(), threading.Event()

    def _pause(conn, cursor, statement, *a):
        if (statement.lstrip().upper().startswith("UPDATE REVIEW_PLAN_ITEMS SET ARCHIVED_AT")
                and not archived.is_set()):
            archived.set()
            release.wait(30)

    _fake_guide(monkeypatch, GUIDE_2)
    engine = get_engine()
    event.listen(engine, "after_cursor_execute", _pause)
    outcome = {}

    def _archiver():
        review_uc.generate(planned["attempt_id"], owner, force=True, bat_buoc_chu_so_huu=True)
        outcome["archive"] = "ok"

    def _worker():
        try:
            _new_practice_quiz(planned["item"], owner)
            outcome["practice"] = "inserted"
        except sa.exc.DBAPIError as exc:
            outcome["practice"] = getattr(exc.orig, "sqlstate", repr(exc.orig))

    try:
        arch = threading.Thread(target=_archiver)
        arch.start()
        assert archived.wait(30), "the regeneration did not reach its archiving UPDATE"
        work = threading.Thread(target=_worker)
        work.start()
        work.join(2)
        assert work.is_alive(), "the insert must wait for the archiving transaction"
        release.set()
        arch.join(60)
        work.join(60)
    finally:
        release.set()
        event.remove(engine, "after_cursor_execute", _pause)
    assert outcome == {"archive": "ok", "practice": "23001"}, outcome


# ── task54: lock order with a practice insert, quiz deletes and detaches ──

def test_a_practice_insert_starting_before_the_archive_does_not_deadlock(client, planned,
                                                                        owner, monkeypatch):
    """Codex task54: regeneration locks attempt -> plan -> topic; the practice trigger
    locked the topic first and the FK check then wanted the attempt: a cycle. The
    regeneration is paused right after it locked the attempt, before archiving; a
    practice insert then starts. It must wait (same lock order), never deadlock, and be
    refused once the archive commits."""
    from sqlalchemy import event

    from app.application import review_plans as review_uc
    from app.db import get_engine

    locked, release = threading.Event(), threading.Event()

    def _pause(conn, cursor, statement, *a):
        st = " ".join(statement.split()).upper()
        if (st.startswith("SELECT") and "FROM QUIZ_ATTEMPTS" in st and "FOR UPDATE" in st
                and not locked.is_set()):
            locked.set()
            release.wait(30)

    _fake_guide(monkeypatch, GUIDE_2)
    engine = get_engine()
    event.listen(engine, "after_cursor_execute", _pause)
    outcome = {}

    def _archiver():
        try:
            review_uc.generate(planned["attempt_id"], owner, force=True, bat_buoc_chu_so_huu=True)
            outcome["archive"] = "ok"
        except Exception as exc:
            outcome["archive"] = repr(exc)[:200]

    def _worker():
        try:
            _new_practice_quiz(planned["item"], owner)
            outcome["practice"] = "inserted"
        except sa.exc.DBAPIError as exc:
            outcome["practice"] = getattr(exc.orig, "sqlstate", repr(exc.orig))

    try:
        arch = threading.Thread(target=_archiver)
        arch.start()
        assert locked.wait(30), "the regeneration did not lock the attempt"
        work = threading.Thread(target=_worker)
        work.start()
        work.join(2)
        assert work.is_alive(), "the insert must wait for the regeneration's attempt lock"
        release.set()
        arch.join(60)
        work.join(60)
    finally:
        release.set()
        event.remove(engine, "after_cursor_execute", _pause)
    assert outcome == {"archive": "ok", "practice": "23001"}, outcome


def test_deleting_or_detaching_a_practice_quiz_is_refused(client, planned):
    """Codex task54: DELETE FROM quizzes cascaded the practice attempts, answers and
    mastery while the topic and its plan existed; changing the source detached it."""
    before = _counts(planned["pq"])
    with _raw() as c, pytest.raises(sa.exc.DBAPIError) as exc_info:
        c.execute(sa.text("DELETE FROM quizzes WHERE id = :q"), {"q": planned["pq"]})
    _refused(exc_info)
    with _raw() as c, pytest.raises(sa.exc.DBAPIError) as exc_info:
        c.execute(sa.text("UPDATE quizzes SET quiz_type = 'diagnostic', "
                          "source_review_item_id = NULL WHERE id = :q"), {"q": planned["pq"]})
    _refused(exc_info)
    with _raw() as c, pytest.raises(sa.exc.DBAPIError) as exc_info:
        c.execute(sa.text("TRUNCATE quizzes CASCADE"))
    _refused(exc_info)
    assert _counts(planned["pq"]) == before


def test_practice_quiz_status_updates_still_work(client, planned):
    """The quiz row keeps changing during generation (status, counts): only the source
    link is frozen."""
    from app.domains.quiz import repository as quiz_repo

    quiz_repo.finish(planned["pq"], "ready", question_count=1)
    with _raw() as c:
        c.execute(sa.text("UPDATE quizzes SET title = title || '' WHERE id = :q"),
                  {"q": planned["pq"]})
        c.commit()


# ── task55: the diagnostic quiz as an upstream delete root; practice provenance ──

def test_deleting_the_diagnostic_quiz_behind_a_plan_with_history_is_refused(client, planned,
                                                                            monkeypatch):
    """Codex task55: the diagnostic quiz has no source topic, so the practice branch let
    its DELETE through; the cascade then took the attempt, the plan, every topic and
    every practice quiz made from them while the user and document still existed."""
    _archived(client, planned, monkeypatch)
    before = _counts(planned["pq"])
    with _raw() as c:
        diagnostic = c.execute(sa.text("SELECT quiz_id FROM quiz_attempts WHERE id = :a"),
                               {"a": planned["attempt_id"]}).scalar()
    with _raw() as c, pytest.raises(sa.exc.DBAPIError) as exc_info:
        c.execute(sa.text("DELETE FROM quizzes WHERE id = :q"), {"q": diagnostic})
    _refused(exc_info)
    assert _counts(planned["pq"]) == before


def test_practice_quiz_provenance_is_read_only(client, planned):
    """Codex task55: only source_review_item_id was frozen; quiz_type and
    source_attempt_id could be rewritten, hiding the quiz and its before/after link."""
    for sql in ("UPDATE quizzes SET source_attempt_id = NULL, quiz_type = 'diagnostic' "
                "WHERE id = :q",
                "UPDATE quizzes SET quiz_type = 'diagnostic' WHERE id = :q",
                "UPDATE quizzes SET source_attempt_id = NULL WHERE id = :q"):
        with _raw() as c, pytest.raises(sa.exc.DBAPIError) as exc_info:
            c.execute(sa.text(sql), {"q": planned["pq"]})
        _refused(exc_info)
