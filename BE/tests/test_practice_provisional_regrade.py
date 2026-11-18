"""A practice attempt left provisional by an AI grader outage can be regraded (#159 item 17).

Practice grades inside the submit request (no job) under an Idempotency-Key. When the
model fails on a short answer the attempt is still `graded`, the answer keeps
`verdict = None` and `ungraded_count` counts it. Before this change nothing could grade
it again: the same key answers with the stored provisional result, and #190's regrade
route refuses practice attempts.

`POST /api/practice/<id>/regrade` regrades only the answers without a verdict, inside
the request, with #190's claim, retry cap and write rules. PostgreSQL only; no model:
a fake `grade_short_answer` returns None (a provider failure) for questions in
`fake.fail`, and a guard fails the test if a real model is reached.
"""
from __future__ import annotations

import threading
import uuid

import pytest

from tests.test_attempt_submit_concurrency import (  # noqa: F401  (owner = fixture)
    _run_together, owner, pytestmark)
from tests.test_provisional_grading_recovery import SA_FLAKY, _FakeGrader, _quiz


@pytest.fixture(autouse=True)
def fake(monkeypatch):
    from app.domains.attempts import grading

    g = _FakeGrader()
    monkeypatch.setattr(grading, "grade_short_answer", g)
    import app.clients.llm_factory as llm_factory
    monkeypatch.setattr(llm_factory, "ask_ai",
                        lambda *a, **k: pytest.fail("real LLM reached"), raising=False)
    monkeypatch.delenv("GRADING_MANUAL_RETRY_MAX", raising=False)
    return g


@pytest.fixture()
def practice(owner, monkeypatch):
    """A ready quiz the practice use case accepts as the owner's practice quiz."""
    from app.application import practice as practice_uc

    quiz_id, qids = _quiz(owner)

    def _owned(qid, user_id, *, bat_buoc_chu_so_huu):
        if qid != quiz_id or (bat_buoc_chu_so_huu and user_id != owner):
            raise practice_uc.PracticeKhongTonTai()
        return {"status": "ready", "user_id": owner}

    monkeypatch.setattr(practice_uc, "_load_owned_practice", _owned)
    return quiz_id, qids


def _key():
    return str(uuid.uuid4())


def _answers(qids):
    return {qids[0]: "dung", qids[1]: "tl mot", qids[2]: "tl hai"}


def _submit(quiz_id, user, answers, key):
    from app.application import practice as practice_uc

    return practice_uc.submit(quiz_id, user, answers, bat_buoc_chu_so_huu=True, submit_key=key)


def _regrade(quiz_id, user, attempt_id, protect=True):
    from app.application import practice as practice_uc

    return practice_uc.regrade(quiz_id, user, attempt_id, bat_buoc_chu_so_huu=protect)


def _provisional(owner, practice, fake):
    quiz_id, qids = practice
    key = _key()
    fake.fail = {SA_FLAKY}
    body = _submit(quiz_id, owner, _answers(qids), key)
    fake.calls.clear()
    fake.fail = set()
    return quiz_id, qids, key, body


def _rows(attempt_id):
    from sqlalchemy import select

    from app.db import session_scope
    from app.db.models import QuizAnswer

    with session_scope() as s:
        return {r.question_id: {k: getattr(r, k) for k in
                                ("verdict", "score", "feedback", "graded_at", "user_answer")}
                for r in s.execute(select(QuizAnswer).where(
                    QuizAnswer.attempt_id == attempt_id)).scalars()}


# ── the provisional practice result today ─────────────────────────────────

def test_a_failed_short_answer_is_left_ungraded_not_wrong(owner, practice, fake):
    _, qids, _, body = _provisional(owner, practice, fake)
    assert body["status"] == "graded"
    assert body["ungraded_count"] == 1 and body["grading_complete"] is False
    assert (body["score"], body["max_score"]) == (2.0, 2.0)
    rows = _rows(body["attempt_id"])
    assert rows[qids[2]]["verdict"] is None and rows[qids[2]]["score"] is None


