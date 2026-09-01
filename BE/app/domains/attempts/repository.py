"""Đọc/ghi `quiz_attempts` / `quiz_answers` (đặc tả 5.12, 5.13)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select

from app.db import session_scope
from app.db.models import Quiz, QuizAnswer, QuizAttempt, QuizQuestion


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _f(value) -> Optional[float]:
    return None if value is None else float(value)


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
        existing = s.execute(
            select(QuizAttempt).where(
                QuizAttempt.quiz_id == str(quiz_id),
                QuizAttempt.user_id == owner,
                QuizAttempt.status == "in_progress",
            ).order_by(QuizAttempt.started_at.desc()).limit(1)
        ).scalar_one_or_none()
        if existing is not None:
            return {"attempt_id": existing.id, "created": False}

        total = int(s.execute(
            select(Quiz.question_count).where(Quiz.id == str(quiz_id))
        ).scalar() or 0)
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
    return len(answers)


def submit(attempt_id: str) -> Optional[Dict[str, Any]]:
    """`in_progress` sang `submitted` (FR-07.12) + `duration_seconds` (FR-07.13).

    Trả None khi attempt không còn `in_progress` — route đổi thành 409. Nộp hai lần
    không được phép ghi đè `submitted_at`, nếu không thời lượng làm bài sai.
    """
    with session_scope() as s:
        a = s.get(QuizAttempt, str(attempt_id))
        if a is None or a.status != "in_progress":
            return None
        now = _now()
        a.status = "submitted"
        a.submitted_at = now
        started = a.started_at
        if started is not None:
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            a.duration_seconds = max(0, int((now - started).total_seconds()))
        return {"attempt_id": a.id, "quiz_id": a.quiz_id, "status": a.status,
                "duration_seconds": a.duration_seconds}


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
        # Phần TOÁN là cố ý và không đổi: câu chưa chấm vẫn nằm ở mẫu số
        # (`test_quiz_attempt.py:311` khoá điều đó). Chỗ hỏng là BÁO CÁO.
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
            "started_at": a.started_at.isoformat() if a.started_at else None,
            "submitted_at": a.submitted_at.isoformat() if a.submitted_at else None,
        } for a in s.execute(q).scalars().all()]
