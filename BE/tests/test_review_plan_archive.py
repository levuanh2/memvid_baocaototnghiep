"""Issue #18, owner option B: "Tạo lại kế hoạch" archives the old topics, it never deletes.

Before: `_persist` deleted the plan, and the database cascade (review_plan_items ->
quizzes.source_review_item_id -> attempts -> answers, concept_masteries) deleted every
practice quiz made from its topics with its results. Now the plan row stays, its current
topics get `archived_at`, the new topics join the same plan, and `created_at` (the
generation time) moves so #190's `outdated` is right. Archived topics are read-only
history: their practice quizzes can still be opened, submitted and regraded, but no new
practice is generated from them.

PostgreSQL only (migration 20261118); no model: the review guide is faked.
"""
from __future__ import annotations

import uuid

import pytest

from tests.test_gap_and_review import (  # noqa: F401  (fixtures)
    _fake_guide, _need_db, _protect, _seed_quiz, _take_quiz, be, owner)

GUIDE_1 = {"summary": "lan 1", "items": [
    {"topic": "quy tac ham hop", "reason": "r1", "review_tasks": ["t1"]}]}
GUIDE_2 = {"summary": "lan 2", "items": [
    {"topic": "quy tac ham hop", "reason": "r2", "review_tasks": ["t2"]}]}


def _plan(client, attempt_id, force=False):
    res = client.post("/api/review-plans/generate",
                      json={"attempt_id": attempt_id, "force": force})
    assert res.status_code in (200, 201), res.get_json()
    return res.get_json()


def _practice_from(item, owner):
    """A ready practice quiz made from `item`, as the generation job would leave it."""
    from app.domains.quiz import repository as quiz_repo

    quiz_id = quiz_repo.create_quiz(
        user_id=owner, document_id=item["document_id"], title=f"Luyện tập: {item['topic']}",
        scope={"type": "review_item", "section_ids": []}, question_count=1,
        difficulty="easy", quiz_type="practice", source_review_item_id=item["review_item_id"],
        source_attempt_id=item["attempt_id"])
    quiz_repo.save_questions(quiz_id, [{
        "question_text": "Luyen tap ham hop?", "question_type": "multiple_choice",
        "options": ["dung", "sai"], "correct_answer": "dung", "explanation": "x",
        "difficulty": "easy", "concept_tags": ["quy tac ham hop"],
        "chunk_ids": item["chunk_ids"][:1]}])
    quiz_repo.finish(quiz_id, "ready", question_count=1)
    return quiz_id, quiz_repo.get_quiz(quiz_id)["questions"][0]["question_id"]


def _submit_practice(client, quiz_id, qid, answer="dung"):
    res = client.post(f"/api/practice/{quiz_id}/submit", json={"answers": {qid: answer}},
                      headers={"Idempotency-Key": str(uuid.uuid4())})
    assert res.status_code == 200, res.get_json()
    return res.get_json()["attempt_id"]


def _counts(quiz_id):
    from sqlalchemy import func, select

    from app.db import session_scope
    from app.db.models import ConceptMastery, Quiz, QuizAnswer, QuizAttempt

    with session_scope() as s:
        attempts = [a for (a,) in s.execute(
            select(QuizAttempt.id).where(QuizAttempt.quiz_id == quiz_id)).all()]
        return {
            "quiz": s.get(Quiz, quiz_id) is not None,
            "attempts": len(attempts),
            "answers": s.execute(select(func.count()).select_from(QuizAnswer).where(
                QuizAnswer.attempt_id.in_(attempts))).scalar() if attempts else 0,
            "masteries": s.execute(select(func.count()).select_from(ConceptMastery).where(
                ConceptMastery.attempt_id.in_(attempts))).scalar() if attempts else 0,
        }


@pytest.fixture()
def planned(be, client, monkeypatch, owner):
    """A graded diagnostic attempt, its plan, a practice quiz from its topic, one attempt."""
    from app.domains.review import service as review_svc

    _protect(be, monkeypatch, owner)
    quiz_id, qids, _ = _seed_quiz(client, owner)
    attempt_id = _take_quiz(client, quiz_id, qids, ["sai", "sai", "dung"])
    _fake_guide(monkeypatch, GUIDE_1)
    first = _plan(client, attempt_id)
    item = review_svc.get_item(first["items"][0]["review_item_id"])
    pq, pqid = _practice_from(item, owner)
    _submit_practice(client, pq, pqid)
    return {"attempt_id": attempt_id, "first": first, "item": item, "pq": pq, "pqid": pqid}


def test_regenerating_keeps_every_practice_quiz_attempt_answer_and_mastery(client, planned,
                                                                          monkeypatch):
    before = _counts(planned["pq"])
    assert before == {"quiz": True, "attempts": 1, "answers": 1, "masteries": 1}
    _fake_guide(monkeypatch, GUIDE_2)
    _plan(client, planned["attempt_id"], force=True)
    assert _counts(planned["pq"]) == before


