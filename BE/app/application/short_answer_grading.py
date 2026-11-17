"""Use case: chấm bài có câu tự luận (FR-08.3).

Chuyển từ `app/main.py` ở Phase 1. `app.main.run_short_answer_grading_job` vẫn còn dưới
dạng wrapper mỏng: RQ serialize hàm theo `module.qualname`, nên job ĐANG NẰM TRONG HÀNG
ĐỢI vẫn resolve được sau khi deploy.

Diagnostic recovery (2026-11-17): one grader per attempt. The job renews the attempt's
claim when it starts, grades with `once=True`, and a job that finds the attempt already
graded (a duplicate job, a retry that won) ends `done` with the STORED result: a valid
no-op, not an error, and no second gap analysis. On failure it releases only its own
claim, so a retry can grade at once.

Ràng buộc tầng: file này KHÔNG import flask, faiss, ollama.
"""

from __future__ import annotations

from typing import Optional

from app.application.shared import _job_error_text

_TOTALS = ("score", "max_score", "percentage", "correct_count", "incorrect_count")


class _ClaimLost(Exception):
    """Another grader took the attempt over (this job outlived its lease)."""


def _stored_result(attempt_id: str) -> Optional[dict]:
    from app.domains.attempts import repository as _attempts

    a = _attempts.get_attempt(attempt_id)
    if a is None or a["status"] != "graded":
        return None
    meta = a.get("metadata") or {}
    return {**{k: a.get(k) for k in _TOTALS},
            "ungraded_count": int(meta.get("ungraded_count") or 0)}


def run_short_answer_grading_job(job_id: str, attempt_id: str,
                                 user_id: Optional[str] = None) -> None:
    """Chấm bài có câu tự luận (FR-08.3). Chấm CẢ attempt rồi ghi một lần."""
    from app.domains.attempts import repository as _attempts
    from app.domains.attempts import service as _grading_service
    from app.domains.jobs import ledger as _ledger
    from app.domains.jobs.jobs_store import update_job

    print(f"grading_job_running job_id={job_id}", flush=True)
    _ledger.open_job(job_id, job_type="short_answer_grading", user_id=user_id,
                     input_json={"attempt_id": attempt_id})
    claimed_at = None
    try:
        from app.application.attempts import job_active as _job_active
        from app.domains.jobs.jobs_store import get_job as _get_job

        # A redelivery of THIS job while its first delivery is alive (the job row is
        # `running` and fresh) must not grade, even if a long model call let the claim
        # expire (Codex re-check of ddafc7b).
        if ((_get_job(job_id) or {}).get("status") in ("running", "processing")
                and _job_active(job_id)):
            print(f"grading_job_duplicate job_id={job_id}", flush=True)
            return
        role, claimed_at = _attempts.start_grading_job(attempt_id, job_id)
        if role == "duplicate":
            # The queue delivered this job twice; the other delivery is grading.
            print(f"grading_job_duplicate job_id={job_id}", flush=True)
            return
        if role == "superseded":
            # Another job is the grader: end as a valid no-op, before any model call.
            update_job(job_id, status="done", progress=100, current_node="Superseded",
                       result={"attempt_id": attempt_id, "superseded": True})
            _ledger.close_job(job_id, "done", result_type="quiz_attempt", result_id=attempt_id)
            print(f"grading_job_superseded job_id={job_id}", flush=True)
            return
        result = None
        if role == "run":
            update_job(job_id, status="running", progress=20, current_node="Grading")

            def _progress(p, msg):
                # Người học đang ngồi chờ màn hình điểm. Không có dòng này thì job đứng ở
                # 20% suốt cả lượt chấm (1 lời gọi LLM mỗi câu tự luận) rồi nhảy 100%.
                # It is also the heartbeat, called before each model call: if the claim
                # was taken over, stop here instead of paying for another answer.
                update_job(job_id, progress=p, current_node=msg)
                if not _attempts.renew_claim(attempt_id, job_id):
                    raise _ClaimLost()

            try:
                result = _grading_service.grade_attempt(attempt_id, once=True,
                                                        progress_cb=_progress)
            except _ClaimLost:
                update_job(job_id, status="done", progress=100, current_node="Superseded",
                           result={"attempt_id": attempt_id, "superseded": True})
                _ledger.close_job(job_id, "done", result_type="quiz_attempt",
                                  result_id=attempt_id)
                print(f"grading_job_superseded job_id={job_id} (claim taken over)", flush=True)
                return
        no_op = result is None
        if no_op:
            # Already graded by someone else (or before this job started): that result
            # stands. Missing attempt: a real error, as before.
            result = _stored_result(attempt_id)
            if result is None:
                raise ValueError("Attempt không tồn tại.")
        update_job(job_id, status="done", progress=100, current_node="Grading",
                   result={"attempt_id": attempt_id, **result})
        _ledger.close_job(job_id, "done", result_type="quiz_attempt", result_id=attempt_id)
        print(f"grading_job_done job_id={job_id} attempt_id={attempt_id} "
              f"score={result['score']}/{result['max_score']} no_op={no_op}", flush=True)
    except Exception as e:
        if claimed_at is not None:
            _attempts.release_job_claim(attempt_id, job_id)
        update_job(job_id, status="error", error_text=_job_error_text(e))
        _ledger.close_job(job_id, "error", error_message=str(e))
        print(f"grading_job_failed job_id={job_id} err={str(e)[:80]}", flush=True)
