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
    assert "guard function studymap_guard_review_plan_delete body differs" in r.stderr
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
    lock = "LOCK TABLE review_plans, review_plan_items IN SHARE ROW EXCLUSIVE MODE"
    for module_file in ("20261119_review_item_guard.py", "20261118_review_item_archive.py"):
        seen = _downgrade_statements(module_file)
        first_count = next(i for i, x in enumerate(seen) if "count(*)" in x)
        assert any(lock in x for x in seen[:first_count]), (module_file, seen[:first_count + 1])
