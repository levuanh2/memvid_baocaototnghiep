"""Diagnostic grading: a stuck `submitted` attempt recovers, and grading runs once.

The first six tests were written red on #185 `5e18271` (local `f85d5ff`) before the
owner approved the scope (2026-11-17): retry instead of 409, 200 with the stored result
for a graded attempt, 202 while a grader holds the claim or its job is queued, a recovery
sweep that is OFF by default. The rest cover the review of that plan (agy, task24).

PostgreSQL only (row locks). Every failure is produced for real: an exception inside
grading, a claim older than the lease (what a killed process leaves), a job left pending
by a lost queue, two graders forced to overlap with a barrier. No LLM is ever called:
short answers are graded by a fake `grading.grade_short_answer`, and a guard fails the
test if the real one is reached.
"""
from __future__ import annotations

import threading
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from tests.test_attempt_submit_concurrency import (  # noqa: F401  (owner = fixture)
    _quiz, _run_together, owner, pytestmark)

MEET_TIMEOUT_S = 5.0


@pytest.fixture(autouse=True)
def no_llm(monkeypatch):
    """Short answers get a fake grader; reaching the real one fails the test."""
    from app.domains.attempts import grading

    calls = []

    def _fake(**kw):
        calls.append(kw.get("question"))
        return {"verdict": "correct", "score": 1.0, "feedback": "ok", "missing_points": []}

    monkeypatch.setattr(grading, "grade_short_answer", _fake)
    import app.clients.llm_factory as llm_factory  # the only way grading reaches a model
    monkeypatch.setattr(llm_factory, "ask_ai",
                        lambda *a, **k: pytest.fail("real LLM reached"), raising=False)
    for name in ("GRADING_RECOVERY_ENABLED", "GRADING_RECOVERY_DRY_RUN"):
        monkeypatch.delenv(name, raising=False)
    return calls


def _dispatch_never(*_a, **_k):
    raise AssertionError("objective-only quiz must not dispatch a background job")


def _submit(attempt_id, user_id, dispatch=_dispatch_never, protect=True):
    from app.application import attempts as attempts_uc

    return attempts_uc.submit_attempt(attempt_id, user_id, bat_buoc_chu_so_huu=protect,
                                      dispatch_grading=dispatch)


def _answered_attempt(owner):
    from app.domains.attempts import repository

    quiz_id, qids = _quiz(owner)
    attempt_id = repository.open_attempt(quiz_id, owner)["attempt_id"]
    repository.save_draft_answers(attempt_id, {qids[0]: "dung", qids[1]: "sai"})
    return attempt_id


def _short_answer_attempt(owner):
    """One multiple-choice and one short-answer question: grading goes to a job."""
    from app.domains.attempts import repository

    quiz_id, qids = _short_answer_quiz(owner)
    attempt_id = repository.open_attempt(quiz_id, owner)["attempt_id"]
    repository.save_draft_answers(attempt_id, {qids[0]: "dung", qids[1]: "tra loi"})
    return attempt_id


def _short_answer_quiz(owner):
    from app.domains.documents import repository as docs_repo
    from app.domains.quiz import repository as quiz_repo

    doc_id = str(uuid.uuid4())
    docs_repo.create(document_id=doc_id, filename=f"sa_{doc_id[:6]}.md", file_type="md",
                     file_path=f"/tmp/sa_{doc_id[:6]}.md", user_id=owner)
    quiz_id = quiz_repo.create_quiz(
        user_id=owner, document_id=doc_id, title="Quiz tu luan",
        scope={"type": "full_document", "section_ids": []},
        question_count=2, difficulty="easy")
    base = {"explanation": "x", "difficulty": "easy", "concept_tags": ["tu luan"],
            "chunk_ids": []}
    quiz_repo.save_questions(quiz_id, [
        {**base, "question_type": "multiple_choice", "options": ["dung", "sai"],
         "correct_answer": "dung", "question_text": "Cau 1?"},
        {**base, "question_type": "short_answer", "options": None,
         "correct_answer": "mot cau tra loi", "question_text": "Cau 2?"},
    ])
    quiz_repo.finish(quiz_id, "ready", question_count=2)
    return quiz_id, [x["question_id"] for x in quiz_repo.get_quiz(quiz_id)["questions"]]


def _run_job_now(job_id, attempt_id, user_id):
    from app.application.short_answer_grading import run_short_answer_grading_job

    run_short_answer_grading_job(job_id, attempt_id, user_id)


class _Recorder:
    def __init__(self):
        self.calls = []

    def __call__(self, job_id, attempt_id, user_id):
        self.calls.append((job_id, attempt_id, user_id))


def _row(attempt_id):
    from app.db import session_scope
    from app.db.models import QuizAttempt

    with session_scope() as s:
        a = s.get(QuizAttempt, attempt_id)
        return {"status": a.status, "score": a.score, "claimed": a.grading_claimed_at,
                "submitted_at": a.submitted_at, "graded_at": a.graded_at,
                "meta": dict(a.metadata_json or {})}


def _masteries(attempt_id):
    from app.domains.gap_analysis import service as gap

    return gap.list_for_attempt(attempt_id)


def _set_claim(attempt_id, age_s):
    """The state a grader leaves when it holds the claim (age 0) or was killed (old)."""
    from app.db import session_scope
    from app.db.models import QuizAttempt

    with session_scope() as s:
        a = s.get(QuizAttempt, attempt_id)
        a.grading_claimed_at = (None if age_s is None
                                else datetime.now(timezone.utc) - timedelta(seconds=age_s))


