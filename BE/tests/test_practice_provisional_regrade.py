"""A practice attempt left provisional by an AI grader outage can be regraded (#159 item 17).

Practice grades inside the submit request (no job) under an Idempotency-Key. When the
model fails on a short answer the attempt is still `graded`, the answer keeps
`verdict = None` and `ungraded_count` counts it.

`POST /api/practice/<id>/regrade` regrades only the answers without a verdict, in #190's
background grading job (owner task A, 2026-11-18): production runs one sync gunicorn
worker with a 120 s timeout, so no model is called inside the request. 202 with the job,
200 when nothing is left, 409 when the retries are used up. A retry whose job never
started (lost by the queue, worker died before taking it) is given back once; one whose
job started stays counted.

PostgreSQL only; no model: a fake `grade_short_answer` returns None (a provider failure)
for questions in `fake.fail`, and a guard fails the test if a real model is reached. The
dispatcher records jobs; tests run them with `run_short_answer_grading_job`.
"""
from __future__ import annotations

import uuid
from datetime import timedelta

import pytest

from tests.test_attempt_submit_concurrency import (  # noqa: F401  (owner = fixture)
    _run_together, owner, pytestmark)
from tests.test_provisional_grading_recovery import (SA_FLAKY, SA_OK, _FakeGrader,
                                                     _Recorder, _quiz, _run_job)


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
    """A ready quiz the practice use case accepts as the owner's practice quiz; the
    generic attempt routes see it as practice too."""
    from app.application import practice as practice_uc
    from app.domains.quiz import repository as quiz_repo

    quiz_id, qids = _quiz(owner)

    def _owned(qid, user_id, *, bat_buoc_chu_so_huu):
        if qid != quiz_id or (bat_buoc_chu_so_huu and user_id != owner):
            raise practice_uc.PracticeKhongTonTai()
        return {"status": "ready", "user_id": owner}

    monkeypatch.setattr(practice_uc, "_load_owned_practice", _owned)
    original = quiz_repo.get_quiz
    monkeypatch.setattr(quiz_repo, "get_quiz", lambda qid, **kw: {
        **(original(qid, **kw) or {}), "quiz_type": "practice"} if qid == quiz_id
        else original(qid, **kw))
    return quiz_id, qids


def _key():
    return str(uuid.uuid4())


def _answers(qids):
    return {qids[0]: "dung", qids[1]: "tl mot", qids[2]: "tl hai"}


def _submit(quiz_id, user, answers, key):
    from app.application import practice as practice_uc

    return practice_uc.submit(quiz_id, user, answers, bat_buoc_chu_so_huu=True, submit_key=key)


def _regrade(quiz_id, user, attempt_id, dispatch, protect=True):
    from app.application import practice as practice_uc

    return practice_uc.regrade(quiz_id, user, attempt_id, bat_buoc_chu_so_huu=protect,
                               dispatch_grading=dispatch)


def _provisional(owner, practice, fake, fail=(SA_FLAKY,)):
    quiz_id, qids = practice
    key = _key()
    fake.fail = set(fail)
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


def _meta(attempt_id):
    from app.db import session_scope
    from app.db.models import QuizAttempt

    with session_scope() as s:
        return dict(s.get(QuizAttempt, attempt_id).metadata_json or {})


def _stored(attempt_id, owner):
    from app.application import attempts as attempts_uc

    return attempts_uc.results(attempt_id, owner, bat_buoc_chu_so_huu=True)


def _silent(attempt_id, monkeypatch):
    """The registered job went silent past the lease: its row stopped reporting and the
    claim expired (a lost queue entry or a dead worker look the same from here)."""
    from app.application import attempts as attempts_uc
    from app.db import session_scope
    from app.db.models import QuizAttempt
    from app.domains.attempts import repository

    monkeypatch.setattr(attempts_uc, "job_active", lambda _job_id: False)
    with session_scope() as s:
        a = s.get(QuizAttempt, attempt_id, with_for_update=True)
        a.grading_claimed_at = repository._now() - timedelta(
            seconds=repository.grading_lease_s() + 1)


