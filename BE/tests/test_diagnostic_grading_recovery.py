"""Diagnostic grading: a stuck `submitted` attempt recovers, and grading runs once.

RED on #185 `5e18271` by design. These tests describe the behaviour proposed in
`docs/ui-ux-v6/06-release-review.md` section 8b; the implementation waits for the owner's
approval of that scope (retry instead of 409, and the bounded sweep).

PostgreSQL only (row locks). Every failure is produced for real: an exception inside
grading, a claim older than the lease (what a killed process leaves), two graders forced
to overlap with a barrier. No catalog edits.
"""
from __future__ import annotations

import threading
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import sqlalchemy as sa

from tests.test_attempt_submit_concurrency import (  # noqa: F401  (owner = fixture)
    _quiz, _run_together, owner, pytestmark)

MEET_TIMEOUT_S = 5.0


def _dispatch_never(*_a, **_k):
    raise AssertionError("objective-only quiz must not dispatch a background job")


def _submit(attempt_id, user_id):
    from app.application import attempts as attempts_uc

    return attempts_uc.submit_attempt(attempt_id, user_id, bat_buoc_chu_so_huu=True,
                                      dispatch_grading=_dispatch_never)


def _answered_attempt(owner):
    from app.domains.attempts import repository

    quiz_id, qids = _quiz(owner)
    attempt_id = repository.open_attempt(quiz_id, owner)["attempt_id"]
    repository.save_draft_answers(attempt_id, {qids[0]: "dung", qids[1]: "sai"})
    return attempt_id


def _row(attempt_id):
    from app.db import session_scope
    from app.db.models import QuizAttempt

    with session_scope() as s:
        a = s.get(QuizAttempt, attempt_id)
        return {"status": a.status, "score": a.score, "claimed": a.grading_claimed_at}


def _masteries(attempt_id):
    from app.domains.gap_analysis import service as gap

    return gap.list_for_attempt(attempt_id)


def _set_claim(attempt_id, age_s):
    """The state a grader leaves when it holds the claim (age 0) or was killed (old)."""
    from app.db import session_scope
    from app.db.models import QuizAttempt

    with session_scope() as s:
        a = s.get(QuizAttempt, attempt_id)
        a.grading_claimed_at = datetime.now(timezone.utc) - timedelta(seconds=age_s)


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

    return repository.GRADING_LEASE_S


# ── B: stuck in `submitted` ───────────────────────────────────────────────
def test_grading_error_after_submit_then_retry_reaches_graded(owner, monkeypatch):
    from app.domains.attempts import service

    attempt_id = _answered_attempt(owner)
    original = service.grade_attempt

    def _boom(*_a, **_k):
        raise RuntimeError("grader crashed after the submit commit")

    monkeypatch.setattr(service, "grade_attempt", _boom)
    with pytest.raises(RuntimeError):
        _submit(attempt_id, owner)
    assert _row(attempt_id)["status"] == "submitted"

    monkeypatch.setattr(service, "grade_attempt", original)
    data, background = _submit(attempt_id, owner)  # today: AttemptKhongConDangLam (409)
    assert background is False and data["status"] == "graded"
    assert _row(attempt_id)["score"] is not None
    assert _masteries(attempt_id), "gap analysis ran for the recovered attempt"


def test_killed_grader_retry_grades_after_the_lease(owner):
    from app.domains.attempts import repository

    attempt_id = _answered_attempt(owner)
    assert repository.submit(attempt_id) is not None  # committed, then the process died
    _set_claim(attempt_id, _lease_s() + 5)

    data, _ = _submit(attempt_id, owner)  # today: 409
    assert data["status"] == "graded"


def test_retry_while_a_live_grader_holds_the_claim_does_not_grade_again(owner, monkeypatch):
    from app.domains.attempts import repository, service

    attempt_id = _answered_attempt(owner)
    assert repository.submit(attempt_id) is not None
    _set_claim(attempt_id, 0)
    graded = _count(monkeypatch, service, "grade_attempt")

    data, _ = _submit(attempt_id, owner)  # today: 409; proposed: "still grading", no work
    assert graded == []
    assert data["status"] == "submitted" and data["grading"] == "pending"


# ── A: two graders of one attempt ─────────────────────────────────────────
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
    assert _row(attempt_id)["status"] == "graded"


def test_mastery_rows_are_exactly_the_snapshot_of_the_stored_grades(owner):
    """Exactly once, observable: one row per concept, matching the saved verdicts."""
    attempt_id = _answered_attempt(owner)
    _submit(attempt_id, owner)
    rows = _masteries(attempt_id)
    assert len(rows) == len({r["concept_name"] for r in rows}) == 1
    assert rows[0]["correct_count"] == 1 and rows[0]["total_count"] == 2


# ── recovery sweep (proposed `attempts_uc.recover_grading`) ───────────────
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

    report = attempts_uc.recover_grading(older_than_s=0, limit=10)  # proposed API

    assert _row(stale)["status"] == "graded"
    assert _row(live)["status"] == "submitted"
    assert _row(done) == done_before
    assert graded == [stale], "only the stale attempt is graded again"
    assert _masteries(no_mastery), "missing mastery is rebuilt without regrading"
    assert report["regraded"] == 1 and report["mastery_repaired"] == 1