def _age_submit(attempt_id, age_s):
    from app.db import session_scope
    from app.db.models import QuizAttempt

    with session_scope() as s:
        a = s.get(QuizAttempt, attempt_id)
        a.submitted_at = datetime.now(timezone.utc) - timedelta(seconds=age_s)


def _count(monkeypatch, module, name):
    calls = []
    original = getattr(module, name)

    def _wrapped(*a, **kw):
        calls.append(a[0] if a else None)
        return original(*a, **kw)

    monkeypatch.setattr(module, name, _wrapped)
    return calls


def _lease_s():
    from app.domains.attempts import repository

    lease = getattr(repository, "grading_lease_s", None)
    return lease() if lease else repository.GRADING_LEASE_S


def _state(attempt_id, user_id):
    from app.application import attempts as attempts_uc

    return attempts_uc.results(attempt_id, user_id, bat_buoc_chu_so_huu=True)["grading_state"]


# ── B: stuck in `submitted` (red on 5e18271) ──────────────────────────────
def test_grading_error_after_submit_then_retry_reaches_graded(owner, monkeypatch):
    from app.domains.attempts import service

    attempt_id = _answered_attempt(owner)
    original = service.grade_attempt

    def _boom(*_a, **_k):
        raise RuntimeError("grader crashed after the submit commit")

    monkeypatch.setattr(service, "grade_attempt", _boom)
    with pytest.raises(RuntimeError):
        _submit(attempt_id, owner)
    first = _row(attempt_id)
    assert first["status"] == "submitted"
    assert first["claimed"] is None, "the failed grader released its claim"
    assert _state(attempt_id, owner) == "stalled"

    monkeypatch.setattr(service, "grade_attempt", original)
    data, background = _submit(attempt_id, owner)  # was AttemptKhongConDangLam (409)
    assert background is False and data["status"] == "graded"
    after = _row(attempt_id)
    assert after["score"] is not None
    assert after["submitted_at"] == first["submitted_at"], "a retry keeps the submit time"
    assert _masteries(attempt_id), "gap analysis ran for the recovered attempt"


def test_killed_grader_retry_grades_after_the_lease(owner):
    from app.domains.attempts import repository

    attempt_id = _answered_attempt(owner)
    assert repository.submit(attempt_id) is not None  # committed, then the process died
    _set_claim(attempt_id, _lease_s() + 5)
    assert _state(attempt_id, owner) == "stalled"

    data, _ = _submit(attempt_id, owner)  # was 409
    assert data["status"] == "graded"


def test_retry_while_a_live_grader_holds_the_claim_does_not_grade_again(owner, monkeypatch):
    from app.domains.attempts import repository, service

    attempt_id = _answered_attempt(owner)
    assert repository.submit(attempt_id) is not None
    _set_claim(attempt_id, 0)
    graded = _count(monkeypatch, service, "grade_attempt")
    assert _state(attempt_id, owner) == "grading"

    data, background = _submit(attempt_id, owner)  # was 409; now "still grading"
    assert graded == []
    assert background is True  # the route answers 202
    assert data["status"] == "submitted" and data["grading"] == "pending"


# ── A: two graders of one attempt (red on 5e18271) ────────────────────────
def test_two_grading_jobs_at_once_save_once_and_analyse_once(owner, monkeypatch):
    from app.application.short_answer_grading import run_short_answer_grading_job
    from app.domains.attempts import grading, repository
    from app.domains.gap_analysis import service as gap
    from app.domains.jobs.jobs_store import create_job, get_job

    attempt_id = _answered_attempt(owner)
    assert repository.submit(attempt_id) is not None
    analysed = _count(monkeypatch, gap, "analyze_attempt")

    # Both graders finish computing before either saves: the interleaving a duplicated
    # or retried job produces.
    barrier, original_totals = threading.Barrier(2), grading.totals

    def _totals(*a, **kw):
        try:
            barrier.wait(MEET_TIMEOUT_S)
        except threading.BrokenBarrierError:
            pass
        return original_totals(*a, **kw)

    monkeypatch.setattr(grading, "totals", _totals)
    jobs = [str(uuid.uuid4()), str(uuid.uuid4())]
    for j in jobs:
        create_job(j, job_type="short_answer_grading", status="pending", user_id=owner)
    it = iter(jobs)
    lock = threading.Lock()

    def _one():
        with lock:
            j = next(it)
        run_short_answer_grading_job(j, attempt_id, owner)

    _run_together(_one)
    assert len(analysed) == 1, f"gap analysis ran {len(analysed)} times"
    assert [get_job(j)["status"] for j in jobs] == ["done", "done"], \
        "the grader that lost the race must end done (the result stands), not error"
    results = [get_job(j)["result"] for j in jobs]
    # Since Codex task25 the loser stops BEFORE grading (superseded) or, if it raced past
    # the start, ends with the stored result: either way one grader and the stored score.
    graders = [r for r in results if not r.get("superseded")]
    assert graders and all(r["score"] == _row(attempt_id)["score"] for r in graders)
    assert _row(attempt_id)["status"] == "graded"


def test_mastery_rows_are_exactly_the_snapshot_of_the_stored_grades(owner):
    """Exactly once, observable: one row per concept, matching the saved verdicts."""
    attempt_id = _answered_attempt(owner)
    _submit(attempt_id, owner)
    rows = _masteries(attempt_id)
    assert len(rows) == len({r["concept_name"] for r in rows}) == 1
    assert rows[0]["correct_count"] == 1 and rows[0]["total_count"] == 2


