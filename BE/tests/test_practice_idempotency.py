"""Idempotency-Key on POST /api/practice/<id>/submit, against a real PostgreSQL.

One logical submit = one key. The same key with the same answers is a retry: it returns
the stored result and grades nothing. A new key is a new attempt even with identical
answers. Concurrency is forced with barriers and events, never with sleeps: a test that
passes only because one thread happened to be slower proves nothing.
"""
from __future__ import annotations

import threading
import uuid
from datetime import timedelta

import pytest

from tests.test_attempt_submit_concurrency import (  # noqa: F401  (fixture `owner`)
    _attempts_of,
    _meet_inside_now,
    _quiz,
    _run_together,
    owner,
    pytestmark,
)


def _key():
    return str(uuid.uuid4())


@pytest.fixture()
def practice(owner, monkeypatch):
    """A ready quiz the practice use case accepts (the ownership gate is not under test)."""
    from app.application import practice as practice_uc

    monkeypatch.setattr(practice_uc, "_load_owned_practice",
                        lambda *a, **k: {"status": "ready"})
    quiz_id, qids = _quiz(owner)
    return quiz_id, qids


@pytest.fixture()
def counts(monkeypatch):
    """How many times grading ran and how many times gap analysis (mastery) ran."""
    from app.domains.attempts import service
    from app.domains.gap_analysis import service as gap_service

    seen = {"grade": [], "gap": []}
    grade, gap = service.grade_attempt, gap_service.analyze_attempt

    def _grade(attempt_id, **kw):
        seen["grade"].append(attempt_id)
        return grade(attempt_id, **kw)

    def _gap(attempt_id):
        seen["gap"].append(attempt_id)
        return gap(attempt_id)

    monkeypatch.setattr(service, "grade_attempt", _grade)
    monkeypatch.setattr(gap_service, "analyze_attempt", _gap)
    return seen


def _submit(quiz_id, user, answers, key, *, protect=True):
    from app.application import practice as practice_uc

    return practice_uc.submit(quiz_id, user, answers, bat_buoc_chu_so_huu=protect,
                              submit_key=key)


def test_same_key_twice_at_once_makes_one_attempt_and_grades_it_once(owner, practice, counts,
                                                                       monkeypatch):
    from app.application import practice as practice_uc

    quiz_id, qids = practice
    answers = {qids[0]: "dung", qids[1]: "sai"}
    key = _key()
    # Both threads meet after their key lookup unless something serialises them.
    _meet_inside_now(monkeypatch)

    results = _run_together(lambda: _submit(quiz_id, owner, answers, key))

    ok = [r for kind, r in results if kind == "ok"]
    errors = [r for kind, r in results if kind == "error"]
    assert len(_attempts_of(quiz_id, owner)) == 1
    assert len(counts["grade"]) == 1 and len(counts["gap"]) == 1
    # The second request either saw the attempt still being graded (retry later with the
    # same key) or already graded (the stored result). Never a second grading.
    assert all(isinstance(e, practice_uc.NopBaiDangCham) for e in errors), results
    assert len({r["attempt_id"] for r in ok}) == 1
    assert len(ok) + len(errors) == 2


def test_same_key_later_returns_the_stored_result_and_grades_nothing(owner, practice, counts):
    quiz_id, qids = practice
    answers = {qids[0]: "dung", qids[1]: "sai"}
    key = _key()

    first = _submit(quiz_id, owner, answers, key)
    again = _submit(quiz_id, owner, answers, key)

    assert first["status"] == "graded"
    assert again == first
    assert counts["grade"] == [first["attempt_id"]]
    assert counts["gap"] == [first["attempt_id"]]
    assert len(_attempts_of(quiz_id, owner)) == 1


def test_same_key_with_other_answers_or_another_quiz_is_refused(owner, practice, counts):
    from app.application import practice as practice_uc

    quiz_id, qids = practice
    other_quiz, other_qids = _quiz(owner)
    key = _key()
    first = _submit(quiz_id, owner, {qids[0]: "dung", qids[1]: "sai"}, key)

    with pytest.raises(practice_uc.KhoaNopBaiDaDung):
        _submit(quiz_id, owner, {qids[0]: "dung", qids[1]: "dung"}, key)
    with pytest.raises(practice_uc.KhoaNopBaiDaDung):
        _submit(other_quiz, owner, {other_qids[0]: "dung", other_qids[1]: "sai"}, key)
    assert counts["grade"] == [first["attempt_id"]]
    assert _attempts_of(other_quiz, owner) == []