# ── the provisional practice result ───────────────────────────────────────

def test_a_failed_short_answer_is_left_ungraded_not_wrong(owner, practice, fake):
    _, qids, _, body = _provisional(owner, practice, fake)
    assert body["status"] == "graded"
    assert body["ungraded_count"] == 1 and body["grading_complete"] is False
    assert (body["score"], body["max_score"]) == (2.0, 2.0)
    rows = _rows(body["attempt_id"])
    assert rows[qids[2]]["verdict"] is None and rows[qids[2]]["score"] is None


# ── the regrade runs in the background job ────────────────────────────────

def test_the_request_only_queues_a_job_and_calls_no_model(owner, practice, fake):
    quiz_id, _, _, body = _provisional(owner, practice, fake)
    rec = _Recorder()
    out, accepted = _regrade(quiz_id, owner, body["attempt_id"], rec)
    assert accepted and out["grading"] == "pending" and out["job_id"]
    assert len(rec.calls) == 1 and rec.calls[0][0] == out["job_id"]
    assert fake.calls == [], "no model call inside the request"
    assert _stored(body["attempt_id"], owner)["regrade_state"] == "running"


def test_the_job_grades_only_the_ungraded_answer_and_keeps_the_rest(owner, practice, fake):
    quiz_id, qids, _, body = _provisional(owner, practice, fake)
    before = _rows(body["attempt_id"])
    rec = _Recorder()
    _regrade(quiz_id, owner, body["attempt_id"], rec)
    _run_job(*rec.calls[0])
    assert fake.calls == [SA_FLAKY]
    out = _stored(body["attempt_id"], owner)
    assert (out["score"], out["max_score"], out["ungraded_count"]) == (3.0, 3.0, 0)
    assert out["grading_complete"] is True and out["regrade_state"] is None
    after = _rows(body["attempt_id"])
    for q in qids[:2]:
        assert after[q] == before[q], q
    assert after[qids[2]]["verdict"] == "correct"
    assert after[qids[2]]["user_answer"] == before[qids[2]]["user_answer"] == "tl hai"


def test_a_regrade_that_fails_again_keeps_the_provisional_result(owner, practice, fake):
    quiz_id, _, _, body = _provisional(owner, practice, fake)
    rec = _Recorder()
    _regrade(quiz_id, owner, body["attempt_id"], rec)
    fake.fail = {SA_FLAKY}
    _run_job(*rec.calls[0])
    out = _stored(body["attempt_id"], owner)
    assert (out["score"], out["ungraded_count"], out["grading_complete"]) == (2.0, 1, False)
    assert out["regrade_state"] == "available"


def test_a_complete_attempt_returns_the_stored_result_and_queues_nothing(owner, practice,
                                                                         fake):
    quiz_id, _, _, body = _provisional(owner, practice, fake)
    rec = _Recorder()
    _regrade(quiz_id, owner, body["attempt_id"], rec)
    _run_job(*rec.calls[0])
    fake.calls.clear()
    again, accepted = _regrade(quiz_id, owner, body["attempt_id"], rec)
    assert not accepted and again["grading"] == "done" and again["grading_complete"] is True
    assert len(rec.calls) == 1 and fake.calls == []


def test_concurrent_regrades_queue_one_job(owner, practice, fake):
    quiz_id, _, _, body = _provisional(owner, practice, fake)
    rec = _Recorder()
    results = _run_together(lambda: _regrade(quiz_id, owner, body["attempt_id"], rec))
    assert [r[0] for r in results] == ["ok", "ok"], results
    jobs = {r[1][0]["job_id"] for r in results}
    assert len(jobs) == 1 and all(r[1][1] for r in results)
    assert len(rec.calls) == 1
    assert int(_meta(body["attempt_id"])["manual_retries"]) == 1


def test_a_duplicate_delivery_of_the_job_grades_once(owner, practice, fake):
    quiz_id, _, _, body = _provisional(owner, practice, fake)
    rec = _Recorder()
    _regrade(quiz_id, owner, body["attempt_id"], rec)
    _run_job(*rec.calls[0])
    _run_job(*rec.calls[0])
    assert fake.calls == [SA_FLAKY]