def test_sweep_regrades_only_stale_submitted_and_repairs_missing_mastery(owner, monkeypatch):
    from app.application import attempts as attempts_uc
    from app.domains.attempts import repository, service
    from app.domains.gap_analysis import service as gap

    stale, live, done, no_mastery = (_answered_attempt(owner) for _ in range(4))
    for a in (stale, live):
        assert repository.submit(a) is not None
    _set_claim(stale, _lease_s() + 5)
    _set_claim(live, 0)
    _submit(done, owner)
    # Scores committed, then the process died before gap analysis.
    original_analyse = gap.analyze_attempt
    monkeypatch.setattr(gap, "analyze_attempt", lambda *_a, **_k: (_ for _ in ()).throw(
        RuntimeError("killed before gap analysis")))
    _submit(no_mastery, owner)
    monkeypatch.setattr(gap, "analyze_attempt", original_analyse)
    assert _masteries(no_mastery) == []
    done_before = _row(done)
    graded = _count(monkeypatch, service, "grade_attempt")

    report = attempts_uc.recover_grading(dispatch_grading=_run_job_now, enabled=True,
                                         dry_run=False, older_than_s=0, limit=10)

    assert _row(stale)["status"] == "graded"
    assert _row(live)["status"] == "submitted"
    assert _row(done) == done_before
    assert graded == [stale], "only the stale attempt is graded again"
    assert _masteries(no_mastery), "missing mastery is rebuilt without regrading"
    assert report["regraded"] == 1 and report["mastery_repaired"] == 1


# ── Contract after approval ───────────────────────────────────────────────
def test_retry_of_a_graded_attempt_returns_the_stored_result(owner, monkeypatch):
    from app.domains.attempts import service

    attempt_id = _answered_attempt(owner)
    first, _ = _submit(attempt_id, owner)
    graded = _count(monkeypatch, service, "grade_attempt")

    again, background = _submit(attempt_id, owner)  # was 409 "Nộp bài thất bại"
    assert background is False and again["grading"] == "done"
    assert graded == []
    for k in ("status", "score", "correct_count", "incorrect_count", "graded_at"):
        assert again[k] == first[k], k


def test_retry_of_a_graded_attempt_rebuilds_mastery_lost_mid_analysis(owner, monkeypatch):
    from app.domains.attempts import service
    from app.domains.gap_analysis import service as gap

    attempt_id = _answered_attempt(owner)
    original = gap.analyze_attempt
    monkeypatch.setattr(gap, "analyze_attempt", lambda *_a, **_k: (_ for _ in ()).throw(
        RuntimeError("killed before gap analysis")))
    _submit(attempt_id, owner)
    assert _row(attempt_id)["status"] == "graded" and _masteries(attempt_id) == []
    monkeypatch.setattr(gap, "analyze_attempt", original)
    graded = _count(monkeypatch, service, "grade_attempt")

    _submit(attempt_id, owner)
    assert graded == [], "rebuilding mastery never regrades"
    assert len(_masteries(attempt_id)) == 1


def test_retry_while_the_grading_job_is_queued_starts_no_second_job(owner):
    attempt_id = _short_answer_attempt(owner)
    queue = _Recorder()
    first, background = _submit(attempt_id, owner, dispatch=queue)
    assert background is True and len(queue.calls) == 1
    _set_claim(attempt_id, _lease_s() + 5)  # a long queue wait outlived the lease

    again, background = _submit(attempt_id, owner, dispatch=queue)
    assert background is True and again["grading"] == "pending"
    assert again["job_id"] == first["job_id"]
    assert len(queue.calls) == 1, "a queued job still counts as the grader"
    assert _state(attempt_id, owner) == "grading"


def test_a_job_the_queue_lost_is_recovered_by_a_retry(owner, monkeypatch):
    attempt_id = _short_answer_attempt(owner)
    queue = _Recorder()
    first, _ = _submit(attempt_id, owner, dispatch=queue)
    _set_claim(attempt_id, _lease_s() + 5)
    _age_job(first["job_id"], _lease_s() + 5)  # silent past the lease: lost
    assert _state(attempt_id, owner) == "stalled"

    _, background = _submit(attempt_id, owner, dispatch=queue)
    assert background is True and len(queue.calls) == 2


def test_grader_crash_in_the_job_releases_the_claim_and_a_retry_regrades(owner, monkeypatch,
                                                                          no_llm):
    from app.domains.attempts import grading
    from app.domains.jobs.jobs_store import get_job

    attempt_id = _short_answer_attempt(owner)
    fake = grading.grade_short_answer
    monkeypatch.setattr(grading, "grade_short_answer",
                        lambda **_k: (_ for _ in ()).throw(RuntimeError("model down")))
    first, _ = _submit(attempt_id, owner, dispatch=_run_job_now)
    assert get_job(first["job_id"])["status"] == "error"
    assert _row(attempt_id)["status"] == "submitted"
    assert _state(attempt_id, owner) == "stalled", "the crashed job released its claim"

    monkeypatch.setattr(grading, "grade_short_answer", fake)
    again, _ = _submit(attempt_id, owner, dispatch=_run_job_now)
    assert get_job(again["job_id"])["status"] == "done"
    assert _row(attempt_id)["status"] == "graded"


def test_an_old_grader_finishing_after_a_reclaim_changes_nothing(owner, monkeypatch):
    """Grader A outlives its lease; B reclaims, saves and analyses; A then saves: no-op."""
    from app.domains.attempts import grading, repository, service
    from app.domains.gap_analysis import service as gap

    attempt_id = _answered_attempt(owner)
    assert repository.submit(attempt_id) is not None
    analysed = _count(monkeypatch, gap, "analyze_attempt")
    original_totals, ran, b_snapshot = grading.totals, [], []

    def _a_pauses_while_b_runs(*a, **kw):
        if not ran:
            ran.append("A")
            _set_claim(attempt_id, _lease_s() + 5)  # A's lease ran out meanwhile
            data, _ = _submit(attempt_id, owner)  # B: a retry reclaims and grades
            assert data["status"] == "graded"
            b_snapshot.append(_row(attempt_id))
        return original_totals(*a, **kw)

    monkeypatch.setattr(grading, "totals", _a_pauses_while_b_runs)
    result_a = service.grade_attempt(attempt_id, once=True)
    assert result_a is None, "A saw the attempt graded and wrote nothing"
    assert len(analysed) == 1
    assert _row(attempt_id) == b_snapshot[0], "B's result stands, untouched by A"