def test_two_keys_with_identical_answers_are_two_attempts(owner, practice, counts):
    """A deliberate retake is a new attempt, even with the same answers seconds later
    (the 30 s guess of #183 applies only to keyless requests)."""
    quiz_id, qids = practice
    answers = {qids[0]: "dung", qids[1]: "dung"}

    first = _submit(quiz_id, owner, answers, _key())
    second = _submit(quiz_id, owner, answers, _key())

    assert first["attempt_id"] != second["attempt_id"]
    assert sorted(s for _, s in _attempts_of(quiz_id, owner)) == ["graded", "graded"]
    assert len(counts["grade"]) == 2


def test_one_key_used_by_two_accounts_never_crosses_over(owner, practice, counts):
    from app.domains.auth import users_store

    quiz_id, qids = practice
    other = users_store.create_user(f"conc_{uuid.uuid4().hex[:8]}@example.com",
                                    "password123")["user_id"]
    key = _key()

    mine = _submit(quiz_id, owner, {qids[0]: "dung", qids[1]: "dung"}, key)
    # Same key, different answers: for another account this is simply a first submit.
    theirs = _submit(quiz_id, other, {qids[0]: "sai", qids[1]: "sai"}, key)

    assert theirs["attempt_id"] != mine["attempt_id"]
    assert theirs["correct_count"] == 0 and mine["correct_count"] == 2
    assert [a for a, _ in _attempts_of(quiz_id, other)] == [theirs["attempt_id"]]


def test_anonymous_clients_with_their_own_keys_do_not_affect_each_other(practice, counts):
    """Open mode: every client shares one anonymous owner, so the key is what tells them
    apart. Different keys, identical answers, moments apart: two independent results."""
    from app.domains.documents.repository import ensure_anonymous_user

    quiz_id, qids = practice
    answers = {qids[0]: "dung", qids[1]: "dung"}
    key_a, key_b = _key(), _key()

    a = _submit(quiz_id, None, answers, key_a, protect=False)
    b = _submit(quiz_id, None, answers, key_b, protect=False)
    a_again = _submit(quiz_id, None, answers, key_a, protect=False)

    assert a["attempt_id"] != b["attempt_id"]
    assert a_again == a
    assert len(_attempts_of(quiz_id, ensure_anonymous_user())) == 2
    assert len(counts["grade"]) == 2


def test_retry_while_the_first_request_is_still_grading_waits_instead_of_grading(
        owner, practice, counts, monkeypatch):
    """A client timeout: the first request is still grading when the retry arrives."""
    from app.application import practice as practice_uc
    from app.domains.attempts import service

    quiz_id, qids = practice
    answers = {qids[0]: "dung", qids[1]: "sai"}
    key = _key()
    grading_started, retry_answered = threading.Event(), threading.Event()
    grade = service.grade_attempt

    def _slow_grade(attempt_id, **kw):
        grading_started.set()
        assert retry_answered.wait(10), "the retry never answered"
        return grade(attempt_id, **kw)

    monkeypatch.setattr(service, "grade_attempt", _slow_grade)
    first = {}
    t = threading.Thread(target=lambda: first.update(_submit(quiz_id, owner, answers, key)))
    t.start()
    assert grading_started.wait(10)
    try:
        with pytest.raises(practice_uc.NopBaiDangCham):
            _submit(quiz_id, owner, answers, key)
    finally:
        retry_answered.set()
        t.join(30)
    assert not t.is_alive()

    # Once the first request has finished, the same retry gets its result.
    assert _submit(quiz_id, owner, answers, key) == first
    assert len(_attempts_of(quiz_id, owner)) == 1