def test_retry_cap_is_shared_and_ends_without_a_job(owner, practice, fake, monkeypatch):
    from app.application import attempts as attempts_uc

    monkeypatch.setenv("GRADING_MANUAL_RETRY_MAX", "2")
    quiz_id, _, _, body = _provisional(owner, practice, fake)
    rec = _Recorder()
    fake.fail = {SA_FLAKY}
    for _ in range(2):
        _regrade(quiz_id, owner, body["attempt_id"], rec)
        _run_job(*rec.calls[-1])
    fake.calls.clear()
    with pytest.raises(attempts_uc.HetLuotChamLai):
        _regrade(quiz_id, owner, body["attempt_id"], rec)
    assert len(rec.calls) == 2 and fake.calls == []
    assert _stored(body["attempt_id"], owner)["regrade_state"] == "exhausted"


# ── crashes, lost jobs, failed enqueue: what a retry costs ────────────────

def test_a_job_that_never_started_gives_its_retry_back_once(owner, practice, fake,
                                                            monkeypatch):
    """The queue lost the job (or the worker died before taking it): no model was called,
    so the learner keeps the retry. The lost job, delivered late, grades nothing."""
    monkeypatch.setenv("GRADING_MANUAL_RETRY_MAX", "1")
    quiz_id, _, _, body = _provisional(owner, practice, fake)
    rec = _Recorder()
    _regrade(quiz_id, owner, body["attempt_id"], rec)
    lost = rec.calls[0]
    _silent(body["attempt_id"], monkeypatch)
    out, accepted = _regrade(quiz_id, owner, body["attempt_id"], rec)
    assert accepted and out["job_id"] != lost[0]
    assert int(_meta(body["attempt_id"])["manual_retries"]) == 1
    _run_job(*lost)
    assert fake.calls == [], "the replaced job makes no model call"
    _run_job(*rec.calls[1])
    assert fake.calls == [SA_FLAKY]


def test_a_job_that_started_and_died_keeps_its_retry_counted(owner, practice, fake,
                                                             monkeypatch):
    """The worker took the job (its model call may have been paid) and died: the retry
    stays spent, so dead workers cannot refund model calls without end."""
    from app.application import attempts as attempts_uc
    from app.domains.attempts import repository

    monkeypatch.setenv("GRADING_MANUAL_RETRY_MAX", "1")
    quiz_id, _, _, body = _provisional(owner, practice, fake)
    rec = _Recorder()
    _regrade(quiz_id, owner, body["attempt_id"], rec)
    role, _ = repository.start_grading_job(body["attempt_id"], rec.calls[0][0])
    assert role == "regrade"
    _silent(body["attempt_id"], monkeypatch)
    with pytest.raises(attempts_uc.HetLuotChamLai):
        _regrade(quiz_id, owner, body["attempt_id"], rec)
    assert len(rec.calls) == 1
    assert _stored(body["attempt_id"], owner)["regrade_state"] == "exhausted"


def test_a_failed_enqueue_gives_the_retry_back_and_leaves_no_job(owner, practice, fake,
                                                                 monkeypatch):
    monkeypatch.setenv("GRADING_MANUAL_RETRY_MAX", "1")
    quiz_id, _, _, body = _provisional(owner, practice, fake)

    def _refuse(*_a):
        raise RuntimeError("queue down")

    with pytest.raises(RuntimeError):
        _regrade(quiz_id, owner, body["attempt_id"], _refuse)
    meta = _meta(body["attempt_id"])
    assert int(meta.get("manual_retries") or 0) == 0 and "regrade_job_id" not in meta
    rec = _Recorder()
    _, accepted = _regrade(quiz_id, owner, body["attempt_id"], rec)
    assert accepted and len(rec.calls) == 1