# ── the regrade ───────────────────────────────────────────────────────────

def test_regrade_grades_only_the_ungraded_answer_and_keeps_the_rest(owner, practice, fake):
    quiz_id, qids, _, body = _provisional(owner, practice, fake)
    before = _rows(body["attempt_id"])
    out = _regrade(quiz_id, owner, body["attempt_id"])
    assert fake.calls == [SA_FLAKY]
    assert out["grading"] == "done" and out["grading_complete"] is True
    assert (out["score"], out["max_score"], out["ungraded_count"]) == (3.0, 3.0, 0)
    after = _rows(body["attempt_id"])
    for q in qids[:2]:
        assert after[q] == before[q], q
    assert after[qids[2]]["verdict"] == "correct"
    assert after[qids[2]]["user_answer"] == before[qids[2]]["user_answer"] == "tl hai"


def test_a_regrade_that_fails_again_keeps_the_provisional_result(owner, practice, fake):
    quiz_id, _, _, body = _provisional(owner, practice, fake)
    fake.fail = {SA_FLAKY}
    out = _regrade(quiz_id, owner, body["attempt_id"])
    assert (out["score"], out["ungraded_count"], out["grading_complete"]) == (2.0, 1, False)


def test_a_complete_attempt_returns_the_stored_result_and_grades_nothing(owner, practice,
                                                                         fake):
    quiz_id, _, _, body = _provisional(owner, practice, fake)
    first = _regrade(quiz_id, owner, body["attempt_id"])
    fake.calls.clear()
    again = _regrade(quiz_id, owner, body["attempt_id"])
    assert fake.calls == []
    assert (again["score"], again["graded_at"]) == (first["score"], first["graded_at"])


def test_concurrent_regrades_grade_once(owner, practice, fake, monkeypatch):
    from app.application import practice as practice_uc
    from app.domains.attempts import grading

    quiz_id, _, _, body = _provisional(owner, practice, fake)
    inside, release = threading.Event(), threading.Event()

    def _slow(**kw):
        inside.set()
        release.wait(10)
        return fake(**kw)

    monkeypatch.setattr(grading, "grade_short_answer", _slow)
    results = []

    def _first():
        results.append(("first", _regrade(quiz_id, owner, body["attempt_id"])))

    t = threading.Thread(target=_first)
    t.start()
    assert inside.wait(10)
    with pytest.raises(practice_uc.NopBaiDangCham):
        _regrade(quiz_id, owner, body["attempt_id"])
    release.set()
    t.join(30)
    assert fake.calls == [SA_FLAKY]
    assert results[0][1]["grading_complete"] is True


def test_retry_cap_is_shared_and_ends_without_a_model_call(owner, practice, fake,
                                                           monkeypatch):
    from app.application import attempts as attempts_uc

    monkeypatch.setenv("GRADING_MANUAL_RETRY_MAX", "2")
    quiz_id, _, _, body = _provisional(owner, practice, fake)
    fake.fail = {SA_FLAKY}
    for _ in range(2):
        _regrade(quiz_id, owner, body["attempt_id"])
    fake.calls.clear()
    with pytest.raises(attempts_uc.HetLuotChamLai):
        _regrade(quiz_id, owner, body["attempt_id"])
    assert fake.calls == []


def test_the_idempotency_key_still_answers_with_the_stored_result(owner, practice, fake):
    """The key keeps its contract: after a regrade, the same key and answers return the
    stored (now complete) attempt and grade nothing; no second attempt is made."""
    quiz_id, qids, key, body = _provisional(owner, practice, fake)
    _regrade(quiz_id, owner, body["attempt_id"])
    fake.calls.clear()
    replay = _submit(quiz_id, owner, _answers(qids), key)
    assert replay["attempt_id"] == body["attempt_id"]
    assert fake.calls == [] and replay["grading_complete"] is True


