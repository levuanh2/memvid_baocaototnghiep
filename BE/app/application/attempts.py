"""Use case cho lượt làm bài (attempt) — FR-07, FR-08, FR-09.

Tầng này điều phối: cổng trạng thái, chuẩn hoá dữ liệu vào, quyết định quyền sở hữu,
chọn nhánh chấm ngay hay chấm nền, và dựng bản công khai để trả ra ngoài. Nó KHÔNG
biết HTTP: không `request`, không `jsonify`, và không có một con số status nào.

Hai quy ước làm nên ranh giới đó:

1. **Lỗi mang NGỮ NGHĨA, không mang mã.** `AttemptKhongTonTai` chứ không phải "404".
   Việc một attempt của người khác trả cùng thân lỗi với attempt không tồn tại là
   quyết định nghiệp vụ (không tạo oracle cho biết id có thật hay không), nên nó nằm
   ở đây; còn con số 404 do tầng route chọn.
2. **Cờ `bat_buoc_chu_so_huu` được TRUYỀN VÀO, không tự đọc env.** Đọc
   `AUTH_PROTECT_APP_APIS` là việc của rìa hệ thống. Truyền vào giữ tầng này thuần,
   và giữ nguyên chỗ test đang thay cờ (`app.main._auth_protect_enabled`).

`dispatch_grading` cũng được tiêm, vì lý do rất cụ thể — xem `submit_attempt`.
"""

from __future__ import annotations

import uuid
from typing import Any, Callable, Dict, List, Optional, Tuple


# ── Lỗi ngữ nghĩa ──────────────────────────────────────────────────────────
class AttemptError(Exception):
    """Gốc chung. `loi` là thân thông báo; `kem` là các trường đi kèm phải giữ
    nguyên trong response (ví dụ `status` của attempt lúc bị từ chối)."""

    loi = "Lỗi không xác định"

    def __init__(self, loi: Optional[str] = None, **kem: Any):
        if loi is not None:
            self.loi = loi
        self.kem: Dict[str, Any] = kem
        super().__init__(self.loi)


class AttemptKhongTonTai(AttemptError):
    """Không có, hoặc có nhưng của người khác — CỐ Ý không phân biệt hai ca."""
    loi = "Attempt not found"


class QuizKhongTonTai(AttemptError):
    loi = "Quiz not found"


class QuizChuaSanSang(AttemptError):
    loi = "Quiz chưa sẵn sàng"


class AttemptDaNop(AttemptError):
    """Đã rời `in_progress` mà còn sửa đáp án."""
    loi = "Attempt đã nộp, không sửa được đáp án"


class AttemptKhongConDangLam(AttemptError):
    """Nộp lần thứ hai."""
    loi = "Attempt không còn ở trạng thái in_progress"


class AttemptChuaNop(AttemptError):
    """Đòi xem kết quả (kèm đáp án đúng) trong khi bài còn đang làm."""
    loi = "Attempt chưa nộp"


class ThieuDapAn(AttemptError):
    loi = "Thiếu answers"


class CauHoiLac(AttemptError):
    """`question_id` không thuộc quiz của attempt."""


class JobChamKhongTonTai(AttemptError):
    loi = "Job not found"


# ── Bản công khai ──────────────────────────────────────────────────────────
def attempt_public(attempt: dict) -> dict:
    out = dict(attempt)
    out.pop("user_id", None)
    out["unanswered_count"] = len(out.get("unanswered_question_ids") or [])
    # Số câu LLM chấm hỏng: đọc từ chính attempt, không từ `result` của job (job bị
    # prune sau 7 ngày, còn điểm thì ở lại vĩnh viễn). Không có metadata = 0 câu, không
    # phải "không biết" — trước khi có trường này thì mọi bài đều chấm đủ hoặc mất dấu.
    meta = out.get("metadata") or {}
    try:
        out["ungraded_count"] = int(meta.get("ungraded_count") or 0)
    except (TypeError, ValueError):
        out["ungraded_count"] = 0
    return out


def load_owned_attempt(attempt_id: str, user_id: Optional[str], *,
                       bat_buoc_chu_so_huu: bool) -> dict:
    """Bản ghi thô (còn `user_id`) sau khi qua cổng sở hữu."""
    from app.domains.attempts import repository as _attempts

    attempt = _attempts.get_attempt(attempt_id)
    if not attempt:
        raise AttemptKhongTonTai()
    if bat_buoc_chu_so_huu and attempt.get("user_id") != user_id:
        raise AttemptKhongTonTai()
    return attempt