def test_retry_on_another_learners_attempt_is_not_found(owner):
    from app.application import attempts as attempts_uc
    from app.domains.attempts import repository

    attempt_id = _answered_attempt(owner)
    assert repository.submit(attempt_id) is not None
    _set_claim(attempt_id, None)
    with pytest.raises(attempts_uc.AttemptKhongTonTai):
        _submit(attempt_id, str(uuid.uuid4()))
    assert _row(attempt_id)["status"] == "submitted", "nothing was graded for a stranger"


def test_the_generic_route_refuses_a_practice_quiz(owner, monkeypatch):
    from app.application import attempts as attempts_uc
    from app.domains.attempts import repository
    from app.domains.quiz import repository as quiz_repo

    quiz_id, qids = _quiz(owner)
    original = quiz_repo.get_quiz
    monkeypatch.setattr(quiz_repo, "get_quiz", lambda qid, **kw: {
        **(original(qid, **kw) or {}), "quiz_type": "practice"} if qid == quiz_id
        else original(qid, **kw))
    attempt_id = repository.open_attempt(quiz_id, owner)["attempt_id"]
    with pytest.raises(attempts_uc.BaiLuyenTapSaiRoute):
        _submit(attempt_id, owner)
    assert _row(attempt_id)["status"] == "in_progress"


# ── Recovery sweep ────────────────────────────────────────────────────────
def _stuck(owner, n):
    from app.domains.attempts import repository

    out = []
    for _ in range(n):
        a = _answered_attempt(owner)
        assert repository.submit(a) is not None
        _set_claim(a, _lease_s() + 5)
        # Older than anything another test file may leave behind: the sweep is global
        # and takes the oldest first, so these come first; assertions look at these only.
        _age_submit(a, 30 * 86400)
        out.append(a)
    return out


def test_sweep_is_off_by_default_and_calls_nothing(owner, monkeypatch, no_llm):
    from app.application import attempts as attempts_uc
    from app.domains.attempts import service

    stuck = _stuck(owner, 1) + [_short_answer_attempt(owner)]
    graded = _count(monkeypatch, service, "grade_attempt")
    queue = _Recorder()

    report = attempts_uc.recover_grading(dispatch_grading=queue)  # env unset

    assert report == {"enabled": False}
    assert queue.calls == [] and graded == [] and no_llm == []
    assert _row(stuck[0])["status"] == "submitted"


def test_sweep_dry_run_picks_and_changes_nothing(owner, monkeypatch):
    from app.application import attempts as attempts_uc

    monkeypatch.setenv("GRADING_RECOVERY_ENABLED", "1")  # DRY_RUN defaults to on
    (a,) = _stuck(owner, 1)
    before = _row(a)
    queue = _Recorder()

    report = attempts_uc.recover_grading(dispatch_grading=queue, older_than_s=0, limit=50)

    assert report["dry_run"] is True and a in report["candidates"]
    assert queue.calls == [] and _row(a) == before


def test_sweep_never_exceeds_its_batch_and_never_grades_inline(owner, monkeypatch):
    from app.application import attempts as attempts_uc
    from app.domains.attempts import service

    stuck = _stuck(owner, 3)
    graded = _count(monkeypatch, service, "grade_attempt")
    queue = _Recorder()

    first = attempts_uc.recover_grading(dispatch_grading=queue, enabled=True, dry_run=False,
                                        older_than_s=0, limit=2, max_inflight=50)
    assert first["regraded"] == 2 and len(queue.calls) == 2, "never more than the batch"
    assert {c[1] for c in queue.calls} <= set(stuck)
    assert graded == [], "the sweep only enqueues; grading happens in the job"
    assert {c[2] for c in queue.calls} == {owner}, "jobs carry the attempt's own learner"
    second = attempts_uc.recover_grading(dispatch_grading=queue, enabled=True, dry_run=False,
                                         older_than_s=0, limit=2, max_inflight=50)
    assert second["regraded"] <= 2
    assert sorted(c[1] for c in queue.calls if c[1] in stuck) == sorted(stuck)


def test_sweep_respects_max_inflight_and_max_attempts(owner):
    from app.application import attempts as attempts_uc

    stuck = _stuck(owner, 3)
    queue = _Recorder()  # records, never runs: the claims stay live (in flight)
    kw = dict(dispatch_grading=queue, enabled=True, dry_run=False, older_than_s=0,
              limit=10, max_attempts=1)
    first = attempts_uc.recover_grading(max_inflight=2, **kw)
    assert first["regraded"] == 2
    blocked = attempts_uc.recover_grading(max_inflight=2, **kw)
    assert blocked["regraded"] == 0 and blocked["inflight"] >= 2

    for a in stuck:  # every recovery died; the lease ran out
        _set_claim(a, _lease_s() + 5)
    gave_up = attempts_uc.recover_grading(max_inflight=10, **kw)
    tried_once = {c[1] for c in queue.calls[:2]}
    again = [a for a in stuck if a in gave_up["candidates"]]
    assert again == [a for a in stuck if a not in tried_once],         "an attempt that used its one recovery is not picked again"
    assert gave_up["gave_up"] >= 2


