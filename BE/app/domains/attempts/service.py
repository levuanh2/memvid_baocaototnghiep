"""Điều phối chấm bài (FR-08).

Trắc nghiệm / đúng-sai chấm **đồng bộ** ngay lúc nộp (NFR-01.4 — kết quả gần như tức
thì). Tự luận ngắn cần LLM nên đẩy sang job nền.

Bài có tự luận thì **không** ghi điểm phần khách quan trước rồi vá phần còn lại sau: cả
attempt chấm một lần, ghi một lần. Ghi hai đợt là mở cửa sổ cho FE đọc trúng bảng điểm
mới có một nửa — đúng lớp lỗi đã có trong known-issues.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from app.domains.attempts import grading, repository


def has_short_answer(quiz_id: str) -> bool:
    return any(q["question_type"] == "short_answer"
               for q in repository.questions_for_grading(quiz_id))


def grade_attempt(attempt_id: str, *, ask: Optional[Callable[..., str]] = None,
                  ) -> Optional[Dict[str, Any]]:
    """Chấm toàn bộ attempt rồi ghi một lần. None khi attempt không tồn tại.

    Trả `{**totals, ungraded_count}`. `ungraded_count > 0` nghĩa là LLM không chấm được
    vài câu tự luận — attempt vẫn `graded` để người học xem được phần còn lại, những câu
    đó để `verdict=None` chứ không bị cho 0 oan.
    """
    attempt = repository.get_attempt(attempt_id)
    if attempt is None:
        return None

    given = {a["question_id"]: a.get("user_answer") for a in attempt["answers"]}
    graded: List[Dict[str, Any]] = []
    ungraded = 0

    for q in repository.questions_for_grading(attempt["quiz_id"]):
        answer = given.get(q["question_id"])
        if q["question_type"] in grading.OBJECTIVE_TYPES:
            verdict, score = grading.grade_objective(
                q["question_type"], answer, q["correct_answer"])
            graded.append({
                "question_id": q["question_id"], "user_answer": answer,
                "verdict": verdict, "score": score,
                # FR-08.6: câu sai phải có feedback; câu đúng không cần giải thích thừa.
                "feedback": None if verdict == "correct" else q["explanation"],
            })
            continue

        result = grading.grade_short_answer(
            question=q["question_text"], correct_answer=q["correct_answer"],
            user_answer=answer, source_context=q["source_context"], ask=ask)
        if result is None:
            ungraded += 1
            continue
        feedback = result["feedback"]
        if result["missing_points"]:
            feedback = ((feedback or "") + " Còn thiếu: "
                        + "; ".join(result["missing_points"])).strip()
        graded.append({
            "question_id": q["question_id"], "user_answer": answer,
            "verdict": result["verdict"], "score": result["score"],
            "feedback": feedback,
        })

    totals = grading.totals(graded, attempt["total_questions"])
    repository.save_grades(attempt_id, graded, totals)

    # Chấm xong thì phân tích lỗ hổng luôn (FR-09.7) — review plan cần nó, và bắt
    # người dùng bấm thêm một nút để hệ thống tự tính là vô nghĩa. Fail-open: điểm đã
    # ghi xong, lỗi phân tích không được biến bài đã chấm thành hỏng.
    try:
        from app.domains.gap_analysis import service as gap_service
        gap_service.analyze_attempt(attempt_id)
    except Exception as exc:
        print(f"[grading] phân tích lỗ hổng thất bại: {exc}", flush=True)

    return {**totals, "ungraded_count": ungraded}
