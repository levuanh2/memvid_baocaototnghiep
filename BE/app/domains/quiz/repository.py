"""Đọc/ghi `quizzes` / `quiz_questions` / `quiz_question_chunks` (đặc tả 5.9–5.11)."""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy import select

from app.db import session_scope
from app.db.models import Document, Quiz, QuizQuestion, QuizQuestionChunk, Section


def create_quiz(*, user_id: Optional[str], document_id: str, title: str, scope: Dict[str, Any],
                question_count: int, difficulty: str, quiz_type: str = "diagnostic",
                map_id: Optional[str] = None,
                source_review_item_id: Optional[str] = None,
                source_attempt_id: Optional[str] = None) -> str:
    """`quiz_type='practice'` BẮT BUỘC có `source_review_item_id` (CHECK ở DB, đặc tả
    10.9) — practice quiz không truy được về review item nguồn là mất cả chuỗi
    yếu → ôn → luyện (FR-11.8).

    `user_id` None = chế độ mở (`AUTH_PROTECT_APP_APIS` tắt) → gắn vào user ẩn danh.
    `quizzes.user_id` là NOT NULL uuid, mà `str(None)` ra CHUỖI `"None"` — Postgres
    báo `invalid input syntax for type uuid: "None"` chứ không báo thiếu giá trị.
    """
    from app.domains.documents.repository import ensure_anonymous_user

    quiz_id = str(uuid.uuid4())
    owner = str(user_id) if user_id else ensure_anonymous_user()
    with session_scope() as s:
        s.add(Quiz(
            id=quiz_id, user_id=owner, document_id=str(document_id), map_id=map_id,
            source_review_item_id=source_review_item_id,
            source_attempt_id=source_attempt_id,
            title=(title or "Quiz")[:500], quiz_type=quiz_type, scope_json=scope,
            question_count=int(question_count), difficulty=difficulty, status="processing",
        ))
    return quiz_id


def save_questions(quiz_id: str, questions: List[Dict[str, Any]]) -> int:
    """Ghi câu hỏi + liên kết chunk nguồn. `questions` đã qua `ai_validation.rules`.

    `chunk_ids` phải là `document_chunks.id` thật (đã resolve từ nhãn) — có FK, id bịa
    sẽ làm hỏng cả transaction.
    """
    with session_scope() as s:
        for order, q in enumerate(questions):
            question_id = str(uuid.uuid4())
            s.add(QuizQuestion(
                id=question_id, quiz_id=str(quiz_id),
                section_id=q.get("section_id"),
                knowledge_node_id=q.get("knowledge_node_id"),
                question_text=q["question_text"],
                question_type=q["question_type"],
                options_json=q.get("options") or None,
                correct_answer=q["correct_answer"],
                explanation=q["explanation"],
                difficulty=q["difficulty"],
                concept_tags_json=q["concept_tags"],
                order_index=order,
            ))
            s.flush()
            for chunk_id in q.get("chunk_ids") or []:
                s.add(QuizQuestionChunk(
                    id=str(uuid.uuid4()), question_id=question_id, chunk_id=chunk_id,
                ))
    return len(questions)


def finish(quiz_id: str, status: str, *, question_count: Optional[int] = None) -> None:
    with session_scope() as s:
        q = s.get(Quiz, str(quiz_id))
        if q is None:
            return
        q.status = status
        if question_count is not None:
            q.question_count = int(question_count)


def get_quiz(quiz_id: str, *, include_answers: bool = False) -> Optional[Dict[str, Any]]:
    """Quiz kèm câu hỏi.

    `include_answers=False` (mặc định) **không** trả `correct_answer` lẫn `explanation`
    — FR-06.12. Mặc định là bản an toàn: quên truyền cờ thì lộ đáp án, nên cờ phải là
    thứ người gọi bật lên chứ không phải thứ họ tắt đi.
    """
    with session_scope() as s:
        quiz = s.get(Quiz, str(quiz_id))
        if quiz is None:
            return None
        rows = s.execute(
            select(QuizQuestion).where(QuizQuestion.quiz_id == quiz.id)
            .order_by(QuizQuestion.order_index)
        ).scalars().all()
        chunk_rows = s.execute(
            select(QuizQuestionChunk.question_id, QuizQuestionChunk.chunk_id)
            .join(QuizQuestion, QuizQuestion.id == QuizQuestionChunk.question_id)
            .where(QuizQuestion.quiz_id == quiz.id)
        ).all()
        by_question: Dict[str, List[str]] = {}
        for question_id, chunk_id in chunk_rows:
            by_question.setdefault(question_id, []).append(chunk_id)

        questions = []
        for r in rows:
            item = {
                "question_id": r.id,
                "question_text": r.question_text,
                "question_type": r.question_type,
                "options": r.options_json or [],
                "difficulty": r.difficulty,
                "concept_tags": r.concept_tags_json or [],
                "section_id": r.section_id,
                "knowledge_node_id": r.knowledge_node_id,
                "chunk_ids": by_question.get(r.id, []),
                "order_index": r.order_index,
            }
            if include_answers:
                item["correct_answer"] = r.correct_answer
                item["explanation"] = r.explanation
            questions.append(item)

        return {
            "quiz_id": quiz.id,
            "document_id": quiz.document_id,
            "user_id": quiz.user_id,
            "title": quiz.title,
            "quiz_type": quiz.quiz_type,
            "scope": quiz.scope_json,
            "difficulty": quiz.difficulty,
            "status": quiz.status,
            "question_count": quiz.question_count,
            "created_at": quiz.created_at.isoformat() if quiz.created_at else None,
            "questions": questions,
        }