def test_the_idempotency_key_still_answers_with_the_stored_result(owner, practice, fake):
    """The key keeps its contract: after a regrade, the same key and answers return the
    stored (now complete) attempt and grade nothing; no second attempt is made."""
    quiz_id, qids, key, body = _provisional(owner, practice, fake)
    rec = _Recorder()
    _regrade(quiz_id, owner, body["attempt_id"], rec)
    _run_job(*rec.calls[0])
    fake.calls.clear()
    replay = _submit(quiz_id, owner, _answers(qids), key)
    assert replay["attempt_id"] == body["attempt_id"]
    assert fake.calls == [] and replay["grading_complete"] is True


# ── ownership ──────────────────────────────────────────────────────────────

def test_another_learner_gets_404(owner, practice, fake):
    from app.application import attempts as attempts_uc
    from app.application import practice as practice_uc

    quiz_id, _, _, body = _provisional(owner, practice, fake)
    rec = _Recorder()
    with pytest.raises((practice_uc.PracticeKhongTonTai, attempts_uc.AttemptKhongTonTai)):
        _regrade(quiz_id, str(uuid.uuid4()), body["attempt_id"], rec)
    assert rec.calls == []


def test_an_attempt_of_another_quiz_is_404(owner, practice, fake):
    from app.application import attempts as attempts_uc
    from app.domains.attempts import repository

    quiz_id, _, _, _ = _provisional(owner, practice, fake)
    other_quiz, _ = _quiz(owner)
    other = repository.open_attempt(other_quiz, owner)["attempt_id"]
    rec = _Recorder()
    with pytest.raises(attempts_uc.AttemptKhongTonTai):
        _regrade(quiz_id, owner, other, rec)
    assert rec.calls == []


def test_mastery_counts_the_regraded_answer(owner, practice, fake):
    from app.domains.gap_analysis import service as gap

    quiz_id, _, _, body = _provisional(owner, practice, fake)
    before = {m["concept_name"]: m for m in gap.list_for_attempt(body["attempt_id"])}
    assert before["khai niem"]["total_count"] == 2
    rec = _Recorder()
    _regrade(quiz_id, owner, body["attempt_id"], rec)
    _run_job(*rec.calls[0])
    after = {m["concept_name"]: m for m in gap.list_for_attempt(body["attempt_id"])}
    assert after["khai niem"]["total_count"] == 3


# ── HTTP ───────────────────────────────────────────────────────────────────

def test_http_contract(client, owner, practice, fake, monkeypatch):
    import app.main as be_main

    rec = _Recorder()
    monkeypatch.setattr(be_main, "_dispatch_grading", rec)
    quiz_id, _, _, body = _provisional(owner, practice, fake)
    url = f"/api/practice/{quiz_id}/regrade"
    res = client.post(url, json={"attempt_id": body["attempt_id"]})
    assert res.status_code == 202 and res.get_json()["job_id"] == rec.calls[0][0]
    again = client.post(url, json={"attempt_id": body["attempt_id"]})
    assert again.status_code == 202 and again.get_json()["job_id"] == rec.calls[0][0]
    assert len(rec.calls) == 1
    _run_job(*rec.calls[0])
    done = client.post(url, json={"attempt_id": body["attempt_id"]})
    assert done.status_code == 200 and done.get_json()["grading_complete"] is True
    assert client.post(url, json={}).status_code == 400


def test_used_up_retries_carry_a_machine_code(client, owner, practice, fake, monkeypatch):
    """The page recognises "no retry left" by a stable code, not by the wording (agy
    task38 F2); the field is additive, the message is unchanged."""
    import app.main as be_main

    rec = _Recorder()
    monkeypatch.setattr(be_main, "_dispatch_grading", rec)
    monkeypatch.setenv("GRADING_MANUAL_RETRY_MAX", "1")
    quiz_id, _, _, body = _provisional(owner, practice, fake)
    url = f"/api/practice/{quiz_id}/regrade"
    assert client.post(url, json={"attempt_id": body["attempt_id"]}).status_code == 202
    fake.fail = {SA_FLAKY}
    _run_job(*rec.calls[0])
    res = client.post(url, json={"attempt_id": body["attempt_id"]})
    assert res.status_code == 409
    assert res.get_json() == {"error": "Đã hết lượt thử chấm lại cho bài này",
                              "status": "graded", "ma": "het_luot_cham_lai"}