def test_grading_error_after_submit_is_recovered_by_a_retry_with_the_same_key(
        owner, practice, counts, monkeypatch):
    """The attempt is committed `submitted`, then grading raises (LLM down, bug). Before
    the key the learner was stuck: a retry was a 409 replay and nothing graded it again."""
    from app.domains.attempts import service

    quiz_id, qids = practice
    answers = {qids[0]: "dung", qids[1]: "sai"}
    key = _key()
    grade = service.grade_attempt
    monkeypatch.setattr(service, "grade_attempt",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("LLM down")))

    with pytest.raises(RuntimeError):
        _submit(quiz_id, owner, answers, key)
    assert [s for _, s in _attempts_of(quiz_id, owner)] == ["submitted"]

    monkeypatch.setattr(service, "grade_attempt", grade)
    result = _submit(quiz_id, owner, answers, key)
    assert result["status"] == "graded" and result["correct_count"] == 1
    assert [s for _, s in _attempts_of(quiz_id, owner)] == ["graded"]


def test_a_grader_that_died_is_taken_over_only_after_the_lease(owner, practice, counts):
    """Process killed between submit and grading: no `except` ran, the claim is still set."""
    from app.application import practice as practice_uc
    from app.db import session_scope
    from app.db.models import QuizAttempt
    from app.domains.attempts import repository

    quiz_id, qids = practice
    answers = {qids[0]: "dung", qids[1]: "dung"}
    key = _key()
    attempt_id, outcome = repository.submit_practice(quiz_id, owner, answers, submit_key=key)
    assert outcome == "grade"   # ...and this "process" dies here without grading.

    with pytest.raises(practice_uc.NopBaiDangCham):
        _submit(quiz_id, owner, answers, key)
    assert counts["grade"] == []

    with session_scope() as s:
        a = s.get(QuizAttempt, attempt_id)
        a.grading_claimed_at = a.grading_claimed_at - timedelta(
            seconds=repository.GRADING_LEASE_S + 1)
    result = _submit(quiz_id, owner, answers, key)
    assert result["attempt_id"] == attempt_id and result["status"] == "graded"
    assert counts["grade"] == [attempt_id] and counts["gap"] == [attempt_id]


def test_a_second_grader_of_one_attempt_writes_nothing(owner, practice, counts):
    """The lease ran out while the first grader was still alive: both grade, one writes."""
    from app.domains.attempts import repository, service

    quiz_id, qids = practice
    attempt_id, _ = repository.submit_practice(
        quiz_id, owner, {qids[0]: "dung", qids[1]: "sai"}, submit_key=_key())

    assert service.grade_attempt(attempt_id, once=True) is not None
    graded_at = repository.get_attempt(attempt_id)["graded_at"]
    assert service.grade_attempt(attempt_id, once=True) is None
    assert repository.get_attempt(attempt_id)["graded_at"] == graded_at
    assert counts["gap"] == [attempt_id]


def test_a_graded_attempt_cannot_be_submitted_again(owner, practice, counts):
    from app.application import attempts as attempts_uc

    quiz_id, qids = practice
    first = _submit(quiz_id, owner, {qids[0]: "dung", qids[1]: "sai"}, _key())
    with pytest.raises(attempts_uc.AttemptKhongConDangLam):
        attempts_uc.submit_attempt(first["attempt_id"], owner, bat_buoc_chu_so_huu=True,
                                   dispatch_grading=lambda *a: pytest.fail("no grading"))
    assert counts["grade"] == [first["attempt_id"]]


@pytest.mark.parametrize("bad", ["", "short", "x" * 129, "has space in it 1234", "ü" * 20])
def test_a_malformed_key_is_refused_before_anything_is_written(owner, practice, counts, bad):
    from app.application import practice as practice_uc

    quiz_id, qids = practice
    with pytest.raises(practice_uc.KhoaNopBaiKhongHopLe):
        _submit(quiz_id, owner, {qids[0]: "dung"}, bad)
    assert _attempts_of(quiz_id, owner) == []


