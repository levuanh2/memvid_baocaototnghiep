"""So sánh trước/sau luyện tập (FR-11.10) và báo cáo tiến độ (FR-12).

Phần tính so sánh là **thuần** — chạy được bằng `python -m app.domains.progress.service`.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from sqlalchemy import func, select

from app.db import session_scope
from app.db.models import ConceptMastery, Document, Quiz, QuizAttempt, ReviewPlan


def compare_masteries(before: Sequence[Dict[str, Any]], after: Sequence[Dict[str, Any]],
                      *, topics: Optional[Sequence[str]] = None) -> Dict[str, Any]:
    """So mastery của attempt gốc với attempt luyện tập.

    `topics` không None thì chỉ so đúng những chủ đề đó — practice quiz chỉ luyện một
    topic, so cả bài là so hai thứ khác nhau.

    Concept chỉ có ở MỘT bên vẫn được trả về với bên kia `None`: "chưa có số liệu" khác
    với "0 điểm", và gộp hai thứ đó lại là báo cáo sai tiến bộ.
    """
    wanted = {str(t) for t in topics} if topics else None
    by_before = {m["concept_name"]: m for m in before or []}
    by_after = {m["concept_name"]: m for m in after or []}
    names = sorted(set(by_before) | set(by_after))
    if wanted is not None:
        names = [n for n in names if n in wanted]

    rows: List[Dict[str, Any]] = []
    improved = declined = unchanged = 0
    for name in names:
        b, a = by_before.get(name), by_after.get(name)
        before_score = float(b["mastery_score"]) if b else None
        after_score = float(a["mastery_score"]) if a else None
        delta = (round(after_score - before_score, 2)
                 if before_score is not None and after_score is not None else None)
        if delta is not None:
            if delta > 0:
                improved += 1
            elif delta < 0:
                declined += 1
            else:
                unchanged += 1
        rows.append({
            "concept_name": name,
            "before": {"mastery_score": before_score,
                       "status": b["status"] if b else None} if b else None,
            "after": {"mastery_score": after_score,
                      "status": a["status"] if a else None} if a else None,
            "delta": delta,
            # FR-12.7: chuyển từ yếu sang nắm được mới là kết quả người học quan tâm
            "became_mastered": bool(a and a["status"] == "mastered"
                                    and (not b or b["status"] != "mastered")),
        })
    return {
        "concepts": rows,
        "improved_count": improved,
        "declined_count": declined,
        "unchanged_count": unchanged,
        "became_mastered_count": sum(1 for r in rows if r["became_mastered"]),
    }


def overview(user_id: str) -> Dict[str, Any]:
    """Chỉ số tổng quan (FR-12)."""
    with session_scope() as s:
        documents = int(s.execute(
            select(func.count()).select_from(Document)
            .where(Document.user_id == str(user_id), Document.status != "deleted")
        ).scalar() or 0)
        quiz_rows = s.execute(
            select(Quiz.quiz_type, func.count()).where(Quiz.user_id == str(user_id))
            .group_by(Quiz.quiz_type)
        ).all()
        quizzes = {t: int(n) for t, n in quiz_rows}
        attempt_rows = s.execute(
            select(QuizAttempt.status, func.count())
            .where(QuizAttempt.user_id == str(user_id))
            .group_by(QuizAttempt.status)
        ).all()
        attempts = {t: int(n) for t, n in attempt_rows}
        avg_percentage = s.execute(
            select(func.avg(QuizAttempt.percentage))
            .where(QuizAttempt.user_id == str(user_id),
                   QuizAttempt.status == "graded")
        ).scalar()
        review_plans = int(s.execute(
            select(func.count()).select_from(ReviewPlan)
            .where(ReviewPlan.user_id == str(user_id))
        ).scalar() or 0)

    total_attempts = sum(attempts.values())
    graded = attempts.get("graded", 0)
    concepts = concept_progress(user_id)
    return {
        "document_count": documents,
        "quiz_count": sum(quizzes.values()),
        "quiz_count_by_type": quizzes,
        "attempt_count": total_attempts,
        "attempt_count_by_status": attempts,
        # Tỷ lệ hoàn thành = đã chấm / đã mở. Mở bài rồi bỏ dở cũng là dữ liệu thật.
        "completion_rate": round(graded / total_attempts, 2) if total_attempts else 0.0,
        "average_percentage": round(float(avg_percentage), 2) if avg_percentage is not None else None,
        "review_plan_count": review_plans,
        "weak_concept_count": sum(1 for c in concepts if c["status"] != "mastered"),
        "mastered_concept_count": sum(1 for c in concepts if c["status"] == "mastered"),
    }


def concept_progress(user_id: str, *, document_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Mastery tổng hợp theo concept qua NHIỀU attempt (FR-12.4).

    Lấy **bản mới nhất** làm mức hiện tại chứ không cộng dồn: `concept_masteries` là
    snapshot theo attempt (đặc tả 8.15), cộng dồn thì một bài tệ hồi đầu kéo điểm xuống
    mãi mãi dù người học đã nắm được.
    """
    with session_scope() as s:
        q = (select(ConceptMastery, QuizAttempt.started_at)
             .join(QuizAttempt, QuizAttempt.id == ConceptMastery.attempt_id)
             .where(ConceptMastery.user_id == str(user_id))
             .order_by(QuizAttempt.started_at))
        if document_id:
            q = q.where(ConceptMastery.document_id == str(document_id))
        rows = s.execute(q).all()

    by_name: Dict[str, Dict[str, Any]] = {}
    for m, started_at in rows:
        score = float(m.mastery_score)
        b = by_name.get(m.concept_name)
        if b is None:
            by_name[m.concept_name] = {
                "concept_name": m.concept_name,
                "document_id": m.document_id,
                "section_id": m.section_id,
                "first_mastery_score": score,
                "mastery_score": score,
                "status": m.status,
                "attempt_count": 1,
                "best_mastery_score": score,
                "last_attempt_id": m.attempt_id,
                "last_attempt_at": started_at.isoformat() if started_at else None,
            }
            continue
        b["attempt_count"] += 1
        b["mastery_score"] = score          # rows đã sắp theo thời gian → cuối là mới nhất
        b["status"] = m.status
        b["section_id"] = m.section_id or b["section_id"]
        b["best_mastery_score"] = max(b["best_mastery_score"], score)
        b["last_attempt_id"] = m.attempt_id
        b["last_attempt_at"] = started_at.isoformat() if started_at else None

    out = list(by_name.values())
    for b in out:
        b["improvement"] = round(b["mastery_score"] - b["first_mastery_score"], 2)
    out.sort(key=lambda b: (b["mastery_score"], b["concept_name"]))
    return out