def list_by_document(document_id: str, *, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    with session_scope() as s:
        q = (select(Quiz).where(Quiz.document_id == str(document_id))
             .order_by(Quiz.created_at.desc()))
        if user_id is not None:
            q = q.where(Quiz.user_id == str(user_id))
        return [{
            "quiz_id": r.id,
            "document_id": r.document_id,
            "title": r.title,
            "quiz_type": r.quiz_type,
            "difficulty": r.difficulty,
            "status": r.status,
            "question_count": r.question_count,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in s.execute(q).scalars().all()]


def owner_of(quiz_id: str) -> Optional[str]:
    with session_scope() as s:
        return s.execute(select(Quiz.user_id).where(Quiz.id == str(quiz_id))).scalar()


def chunks_for_scope(document_id: str, section_ids: Optional[List[str]] = None,
                     *, limit: int = 200) -> List[Dict[str, Any]]:
    """Chunk trong phạm vi đề (FR-06.2). `section_ids` rỗng = toàn tài liệu."""
    from app.db.models import DocumentChunk

    with session_scope() as s:
        q = (select(DocumentChunk.id, DocumentChunk.text, DocumentChunk.heading,
                    DocumentChunk.section_id, DocumentChunk.chunk_index)
             .where(DocumentChunk.document_id == str(document_id))
             .order_by(DocumentChunk.chunk_index).limit(int(limit)))
        if section_ids:
            q = q.where(DocumentChunk.section_id.in_([str(x) for x in section_ids]))
        return [{"chunk_id": cid, "text": text, "heading": heading,
                 "section_id": section_id, "chunk_index": index}
                for cid, text, heading, section_id, index in s.execute(q).all()]


def section_ids_of(document_id: str) -> List[str]:
    with session_scope() as s:
        return [r for r in s.execute(
            select(Section.id).where(Section.document_id == str(document_id))
        ).scalars().all()]


def document_title(document_id: str) -> str:
    with session_scope() as s:
        return s.execute(
            select(Document.title).where(Document.id == str(document_id))
        ).scalar() or "Quiz"


def chunks_by_ids(document_id: str, chunk_ids: List[str], *, limit: int = 200,
                  ) -> List[Dict[str, Any]]:
    """Chunk theo id cụ thể (practice quiz — FR-11.2).

    Vẫn lọc theo `document_id`: id chunk đến từ review item của người dùng, nhưng ràng
    buộc lại ở đây thì một id lạc sang tài liệu khác không thể lọt vào ngữ liệu.
    """
    from app.db.models import DocumentChunk

    ids = [str(c) for c in (chunk_ids or []) if str(c or "").strip()]
    if not ids:
        return []
    with session_scope() as s:
        rows = s.execute(
            select(DocumentChunk.id, DocumentChunk.text, DocumentChunk.heading,
                   DocumentChunk.section_id, DocumentChunk.chunk_index)
            .where(DocumentChunk.document_id == str(document_id),
                   DocumentChunk.id.in_(ids))
            .order_by(DocumentChunk.chunk_index).limit(int(limit))
        ).all()
        return [{"chunk_id": cid, "text": text, "heading": heading,
                 "section_id": section_id, "chunk_index": index}
                for cid, text, heading, section_id, index in rows]


def get_meta(quiz_id: str) -> Optional[Dict[str, Any]]:
    """Thông tin quiz KHÔNG kèm câu hỏi — dùng khi chỉ cần kiểm quyền/loại quiz."""
    with session_scope() as s:
        q = s.get(Quiz, str(quiz_id))
        if q is None:
            return None
        return {
            "quiz_id": q.id, "user_id": q.user_id, "document_id": q.document_id,
            "quiz_type": q.quiz_type, "status": q.status, "title": q.title,
            "question_count": q.question_count, "difficulty": q.difficulty,
            "source_review_item_id": q.source_review_item_id,
            "source_attempt_id": q.source_attempt_id,
            "created_at": q.created_at.isoformat() if q.created_at else None,
        }
