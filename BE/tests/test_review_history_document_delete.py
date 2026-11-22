"""Hard document deletes and review history (owner decisions 2026-11-19, items 4 and 5).

Deleting a source ("Xóa" in the sources sidebar: DELETE /sources/<id>, and the
/delete-source cleanup) hard-deletes the document; the foreign key cascade removes every
quiz, plan, topic, practice quiz, attempt and answer made from it, archived history
included. That is the product's decision (owner item 4), so the guard lets it through.
Two things must hold:

- only the owner can do it (another learner gets 404 and nothing is removed);
- it never deadlocks with a regeneration of one of its attempts (owner item 5: a
  deadlock is acceptable only against code older than #194). The regeneration locks
  attempt, then plan; the cascade used to lock the plan before the attempt.
"""
from __future__ import annotations

import uuid

import sqlalchemy as sa

from tests.test_review_item_archive_guard import (  # noqa: F401  (fixtures and helpers)
    _counts, _fake_guide, _need_db, _plan_without_history, _protect, _race, _raw,
    _sqlstate_of, be, owner, planned)


def _document_of(attempt_id):
    with _raw() as c:
        return c.execute(sa.text("SELECT q.document_id FROM quiz_attempts a JOIN quizzes q "
                                 "ON q.id = a.quiz_id WHERE a.id = :a"), {"a": attempt_id}).scalar()


def test_a_hard_document_delete_racing_a_regeneration_does_not_deadlock(be, client, owner,
                                                                       monkeypatch):
    from app.application import review_plans as review_uc
    from app.domains.documents import repository as docs_repo
    from tests.test_review_plan_archive import GUIDE_2

    _, attempt_id, first = _plan_without_history(be, client, monkeypatch, owner)
    document_id = _document_of(attempt_id)
    _fake_guide(monkeypatch, GUIDE_2)
    outcome = {}

    def _regenerate():
        _sqlstate_of(lambda: review_uc.generate(attempt_id, owner, force=True,
                                                bat_buoc_chu_so_huu=True), outcome, "archive")

    def _hard_delete():
        _sqlstate_of(lambda: docs_repo.hard_delete(document_id), outcome, "delete")

    _race("archiver", _regenerate,
          lambda st: st.startswith("SELECT") and "FROM QUIZ_ATTEMPTS" in st and "FOR UPDATE" in st,
          _hard_delete, outcome)
    assert outcome == {"archive": "done", "delete": "done"}, outcome
    with _raw() as c:
        assert c.execute(sa.text("SELECT count(*) FROM review_plans WHERE id = :p"),
                         {"p": first["review_plan_id"]}).scalar() == 0


def test_another_learner_cannot_delete_a_source_with_history(be, client, planned,
                                                             monkeypatch):
    from app.domains.auth import users_store

    before = _counts(planned["pq"])
    document_id = planned["item"]["document_id"]
    stranger = users_store.create_user(f"stranger_{uuid.uuid4().hex[:8]}@example.com", "password123")
    _protect(be, monkeypatch, stranger["user_id"])
    assert client.delete(f"/sources/{document_id}").status_code == 404
    assert client.delete(f"/api/documents/{document_id}").status_code == 404
    assert _counts(planned["pq"]) == before


def test_the_owner_hard_delete_removes_the_history_with_the_document(be, client, planned,
                                                                     monkeypatch):
    """Owner item 4: kept as before #194, and said so in the confirmation."""
    from app.domains.documents import repository as docs_repo

    _fake_guide(monkeypatch, __import__("tests.test_review_plan_archive",
                                        fromlist=["GUIDE_2"]).GUIDE_2)
    client.post("/api/review-plans/generate",
                json={"attempt_id": planned["attempt_id"], "force": True})
    assert docs_repo.hard_delete(planned["item"]["document_id"]) is True
    assert _counts(planned["pq"])["quiz"] is False


def test_the_library_delete_is_soft_and_keeps_the_history(be, client, owner, planned,
                                                          monkeypatch):
    """The Library's "Xoá" (DELETE /api/documents/<id>) only hides the document: no
    history goes, so its confirmation must not promise a loss it does not cause."""
    before = _counts(planned["pq"])
    _protect(be, monkeypatch, owner)
    assert client.delete(f"/api/documents/{planned['item']['document_id']}").status_code == 200
    assert _counts(planned["pq"]) == before