# ── Use case ───────────────────────────────────────────────────────────────
def open_attempt(quiz_id: str, user_id: Optional[str], *,
                 bat_buoc_chu_so_huu: bool) -> Tuple[dict, bool]:
    """(bản công khai kèm quiz, có_tạo_mới). Mở lại quiz đang làm dở KHÔNG tạo
    attempt thứ hai — `open_attempt` của repository trả cờ `created` cho việc đó."""
    from app.domains.attempts import repository as _attempts
    from app.domains.quiz import repository as _quiz_repo

    quiz = _quiz_repo.get_quiz(quiz_id, include_answers=False)
    if not quiz or (bat_buoc_chu_so_huu and quiz.get("user_id") != user_id):
        raise QuizKhongTonTai()
    if quiz["status"] != "ready":
        raise QuizChuaSanSang()

    opened = _attempts.open_attempt(quiz_id, user_id)
    attempt = _attempts.get_attempt(opened["attempt_id"])
    quiz.pop("user_id", None)
    return {**attempt_public(attempt), "quiz": quiz}, bool(opened["created"])


def list_attempts(quiz_id: str, user_id: Optional[str], *,
                  bat_buoc_chu_so_huu: bool) -> dict:
    from app.domains.attempts import repository as _attempts
    from app.domains.quiz import repository as _quiz_repo

    owner = _quiz_repo.owner_of(quiz_id)
    if owner is None or (bat_buoc_chu_so_huu and owner != user_id):
        raise QuizKhongTonTai()
    return {
        "quiz_id": quiz_id,
        "attempts": _attempts.list_by_quiz(
            quiz_id, user_id=user_id if bat_buoc_chu_so_huu else None),
    }


def get_attempt(attempt_id: str, user_id: Optional[str], *,
                bat_buoc_chu_so_huu: bool) -> dict:
    return attempt_public(
        load_owned_attempt(attempt_id, user_id, bat_buoc_chu_so_huu=bat_buoc_chu_so_huu))


def _chuan_hoa_dap_an(raw: Any) -> Dict[str, Any]:
    """FE gửi được cả hai hình dạng: `{question_id: user_answer}` và
    `[{question_id, user_answer}]`. Gộp về dict, bỏ phần tử không có `question_id`."""
    if isinstance(raw, list):
        raw = {a.get("question_id"): a.get("user_answer")
               for a in raw if isinstance(a, dict) and a.get("question_id")}
    if not isinstance(raw, dict) or not raw:
        raise ThieuDapAn()
    return raw


def save_answers(attempt_id: str, user_id: Optional[str], raw: Any, *,
                 bat_buoc_chu_so_huu: bool) -> dict:
    """Lưu nháp (FR-07.5, FR-07.11). Gọi lại cho cùng câu thì ghi đè."""
    from app.domains.attempts import repository as _attempts

    attempt = load_owned_attempt(attempt_id, user_id,
                                 bat_buoc_chu_so_huu=bat_buoc_chu_so_huu)
    if attempt["status"] != "in_progress":
        # Đã nộp rồi mà còn sửa đáp án thì điểm không còn nghĩa gì.
        raise AttemptDaNop(status=attempt["status"])

    raw = _chuan_hoa_dap_an(raw)
    known = set(_attempts.question_ids_of_quiz(attempt["quiz_id"]))
    unknown = [q for q in raw if str(q) not in known]
    if unknown:
        raise CauHoiLac(f"question_id không thuộc quiz: {unknown}")

    _attempts.save_draft_answers(attempt_id, {str(k): v for k, v in raw.items()})
    return attempt_public(_attempts.get_attempt(attempt_id))