def test_the_plan_shows_only_the_new_topics_and_lists_the_old_ones_as_history(client,
                                                                             planned,
                                                                             monkeypatch):
    _fake_guide(monkeypatch, GUIDE_2)
    forced = _plan(client, planned["attempt_id"], force=True)
    assert forced["review_plan_id"] == planned["first"]["review_plan_id"]
    assert [i["reason"] for i in forced["items"]] == ["r2"]
    old = planned["item"]["review_item_id"]
    assert [a["review_item_id"] for a in forced["archived_items"]] == [old]
    assert forced["archived_items"][0]["practice_quiz_ids"] == [planned["pq"]]
    items = client.get(f"/api/review-plans/{forced['review_plan_id']}/items").get_json()
    assert [i["reason"] for i in items["items"]] == ["r2"]


def test_the_regenerated_plan_is_not_outdated(client, planned, monkeypatch):
    """`created_at` is the generation time: it moves, or the regenerated plan would stay
    "outdated" against a result graded before it."""
    from app.db import session_scope
    from app.db.models import QuizAttempt
    from app.domains.attempts import repository

    with session_scope() as s:   # the attempt was regraded after the first plan
        s.get(QuizAttempt, planned["attempt_id"]).graded_at = repository._now()
    stale = client.get(f"/api/review-plans/{planned['attempt_id']}").get_json()
    assert stale["outdated"] is True
    _fake_guide(monkeypatch, GUIDE_2)
    forced = _plan(client, planned["attempt_id"], force=True)
    assert forced["outdated"] is False
    assert forced["created_at"] > planned["first"]["created_at"]


def test_two_regenerations_archive_both_older_sets_without_a_unique_violation(
        client, planned, monkeypatch):
    _fake_guide(monkeypatch, GUIDE_2)
    _plan(client, planned["attempt_id"], force=True)
    _fake_guide(monkeypatch, GUIDE_1)
    third = _plan(client, planned["attempt_id"], force=True)
    assert [i["reason"] for i in third["items"]] == ["r1"]
    assert len(third["archived_items"]) == 2
    assert {a["priority"] for a in third["archived_items"]} == {1}


def test_no_new_practice_from_an_archived_topic(be, client, planned, monkeypatch):
    queued = []
    monkeypatch.setattr(be, "_day_quiz_job", lambda *a, **k: queued.append(a) or {"mode": "t"})
    _fake_guide(monkeypatch, GUIDE_2)
    forced = _plan(client, planned["attempt_id"], force=True)
    res = client.post("/api/practice/generate",
                      json={"review_item_id": planned["item"]["review_item_id"]})
    assert res.status_code == 409
    assert res.get_json()["error"] == "Chủ đề này thuộc kế hoạch cũ. Hãy luyện tập từ kế hoạch hiện tại."
    assert queued == [], "no generation job"
    current = client.post("/api/practice/generate",
                          json={"review_item_id": forced["items"][0]["review_item_id"]})
    assert current.status_code == 202 and len(queued) == 1, "the current topic still works"


def test_a_practice_quiz_from_an_archived_topic_can_still_be_opened_and_submitted(
        client, planned, monkeypatch):
    _fake_guide(monkeypatch, GUIDE_2)
    _plan(client, planned["attempt_id"], force=True)
    got = client.get(f"/api/practice/{planned['pq']}")
    assert got.status_code == 200
    assert got.get_json()["source_review_item_id"] == planned["item"]["review_item_id"]
    _submit_practice(client, planned["pq"], planned["pqid"], answer="sai")
    assert _counts(planned["pq"])["attempts"] == 2
    cmp = client.get(f"/api/practice/{planned['pq']}/comparison")
    assert cmp.status_code == 200 and cmp.get_json()["topic"] == "quy tac ham hop"


def test_progress_numbers_do_not_change_on_regeneration(client, planned, monkeypatch):
    overview = client.get("/api/progress/overview").get_json()
    attempts = client.get("/api/progress/attempts?limit=200").get_json()
    _fake_guide(monkeypatch, GUIDE_2)
    _plan(client, planned["attempt_id"], force=True)
    assert client.get("/api/progress/overview").get_json() == overview
    assert client.get("/api/progress/attempts?limit=200").get_json() == attempts


def test_the_library_lists_current_topics_only(client, planned, monkeypatch, owner):
    from app.domains.documents import repository as docs_repo

    _fake_guide(monkeypatch, {"summary": "lan 2", "items": [
        {"topic": "quy tac ham hop", "reason": "r2", "review_tasks": ["t2"]}]})
    _plan(client, planned["attempt_id"], force=True)
    docs_repo.invalidate_cache()
    topics = docs_repo.tri_thuc_tho(owner)[planned["item"]["document_id"]]["review_topics"]
    assert topics.count("quy tac ham hop") == 1, topics


def test_another_learner_sees_no_archived_topic(be, client, planned, monkeypatch):
    from app.domains.auth import users_store

    _fake_guide(monkeypatch, GUIDE_2)
    _plan(client, planned["attempt_id"], force=True)
    other = users_store.create_user(f"arc_{uuid.uuid4().hex[:8]}@example.com", "password123")
    _protect(be, monkeypatch, other["user_id"])
    assert client.get(f"/api/review-plans/{planned['attempt_id']}").status_code == 404
    res = client.post("/api/practice/generate",
                      json={"review_item_id": planned["item"]["review_item_id"]})
    assert res.status_code == 404
    assert client.get(f"/api/practice/{planned['pq']}").status_code == 404
