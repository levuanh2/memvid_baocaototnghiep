"""Đọc/ghi `quiz_attempts` / `quiz_answers` (đặc tả 5.12, 5.13)."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import Integer, and_, func, or_, select, text
from sqlalchemy.exc import IntegrityError

from app.db import session_scope
from app.db.models import Quiz, QuizAnswer, QuizAttempt, QuizQuestion


def grading_complete_clause():
    """SQL predicate: no answer of the attempt is left ungraded.

    Rows written before `metadata_json.ungraded_count` existed count as complete.
    Shared by every consumer that must not treat a provisional (AI-outage)
    attempt as finished: progress average, completion rate, Library counts."""
    return func.coalesce(
        QuizAttempt.metadata_json["ungraded_count"].astext.cast(Integer), 0
    ) == 0


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _f(value) -> Optional[float]:
    return None if value is None else float(value)


def _lock_quiz(s, quiz_id: str):
    """Row lock on the quiz until this transaction ends; returns `question_count`.

    Serialises "look for an attempt, then create or submit one" per quiz. Without it two
    requests both see no `in_progress` attempt and both insert one, or both see nothing
    submitted yet and both grade (known-issues 2026-11-14).
    """
    return s.execute(
        select(Quiz.question_count).where(Quiz.id == str(quiz_id)).with_for_update()
    ).scalar()


def _upsert_answers(s, attempt_id: str, answers: Dict[str, Optional[str]]) -> None:
    rows = {r.question_id: r for r in s.execute(
        select(QuizAnswer).where(
            QuizAnswer.attempt_id == str(attempt_id),
            QuizAnswer.question_id.in_([str(q) for q in answers]),
        )
    ).scalars().all()}
    for question_id, value in answers.items():
        text = None if value is None else str(value)
        row = rows.get(str(question_id))
        if row is None:
            s.add(QuizAnswer(id=str(uuid.uuid4()), attempt_id=str(attempt_id),
                             question_id=str(question_id), user_answer=text))
        else:
            row.user_answer = text


def _mark_submitted(a: QuizAttempt, now: datetime) -> None:
    a.status = "submitted"
    a.submitted_at = now
    started = a.started_at
    if started is not None:
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        a.duration_seconds = max(0, int((now - started).total_seconds()))


def open_attempt(quiz_id: str, user_id: Optional[str]) -> Dict[str, Any]:
    """Tạo attempt lúc MỞ quiz (FR-07.10), không đợi nộp.

    Đang có attempt `in_progress` thì trả lại chính nó: mỗi lần F5 mà đẻ một attempt mới
    thì thống kê tiến bộ (Phase 7) đếm toàn bài dở.

    `user_id` None = chế độ mở → gắn vào user ẩn danh, GIẢI MỘT LẦN rồi dùng cho cả
    truy vấn tra attempt đang mở lẫn hàng ghi mới. Hai chỗ dùng hai giá trị khác nhau
    thì lần F5 nào cũng đẻ attempt mới. (`str(None)` ra chuỗi `"None"`, không phải NULL —
    Postgres từ chối với `invalid input syntax for type uuid`.)
    """
    from app.domains.documents.repository import ensure_anonymous_user

    owner = str(user_id) if user_id else ensure_anonymous_user()
    with session_scope() as s:
        total = int(_lock_quiz(s, quiz_id) or 0)
        existing = s.execute(
            select(QuizAttempt).where(
                QuizAttempt.quiz_id == str(quiz_id),
                QuizAttempt.user_id == owner,
                QuizAttempt.status == "in_progress",
            ).order_by(QuizAttempt.started_at.desc()).limit(1)
        ).scalar_one_or_none()
        if existing is not None:
            return {"attempt_id": existing.id, "created": False}

        attempt_id = str(uuid.uuid4())
        s.add(QuizAttempt(
            id=attempt_id, quiz_id=str(quiz_id), user_id=owner,
            total_questions=total, max_score=float(total), status="in_progress",
        ))
        return {"attempt_id": attempt_id, "created": True}


def get_attempt(attempt_id: str) -> Optional[Dict[str, Any]]:
    """Attempt kèm câu trả lời. `user_id` trả kèm để route kiểm quyền."""
    with session_scope() as s:
        a = s.get(QuizAttempt, str(attempt_id))
        if a is None:
            return None
        answers = s.execute(
            select(QuizAnswer).where(QuizAnswer.attempt_id == a.id)
        ).scalars().all()
        answered = {r.question_id for r in answers if (r.user_answer or "").strip()}
        question_ids = list(s.execute(
            select(QuizQuestion.id).where(QuizQuestion.quiz_id == a.quiz_id)
            .order_by(QuizQuestion.order_index)
        ).scalars().all())
        return {
            "attempt_id": a.id,
            "quiz_id": a.quiz_id,
            "user_id": a.user_id,
            "status": a.status,
            "total_questions": a.total_questions,
            "score": _f(a.score),
            "max_score": _f(a.max_score),
            "percentage": _f(a.percentage),
            "correct_count": a.correct_count,
            "incorrect_count": a.incorrect_count,
            "duration_seconds": a.duration_seconds,
            "started_at": a.started_at.isoformat() if a.started_at else None,
            "submitted_at": a.submitted_at.isoformat() if a.submitted_at else None,
            "graded_at": a.graded_at.isoformat() if a.graded_at else None,
            "metadata": a.metadata_json,
            # FR-07.6: FE cần biết còn câu nào bỏ trống để cảnh báo TRƯỚC khi nộp.
            "unanswered_question_ids": [q for q in question_ids if q not in answered],
            "answers": [{
                "question_id": r.question_id,
                "user_answer": r.user_answer,
                "verdict": r.verdict,
                "is_correct": r.is_correct,
                "score": _f(r.score),
                "feedback": r.feedback,
            } for r in answers],
        }


def question_ids_of_quiz(quiz_id: str) -> List[str]:
    with session_scope() as s:
        return list(s.execute(
            select(QuizQuestion.id).where(QuizQuestion.quiz_id == str(quiz_id))
        ).scalars().all())


def save_draft_answers(attempt_id: str, answers: Dict[str, Optional[str]]) -> Optional[int]:
    """Lưu nháp (FR-07.11). Gọi lại cho cùng câu thì GHI ĐÈ, không tạo dòng thứ hai.

    UNIQUE `(attempt_id, question_id)` là thứ chặn double-answer, nên ở đây phải
    update-or-insert chứ không insert mù.
    """
    if not answers:
        return 0
    with session_scope() as s:
        # Re-check under the row lock `submit` takes: the caller's `in_progress` check ran
        # in an earlier transaction, and a submit (and grading) may have committed since.
        # Writing anyway changed a graded attempt's answers without regrading it.
        a = s.get(QuizAttempt, str(attempt_id), with_for_update=True)
        if a is None or a.status != "in_progress":
            return None
        _upsert_answers(s, attempt_id, answers)
    return len(answers)


def submit(attempt_id: str) -> Optional[Dict[str, Any]]:
    """`in_progress` sang `submitted` (FR-07.12) + `duration_seconds` (FR-07.13).

    Trả None khi attempt không còn `in_progress` — route đổi thành 409. Nộp hai lần
    không được phép ghi đè `submitted_at`, nếu không thời lượng làm bài sai.

    `FOR UPDATE`: hai request cùng lúc trước đây cùng đọc `in_progress` rồi cùng chấm.
    Có khoá hàng, request thứ hai chờ tới khi request đầu commit rồi đọc `submitted`.

    The same transaction takes the grading claim (`grading_claimed_at`), and returns it
    as `claimed_at` so a failed grader releases exactly its own claim (diagnostic
    recovery, 2026-11-17; the practice route has done this since #185).
    """
    with session_scope() as s:
        a = s.get(QuizAttempt, str(attempt_id), with_for_update=True)
        if a is None or a.status != "in_progress":
            return None
        now = _now()
        _mark_submitted(a, now)
        a.grading_claimed_at = now
        return {"attempt_id": a.id, "quiz_id": a.quiz_id, "status": a.status,
                "duration_seconds": a.duration_seconds, "claimed_at": now}


# Keyless requests only (clients older than the Idempotency-Key change): a replay is
# "same answers, same quiz, same learner, within this window". It guesses; the key does
# not. ponytail: delete with the keyless path once no deployed client omits the key.
PRACTICE_REPLAY_WINDOW_S = 30

# A grader that died (process killed, deploy) leaves `grading_claimed_at` set and the
# attempt `submitted`. After this lease a retry with the same key may grade it.
# ponytail: a fixed lease; if grading can legitimately run longer, the second grader still
# cannot write twice (`save_grades(once=True)`), it only spends a second LLM pass.
GRADING_LEASE_S = 300


def grading_lease_s() -> int:
    """The lease actually used: at least `GRADING_LEASE_S`, and always longer than ONE
    model call plus its queue wait plus a margin, whatever the configuration says. A live
    grader renews its claim only between answers, so a call longer than the lease would
    let a retry or a redelivery start a second grader (Codex re-check 3 of #188)."""
    import os

    def _num(name: str, default: float) -> float:
        try:
            return float((os.getenv(name) or "").strip() or default)
        except ValueError:
            return default

    one_call = _num("GRADE_LLM_TIMEOUT_SEC", 120.0) + _num("LLM_QUEUE_WAIT_TIMEOUT_SECONDS", 30.0)
    return int(max(GRADING_LEASE_S, one_call + 60))


class SubmitKeyMismatch(Exception):
    """The key was already used for a different quiz or different answers."""


def submit_fingerprint(quiz_id: str, answers: Dict[str, Optional[str]]) -> str:
    body = json.dumps({"quiz_id": str(quiz_id),
                       "answers": {str(k): (None if v is None else str(v))
                                   for k, v in answers.items()}},
                      sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _aware(ts: Optional[datetime]) -> Optional[datetime]:
    return ts.replace(tzinfo=timezone.utc) if ts is not None and ts.tzinfo is None else ts


def _claim_grading(a: QuizAttempt, now: datetime) -> bool:
    claimed = _aware(a.grading_claimed_at)
    if claimed is not None and now - claimed < timedelta(seconds=grading_lease_s()):
        return False
    a.grading_claimed_at = now
    return True


def release_grading_claim(attempt_id: str, claimed_at: Optional[datetime]) -> None:
    """Grading failed in THIS process: let the next retry grade at once.

    Only our own claim: if the lease ran out and another request reclaimed the attempt,
    its newer `grading_claimed_at` must stay (Codex review of #185).
    """
    with session_scope() as s:
        a = s.get(QuizAttempt, str(attempt_id), with_for_update=True)
        if (a is not None and a.status == "submitted" and claimed_at is not None
                and _aware(a.grading_claimed_at) == _aware(claimed_at)):
            a.grading_claimed_at = None


# ── Diagnostic grading recovery (2026-11-17) ──────────────────────────────
# A diagnostic attempt is `submitted` before it is graded. A crash or a grading error in
# between used to leave it there for good: a second submit answered 409 and nothing ever
# looked at it again. These functions reuse the practice claim (`grading_claimed_at`,
# `GRADING_LEASE_S`, `save_grades(once=True)`): whoever holds a live claim, or whose
# grading job is still queued or running, is the only grader.

def _grading_job_id(a: QuizAttempt) -> Optional[str]:
    return (a.metadata_json or {}).get("grading_job_id")


def reclaim_for_retry(attempt_id: str, *, job_active=lambda _job_id: False,
                      max_retries: Optional[int] = None) -> Tuple[str, Optional[datetime]]:
    """Outcome of a submit on an attempt that is no longer `in_progress`.

    ("graded", None) | ("pending", None): a grader holds a live claim, or its job is still
    queued/running | ("grade", claimed_at): the claim was free or expired, it is ours now
    | ("exhausted", None): `max_retries` learner retries already used (each regrade of
    short answers costs LLM calls) | ("refused", None): cancelled or gone. Row lock: two
    retries cannot both grade, and the retry counter cannot be raced.
    """
    with session_scope() as s:
        a = s.get(QuizAttempt, str(attempt_id), with_for_update=True)
        if a is None or a.status not in ("submitted", "graded"):
            return "refused", None
        if a.status == "graded":
            return "graded", None
        if job_active(_grading_job_id(a)):
            return "pending", None
        now = _now()
        outcome = _take_retry(s, a, now, max_retries)
        return outcome, (now if outcome == "grade" else None)


def _has_short_answer(s, quiz_id: str) -> bool:
    """In the caller's session: no second connection while a row lock is held."""
    return s.execute(select(QuizQuestion.id).where(
        QuizQuestion.quiz_id == str(quiz_id),
        QuizQuestion.question_type == "short_answer").limit(1)).first() is not None


def _take_retry(s, a: QuizAttempt, now: datetime, max_retries: Optional[int]) -> str:
    """Under the row lock: "grade" (claim taken, one retry counted) | "pending" (a live
    claim exists) | "exhausted" (`max_retries` already used). Shared by the diagnostic
    and practice routes. The cap protects LLM cost, so it applies only to a quiz with
    short answers, decided here in the same session (Codex task25 re-checks). Taking the
    claim clears the old job's running marker: a grader that outlived its lease can no
    longer renew or release the new claim, and stops before its next model call."""
    claimed = _aware(a.grading_claimed_at)
    if claimed is not None and now - claimed < timedelta(seconds=grading_lease_s()):
        return "pending"
    used = int((a.metadata_json or {}).get("manual_retries") or 0)
    if (max_retries is not None and used >= max_retries
            and _has_short_answer(s, a.quiz_id)):
        return "exhausted"
    a.grading_claimed_at = now
    meta = {k: v for k, v in (a.metadata_json or {}).items() if k != "grading_job_running"}
    a.metadata_json = {**meta, "manual_retries": used + 1}
    return "grade"


def start_grading_job(attempt_id: str, job_id: str) -> Tuple[str, Optional[datetime]]:
    """A grading job about to grade. The claim must fence the LLM work, not only the
    final write (Codex task25): a stale or duplicated job used to renew the claim and
    pay for every model call before `save_grades(once=True)` threw its result away.

    ("run", claimed_at): this job is THE grader, claim renewed | ("superseded", None):
    another job is registered for the attempt, or another job is running it under a live
    claim | ("duplicate", None): this same job is already running elsewhere (a queue
    delivered it twice) | ("done", None): the attempt is no longer `submitted`.
    """
    with session_scope() as s:
        a = s.get(QuizAttempt, str(attempt_id), with_for_update=True)
        if a is None:
            return "done", None
        meta = dict(a.metadata_json or {})
        if a.status == "graded":
            # A provisional result is regraded only by the job its regrade registered;
            # the job that produced the result, delivered again, must not regrade free.
            if not (_ungraded(a) and meta.get("regrade_job_id") == job_id):
                return "done", None
            role = "regrade"
        elif a.status != "submitted":
            return "done", None
        else:
            role = "run"
            registered = meta.get("grading_job_id")
            if registered and registered != job_id:
                return "superseded", None
        now = _now()
        claimed = _aware(a.grading_claimed_at)
        live = claimed is not None and now - claimed < timedelta(seconds=grading_lease_s())
        running = meta.get("grading_job_running")
        if live and running:
            return ("duplicate" if running == job_id else "superseded"), None
        a.grading_claimed_at = now
        a.metadata_json = {**meta, "grading_job_running": job_id}
        return role, now


def release_job_claim(attempt_id: str, job_id: str) -> None:
    """The running job failed: free the attempt for a retry at once. By job, not by
    timestamp: the heartbeat moved the claim since the job started."""
    with session_scope() as s:
        a = s.get(QuizAttempt, str(attempt_id), with_for_update=True)
        if a is None or (a.metadata_json or {}).get("grading_job_running") != job_id:
            return
        a.grading_claimed_at = None
        a.metadata_json = {k: v for k, v in (a.metadata_json or {}).items()
                           if k != "grading_job_running"}


def renew_claim(attempt_id: str, job_id: str) -> bool:
    """Heartbeat of the running grader, between answers: keeps its claim live through a
    long grading so a retry or a redelivery does not take over. Only the job that is
    running the attempt may renew (fenced like `start_grading_job`)."""
    with session_scope() as s:
        a = s.get(QuizAttempt, str(attempt_id), with_for_update=True)
        if (a is None or a.status not in ("submitted", "graded")
                or (a.metadata_json or {}).get("grading_job_running") != job_id):
            return False
        a.grading_claimed_at = _now()
        return True


def set_grading_job(attempt_id: str, job_id: str, claimed_at: Optional[datetime]) -> bool:
    """Register the job that will grade the attempt, only while the caller still holds
    the claim it took (`claimed_at`). False: the claim was lost (lease expired and a
    retry reclaimed it); the caller must not dispatch."""
    with session_scope() as s:
        a = s.get(QuizAttempt, str(attempt_id), with_for_update=True)
        if (a is None or a.status != "submitted" or claimed_at is None
                or _aware(a.grading_claimed_at) != _aware(claimed_at)):
            return False
        meta = {k: v for k, v in (a.metadata_json or {}).items() if k != "grading_job_running"}
        a.metadata_json = {**meta, "grading_job_id": job_id}
        return True


def abandon_job(attempt_id: str, job_id: str, claimed_at: Optional[datetime], *,
                refund: Optional[str] = None) -> None:
    """The queue refused the job: nothing was accepted. Forget the job (no ghost
    `pending` that turns the next retry into a false 202), release our claim, and give
    back the retry it counted (`refund` = "manual_retries" | "recovery_attempts")."""
    with session_scope() as s:
        a = s.get(QuizAttempt, str(attempt_id), with_for_update=True)
        if a is None:
            return
        meta = dict(a.metadata_json or {})
        for key in ("grading_job_id", "regrade_job_id"):
            if meta.get(key) == job_id:
                meta.pop(key, None)
        if refund and int(meta.get(refund) or 0) > 0:
            meta[refund] = int(meta[refund]) - 1
        a.metadata_json = meta
        if claimed_at is not None and _aware(a.grading_claimed_at) == _aware(claimed_at):
            a.grading_claimed_at = None


def grading_state(attempt_id: str, *, job_active=lambda _job_id: False,
                  max_retries: Optional[int] = None) -> Optional[str]:
    """"graded" | "grading" (live claim or active job) | "stalled" (submitted, nobody
    grading: a retry may grade it) | "failed" (stalled and the learner's retries are used
    up) | the raw status otherwise. Read-only."""
    with session_scope() as s:
        a = s.get(QuizAttempt, str(attempt_id))
        if a is None:
            return None
        if a.status != "submitted":
            return a.status
        claimed = _aware(a.grading_claimed_at)
        live = claimed is not None and _now() - claimed < timedelta(seconds=grading_lease_s())
        if live or job_active(_grading_job_id(a)):
            return "grading"
        used = int((a.metadata_json or {}).get("manual_retries") or 0)
        capped = (max_retries is not None and used >= max_retries
                  and _has_short_answer(s, a.quiz_id))
        return "failed" if capped else "stalled"


# ── Provisional grading recovery (owner-approved 2026-11-17) ──────────────
# When the model fails on a short answer, grading still finishes: the attempt is
# `graded`, those answers keep `verdict=None` and `ungraded_count` counts them (the
# "Kết quả tạm thời" result). These functions regrade exactly those answers, under the
# same claim, lease, retry cap (`manual_retries`) and job fencing as the diagnostic
# recovery above, without ever leaving `graded`: the provisional result stays readable
# until the regrade writes a better one.

def _ungraded(a: QuizAttempt) -> int:
    try:
        return int((a.metadata_json or {}).get("ungraded_count") or 0)
    except (TypeError, ValueError):
        return 0


def reclaim_for_regrade(attempt_id: str, job_id: str, *, job_active=lambda _job_id: False,
                        max_retries: Optional[int] = None
                        ) -> Tuple[str, Optional[datetime], Optional[str]]:
    """(outcome, claimed_at, regrade_job_id) under the row lock.

    "refused": not graded (in progress, submitted, cancelled) | "graded": nothing left
    to regrade | "pending": a regrade holds a live claim or its job is queued/running |
    "exhausted": `max_retries` learner retries already used | "grade": the claim is ours
    and `job_id` is registered as THE regrade job, in the same transaction, so a second
    request sees it at once and answers with it."""
    with session_scope() as s:
        a = s.get(QuizAttempt, str(attempt_id), with_for_update=True)
        if a is None or a.status != "graded":
            return "refused", None, None
        if not _ungraded(a):
            return "graded", None, None
        registered = (a.metadata_json or {}).get("regrade_job_id")
        if job_active(registered):
            return "pending", None, registered
        now = _now()
        outcome = _take_retry(s, a, now, max_retries)
        if outcome != "grade":
            return outcome, None, registered
        a.metadata_json = {**(a.metadata_json or {}), "regrade_job_id": job_id}
        return "grade", now, job_id


def regrade_state(attempt_id: str, *, job_active=lambda _job_id: False,
                  max_retries: Optional[int] = None) -> Optional[str]:
    """None (nothing to regrade) | "running" | "exhausted" | "available". Read-only."""
    with session_scope() as s:
        a = s.get(QuizAttempt, str(attempt_id))
        if a is None or a.status != "graded" or not _ungraded(a):
            return None
        meta = a.metadata_json or {}
        claimed = _aware(a.grading_claimed_at)
        if ((claimed is not None and _now() - claimed < timedelta(seconds=grading_lease_s()))
                or job_active(meta.get("regrade_job_id"))):
            return "running"
        used = int(meta.get("manual_retries") or 0)
        if max_retries is not None and used >= max_retries:
            return "exhausted"
        return "available"


def save_regrade(attempt_id: str, job_id: str, regraded: Dict[str, Dict[str, Any]],
                 ) -> Optional[Dict[str, Any]]:
    """Write a regrade in ONE transaction: the answers that still have no verdict, then
    totals recomputed from every stored verdict, `ungraded_count`, and the end of the
    claim. Only the job running the regrade may write (else None). An answer that has a
    verdict is never rewritten, and `user_answer` is never touched."""
    from app.domains.attempts import grading

    now = _now()
    with session_scope() as s:
        a = s.get(QuizAttempt, str(attempt_id), with_for_update=True)
        meta = dict((a.metadata_json if a is not None else None) or {})
        if a is None or a.status != "graded" or meta.get("grading_job_running") != job_id:
            return None
        rows = s.execute(select(QuizAnswer).where(QuizAnswer.attempt_id == a.id)
                         ).scalars().all()
        changed = 0
        for row in rows:
            g = regraded.get(str(row.question_id))
            if row.verdict is not None or not g:
                continue
            row.verdict = g["verdict"]
            row.is_correct = g["verdict"] == "correct"
            row.score = g["score"]
            row.feedback = g.get("feedback")
            row.graded_at = now
            changed += 1
        t = grading.totals([{"verdict": r.verdict, "score": r.score} for r in rows],
                           a.total_questions or 0)
        a.score, a.max_score, a.percentage = t["score"], t["max_score"], t["percentage"]
        a.correct_count, a.incorrect_count = t["correct_count"], t["incorrect_count"]
        meta["ungraded_count"] = sum(1 for r in rows if r.verdict is None)
        meta.pop("grading_job_running", None)
        a.metadata_json = meta
        a.grading_claimed_at = None
        if changed:
            a.graded_at = now
        return {**t, "ungraded_count": meta["ungraded_count"], "changed": changed}


_RECOVERY_LOCK_KEY = 0x53_4D_47_52  # "SMGR": StudyMap grading recovery


def _recovery_attempts():
    return func.coalesce(
        QuizAttempt.metadata_json["recovery_attempts"].astext.cast(Integer), 0)


def claim_stuck_for_recovery(*, older_than_s: int, limit: int, max_attempts: int,
                             max_inflight: int, dry_run: bool,
                             job_active=lambda _job_id: False) -> Dict[str, Any]:
    """Pick and claim, in ONE transaction, the stuck attempts the sweep may regrade.

    Stuck = `submitted`, submitted more than `older_than_s` ago (never races a learner
    who just submitted or released a claim), claim free or expired, no active job,
    fewer than `max_attempts` recoveries so far. `FOR UPDATE SKIP LOCKED`: two sweeps
    (two web processes) never take the same row. At most `limit`, and never more than
    `max_inflight` recoveries in progress at once. `dry_run` claims nothing.
    """
    with session_scope() as s:
        # One budget for every process: two web workers used to count `inflight=0` at
        # the same time and each spend all of it (Codex task25). Released at commit.
        s.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _RECOVERY_LOCK_KEY})
        now = _now()
        lease_cutoff = now - timedelta(seconds=grading_lease_s())
        # In flight = a recovery whose claim is live OR whose job is still queued or
        # running (a claim expires during a long queue wait; the job does not).
        inflight = sum(
            1 for a in s.execute(select(QuizAttempt).where(
                QuizAttempt.status == "submitted",
                QuizAttempt.metadata_json["recovery_attempts"].isnot(None),
            )).scalars()
            if (a.grading_claimed_at is not None and _aware(a.grading_claimed_at) >= lease_cutoff)
            or job_active(_grading_job_id(a)))
        gave_up = s.execute(select(func.count()).select_from(QuizAttempt).where(
            QuizAttempt.status == "submitted", _recovery_attempts() >= max_attempts,
        )).scalar() or 0
        room = max(0, min(limit, max_inflight - inflight))
        rows = [] if room == 0 else s.execute(
            select(QuizAttempt).where(
                QuizAttempt.status == "submitted",
                QuizAttempt.submitted_at < now - timedelta(seconds=older_than_s),
                or_(QuizAttempt.grading_claimed_at.is_(None),
                    QuizAttempt.grading_claimed_at < lease_cutoff),
                _recovery_attempts() < max_attempts,
            ).order_by(QuizAttempt.submitted_at).limit(room)
            .with_for_update(skip_locked=True)
        ).scalars().all()
        picked, skipped_active = [], 0
        for a in rows:
            if job_active(_grading_job_id(a)):
                skipped_active += 1
                continue
            picked.append({"attempt_id": a.id, "quiz_id": a.quiz_id, "user_id": a.user_id,
                           "recovery_attempts": int((a.metadata_json or {}).get(
                               "recovery_attempts") or 0) + 1})
            if not dry_run:
                a.grading_claimed_at = now
                meta = {k: v for k, v in (a.metadata_json or {}).items()
                        if k != "grading_job_running"}
                a.metadata_json = {**meta,
                                   "recovery_attempts": picked[-1]["recovery_attempts"]}
        if dry_run:
            s.rollback()
        return {"picked": picked, "claimed_at": None if dry_run else now,
                "inflight": int(inflight), "gave_up": int(gave_up),
                "skipped_active_job": skipped_active}


def graded_without_mastery(*, limit: int, within_days: int = 7) -> List[str]:
    """Graded attempts with no concept-mastery rows and not yet checked: scores were
    saved, then the process died (or analysis failed) before gap analysis."""
    from app.db.models import ConceptMastery

    since = _now() - timedelta(days=within_days)
    with session_scope() as s:
        return list(s.execute(
            select(QuizAttempt.id).where(
                QuizAttempt.status == "graded",
                QuizAttempt.graded_at >= since,
                QuizAttempt.metadata_json["mastery_checked"].is_(None),
                ~select(ConceptMastery.id).where(
                    ConceptMastery.attempt_id == QuizAttempt.id).exists(),
            ).order_by(QuizAttempt.graded_at).limit(limit)
        ).scalars().all())


def mark_mastery_checked(attempt_id: str) -> None:
    """A quiz without concept tags legitimately has no mastery rows: check it once."""
    with session_scope() as s:
        a = s.get(QuizAttempt, str(attempt_id), with_for_update=True)
        if a is not None:
            a.metadata_json = {**(a.metadata_json or {}), "mastery_checked": True}


def submit_practice(quiz_id: str, user_id: Optional[str],
                    answers: Dict[str, Optional[str]], *,
                    submit_key: Optional[str] = None, max_retries: Optional[int] = None
                    ) -> Tuple[Optional[str], str, Optional[datetime]]:
    """Open, fill and submit a practice attempt in ONE transaction.

    Returns `(attempt_id, outcome, claimed_at)`; `claimed_at` is this caller's grading claim
    (only for `"grade"`), to release exactly that claim if grading fails. Outcomes:
    - `"grade"`: this caller holds the grading claim and must grade `attempt_id`
      (a new submission, or a retry of one whose grader died or failed);
    - `"done"`: the key's attempt is already graded: answer with it, grade nothing;
    - `"pending"`: the key's attempt is being graded by another request right now;
    - `"replay"` (keyless only): same answers moments ago, `attempt_id` is None;
    - `"exhausted"`: a retry of a stuck attempt after `max_retries` retries (each regrade
      of short answers costs LLM calls; the first submit is not a retry).
    Raises `SubmitKeyMismatch` when the key was used for another quiz or answer set.

    The key is scoped to the owner, so another account's key never finds this row. In
    open mode every client shares one anonymous owner: there the key itself (a random
    UUID) is what tells clients apart, so different keys never meet.
    """
    try:
        return _submit_practice(quiz_id, user_id, answers, submit_key, max_retries)
    except IntegrityError:
        # Two first submits with one key for DIFFERENT quizzes: the quiz locks do not
        # serialise them, the unique index does. The loser re-reads the winner's row.
        if not submit_key:
            raise
        return _submit_practice(quiz_id, user_id, answers, submit_key, max_retries)


def _submit_practice(quiz_id, user_id, answers, submit_key, max_retries=None):
    from app.domains.documents.repository import ensure_anonymous_user

    owner = str(user_id) if user_id else ensure_anonymous_user()
    given = {str(k): (None if v is None else str(v)) for k, v in answers.items()}
    fingerprint = submit_fingerprint(quiz_id, given)
    with session_scope() as s:
        total = int(_lock_quiz(s, quiz_id) or 0)
        now = _now()
        if submit_key:
            seen = s.execute(
                select(QuizAttempt).where(QuizAttempt.user_id == owner,
                                          QuizAttempt.submit_key == submit_key)
                .with_for_update()
            ).scalar_one_or_none()
            if seen is not None:
                if seen.submit_fingerprint != fingerprint:
                    raise SubmitKeyMismatch()
                if seen.status != "submitted":
                    return seen.id, "done", None
                outcome = _take_retry(s, seen, now, max_retries)
                return seen.id, outcome, (now if outcome == "grade" else None)
        elif user_id:
            # Open mode (no signed-in user) shares ONE anonymous owner between every
            # client: there this guess would let one person's submit block another's.
            lease_cutoff = now - timedelta(seconds=grading_lease_s())
            recent_ids = s.execute(
                select(QuizAttempt.id).where(
                    QuizAttempt.quiz_id == str(quiz_id),
                    QuizAttempt.user_id == owner,
                    or_(
                        and_(QuizAttempt.status.in_(("submitted", "graded")),
                             QuizAttempt.submitted_at >= now - timedelta(seconds=PRACTICE_REPLAY_WINDOW_S)),
                        # A grader that died leaves the attempt `submitted` with a claim that
                        # outlives the 30 s window; once its lease is over, the same answers
                        # must reclaim it instead of opening a new attempt (Codex review).
                        and_(QuizAttempt.status == "submitted",
                             or_(QuizAttempt.grading_claimed_at.is_(None),
                                 QuizAttempt.grading_claimed_at < lease_cutoff)),
                    ),
                )
            ).scalars().all()
            if recent_ids:
                # Every submit in the window, not only the newest. Grading adds a row
                # (answer None) per unanswered question; compare only real answers.
                wanted = {k: v for k, v in given.items() if v is not None}
                earlier: Dict[str, Dict[str, str]] = {}
                for r in s.execute(select(QuizAnswer).where(
                        QuizAnswer.attempt_id.in_(recent_ids))).scalars():
                    if r.user_answer is not None:
                        earlier.setdefault(r.attempt_id, {})[r.question_id] = r.user_answer
                same = [a for a in recent_ids if earlier.get(a, {}) == wanted]
                if same:
                    # A replay of an attempt whose grading failed or died must grade it,
                    # not answer 409 forever (it stayed `submitted` on #183).
                    stuck = s.execute(select(QuizAttempt).where(
                        QuizAttempt.id.in_(same), QuizAttempt.status == "submitted")
                        .with_for_update()).scalars().first()
                    if stuck is not None:
                        outcome = _take_retry(s, stuck, now, max_retries)
                        if outcome in ("grade", "exhausted"):
                            return stuck.id, outcome, (now if outcome == "grade" else None)
                    return None, "replay", None

        a = s.execute(
            select(QuizAttempt).where(
                QuizAttempt.quiz_id == str(quiz_id),
                QuizAttempt.user_id == owner,
                QuizAttempt.status == "in_progress",
            ).order_by(QuizAttempt.started_at.desc()).limit(1)
        ).scalar_one_or_none()
        if a is None:
            a = QuizAttempt(id=str(uuid.uuid4()), quiz_id=str(quiz_id), user_id=owner,
                            total_questions=total, max_score=float(total),
                            status="in_progress", started_at=now)
            s.add(a)
            s.flush()
        _upsert_answers(s, a.id, given)
        _mark_submitted(a, now)
        a.submit_key = submit_key or None
        a.submit_fingerprint = fingerprint if submit_key else None
        a.grading_claimed_at = now
        s.flush()
        return a.id, "grade", now


def save_grades(attempt_id: str, graded: List[Dict[str, Any]], totals: Dict[str, Any],
                *, status: str = "graded", ungraded_count: int = 0,
                once: bool = False) -> bool:
    """Ghi điểm từng câu + tổng kết attempt trong MỘT transaction.

    Bài học known-issues (cache hit trả rỗng): trạng thái terminal phải ghi cùng lúc với
    payload kết quả. Đặt `graded` trước rồi mới gắn điểm là mở cửa sổ cho FE poll trúng
    lúc "đã chấm xong, chưa có điểm".
    """
    now = _now()
    with session_scope() as s:
        # `once`: a second grader of the same attempt (a retry that reclaimed a lease the
        # first grader outlived) must not overwrite the result or redo gap analysis.
        a = s.get(QuizAttempt, str(attempt_id), with_for_update=once)
        if a is None or (once and a.status != "submitted"):
            return False
        rows = {r.question_id: r for r in s.execute(
            select(QuizAnswer).where(QuizAnswer.attempt_id == a.id)
        ).scalars().all()}
        for g in graded:
            question_id = str(g["question_id"])
            row = rows.get(question_id)
            if row is None:
                row = QuizAnswer(id=str(uuid.uuid4()), attempt_id=a.id,
                                 question_id=question_id, user_answer=g.get("user_answer"))
                s.add(row)
            row.verdict = g.get("verdict")
            row.is_correct = (g.get("verdict") == "correct")
            row.score = g.get("score")
            row.feedback = g.get("feedback")
            row.graded_at = now

        a.score = totals["score"]
        a.max_score = totals["max_score"]
        a.percentage = totals["percentage"]
        a.correct_count = totals["correct_count"]
        a.incorrect_count = totals["incorrect_count"]
        a.status = status
        # Số câu LLM chấm hỏng phải sống LÂU BẰNG attempt. Trước đây nó chỉ nằm trong
        # `result` của job, mà job bị prune sau `JOB_RETENTION_DAYS=7` — còn
        # `percentage` thì ở lại DB vĩnh viễn và chảy vào `progress.overview`. Người
        # học thấy 66.7% và không còn cách nào biết một câu chưa được chấm.
        #
        meta = dict(a.metadata_json or {})
        meta["ungraded_count"] = int(ungraded_count)
        # The result ends the grader's claim. Left set, a regrade of a provisional
        # result right after it saw a "live" claim and answered 202 with no job.
        meta.pop("grading_job_running", None)
        a.metadata_json = meta
        a.grading_claimed_at = None
        if status == "graded":
            a.graded_at = now
    return True


def questions_for_grading(quiz_id: str) -> List[Dict[str, Any]]:
    """Câu hỏi kèm đáp án + chunk nguồn (ngữ liệu để chấm tự luận)."""
    from app.db.models import DocumentChunk, QuizQuestionChunk

    with session_scope() as s:
        rows = s.execute(
            select(QuizQuestion).where(QuizQuestion.quiz_id == str(quiz_id))
            .order_by(QuizQuestion.order_index)
        ).scalars().all()
        texts = s.execute(
            select(QuizQuestionChunk.question_id, DocumentChunk.text)
            .join(DocumentChunk, DocumentChunk.id == QuizQuestionChunk.chunk_id)
            .join(QuizQuestion, QuizQuestion.id == QuizQuestionChunk.question_id)
            .where(QuizQuestion.quiz_id == str(quiz_id))
        ).all()
        by_question: Dict[str, List[str]] = {}
        for question_id, text in texts:
            by_question.setdefault(question_id, []).append(text)
        return [{
            "question_id": r.id,
            "question_text": r.question_text,
            "question_type": r.question_type,
            "correct_answer": r.correct_answer,
            "explanation": r.explanation,
            "section_id": r.section_id,
            "knowledge_node_id": r.knowledge_node_id,
            "concept_tags": r.concept_tags_json or [],
            "source_context": "\n\n".join(by_question.get(r.id, [])),
        } for r in rows]


def list_by_quiz(quiz_id: str, *, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    with session_scope() as s:
        q = (select(QuizAttempt).where(QuizAttempt.quiz_id == str(quiz_id))
             .order_by(QuizAttempt.started_at.desc()))
        if user_id is not None:
            q = q.where(QuizAttempt.user_id == str(user_id))
        return [{
            "attempt_id": a.id,
            "status": a.status,
            "score": _f(a.score),
            "max_score": _f(a.max_score),
            "percentage": _f(a.percentage),
            "ungraded_count": int((a.metadata_json or {}).get("ungraded_count") or 0),
            "grading_complete": (
                a.status == "graded"
                and int((a.metadata_json or {}).get("ungraded_count") or 0) == 0
            ),
            "started_at": a.started_at.isoformat() if a.started_at else None,
            "submitted_at": a.submitted_at.isoformat() if a.submitted_at else None,
        } for a in s.execute(q).scalars().all()]
