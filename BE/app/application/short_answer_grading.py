"""Use case: chấm bài có câu tự luận (FR-08.3).

Chuyển từ `app/main.py` ở Phase 1 — **di chuyển nguyên trạng**, không refactor logic,
không đổi thứ tự xử lý, không đổi cách bắt lỗi, không đổi mốc trạng thái.

`app.main.run_short_answer_grading_job` vẫn còn dưới dạng wrapper mỏng: RQ serialize hàm theo
`module.qualname`, nên job ĐANG NẰM TRONG HÀNG ĐỢI vẫn resolve được sau khi deploy.

Ràng buộc tầng: file này KHÔNG import flask, faiss, ollama.
"""

from __future__ import annotations

from typing import Optional

from app.application.shared import _job_error_text

def run_short_answer_grading_job(job_id: str, attempt_id: str,
                                 user_id: Optional[str] = None) -> None:
    """Chấm bài có câu tự luận (FR-08.3). Chấm CẢ attempt rồi ghi một lần."""
    from app.domains.attempts import service as _grading_service
    from app.domains.jobs import ledger as _ledger
    from app.domains.jobs.jobs_store import update_job

    print(f"grading_job_running job_id={job_id}", flush=True)
    _ledger.open_job(job_id, job_type="short_answer_grading", user_id=user_id,
                     input_json={"attempt_id": attempt_id})
    try:
        update_job(job_id, status="running", progress=20, current_node="Grading")
        result = _grading_service.grade_attempt(
            attempt_id,
            # Người học đang ngồi chờ màn hình điểm. Không có dòng này thì job đứng ở
            # 20% suốt cả lượt chấm (1 lời gọi LLM mỗi câu tự luận) rồi nhảy thẳng 100%.
            progress_cb=lambda p, msg: update_job(job_id, progress=p, current_node=msg),
        )
        if result is None:
            raise ValueError("Attempt không tồn tại.")
        update_job(job_id, status="done", progress=100, current_node="Grading",
                   result={"attempt_id": attempt_id, **result})
        _ledger.close_job(job_id, "done", result_type="quiz_attempt", result_id=attempt_id)
        print(f"grading_job_done job_id={job_id} attempt_id={attempt_id} "
              f"score={result['score']}/{result['max_score']}", flush=True)
    except Exception as e:
        update_job(job_id, status="error", error_text=_job_error_text(e))
        _ledger.close_job(job_id, "error", error_message=str(e))
        print(f"grading_job_failed job_id={job_id} err={str(e)[:80]}", flush=True)
