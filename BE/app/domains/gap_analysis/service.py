"""Tính mastery theo concept và lưu `concept_masteries` (FR-09).

Phần tính là **thuần** — chạy được bằng `python -m app.domains.gap_analysis.service`.

Công thức đặc tả 4.9 / PRD 14.1:

    earned_score  = SUM(quiz_answers.score) của các câu thuộc concept
    total_count   = tổng số câu thuộc concept
    mastery_score = earned_score / total_count

`correct_count` lưu riêng để báo cáo số câu **đúng hoàn toàn**; `earned_score` mới là cơ
sở tính mastery (câu `partial` đóng góp 0.5 — FR-09.9).
"""

from __future__ import annotations

import uuid
from collections import Counter
from typing import Any, Dict, List, Optional, Sequence

# Ngưỡng đặc tả 4.9. Thứ tự giảm dần, so bằng `>=`.
STATUS_THRESHOLDS = (
    (0.80, "mastered"),
    (0.60, "light_review"),
    (0.40, "review_needed"),
    (0.00, "critical_gap"),
)
WEAK_STATUSES = ("light_review", "review_needed", "critical_gap")


def status_for(mastery_score: float) -> str:
    for threshold, status in STATUS_THRESHOLDS:
        if mastery_score >= threshold:
            return status
    return "critical_gap"