def attempt_history(user_id: str, *, limit: int = 50) -> List[Dict[str, Any]]:
    """Lịch sử làm bài, mới nhất trước (FR-12.1, FR-12.2, FR-12.6)."""
    with session_scope() as s:
        rows = s.execute(
            select(QuizAttempt, Quiz.title, Quiz.quiz_type, Quiz.document_id,
                   Quiz.source_review_item_id, Quiz.source_attempt_id)
            .join(Quiz, Quiz.id == QuizAttempt.quiz_id)
            .where(QuizAttempt.user_id == str(user_id))
            .order_by(QuizAttempt.started_at.desc()).limit(int(limit))
        ).all()
        return [{
            "attempt_id": a.id,
            "quiz_id": a.quiz_id,
            "quiz_title": title,
            "quiz_type": quiz_type,
            "document_id": document_id,
            "source_review_item_id": review_item_id,
            "source_attempt_id": source_attempt_id,
            "status": a.status,
            "score": float(a.score) if a.score is not None else None,
            "max_score": float(a.max_score),
            "percentage": float(a.percentage) if a.percentage is not None else None,
            "correct_count": a.correct_count,
            "incorrect_count": a.incorrect_count,
            "duration_seconds": a.duration_seconds,
            "started_at": a.started_at.isoformat() if a.started_at else None,
            "submitted_at": a.submitted_at.isoformat() if a.submitted_at else None,
        } for a, title, quiz_type, document_id, review_item_id, source_attempt_id in rows]


def latest_graded_attempt(quiz_id: str, user_id: str) -> Optional[str]:
    with session_scope() as s:
        return s.execute(
            select(QuizAttempt.id)
            .where(QuizAttempt.quiz_id == str(quiz_id),
                   QuizAttempt.user_id == str(user_id),
                   QuizAttempt.status == "graded")
            .order_by(QuizAttempt.started_at.desc()).limit(1)
        ).scalar()


def demo() -> None:
    """Self-check: `python -m app.domains.progress.service`."""
    before = [
        {"concept_name": "ham hop", "mastery_score": 0.0, "status": "critical_gap"},
        {"concept_name": "dao ham", "mastery_score": 1.0, "status": "mastered"},
        {"concept_name": "chi co truoc", "mastery_score": 0.5, "status": "review_needed"},
    ]
    after = [
        {"concept_name": "ham hop", "mastery_score": 1.0, "status": "mastered"},
        {"concept_name": "dao ham", "mastery_score": 0.5, "status": "review_needed"},
        {"concept_name": "chi co sau", "mastery_score": 0.8, "status": "mastered"},
    ]
    out = compare_masteries(before, after)
    by_name = {c["concept_name"]: c for c in out["concepts"]}
    assert by_name["ham hop"]["delta"] == 1.0 and by_name["ham hop"]["became_mastered"]
    assert by_name["dao ham"]["delta"] == -0.5
    assert not by_name["dao ham"]["became_mastered"]
    # có một bên thì delta phải là None, KHÔNG phải 0 — chưa có số liệu khác 0 điểm
    assert by_name["chi co truoc"]["after"] is None
    assert by_name["chi co truoc"]["delta"] is None
    assert by_name["chi co sau"]["before"] is None
    assert by_name["chi co sau"]["delta"] is None
    assert by_name["chi co sau"]["became_mastered"], "chưa từng nắm → giờ nắm"
    assert out["improved_count"] == 1 and out["declined_count"] == 1
    assert out["unchanged_count"] == 0 and out["became_mastered_count"] == 2

    # lọc theo topic: practice chỉ luyện một chủ đề
    only = compare_masteries(before, after, topics=["ham hop"])
    assert [c["concept_name"] for c in only["concepts"]] == ["ham hop"]
    assert only["improved_count"] == 1 and only["declined_count"] == 0

    same = compare_masteries(before, before)
    assert same["unchanged_count"] == 3 and same["improved_count"] == 0

    assert compare_masteries([], [])["concepts"] == []
    print("progress demo OK")


if __name__ == "__main__":
    demo()
