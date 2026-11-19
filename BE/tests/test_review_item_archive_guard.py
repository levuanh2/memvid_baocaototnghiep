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


def test_an_old_code_delete_racing_the_new_code_archive_is_refused(client, planned):
    """New code archives under a lock on the plan row (it updates summary/created_at in
    the same transaction). An old-code DELETE that started before the archive committed
    waits for that lock, then its row trigger sees the committed archive and refuses."""
    plan_id = planned["first"]["review_plan_id"]
    archiving = _raw()
    archiving.execute(sa.text("UPDATE review_plans SET summary = summary || ' ' WHERE id = :p"),
                      {"p": plan_id})
    archiving.execute(sa.text("UPDATE review_plan_items SET archived_at = now() "
                              "WHERE review_plan_id = :p AND archived_at IS NULL"),
                      {"p": plan_id})
    outcome = {}

    def _old_code_delete():
        with _raw() as c:
            try:
                c.execute(sa.text("SET lock_timeout = '20s'"))
                c.execute(sa.text("DELETE FROM review_plans WHERE id = :p"), {"p": plan_id})
                c.commit()
                outcome["result"] = "deleted"
            except sa.exc.DBAPIError as exc:
                outcome["result"] = getattr(exc.orig, "sqlstate", repr(exc.orig))

    t = threading.Thread(target=_old_code_delete)
    t.start()
    t.join(2)
    assert t.is_alive(), "the delete must wait for the archiving transaction"
    archiving.commit()
    archiving.close()
    t.join(30)
    assert outcome.get("result") == "23001", outcome
    assert _counts(planned["pq"])["attempts"] == 1


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