def test_the_result_page_route_regrades_a_practice_attempt_with_the_same_job(
        client, owner, practice, fake, monkeypatch):
    """A provisional practice attempt opened from "Bài đã làm gần đây" lands on the
    generic result page, which posts to /api/attempts/<id>/regrade: the same job, the
    same claim and cap (task39, task A)."""
    import app.main as be_main

    rec = _Recorder()
    monkeypatch.setattr(be_main, "_dispatch_grading", rec)
    _, qids, _, body = _provisional(owner, practice, fake)
    res = client.post(f"/api/attempts/{body['attempt_id']}/regrade")
    assert res.status_code == 202, res.get_json()
    assert res.get_json()["job_id"] == rec.calls[0][0]
    _run_job(*rec.calls[0])
    assert fake.calls == [SA_FLAKY]
    assert _rows(body["attempt_id"])[qids[2]]["verdict"] == "correct"


def test_the_practice_page_finds_a_provisional_result_again(owner, practice, fake):
    """The comparison counts complete results only (409 while provisional), so after a
    reload the page showed the empty quiz: the result and its regrade offer were gone
    (task39). GET /api/practice/<id> names the latest graded attempt, provisional too."""
    from app.application import practice as practice_uc

    quiz_id, _, _, body = _provisional(owner, practice, fake)
    got = practice_uc.get(quiz_id, owner, bat_buoc_chu_so_huu=True)
    assert got["latest_attempt_id"] == body["attempt_id"]
    with pytest.raises(practice_uc.ChuaCoLanChamNao):
        practice_uc.comparison(quiz_id, owner, bat_buoc_chu_so_huu=True)


def test_two_failed_answers_are_both_regraded_by_one_job(owner, practice, fake):
    quiz_id, qids, _, body = _provisional(owner, practice, fake, fail=(SA_OK, SA_FLAKY))
    assert body["ungraded_count"] == 2
    rec = _Recorder()
    _regrade(quiz_id, owner, body["attempt_id"], rec)
    _run_job(*rec.calls[0])
    assert sorted(fake.calls) == sorted([SA_OK, SA_FLAKY])
    assert _stored(body["attempt_id"], owner)["ungraded_count"] == 0


def test_the_diagnostic_route_gives_back_a_never_started_retry_too(owner, fake, monkeypatch):
    """The refund lives in the shared `reclaim_for_regrade`: the diagnostic result page
    (#190) follows the same rule."""
    from tests.test_provisional_grading_recovery import _provisional as _diag_provisional
    from tests.test_provisional_grading_recovery import _regrade as _diag_regrade

    monkeypatch.setenv("GRADING_MANUAL_RETRY_MAX", "1")
    attempt_id, _ = _diag_provisional(owner, fake)
    rec = _Recorder()
    _diag_regrade(attempt_id, owner, rec)
    _silent(attempt_id, monkeypatch)
    _, accepted = _diag_regrade(attempt_id, owner, rec)
    assert accepted and len(rec.calls) == 2
    assert int(_meta(attempt_id)["manual_retries"]) == 1


def test_a_job_from_before_the_start_marker_that_did_run_is_not_refunded(owner, practice,
                                                                        fake, monkeypatch):
    """Deploy transition: a regrade job registered by older code has no start marker even
    if it ran. Its job row left `pending` when it started, so it is not refunded."""
    from app.application import attempts as attempts_uc
    from app.domains.jobs.jobs_store import update_job

    monkeypatch.setenv("GRADING_MANUAL_RETRY_MAX", "1")
    quiz_id, _, _, body = _provisional(owner, practice, fake)
    rec = _Recorder()
    _regrade(quiz_id, owner, body["attempt_id"], rec)
    update_job(rec.calls[0][0], status="running", progress=20, current_node="Grading")
    _silent(body["attempt_id"], monkeypatch)
    with pytest.raises(attempts_uc.HetLuotChamLai):
        _regrade(quiz_id, owner, body["attempt_id"], rec)
    assert len(rec.calls) == 1