def test_another_learner_gets_404(owner, practice, fake):
    from app.application import attempts as attempts_uc
    from app.application import practice as practice_uc

    quiz_id, _, _, body = _provisional(owner, practice, fake)
    with pytest.raises((practice_uc.PracticeKhongTonTai, attempts_uc.AttemptKhongTonTai)):
        _regrade(quiz_id, str(uuid.uuid4()), body["attempt_id"])
    assert fake.calls == []


def test_an_attempt_of_another_quiz_is_404(owner, practice, fake):
    from app.application import attempts as attempts_uc
    from app.domains.attempts import repository

    quiz_id, _, _, _ = _provisional(owner, practice, fake)
    other_quiz, oq = _quiz(owner)
    other = repository.open_attempt(other_quiz, owner)["attempt_id"]
    with pytest.raises(attempts_uc.AttemptKhongTonTai):
        _regrade(quiz_id, owner, other)


def test_mastery_counts_the_regraded_answer(owner, practice, fake):
    from app.domains.gap_analysis import service as gap

    quiz_id, _, _, body = _provisional(owner, practice, fake)
    before = {m["concept_name"]: m for m in gap.list_for_attempt(body["attempt_id"])}
    assert before["khai niem"]["total_count"] == 2
    _regrade(quiz_id, owner, body["attempt_id"])
    after = {m["concept_name"]: m for m in gap.list_for_attempt(body["attempt_id"])}
    assert after["khai niem"]["total_count"] == 3


def test_http_contract(client, owner, practice, fake):
    quiz_id, _, _, body = _provisional(owner, practice, fake)
    res = client.post(f"/api/practice/{quiz_id}/regrade", json={"attempt_id": body["attempt_id"]})
    assert res.status_code == 200 and res.get_json()["grading_complete"] is True
    assert client.post(f"/api/practice/{quiz_id}/regrade", json={}).status_code == 400


def test_used_up_retries_carry_a_machine_code(client, owner, practice, fake, monkeypatch):
    """The page recognises "no retry left" by a stable code, not by the wording (agy
    task38 F2); the field is additive, the message is unchanged."""
    monkeypatch.setenv("GRADING_MANUAL_RETRY_MAX", "1")
    quiz_id, _, _, body = _provisional(owner, practice, fake)
    fake.fail = {SA_FLAKY}
    _regrade(quiz_id, owner, body["attempt_id"])
    res = client.post(f"/api/practice/{quiz_id}/regrade", json={"attempt_id": body["attempt_id"]})
    assert res.status_code == 409
    assert res.get_json() == {"error": "Đã hết lượt thử chấm lại cho bài này",
                              "status": "graded", "ma": "het_luot_cham_lai"}


def test_a_regrade_that_lost_its_claim_stops_before_the_next_model_call(owner, practice, fake,
                                                                        monkeypatch):
    """Inside the request there was no heartbeat between answers: a regrade longer than
    the lease let a second request reclaim and pay for the same answers again, while the
    first kept calling the model (task39). The first now renews before each call and
    stops when its claim was taken over; the second request is the grader."""
    from app.application import practice as practice_uc
    from app.db import session_scope
    from app.db.models import QuizAttempt
    from app.domains.attempts import grading
    from tests.test_provisional_grading_recovery import SA_OK

    quiz_id, qids = practice
    fake.fail = {SA_OK, SA_FLAKY}
    body = _submit(quiz_id, owner, _answers(qids), _key())
    assert body["ungraded_count"] == 2
    fake.calls.clear()
    fake.fail = set()
    attempt_id = body["attempt_id"]

    def _taken_over(**kw):
        # A second request reclaimed after the lease: new token, running marker cleared.
        with session_scope() as s:
            a = s.get(QuizAttempt, attempt_id, with_for_update=True)
            meta = {k: v for k, v in (a.metadata_json or {}).items()
                    if k != "grading_job_running"}
            a.metadata_json = {**meta, "regrade_job_id": "practice-regrade-other"}
        return fake(**kw)

    monkeypatch.setattr(grading, "grade_short_answer", _taken_over)
    with pytest.raises(practice_uc.NopBaiDangCham):
        _regrade(quiz_id, owner, attempt_id)
    assert len(fake.calls) == 1, fake.calls
    assert _rows(attempt_id)[qids[1]]["verdict"] is None   # the lost request wrote nothing


