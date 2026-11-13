"""Two submits of one attempt / one practice quiz at almost the same moment.

PostgreSQL only: the property under test is row locking, which SQLite does not have.

Each test forces the interleaving that breaks a read-then-write status check: both
threads wait for each other inside `repository._now()`, which `submit` calls AFTER it has
read `status == "in_progress"` and BEFORE it writes. With a row lock the second thread
cannot get there until the first has committed, so the wait times out and the run is
serial; without one, both threads pass the check and both grade.
"""
from __future__ import annotations

import os
import threading
import uuid

import pytest

TEST_DSN = (os.getenv("TEST_DATABASE_URL") or "").strip()
pytestmark = pytest.mark.skipif(
    not TEST_DSN.startswith(("postgres://", "postgresql://")),
    reason="TEST_DATABASE_URL must point to a disposable PostgreSQL database",
)

# How long a thread waits inside `_now()` for the other one. Long enough for the other
# thread to arrive when nothing blocks it; short enough that a blocked run stays quick.
MEET_TIMEOUT_S = 2.0


@pytest.fixture()
def owner(client):
    from app.db import session_scope
    from app.db.models import User
    from app.domains.auth import users_store

    u = users_store.create_user(f"conc_{uuid.uuid4().hex[:8]}@example.com", "password123")
    yield u["user_id"]
    with session_scope() as s:
        row = s.get(User, u["user_id"])
        if row is not None:
            s.delete(row)
    from app.domains.documents import repository as docs_repo
    docs_repo.invalidate_cache()


def _quiz(owner):
    """A ready two-question multiple-choice quiz on a fresh document.

    The practice tests use a diagnostic quiz and stub the practice ownership check: a
    real practice quiz needs a review item chain, and the locking under test does not
    depend on `quiz_type`.
    """
    from app.domains.documents import repository as docs_repo
    from app.domains.quiz import repository as quiz_repo

    doc_id = str(uuid.uuid4())
    docs_repo.create(document_id=doc_id, filename=f"conc_{doc_id[:6]}.md", file_type="md",
                     file_path=f"/tmp/conc_{doc_id[:6]}.md", user_id=owner)
    quiz_id = quiz_repo.create_quiz(
        user_id=owner, document_id=doc_id, title="Quiz dong thoi",
        scope={"type": "full_document", "section_ids": []},
        question_count=2, difficulty="easy")
    q = {"question_type": "multiple_choice", "options": ["dung", "sai"],
         "correct_answer": "dung", "explanation": "x", "difficulty": "easy",
         "concept_tags": ["dong thoi"], "chunk_ids": []}
    quiz_repo.save_questions(quiz_id, [{**q, "question_text": "Cau 1?"},
                                       {**q, "question_text": "Cau 2?"}])
    quiz_repo.finish(quiz_id, "ready", question_count=2)
    qids = [x["question_id"] for x in quiz_repo.get_quiz(quiz_id)["questions"]]
    return quiz_id, qids


def _meet_inside_now(monkeypatch):
    """Make two threads meet inside `repository._now()` (or give up after the timeout)."""
    from app.domains.attempts import repository

    original = repository._now
    barrier = threading.Barrier(2)

    def _now():
        try:
            barrier.wait(MEET_TIMEOUT_S)
        except threading.BrokenBarrierError:
            pass
        return original()

    monkeypatch.setattr(repository, "_now", _now)


def _count_grading(monkeypatch):
    from app.domains.attempts import service

    calls = []
    original = service.grade_attempt

    def _grade(attempt_id, **kw):
        calls.append(attempt_id)
        return original(attempt_id, **kw)

    monkeypatch.setattr(service, "grade_attempt", _grade)
    return calls