def compute_masteries(questions: Sequence[Dict[str, Any]],
                      answers: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Gộp câu hỏi theo `concept_tags` (FR-09.2) và tính mastery cho từng concept.

    Câu **chưa chấm được** (`verdict` None — LLM bó tay) bị loại khỏi phép tính: tính
    nó thành 0 là đổ lỗi cho người học vì model hỏng. Concept mà mọi câu đều chưa chấm
    thì không sinh bản ghi (`total_count > 0` là CHECK ở DB).

    Một câu thuộc nhiều concept thì tính vào TẤT CẢ các concept đó — nó thật sự kiểm
    tra từng cái một.
    """
    by_question = {a["question_id"]: a for a in answers or []}
    buckets: Dict[str, Dict[str, Any]] = {}

    for q in questions or []:
        answer = by_question.get(q["question_id"])
        if not answer or answer.get("verdict") is None:
            continue
        score = float(answer.get("score") or 0.0)
        for tag in q.get("concept_tags") or []:
            name = str(tag).strip()
            if not name:
                continue
            b = buckets.setdefault(name, {
                "concept_name": name[:255], "earned_score": 0.0, "total_count": 0,
                "correct_count": 0, "wrong_count": 0,
                "sections": [], "nodes": [], "wrong_question_ids": [],
            })
            b["earned_score"] += score
            b["total_count"] += 1
            if answer.get("verdict") == "correct":
                b["correct_count"] += 1
            else:
                b["wrong_count"] += 1
                b["wrong_question_ids"].append(q["question_id"])
            # FR-09.3 / FR-09.4: giữ section + node để review plan trỏ về đúng chỗ.
            if q.get("section_id"):
                b["sections"].append(q["section_id"])
            if q.get("knowledge_node_id"):
                b["nodes"].append(q["knowledge_node_id"])

    out: List[Dict[str, Any]] = []
    for b in buckets.values():
        mastery = round(b["earned_score"] / b["total_count"], 2)
        out.append({
            "concept_name": b["concept_name"],
            "earned_score": round(b["earned_score"], 2),
            "total_count": b["total_count"],
            "correct_count": b["correct_count"],
            "wrong_count": b["wrong_count"],
            "mastery_score": mastery,
            "status": status_for(mastery),
            "section_id": _majority(b["sections"]),
            "knowledge_node_id": _majority(b["nodes"]),
            "wrong_question_ids": b["wrong_question_ids"],
        })
    # Yếu nhất lên đầu — đó là thứ tự người học cần đọc.
    out.sort(key=lambda m: (m["mastery_score"], -m["wrong_count"], m["concept_name"]))
    return out


def _majority(values: List[str]) -> Optional[str]:
    return Counter(values).most_common(1)[0][0] if values else None


def analyze_attempt(attempt_id: str) -> List[Dict[str, Any]]:
    """Tính rồi ghi `concept_masteries` cho attempt. Trả danh sách đã tính.

    Ghi đè bản cũ của cùng attempt: UNIQUE `(attempt_id, concept_name)` là snapshot theo
    attempt (đặc tả 5.14), chấm lại thì snapshot phải theo bản chấm mới chứ không cộng dồn.
    """
    from app.db import session_scope
    from app.db.models import ConceptMastery, Quiz, QuizAttempt
    from app.domains.attempts import repository as attempts_repo

    attempt = attempts_repo.get_attempt(attempt_id)
    if attempt is None:
        return []
    questions = attempts_repo.questions_for_grading(attempt["quiz_id"])
    masteries = compute_masteries(questions, attempt["answers"])

    with session_scope() as s:
        row = s.get(QuizAttempt, str(attempt_id))
        if row is None:
            return []
        document_id = s.get(Quiz, row.quiz_id).document_id
        s.query(ConceptMastery).filter(
            ConceptMastery.attempt_id == str(attempt_id)).delete()
        s.flush()
        for m in masteries:
            s.add(ConceptMastery(
                id=str(uuid.uuid4()), user_id=row.user_id, document_id=document_id,
                attempt_id=str(attempt_id), section_id=m["section_id"],
                knowledge_node_id=m["knowledge_node_id"],
                concept_name=m["concept_name"], correct_count=m["correct_count"],
                earned_score=m["earned_score"], total_count=m["total_count"],
                mastery_score=m["mastery_score"], status=m["status"],
            ))
    return masteries


def list_for_attempt(attempt_id: str, *, weak_only: bool = False) -> List[Dict[str, Any]]:
    from sqlalchemy import select

    from app.db import session_scope
    from app.db.models import ConceptMastery

    with session_scope() as s:
        q = (select(ConceptMastery)
             .where(ConceptMastery.attempt_id == str(attempt_id))
             .order_by(ConceptMastery.mastery_score))
        if weak_only:
            q = q.where(ConceptMastery.status.in_(WEAK_STATUSES))
        return [{
            "concept_mastery_id": r.id,
            "concept_name": r.concept_name,
            "section_id": r.section_id,
            "knowledge_node_id": r.knowledge_node_id,
            "correct_count": r.correct_count,
            "total_count": r.total_count,
            "earned_score": float(r.earned_score),
            "mastery_score": float(r.mastery_score),
            "status": r.status,
        } for r in s.execute(q).scalars().all()]


def demo() -> None:
    """Self-check: `python -m app.domains.gap_analysis.service`."""
    assert status_for(1.0) == "mastered" and status_for(0.80) == "mastered"
    assert status_for(0.79) == "light_review" and status_for(0.60) == "light_review"
    assert status_for(0.59) == "review_needed" and status_for(0.40) == "review_needed"
    assert status_for(0.39) == "critical_gap" and status_for(0.0) == "critical_gap"

    questions = [
        {"question_id": "q1", "concept_tags": ["dao ham"], "section_id": "sA",
         "knowledge_node_id": None},
        {"question_id": "q2", "concept_tags": ["dao ham", "ham hop"], "section_id": "sA",
         "knowledge_node_id": "n1"},
        {"question_id": "q3", "concept_tags": ["ham hop"], "section_id": "sB",
         "knowledge_node_id": "n1"},
        {"question_id": "q4", "concept_tags": ["chua cham"], "section_id": "sC",
         "knowledge_node_id": None},
    ]
    answers = [
        {"question_id": "q1", "verdict": "correct", "score": 1.0},
        {"question_id": "q2", "verdict": "partial", "score": 0.5},
        {"question_id": "q3", "verdict": "incorrect", "score": 0.0},
        {"question_id": "q4", "verdict": None, "score": None},  # LLM bó tay
    ]
    out = {m["concept_name"]: m for m in compute_masteries(questions, answers)}

    # dao ham: (1.0 + 0.5) / 2 = 0.75 -> light_review
    assert out["dao ham"]["earned_score"] == 1.5 and out["dao ham"]["total_count"] == 2
    assert out["dao ham"]["mastery_score"] == 0.75 == 1.5 / 2
    assert out["dao ham"]["status"] == "light_review"
    # correct_count đếm câu ĐÚNG HOÀN TOÀN, khác earned_score
    assert out["dao ham"]["correct_count"] == 1 and out["dao ham"]["wrong_count"] == 1

    # ham hop: (0.5 + 0.0) / 2 = 0.25 -> critical_gap
    assert out["ham hop"]["mastery_score"] == 0.25 and out["ham hop"]["status"] == "critical_gap"
    assert out["ham hop"]["knowledge_node_id"] == "n1"
    assert sorted(out["ham hop"]["wrong_question_ids"]) == ["q2", "q3"]

    # câu chưa chấm được không sinh concept (total_count > 0 là CHECK ở DB)
    assert "chua cham" not in out

    ordered = [m["concept_name"] for m in compute_masteries(questions, answers)]
    assert ordered[0] == "ham hop", "yếu nhất lên đầu"

    assert compute_masteries([], []) == []
    print("gap_analysis demo OK")


if __name__ == "__main__":
    demo()