def test_the_result_page_route_regrades_a_practice_attempt_the_practice_way(client, owner,
                                                                           practice, fake,
                                                                           monkeypatch):
    """A provisional practice attempt opened from "Bài đã làm gần đây" lands on the
    generic result page, which offers "Chấm lại câu còn thiếu" (`regrade_state`
    "available") and posts to /api/attempts/<id>/regrade. That route refused practice
    attempts with a developer message, so the offer always failed (task39). It now
    regrades the practice way: inside the request, same claim and cap, 200."""
    from app.domains.quiz import repository as quiz_repo

    quiz_id, qids, _, body = _provisional(owner, practice, fake)
    original = quiz_repo.get_quiz
    monkeypatch.setattr(quiz_repo, "get_quiz", lambda qid, **kw: {
        **(original(qid, **kw) or {}), "quiz_type": "practice"} if qid == quiz_id
        else original(qid, **kw))
    res = client.post(f"/api/attempts/{body['attempt_id']}/regrade")
    assert res.status_code == 200, res.get_json()
    out = res.get_json()
    assert out["grading"] == "done" and out["grading_complete"] is True
    assert fake.calls == [SA_FLAKY]
    assert _rows(body["attempt_id"])[qids[2]]["verdict"] == "correct"


def test_the_practice_page_finds_a_provisional_result_again(client, owner, practice, fake):
    """The comparison counts complete results only (409 while provisional), so after a
    reload the page showed the empty quiz: the result and its regrade offer were gone
    (task39). GET /api/practice/<id> names the latest graded attempt, provisional too."""
    from app.application import practice as practice_uc

    quiz_id, _, _, body = _provisional(owner, practice, fake)
    got = practice_uc.get(quiz_id, owner, bat_buoc_chu_so_huu=True)
    assert got["latest_attempt_id"] == body["attempt_id"]
    with pytest.raises(practice_uc.ChuaCoLanChamNao):
        practice_uc.comparison(quiz_id, owner, bat_buoc_chu_so_huu=True)


def test_a_regrade_whose_write_was_fenced_off_says_another_request_is_grading(owner, practice,
                                                                              fake,
                                                                              monkeypatch):
    """One ungraded answer: no heartbeat follows the last model call, so a takeover
    during it shows only at the write, which is refused. The request answered 200 with
    the unchanged provisional result ("thử thêm") while the other request was still
    grading (agy task40). It now answers 409 NopBaiDangCham, like a takeover seen by
    the heartbeat."""
    from app.application import practice as practice_uc
    from app.db import session_scope
    from app.db.models import QuizAttempt
    from app.domains.attempts import grading

    quiz_id, qids, _, body = _provisional(owner, practice, fake)
    attempt_id = body["attempt_id"]

    def _taken_over(**kw):
        with session_scope() as s:
            a = s.get(QuizAttempt, attempt_id, with_for_update=True)
            meta = {k: v for k, v in (a.metadata_json or {}).items()
                    if k != "grading_job_running"}
            a.metadata_json = {**meta, "regrade_job_id": "practice-regrade-other"}
        return fake(**kw)

    monkeypatch.setattr(grading, "grade_short_answer", _taken_over)
    with pytest.raises(practice_uc.NopBaiDangCham):
        _regrade(quiz_id, owner, attempt_id)
    assert fake.calls == [SA_FLAKY]
    assert _rows(attempt_id)[qids[2]]["verdict"] is None
