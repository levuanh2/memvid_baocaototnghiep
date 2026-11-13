"""Đọc/ghi `quiz_attempts` / `quiz_answers` (đặc tả 5.12, 5.13)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import Integer, func, select

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


def save_draft_answers(attempt_id: str, answers: Dict[str, Optional[str]]) -> int:
    """Lưu nháp (FR-07.11). Gọi lại cho cùng câu thì GHI ĐÈ, không tạo dòng thứ hai.

    UNIQUE `(attempt_id, question_id)` là thứ chặn double-answer, nên ở đây phải
    update-or-insert chứ không insert mù.
    """
    if not answers:
        return 0
    with session_scope() as s:
        _upsert_answers(s, attempt_id, answers)
    return len(answers)


def submit(attempt_id: str) -> Optional[Dict[str, Any]]:
    """`in_progress` sang `submitted` (FR-07.12) + `duration_seconds` (FR-07.13).

    Trả None khi attempt không còn `in_progress` — route đổi thành 409. Nộp hai lần
    không được phép ghi đè `submitted_at`, nếu không thời lượng làm bài sai.

    `FOR UPDATE`: hai request cùng lúc trước đây cùng đọc `in_progress` rồi cùng chấm.
    Có khoá hàng, request thứ hai chờ tới khi request đầu commit rồi đọc `submitted`.
    """
    with session_scope() as s:
        a = s.get(QuizAttempt, str(attempt_id), with_for_update=True)
        if a is None or a.status != "in_progress":
            return None
        _mark_submitted(a, _now())
        return {"attempt_id": a.id, "quiz_id": a.quiz_id, "status": a.status,
                "duration_seconds": a.duration_seconds}


# ponytail: a replay is "same answers, same quiz, same learner, within this window".
# A retake with identical answers inside it gets 409; a client idempotency key would
# remove the guess (proposal in the PR; it is an API change the owner has not approved).
PRACTICE_REPLAY_WINDOW_S = 30


def submit_practice(quiz_id: str, user_id: Optional[str],
                    answers: Dict[str, Optional[str]]) -> Optional[str]:
    """Open, fill and submit a practice attempt in ONE transaction; returns attempt_id.

    None = the same answers were submitted moments ago (a double click, a retried
    request): the caller answers 409 instead of grading a second attempt. Practice is
    one call that always opens a fresh attempt, so without this a second identical
    request produced a second graded result.
    """
    from app.domains.documents.repository import ensure_anonymous_user

    owner = str(user_id) if user_id else ensure_anonymous_user()
    given = {str(k): (None if v is None else str(v)) for k, v in answers.items()}
    with session_scope() as s:
        total = int(_lock_quiz(s, quiz_id) or 0)
        now = _now()
        last = s.execute(
            select(QuizAttempt).where(
                QuizAttempt.quiz_id == str(quiz_id),
                QuizAttempt.user_id == owner,
                QuizAttempt.status.in_(("submitted", "graded")),
                QuizAttempt.submitted_at >= now - timedelta(seconds=PRACTICE_REPLAY_WINDOW_S),
            ).order_by(QuizAttempt.submitted_at.desc()).limit(1)
        ).scalar_one_or_none()
        if last is not None:
            # Grading adds a row (answer None) for every unanswered question; compare
            # only what the learner actually answered.
            before = {r.question_id: r.user_answer for r in s.execute(
                select(QuizAnswer).where(QuizAnswer.attempt_id == last.id)).scalars()
                if r.user_answer is not None}
            if before == {k: v for k, v in given.items() if v is not None}:
                return None

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
        return a.id


def save_grades(attempt_id: str, graded: List[Dict[str, Any]], totals: Dict[str, Any],
                *, status: str = "graded", ungraded_count: int = 0) -> bool:
    """Ghi điểm từng câu + tổng kết attempt trong MỘT transaction.

    Bài học known-issues (cache hit trả rỗng): trạng thái terminal phải ghi cùng lúc với
    payload kết quả. Đặt `graded` trước rồi mới gắn điểm là mở cửa sổ cho FE poll trúng
    lúc "đã chấm xong, chưa có điểm".
    """
    now = _now()
    with session_scope() as s:
        a = s.get(QuizAttempt, str(attempt_id))
        if a is None:
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
        a.metadata_json = meta
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