def _run_together(fn, n=2):
    results = [None] * n

    def _one(i):
        try:
            results[i] = ("ok", fn())
        except Exception as exc:  # the loser's error is the result under test
            results[i] = ("error", exc)

    threads = [threading.Thread(target=_one, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    return results


def _attempts_of(quiz_id, owner):
    from sqlalchemy import select

    from app.db import session_scope
    from app.db.models import QuizAttempt

    with session_scope() as s:
        return [(a.id, a.status) for a in s.execute(
            select(QuizAttempt).where(QuizAttempt.quiz_id == quiz_id,
                                      QuizAttempt.user_id == owner)).scalars()]


def test_two_submits_of_one_diagnostic_attempt_grade_it_once(owner, monkeypatch):
    from app.application import attempts as attempts_uc
    from app.domains.attempts import repository

    quiz_id, qids = _quiz(owner)
    attempt_id = repository.open_attempt(quiz_id, owner)["attempt_id"]
    repository.save_draft_answers(attempt_id, {qids[0]: "dung", qids[1]: "sai"})
    _meet_inside_now(monkeypatch)
    graded = _count_grading(monkeypatch)

    results = _run_together(lambda: attempts_uc.submit_attempt(
        attempt_id, owner, bat_buoc_chu_so_huu=True,
        dispatch_grading=lambda *a: pytest.fail("multiple choice is graded inline")))

    ok = [r for kind, r in results if kind == "ok"]
    errors = [r for kind, r in results if kind == "error"]
    assert len(ok) == 1, results
    assert len(errors) == 1 and isinstance(errors[0], attempts_uc.AttemptKhongConDangLam), results
    assert graded == [attempt_id]
    assert _attempts_of(quiz_id, owner) == [(attempt_id, "graded")]


def test_two_opens_of_one_quiz_share_one_attempt(owner, monkeypatch):
    from app.domains.attempts import repository

    quiz_id, _ = _quiz(owner)
    # `open_attempt` does not call `_now`; make both threads meet after their lookup.
    original_uuid4 = uuid.uuid4
    barrier = threading.Barrier(2)

    def _uuid4():
        try:
            barrier.wait(MEET_TIMEOUT_S)
        except threading.BrokenBarrierError:
            pass
        return original_uuid4()

    monkeypatch.setattr(repository.uuid, "uuid4", _uuid4)
    results = _run_together(lambda: repository.open_attempt(quiz_id, owner))

    assert all(kind == "ok" for kind, _ in results), results
    assert len({r["attempt_id"] for _, r in results}) == 1, results
    assert len(_attempts_of(quiz_id, owner)) == 1


def test_two_submits_of_one_practice_quiz_grade_once(owner, monkeypatch):
    from app.application import attempts as attempts_uc
    from app.application import practice as practice_uc

    quiz_id, qids = _quiz(owner)
    monkeypatch.setattr(practice_uc, "_load_owned_practice",
                        lambda *a, **k: {"status": "ready"})
    _meet_inside_now(monkeypatch)
    graded = _count_grading(monkeypatch)
    answers = {qids[0]: "dung", qids[1]: "dung"}

    results = _run_together(lambda: practice_uc.submit(
        quiz_id, owner, answers, bat_buoc_chu_so_huu=True))

    ok = [r for kind, r in results if kind == "ok"]
    errors = [r for kind, r in results if kind == "error"]
    assert len(ok) == 1, results
    assert len(errors) == 1 and isinstance(errors[0], attempts_uc.AttemptKhongConDangLam), results
    assert len(graded) == 1
    assert [s for _, s in _attempts_of(quiz_id, owner)] == ["graded"]


def test_resending_the_same_practice_answers_right_after_does_not_grade_again(owner, monkeypatch):
    from app.application import attempts as attempts_uc
    from app.application import practice as practice_uc

    quiz_id, qids = _quiz(owner)
    monkeypatch.setattr(practice_uc, "_load_owned_practice",
                        lambda *a, **k: {"status": "ready"})
    answers = {qids[0]: "dung", qids[1]: "sai"}

    first = practice_uc.submit(quiz_id, owner, answers, bat_buoc_chu_so_huu=True)
    assert first["status"] == "graded"
    with pytest.raises(attempts_uc.AttemptKhongConDangLam):
        practice_uc.submit(quiz_id, owner, answers, bat_buoc_chu_so_huu=True)
    assert len(_attempts_of(quiz_id, owner)) == 1

    # A retake with different answers is a new attempt, as before.
    again = practice_uc.submit(quiz_id, owner, {qids[0]: "dung", qids[1]: "dung"},
                               bat_buoc_chu_so_huu=True)
    assert again["attempt_id"] != first["attempt_id"]
    assert len(_attempts_of(quiz_id, owner)) == 2