def test_two_sweeps_at_once_never_take_the_same_attempt(owner):
    from app.application import attempts as attempts_uc

    stuck = _stuck(owner, 4)
    queue = _Recorder()
    _run_together(lambda: attempts_uc.recover_grading(
        dispatch_grading=queue, enabled=True, dry_run=False, older_than_s=0, limit=4,
        max_inflight=50))
    taken = [c[1] for c in queue.calls if c[1] in stuck]
    assert len(taken) == len(set(taken)), "an attempt was dispatched twice"


def test_learner_retries_are_capped_per_attempt(owner, monkeypatch, no_llm):
    """Each regrade of short answers is an LLM call: a learner cannot loop on the button."""
    from app.application import attempts as attempts_uc
    from app.domains.attempts import grading

    monkeypatch.setenv("GRADING_MANUAL_RETRY_MAX", "2")
    attempt_id = _short_answer_attempt(owner)
    attempts = []

    def _always_fails(**kw):
        attempts.append(kw.get("question"))
        raise RuntimeError("model down")

    monkeypatch.setattr(grading, "grade_short_answer", _always_fails)
    _submit(attempt_id, owner, dispatch=_run_job_now)        # the submit itself
    _submit(attempt_id, owner, dispatch=_run_job_now)        # retry 1
    _submit(attempt_id, owner, dispatch=_run_job_now)        # retry 2
    assert _state(attempt_id, owner) == "failed"
    with pytest.raises(attempts_uc.HetLuotChamLai):
        _submit(attempt_id, owner, dispatch=_run_job_now)    # retry 3: refused
    assert len(attempts) == 3, "one model call per grading pass, none after the cap"
    assert _row(attempt_id)["meta"]["manual_retries"] == 2


# ── Codex task25 review of 6a33f9b ────────────────────────────────────────
def _count_model_calls(monkeypatch, *, meet=False):
    """Count short-answer model calls; with `meet`, two graders wait for each other
    INSIDE the model call (before any save), the moment a claim must already fence."""
    from app.domains.attempts import grading

    calls, barrier = [], threading.Barrier(2)

    def _fake(**kw):
        calls.append(kw.get("question"))
        if meet:
            try:
                barrier.wait(MEET_TIMEOUT_S)
            except threading.BrokenBarrierError:
                pass
        return {"verdict": "correct", "score": 1.0, "feedback": "ok", "missing_points": []}

    monkeypatch.setattr(grading, "grade_short_answer", _fake)
    return calls


def test_a_stale_second_job_never_calls_the_model(owner, monkeypatch):
    """Finding 1: the claim must fence the LLM work, not only the final write."""
    from app.domains.jobs.jobs_store import create_job, get_job

    attempt_id = _short_answer_attempt(owner)
    queue = _Recorder()
    first, _ = _submit(attempt_id, owner, dispatch=queue)       # job 1 is the grader
    stale = str(uuid.uuid4())                                     # e.g. an older retry job
    create_job(stale, job_type="short_answer_grading", status="pending", user_id=owner)
    calls = _count_model_calls(monkeypatch, meet=True)
    jobs = iter([first["job_id"], stale])
    lock = threading.Lock()

    def _one():
        with lock:
            j = next(jobs)
        _run_job_now(j, attempt_id, owner)

    _run_together(_one)
    assert len(calls) == 1, f"the model was called {len(calls)} times for one answer"
    assert get_job(stale)["status"] == "done", "the superseded job is a no-op, not an error"
    assert _row(attempt_id)["status"] == "graded"


def test_the_same_job_delivered_twice_calls_the_model_once(owner, monkeypatch):
    attempt_id = _short_answer_attempt(owner)
    queue = _Recorder()
    first, _ = _submit(attempt_id, owner, dispatch=queue)
    calls = _count_model_calls(monkeypatch, meet=True)
    _run_together(lambda: _run_job_now(first["job_id"], attempt_id, owner))
    assert len(calls) == 1


def test_a_request_that_lost_its_claim_does_not_register_a_job(owner):
    """Request A pauses past the lease and B reclaims: the late registration of A fails."""
    from app.domains.attempts import repository

    attempt_id = _short_answer_attempt(owner)
    a_claim = repository.submit(attempt_id)["claimed_at"]
    _set_claim(attempt_id, _lease_s() + 5)
    outcome, b_claim = repository.reclaim_for_retry(attempt_id)
    assert outcome == "grade"
    assert repository.set_grading_job(attempt_id, "job-a", a_claim) is False
    assert repository.set_grading_job(attempt_id, "job-b", b_claim) is True
    assert _row(attempt_id)["meta"]["grading_job_id"] == "job-b"


def test_a_failed_enqueue_leaves_no_ghost_job_and_costs_no_retry(owner):
    """Finding 2: nothing was accepted, so no 202 later and no retry used up."""
    from app.domains.jobs.jobs_store import get_job

    attempt_id = _short_answer_attempt(owner)
    failed = []

    def _queue_down(job_id, *_a):
        failed.append(job_id)
        raise ConnectionError("queue down")

    with pytest.raises(ConnectionError):
        _submit(attempt_id, owner, dispatch=_queue_down)
    assert get_job(failed[0])["status"] == "error"
    assert "grading_job_id" not in _row(attempt_id)["meta"]
    assert _state(attempt_id, owner) == "stalled"

    with pytest.raises(ConnectionError):                            # a retry, queue still down
        _submit(attempt_id, owner, dispatch=_queue_down)
    assert int(_row(attempt_id)["meta"].get("manual_retries") or 0) == 0, "refunded"

    queue = _Recorder()
    again, background = _submit(attempt_id, owner, dispatch=queue)  # queue back
    assert background is True and len(queue.calls) == 1, "a real job, not a ghost 202"
    assert again["job_id"] == queue.calls[0][0]