def test_http_contract_header_body_and_status_codes(client, practice, counts):
    """Through Flask: the header or the body field; 200 same body on retry, 422, 409, 400.
    Without a key the response and its status are what they were before."""
    from app.domains.documents.repository import ensure_anonymous_user

    quiz_id, qids = practice
    url = f"/api/practice/{quiz_id}/submit"
    answers = {qids[0]: "dung", qids[1]: "sai"}
    key = _key()

    first = client.post(url, json={"answers": answers}, headers={"Idempotency-Key": key})
    assert first.status_code == 200, first.get_json()
    retry = client.post(url, json={"answers": answers, "idempotency_key": key})
    assert retry.status_code == 200 and retry.get_json() == first.get_json()

    other = client.post(url, json={"answers": {qids[0]: "sai"}},
                        headers={"Idempotency-Key": key})
    assert other.status_code == 422
    assert other.get_json() == {"error": "Idempotency-Key đã dùng cho một lần nộp khác"}

    bad = client.post(url, json={"answers": answers}, headers={"Idempotency-Key": "abc"})
    assert bad.status_code == 400

    keyless = client.post(url, json={"answers": answers})
    assert keyless.status_code == 200
    assert set(keyless.get_json()) == set(first.get_json())
    assert len(_attempts_of(quiz_id, ensure_anonymous_user())) == 2


def test_cors_preflight_allows_the_idempotency_header(client):
    res = client.options("/api/practice/x/submit", headers={
        "Origin": "https://studymap.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type, idempotency-key",
    })
    allowed = res.headers.get("Access-Control-Allow-Headers", "").lower()
    assert "idempotency-key" in allowed


def test_one_key_on_two_quizzes_at_once_is_one_submit_and_one_refusal(owner, practice, counts,
                                                                     monkeypatch):
    """Different quizzes take different quiz locks, so nothing serialises the two first
    submits except the unique index on (user_id, submit_key). The loser re-reads."""
    from app.application import practice as practice_uc

    quiz_a, qa = practice
    quiz_b, qb = _quiz(owner)
    key = _key()
    _meet_inside_now(monkeypatch)
    jobs = iter([(quiz_a, {qa[0]: "dung"}), (quiz_b, {qb[0]: "dung"})])
    lock = threading.Lock()

    def _one():
        with lock:
            quiz_id, answers = next(jobs)
        return _submit(quiz_id, owner, answers, key)

    results = _run_together(_one)

    ok = [r for kind, r in results if kind == "ok"]
    errors = [r for kind, r in results if kind == "error"]
    assert len(ok) == 1 and len(errors) == 1, results
    assert isinstance(errors[0], practice_uc.KhoaNopBaiDaDung), results
    assert len(_attempts_of(quiz_a, owner)) + len(_attempts_of(quiz_b, owner)) == 1


def test_keyless_retry_after_a_grading_error_grades_the_stuck_attempt(owner, practice, counts,
                                                                     monkeypatch):
    """Old clients send no key. On #183 their retry was a 409 replay and the attempt stayed
    `submitted` forever (reproduced on 1d787f8)."""
    from app.application import practice as practice_uc
    from app.domains.attempts import service

    quiz_id, qids = practice
    answers = {qids[0]: "dung", qids[1]: "sai"}
    grade = service.grade_attempt
    monkeypatch.setattr(service, "grade_attempt",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("LLM down")))
    with pytest.raises(RuntimeError):
        practice_uc.submit(quiz_id, owner, answers, bat_buoc_chu_so_huu=True)

    monkeypatch.setattr(service, "grade_attempt", grade)
    result = practice_uc.submit(quiz_id, owner, answers, bat_buoc_chu_so_huu=True)
    assert result["status"] == "graded"
    assert [s for _, s in _attempts_of(quiz_id, owner)] == ["graded"]


def test_the_web_app_recognises_the_still_grading_message():
    """The FE asks again with the same key only on this exact 409 body (no error codes in
    `_appError`). Renaming the message on one side must fail here, not in production."""
    from pathlib import Path

    from app.application import practice as practice_uc

    fe = Path(__file__).resolve().parents[2] / "FE" / "src" / "utils" / "practiceSubmitKey.js"
    assert f'"{practice_uc.NopBaiDangCham.loi}"' in fe.read_text(encoding="utf-8")
