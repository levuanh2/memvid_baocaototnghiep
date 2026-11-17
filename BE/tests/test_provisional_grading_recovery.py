"""A provisional result (AI grader failed on some short answers) can be regraded.

When the model fails on a short answer, grading still finishes: the attempt is `graded`
with `ungraded_count > 0` and `grading_complete = false`, the learner sees "Kết quả tạm
thời", and those answers keep `verdict = None`. Before this change nothing could ever
grade them again: a submit of a graded attempt answers 200 with the stored result.

Owner-approved 2026-11-17 (provisional grading recovery, stacked on #188): a regrade of
exactly those answers, under the same claim, retry cap and job fencing as #188, keeping
the provisional result visible until the regrade succeeds.

PostgreSQL only (row locks). No LLM: short answers go to a fake `grade_short_answer`
that returns None (what the real one returns on a provider failure) for the questions
listed in `fake.fail`, and a guard fails the test if a real model is reached.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from tests.test_attempt_submit_concurrency import (  # noqa: F401  (owner = fixture)
    _run_together, owner, pytestmark)

SA_OK, SA_FLAKY = "Cau 2?", "Cau 3?"


class _FakeGrader:
    def __init__(self):
        self.calls = []
        self.fail = set()

    def __call__(self, **kw):
        q = kw.get("question")
        self.calls.append(q)
        if q in self.fail:
            return None   # what grade_short_answer returns when the provider fails
        return {"verdict": "correct", "score": 1.0, "feedback": f"ok {q}",
                "missing_points": []}


@pytest.fixture(autouse=True)
def fake(monkeypatch):
    from app.domains.attempts import grading

    g = _FakeGrader()
    monkeypatch.setattr(grading, "grade_short_answer", g)
    import app.clients.llm_factory as llm_factory
    monkeypatch.setattr(llm_factory, "ask_ai",
                        lambda *a, **k: pytest.fail("real LLM reached"), raising=False)
    for name in ("GRADING_RECOVERY_ENABLED", "GRADING_RECOVERY_DRY_RUN",
                 "GRADING_MANUAL_RETRY_MAX"):
        monkeypatch.delenv(name, raising=False)
    return g


class _Recorder:
    def __init__(self):
        self.calls = []

    def __call__(self, job_id, attempt_id, user_id):
        self.calls.append((job_id, attempt_id, user_id))


def _quiz(owner):
    from app.domains.documents import repository as docs_repo
    from app.domains.quiz import repository as quiz_repo

    doc_id = str(uuid.uuid4())
    docs_repo.create(document_id=doc_id, filename=f"pv_{doc_id[:6]}.md", file_type="md",
                     file_path=f"/tmp/pv_{doc_id[:6]}.md", user_id=owner)
    quiz_id = quiz_repo.create_quiz(
        user_id=owner, document_id=doc_id, title="Quiz tam",
        scope={"type": "full_document", "section_ids": []},
        question_count=3, difficulty="easy")
    base = {"explanation": "x", "difficulty": "easy", "chunk_ids": []}
    quiz_repo.save_questions(quiz_id, [
        {**base, "question_type": "multiple_choice", "options": ["dung", "sai"],
         "correct_answer": "dung", "question_text": "Cau 1?", "concept_tags": ["khai niem"]},
        {**base, "question_type": "short_answer", "options": None,
         "correct_answer": "mot", "question_text": SA_OK, "concept_tags": ["khai niem"]},
        {**base, "question_type": "short_answer", "options": None,
         "correct_answer": "hai", "question_text": SA_FLAKY, "concept_tags": ["khai niem"]},
    ])
    quiz_repo.finish(quiz_id, "ready", question_count=3)
    return quiz_id, [x["question_id"] for x in quiz_repo.get_quiz(quiz_id)["questions"]]


def _run_job(job_id, attempt_id, user_id):
    from app.application.short_answer_grading import run_short_answer_grading_job

    run_short_answer_grading_job(job_id, attempt_id, user_id)


def _provisional(owner, fake):
    """Submit, then run the grading job with the model failing on SA_FLAKY."""
    from app.application import attempts as attempts_uc
    from app.domains.attempts import repository

    quiz_id, qids = _quiz(owner)
    attempt_id = repository.open_attempt(quiz_id, owner)["attempt_id"]
    repository.save_draft_answers(attempt_id, {qids[0]: "dung", qids[1]: "tl mot",
                                               qids[2]: "tl hai"})
    rec = _Recorder()
    _, accepted = attempts_uc.submit_attempt(attempt_id, owner, bat_buoc_chu_so_huu=True,
                                             dispatch_grading=rec)
    assert accepted and len(rec.calls) == 1
    fake.fail = {SA_FLAKY}
    _run_job(*rec.calls[0])
    fake.calls.clear()
    fake.fail = set()
    return attempt_id, qids


def _regrade(attempt_id, user_id, dispatch, protect=True):
    from app.application import attempts as attempts_uc

    return attempts_uc.regrade_provisional(attempt_id, user_id, bat_buoc_chu_so_huu=protect,
                                           dispatch_grading=dispatch)


def _result(attempt_id, user_id):
    from app.application import attempts as attempts_uc

    return attempts_uc.results(attempt_id, user_id, bat_buoc_chu_so_huu=True)


def _answers(attempt_id):
    """The stored answer rows, read from the table (graded_at is not in the API)."""
    from sqlalchemy import select

    from app.db import session_scope
    from app.db.models import QuizAnswer

    keys = ("verdict", "score", "feedback", "graded_at", "user_answer")
    with session_scope() as s:
        rows = s.execute(select(QuizAnswer).where(QuizAnswer.attempt_id == attempt_id)
                         ).scalars().all()
        return {r.question_id: {k: getattr(r, k) for k in keys} for r in rows}


def _set_claim(attempt_id, age_s):
    from app.db import session_scope
    from app.db.models import QuizAttempt

    with session_scope() as s:
        s.get(QuizAttempt, attempt_id).grading_claimed_at = (
            datetime.now(timezone.utc) - timedelta(seconds=age_s))


def _lease_s():
    from app.domains.attempts.repository import grading_lease_s

    return grading_lease_s()


# ── the state the learner is in today ──────────────────────────────────────

def test_a_failed_short_answer_leaves_a_provisional_result_with_a_regrade_offer(owner, fake):
    attempt_id, qids = _provisional(owner, fake)
    r = _result(attempt_id, owner)
    assert r["status"] == "graded"
    assert r["ungraded_count"] == 1 and r["grading_complete"] is False
    assert (r["score"], r["max_score"]) == (2.0, 2.0)      # the two graded answers only
    by_q = {q["question_id"]: q for q in r["questions"]}
    assert by_q[qids[2]]["verdict"] is None
    assert r["regrade_state"] == "available"


def test_a_complete_result_offers_no_regrade(owner, fake):
    attempt_id, _ = _provisional(owner, fake)
    rec = _Recorder()
    _regrade(attempt_id, owner, rec)
    _run_job(*rec.calls[0])
    assert _result(attempt_id, owner)["regrade_state"] is None


# ── the regrade ───────────────────────────────────────────────────────────

def test_regrade_is_accepted_at_once_after_grading(owner, fake):
    """The first grader's claim must not survive its own result: right after a
    provisional grading the regrade starts a job (202), it is not a ghost "pending"."""
    attempt_id, _ = _provisional(owner, fake)
    rec = _Recorder()
    body, accepted = _regrade(attempt_id, owner, rec)
    assert accepted and body["grading"] == "pending" and body["job_id"]
    assert [c[0] for c in rec.calls] == [body["job_id"]]


def test_regrade_grades_only_the_ungraded_answer(owner, fake):
    attempt_id, qids = _provisional(owner, fake)
    before = _answers(attempt_id)
    rec = _Recorder()
    _regrade(attempt_id, owner, rec)
    _run_job(*rec.calls[0])

    assert fake.calls == [SA_FLAKY], "the model is called for the ungraded answer only"
    after = _answers(attempt_id)
    for q in qids[:2]:   # answers that had a verdict are untouched
        for key in ("verdict", "score", "feedback", "graded_at", "user_answer"):
            assert after[q][key] == before[q][key], (q, key)
    assert after[qids[2]]["verdict"] == "correct"
    assert after[qids[2]]["user_answer"] == before[qids[2]]["user_answer"] == "tl hai"
    r = _result(attempt_id, owner)
    assert r["status"] == "graded" and r["ungraded_count"] == 0
    assert r["grading_complete"] is True
    assert (r["score"], r["max_score"], r["correct_count"]) == (3.0, 3.0, 3)


def test_a_regrade_that_fails_again_keeps_the_provisional_result(owner, fake):
    attempt_id, qids = _provisional(owner, fake)
    before = _result(attempt_id, owner)
    rec = _Recorder()
    _regrade(attempt_id, owner, rec)
    fake.fail = {SA_FLAKY}
    _run_job(*rec.calls[0])
    r = _result(attempt_id, owner)
    assert r["status"] == "graded" and r["ungraded_count"] == 1
    assert (r["score"], r["max_score"]) == (before["score"], before["max_score"])
    assert r["regrade_state"] == "available"   # another retry is allowed, at once


def test_a_crashing_regrade_job_keeps_the_result_and_frees_the_attempt(owner, fake,
                                                                       monkeypatch):
    attempt_id, _ = _provisional(owner, fake)
    before = _result(attempt_id, owner)
    rec = _Recorder()
    _regrade(attempt_id, owner, rec)

    def _boom(**_kw):
        raise RuntimeError("worker died")

    from app.domains.attempts import grading
    monkeypatch.setattr(grading, "grade_short_answer", _boom)
    _run_job(*rec.calls[0])
    r = _result(attempt_id, owner)
    assert r["status"] == "graded"
    assert (r["score"], r["ungraded_count"]) == (before["score"], 1)
    assert r["regrade_state"] == "available"


def test_a_complete_attempt_answers_200_with_the_stored_result(owner, fake):
    attempt_id, _ = _provisional(owner, fake)
    rec = _Recorder()
    _regrade(attempt_id, owner, rec)
    _run_job(*rec.calls[0])
    stored = _result(attempt_id, owner)
    rec2 = _Recorder()
    body, accepted = _regrade(attempt_id, owner, rec2)
    assert accepted is False and rec2.calls == []
    assert body["grading"] == "done"
    assert (body["score"], body["graded_at"]) == (stored["score"], stored["graded_at"])


def test_a_regrade_while_its_job_is_queued_is_202_without_a_second_job(owner, fake):
    attempt_id, _ = _provisional(owner, fake)
    rec = _Recorder()
    first, _ = _regrade(attempt_id, owner, rec)
    again, accepted = _regrade(attempt_id, owner, rec)
    assert accepted and again["grading"] == "pending"
    assert again["job_id"] == first["job_id"]
    assert len(rec.calls) == 1
    assert _result(attempt_id, owner)["regrade_state"] == "running"


def test_concurrent_regrades_dispatch_one_job(owner, fake):
    attempt_id, _ = _provisional(owner, fake)
    rec = _Recorder()
    out = _run_together(lambda: _regrade(attempt_id, owner, rec), n=4)
    assert all(kind == "ok" for kind, _ in out), out
    assert len(rec.calls) == 1
    assert {r[0]["job_id"] for _, r in out} == {rec.calls[0][0]}


def test_used_up_retries_end_in_409_and_keep_the_provisional_result(owner, fake,
                                                                    monkeypatch):
    from app.application import attempts as attempts_uc

    monkeypatch.setenv("GRADING_MANUAL_RETRY_MAX", "2")
    attempt_id, _ = _provisional(owner, fake)
    before = _result(attempt_id, owner)
    fake.fail = {SA_FLAKY}
    for _ in range(2):
        rec = _Recorder()
        _, accepted = _regrade(attempt_id, owner, rec)
        assert accepted
        _run_job(*rec.calls[0])
    fake.calls.clear()
    rec = _Recorder()
    with pytest.raises(attempts_uc.HetLuotChamLai):
        _regrade(attempt_id, owner, rec)
    assert rec.calls == [] and fake.calls == []
    r = _result(attempt_id, owner)
    assert r["regrade_state"] == "exhausted"
    assert (r["status"], r["score"], r["ungraded_count"]) == ("graded", before["score"], 1)


def test_another_learner_gets_404(owner, fake):
    from app.application import attempts as attempts_uc

    attempt_id, _ = _provisional(owner, fake)
    rec = _Recorder()
    with pytest.raises(attempts_uc.AttemptKhongTonTai):
        _regrade(attempt_id, str(uuid.uuid4()), rec)
    assert rec.calls == []


def test_attempts_that_are_not_provisional_are_refused(owner, fake):
    from app.application import attempts as attempts_uc
    from app.domains.attempts import repository

    quiz_id, _ = _quiz(owner)
    attempt_id = repository.open_attempt(quiz_id, owner)["attempt_id"]
    rec = _Recorder()
    with pytest.raises(attempts_uc.AttemptError) as err:
        _regrade(attempt_id, owner, rec)
    assert not isinstance(err.value, attempts_uc.AttemptKhongTonTai)
    assert rec.calls == []


# ── fencing: old and duplicated jobs ──────────────────────────────────────

def test_a_redelivered_first_grading_job_does_not_regrade(owner, fake):
    """The job that produced the provisional result, delivered again by the queue,
    must not regrade for free (it is not the registered regrade job)."""
    from app.domains.attempts import repository

    quiz_id, qids = _quiz(owner)
    attempt_id = repository.open_attempt(quiz_id, owner)["attempt_id"]
    repository.save_draft_answers(attempt_id, {qids[0]: "dung", qids[1]: "a", qids[2]: "b"})
    from app.application import attempts as attempts_uc
    rec = _Recorder()
    attempts_uc.submit_attempt(attempt_id, owner, bat_buoc_chu_so_huu=True,
                               dispatch_grading=rec)
    fake.fail = {SA_FLAKY}
    _run_job(*rec.calls[0])
    fake.calls.clear()
    fake.fail = set()
    _run_job(*rec.calls[0])
    assert fake.calls == []
    assert _result(attempt_id, owner)["ungraded_count"] == 1


def test_a_stale_regrade_job_is_superseded_before_any_model_call(owner, fake):
    attempt_id, _ = _provisional(owner, fake)
    rec = _Recorder()
    _regrade(attempt_id, owner, rec)               # job 1, never started (queue lost it)
    from app.domains.jobs.jobs_store import update_job
    update_job(rec.calls[0][0], status="error", error_text="lost")
    _set_claim(attempt_id, _lease_s() + 5)
    _regrade(attempt_id, owner, rec)               # job 2 takes over
    assert len(rec.calls) == 2
    _run_job(*rec.calls[0])                        # job 1 arrives late
    assert fake.calls == []
    _run_job(*rec.calls[1])
    assert fake.calls == [SA_FLAKY]
    assert _result(attempt_id, owner)["grading_complete"] is True


# ── mastery and progress follow the completed result ──────────────────────

def test_mastery_counts_the_regraded_answer(owner, fake):
    from app.domains.gap_analysis import service as gap

    attempt_id, _ = _provisional(owner, fake)
    before = {m["concept_name"]: m for m in gap.list_for_attempt(attempt_id)}
    assert before["khai niem"]["total_count"] == 2   # the ungraded answer is left out
    rec = _Recorder()
    _regrade(attempt_id, owner, rec)
    _run_job(*rec.calls[0])
    after = {m["concept_name"]: m for m in gap.list_for_attempt(attempt_id)}
    assert after["khai niem"]["total_count"] == 3
    assert after["khai niem"]["correct_count"] == 3