def test_concurrent_sweeps_share_one_inflight_budget(owner, monkeypatch):
    """Finding 3: two processes must not each spend the whole budget."""
    from app.application import attempts as attempts_uc
    from app.domains.attempts import repository

    stuck = _stuck(owner, 4)
    original_now, barrier = repository._now, threading.Barrier(2)

    def _now():
        try:
            barrier.wait(2.0)
        except threading.BrokenBarrierError:
            pass
        return original_now()

    monkeypatch.setattr(repository, "_now", _now)
    queue = _Recorder()
    _run_together(lambda: attempts_uc.recover_grading(
        dispatch_grading=queue, enabled=True, dry_run=False, older_than_s=0, limit=10,
        max_inflight=2))
    assert len([c for c in queue.calls if c[1] in stuck]) <= 2


def test_a_recovery_whose_job_is_still_queued_counts_as_inflight(owner):
    from app.application import attempts as attempts_uc

    stuck = _stuck(owner, 3)
    queue = _Recorder()   # records, never runs: the jobs stay pending (active)
    kw = dict(dispatch_grading=queue, enabled=True, dry_run=False, older_than_s=0,
              limit=10, max_inflight=2)
    assert attempts_uc.recover_grading(**kw)["regraded"] == 2
    for a in stuck:
        _set_claim(a, _lease_s() + 5)  # the claims expired, the jobs did not
    assert attempts_uc.recover_grading(**kw)["regraded"] == 0


def test_the_practice_route_caps_retries_of_one_attempt_too(owner, monkeypatch):
    """Finding 4: the only valid route for practice had no per-attempt cap."""
    from app.application import attempts as attempts_uc
    from app.application import practice as practice_uc
    from app.domains.attempts import service

    monkeypatch.setenv("GRADING_MANUAL_RETRY_MAX", "2")
    monkeypatch.setattr(practice_uc, "_load_owned_practice", lambda *a, **k: {"status": "ready"})
    quiz_id, qids = _short_answer_quiz(owner)  # a regrade costs model calls: capped
    passes = []

    def _paid_then_fails(attempt_id, **kw):
        passes.append(attempt_id)  # a provider call happened, then grading failed
        raise RuntimeError("failed after the model call")

    monkeypatch.setattr(service, "grade_attempt", _paid_then_fails)
    key = "k" * 32
    for _ in range(3):  # the submit, then retries 1 and 2
        with pytest.raises(RuntimeError):
            practice_uc.submit(quiz_id, owner, {qids[0]: "dung"}, bat_buoc_chu_so_huu=True,
                               submit_key=key)
    with pytest.raises(attempts_uc.HetLuotChamLai):
        practice_uc.submit(quiz_id, owner, {qids[0]: "dung"}, bat_buoc_chu_so_huu=True,
                           submit_key=key)
    assert len(passes) == 3


def test_a_failed_mastery_repair_is_tried_again_next_sweep(owner, monkeypatch):
    """Finding 5: only a repair that did not fail may mark the attempt checked."""
    from app.application import attempts as attempts_uc
    from app.domains.gap_analysis import service as gap

    attempt_id = _answered_attempt(owner)
    original = gap.analyze_attempt
    monkeypatch.setattr(gap, "analyze_attempt", lambda *_a, **_k: (_ for _ in ()).throw(
        RuntimeError("down")))
    _submit(attempt_id, owner)
    kw = dict(dispatch_grading=_Recorder(), enabled=True, dry_run=False, older_than_s=0,
              limit=50)
    attempts_uc.recover_grading(**kw)                      # analysis still down
    assert "mastery_checked" not in _row(attempt_id)["meta"]
    monkeypatch.setattr(gap, "analyze_attempt", original)
    attempts_uc.recover_grading(**kw)
    assert _masteries(attempt_id), "repaired on the next sweep"