def submit_attempt(attempt_id: str, user_id: Optional[str], *,
                   bat_buoc_chu_so_huu: bool,
                   dispatch_grading: Callable[[str, str, Optional[str]], Any],
                   ) -> Tuple[dict, bool]:
    """(bản công khai, có_chấm_nền). Bài toàn trắc nghiệm chấm luôn; có tự luận thì nền.

    `dispatch_grading` được TIÊM, không import thẳng runner. Lý do là hợp đồng của RQ,
    không phải thẩm mỹ: `queue.enqueue_job` đưa hàm cho RQ, RQ lưu chuỗi
    `module.qualname` rồi import lại ở worker. Job đã nằm trong hàng đợi mang đường dẫn
    `app.main.run_short_answer_grading_job`; nếu tầng này import thẳng impl ở
    `app.application.short_answer_grading`, đường dẫn đổi và job cũ chết ở worker — im
    lặng, vì chế độ thread không dùng đường dẫn nên test vẫn xanh.
    """
    from app.domains.attempts import repository as _attempts
    from app.domains.attempts import service as _grading_service

    attempt = load_owned_attempt(attempt_id, user_id,
                                 bat_buoc_chu_so_huu=bat_buoc_chu_so_huu)
    submitted = _attempts.submit(attempt_id)
    if submitted is None:
        raise AttemptKhongConDangLam(status=attempt["status"])

    if not _grading_service.has_short_answer(attempt["quiz_id"]):
        result = _grading_service.grade_attempt(attempt_id)
        return ({**attempt_public(_attempts.get_attempt(attempt_id)),
                 "grading": "done", **(result or {})}, False)

    job_id = str(uuid.uuid4())
    from app.domains.jobs.jobs_store import create_job
    create_job(job_id, job_type="short_answer_grading", status="pending", progress=0,
               current_node="Queued", user_id=user_id)
    dispatch_grading(job_id, attempt_id, user_id)
    return ({**attempt_public(_attempts.get_attempt(attempt_id)),
             "grading": "pending", "job_id": job_id}, True)


def grading_job(job_id: str, user_id: Optional[str], *,
                bat_buoc_chu_so_huu: bool) -> dict:
    """Job loại khác, hoặc job của người khác, đều là "không tồn tại"."""
    from app.domains.jobs.jobs_store import get_job as _js_get

    j = _js_get(job_id)
    if not j or j.get("job_type") != "short_answer_grading":
        raise JobChamKhongTonTai()
    if bat_buoc_chu_so_huu and j.get("user_id") != user_id:
        raise JobChamKhongTonTai()
    return {
        "job_id": job_id,
        "status": j.get("status"),
        "progress": j.get("progress", 0),
        "result": j.get("result"),
        "error": j.get("error"),
    }


def results(attempt_id: str, user_id: Optional[str], *,
            bat_buoc_chu_so_huu: bool) -> dict:
    """Kết quả sau khi nộp — CHỖ DUY NHẤT lộ đáp án đúng + giải thích (FR-08.8).

    Chưa nộp thì từ chối: trả đáp án lúc bài còn `in_progress` là đưa bài giải cho
    người đang làm.
    """
    from app.domains.quiz import repository as _quiz_repo

    attempt = load_owned_attempt(attempt_id, user_id,
                                 bat_buoc_chu_so_huu=bat_buoc_chu_so_huu)
    if attempt["status"] == "in_progress":
        raise AttemptChuaNop(status=attempt["status"])

    quiz = _quiz_repo.get_quiz(attempt["quiz_id"], include_answers=True) or {}
    by_question = {a["question_id"]: a for a in attempt["answers"]}
    questions: List[dict] = []
    for q in quiz.get("questions") or []:
        answer = by_question.get(q["question_id"]) or {}
        questions.append({
            **q,
            "user_answer": answer.get("user_answer"),
            "verdict": answer.get("verdict"),
            "is_correct": answer.get("is_correct"),
            "score": answer.get("score"),
            "feedback": answer.get("feedback"),
        })
    return {
        **attempt_public(attempt),
        "quiz_id": attempt["quiz_id"],
        "quiz_title": quiz.get("title"),
        "questions": questions,
    }


def concept_masteries(attempt_id: str, user_id: Optional[str], *,
                      weak_only: bool, bat_buoc_chu_so_huu: bool) -> dict:
    """Mức nắm từng concept của bài làm (FR-09.8)."""
    from app.domains.gap_analysis import service as _gap

    attempt = load_owned_attempt(attempt_id, user_id,
                                 bat_buoc_chu_so_huu=bat_buoc_chu_so_huu)
    rows = _gap.list_for_attempt(attempt_id, weak_only=weak_only)
    if not rows and attempt["status"] == "graded" and not weak_only:
        # Bài đã chấm mà chưa có snapshot (hook lúc chấm hỏng) → tính bù, đừng trả rỗng.
        _gap.analyze_attempt(attempt_id)
        rows = _gap.list_for_attempt(attempt_id)
    return {"attempt_id": attempt_id, "status": attempt["status"],
            "concept_masteries": rows}