# ── Codex re-check of ddafc7b and agy task27 ──────────────────────────────
def _age_job(job_id, seconds):
    """What a killed worker leaves: the job row stops being updated."""
    from app.domains.jobs import jobs_store

    old = (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()
    conn = jobs_store.get_conn()
    try:
        conn.execute("UPDATE jobs SET updated_at=? WHERE job_id=?", (old, job_id))
        conn.commit()
    finally:
        conn.close()


def test_a_redelivered_job_does_not_grade_while_the_first_delivery_runs(owner, monkeypatch):
    """Codex HIGH: the claim expired during a long model call; the queue delivers the
    same job again. The first delivery is alive (its job row is fresh): no second run."""
    from app.domains.attempts import grading

    attempt_id = _short_answer_attempt(owner)
    queue = _Recorder()
    first, _ = _submit(attempt_id, owner, dispatch=queue)
    job_id = first["job_id"]
    inside, release, calls = threading.Event(), threading.Event(), []

    def _slow(**kw):
        calls.append(kw.get("question"))
        if len(calls) == 1:
            inside.set()
            release.wait(30)
        return {"verdict": "correct", "score": 1.0, "feedback": "ok", "missing_points": []}

    monkeypatch.setattr(grading, "grade_short_answer", _slow)
    t = threading.Thread(target=_run_job_now, args=(job_id, attempt_id, owner))
    t.start()
    try:
        assert inside.wait(30)
        _set_claim(attempt_id, _lease_s() + 5)   # the call outlived the lease
        _run_job_now(job_id, attempt_id, owner)  # redelivery
    finally:
        release.set()
        t.join(30)
    assert len(calls) == 1, f"the model was called {len(calls)} times"
    assert _row(attempt_id)["status"] == "graded"


def test_a_running_job_renews_the_claim_between_answers(owner, monkeypatch):
    from app.domains.attempts import grading

    attempt_id = _short_answer_attempt(owner)
    first, _ = _submit(attempt_id, owner, dispatch=_Recorder())
    seen = []

    def _probe(**kw):
        seen.append(_row(attempt_id)["claimed"])
        return {"verdict": "correct", "score": 1.0, "feedback": "ok", "missing_points": []}

    _set_claim(attempt_id, _lease_s() - 1)       # about to expire
    monkeypatch.setattr(grading, "grade_short_answer", _probe)
    _run_job_now(first["job_id"], attempt_id, owner)
    age = (datetime.now(timezone.utc) - seen[0]).total_seconds()
    assert age < 60, "the claim was renewed when grading started"


def test_a_job_silent_past_the_lease_counts_as_dead(owner):
    """agy B1: a killed worker leaves its job 'running'; after the lease (not 15 min)
    the attempt is stalled and a retry can grade it."""
    from app.domains.jobs.jobs_store import update_job

    attempt_id = _short_answer_attempt(owner)
    first, _ = _submit(attempt_id, owner, dispatch=_Recorder())
    update_job(first["job_id"], status="running")
    _set_claim(attempt_id, _lease_s() + 5)
    _age_job(first["job_id"], _lease_s() + 5)
    assert _state(attempt_id, owner) == "stalled"
    queue = _Recorder()
    _submit(attempt_id, owner, dispatch=queue)
    assert len(queue.calls) == 1


def test_a_request_that_lost_its_claim_refunds_and_answers_200_if_graded(owner, monkeypatch):
    """Codex MEDIUM: the retry counted, then lost the claim before registering its job
    (B reclaimed and graded meanwhile): give the retry back, answer with the result."""
    from app.application import attempts as attempts_uc
    from app.domains.attempts import repository

    attempt_id = _short_answer_attempt(owner)
    assert repository.submit(attempt_id) is not None
    _set_claim(attempt_id, _lease_s() + 5)
    original = repository.set_grading_job

    def _b_wins_first(aid, job_id, claimed_at):
        # B reclaims and grades between our claim and our registration.
        _set_claim(aid, _lease_s() + 5)
        _run_job_now_for(aid)
        return original(aid, job_id, claimed_at)

    def _run_job_now_for(aid):
        monkeypatch.setattr(repository, "set_grading_job", original)
        attempts_uc.submit_attempt(aid, owner, bat_buoc_chu_so_huu=True,
                                   dispatch_grading=_run_job_now)

    monkeypatch.setattr(repository, "set_grading_job", _b_wins_first)
    data, background = _submit(attempt_id, owner, dispatch=_Recorder())
    assert background is False and data["grading"] == "done"
    assert _row(attempt_id)["meta"].get("manual_retries") == 1, "only B's retry counts"


def test_objective_only_attempts_are_never_capped(owner, monkeypatch):
    """Codex MEDIUM: the cap protects LLM cost; an objective quiz costs none."""
    from app.domains.attempts import service

    monkeypatch.setenv("GRADING_MANUAL_RETRY_MAX", "1")
    attempt_id = _answered_attempt(owner)
    original = service.grade_attempt

    def _boom(*_a, **_k):
        raise RuntimeError("db hiccup")

    monkeypatch.setattr(service, "grade_attempt", _boom)
    for _ in range(4):
        with pytest.raises(RuntimeError):
            _submit(attempt_id, owner)
    assert _state(attempt_id, owner) == "stalled"
    monkeypatch.setattr(service, "grade_attempt", original)
    data, _ = _submit(attempt_id, owner)
    assert data["status"] == "graded"


def test_a_job_for_an_attempt_already_graded_ends_done_without_running(owner):
    """agy B3: no 'running' flicker and no error for a job that has nothing to do."""
    from app.domains.jobs.jobs_store import create_job, get_job

    attempt_id = _answered_attempt(owner)
    _submit(attempt_id, owner)
    job = str(uuid.uuid4())
    create_job(job, job_type="short_answer_grading", status="pending", user_id=owner)
    _run_job_now(job, attempt_id, owner)
    assert get_job(job)["status"] == "done"


# ── Codex re-check 2 of 364f550 ───────────────────────────────────────────
def _two_short_answer_attempt(owner):
    from app.domains.attempts import repository
    from app.domains.documents import repository as docs_repo
    from app.domains.quiz import repository as quiz_repo

    doc_id = str(uuid.uuid4())
    docs_repo.create(document_id=doc_id, filename=f"sa2_{doc_id[:6]}.md", file_type="md",
                     file_path=f"/tmp/sa2_{doc_id[:6]}.md", user_id=owner)
    quiz_id = quiz_repo.create_quiz(
        user_id=owner, document_id=doc_id, title="Hai cau tu luan",
        scope={"type": "full_document", "section_ids": []},
        question_count=2, difficulty="easy")
    base = {"explanation": "x", "difficulty": "easy", "concept_tags": ["tu luan"],
            "chunk_ids": [], "question_type": "short_answer", "options": None,
            "correct_answer": "mot cau tra loi"}
    quiz_repo.save_questions(quiz_id, [{**base, "question_text": "Cau 1?"},
                                       {**base, "question_text": "Cau 2?"}])
    quiz_repo.finish(quiz_id, "ready", question_count=2)
    qids = [x["question_id"] for x in quiz_repo.get_quiz(quiz_id)["questions"]]
    attempt_id = repository.open_attempt(quiz_id, owner)["attempt_id"]
    repository.save_draft_answers(attempt_id, {qids[0]: "a", qids[1]: "b"})
    return attempt_id


def test_a_grader_that_lost_its_claim_stops_before_the_next_model_call(owner, monkeypatch):
    """A takeover happens while job A is inside its first model call (it outlived the
    lease): A must not call the model for the second answer."""
    from app.domains.attempts import grading, repository
    from app.domains.jobs.jobs_store import get_job

    attempt_id = _two_short_answer_attempt(owner)
    first, _ = _submit(attempt_id, owner, dispatch=_Recorder())
    calls = []

    def _model(**kw):
        calls.append(kw.get("question"))
        if len(calls) == 1:  # meanwhile: A looks dead, a retry takes the attempt over
            _set_claim(attempt_id, _lease_s() + 5)
            assert repository.reclaim_for_retry(attempt_id)[0] == "grade"
        return {"verdict": "correct", "score": 1.0, "feedback": "ok", "missing_points": []}

    monkeypatch.setattr(grading, "grade_short_answer", _model)
    _run_job_now(first["job_id"], attempt_id, owner)
    assert len(calls) == 1, "A stopped instead of paying for the second answer"
    assert _row(attempt_id)["status"] == "submitted", "A wrote nothing"
    assert get_job(first["job_id"])["status"] == "done"
    assert get_job(first["job_id"])["result"].get("superseded") is True


def test_a_takeover_clears_the_old_job_marker(owner):
    from app.domains.attempts import repository

    attempt_id = _short_answer_attempt(owner)
    first, _ = _submit(attempt_id, owner, dispatch=_Recorder())
    assert repository.start_grading_job(attempt_id, first["job_id"])[0] == "run"
    _set_claim(attempt_id, _lease_s() + 5)
    assert repository.reclaim_for_retry(attempt_id)[0] == "grade"
    assert "grading_job_running" not in _row(attempt_id)["meta"]
    assert repository.renew_claim(attempt_id, first["job_id"]) is False


def test_the_retry_cap_is_decided_inside_the_locked_transaction(owner, monkeypatch):
    """No second database session while the attempt row is locked (pool starvation)."""
    import app.domains.attempts.repository as repository

    attempt_id = _short_answer_attempt(owner)
    assert repository.submit(attempt_id) is not None
    _set_claim(attempt_id, None)
    opened = []
    original = repository.session_scope

    def _counting():
        opened.append(1)
        return original()

    monkeypatch.setattr(repository, "session_scope", _counting)
    import app.domains.attempts.service as service
    monkeypatch.setattr(service, "has_short_answer",
                        lambda *_a: pytest.fail("a nested query for the cap"))
    assert repository.reclaim_for_retry(attempt_id, max_retries=3)[0] == "grade"
    assert opened == [1]
    # The repository decides "has short answers" itself, in that same session: an
    # objective-only attempt is never capped, even with a cap of 0.
    monkeypatch.setattr(repository, "session_scope", original)
    objective = _answered_attempt(owner)
    assert repository.submit(objective) is not None
    _set_claim(objective, None)
    assert repository.reclaim_for_retry(objective, max_retries=0)[0] == "grade"


@pytest.mark.parametrize("timeout, wait", [(None, None), ("600", None), ("120", "500")])
def test_the_lease_outlasts_one_model_call_whatever_the_config(monkeypatch, timeout, wait):
    """A live grader renews only between answers, so ONE model call plus its queue wait
    must fit inside the lease, for any GRADE_LLM_TIMEOUT_SEC / LLM_QUEUE_WAIT_TIMEOUT_SECONDS
    (Codex re-check 3: the earlier test hard-coded the defaults)."""
    from app.domains.attempts import repository

    for name, value in (("GRADE_LLM_TIMEOUT_SEC", timeout),
                        ("LLM_QUEUE_WAIT_TIMEOUT_SECONDS", wait)):
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)
    call = float(timeout or 120) + float(wait or 30)
    assert repository.grading_lease_s() > call
    assert repository.grading_lease_s() >= repository.GRADING_LEASE_S


def test_a_claim_inside_a_long_configured_call_is_still_live(owner, monkeypatch):
    from app.domains.attempts import repository

    monkeypatch.setenv("GRADE_LLM_TIMEOUT_SEC", "600")
    attempt_id = _short_answer_attempt(owner)
    assert repository.submit(attempt_id) is not None
    _set_claim(attempt_id, 400)  # past the 300 s floor, inside one 600 s call
    assert repository.reclaim_for_retry(attempt_id)[0] == "pending"


def test_a_disabled_sweep_touches_nothing_at_all(monkeypatch):
    """Task 3 (2026-11-17): with the flag off the sweep opens no database session, takes
    no lock, enqueues nothing and calls no model; it reads one environment variable."""
    from app.application import attempts as attempts_uc
    from app.domains.attempts import repository

    monkeypatch.delenv("GRADING_RECOVERY_ENABLED", raising=False)
    monkeypatch.setattr(repository, "session_scope",
                        lambda: pytest.fail("a database session while the sweep is off"))
    monkeypatch.setattr(repository, "claim_stuck_for_recovery",
                        lambda **_k: pytest.fail("claimed while the sweep is off"))
    assert attempts_uc.recover_grading(
        dispatch_grading=lambda *a: pytest.fail("enqueued while the sweep is off")) == {
        "enabled": False}
    for off in ("0", "false", "no", "off", ""):
        monkeypatch.setenv("GRADING_RECOVERY_ENABLED", off)
        assert attempts_uc.recover_grading(dispatch_grading=lambda *a: None) == {"enabled": False}
