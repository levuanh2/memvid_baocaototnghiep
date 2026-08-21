"""Sổ cái job trong Postgres (bảng `jobs`, đặc tả 5.18).

**Không** thay `jobs_store` (SQLite). Hai bảng giữ hai thứ khác nhau:

- `jobs_store` (SQLite, cùng máy): trạng thái runtime — progress từng %, `current_node`,
  và **token buffer của chat** (`append_token` ghi mỗi token). Đẩy thứ đó sang pooler
  ap-northeast-2 là tự sát về độ trễ.
- `jobs` (Postgres): sổ cái kiểm toán — ai chạy, cấu hình vào, kết quả ra, trạng thái
  cuối. `ai_validation_logs.job_id` là FK trỏ vào đây, nên không có bảng này thì mọi log
  validation mất dấu job sinh ra nó.

Vì thế Postgres chỉ ghi **2 lần cho mỗi job** (mở + đóng), `progress` để nguyên 0 — cột
progress ở đây không phải nguồn sự thật, `jobs_store` mới là.

Mọi hàm nuốt lỗi: sổ kiểm toán hỏng không được làm hỏng job đang chạy.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

# jobs_store dùng 'done'/'error'; CHECK của Postgres chỉ nhận tập dưới đây.
STATUS_MAP = {
    "done": "completed",
    "error": "failed",
    "completed": "completed",
    "failed": "failed",
    "cancelled": "cancelled",
    "timeout": "timeout",
    "running": "running",
    "pending": "pending",
}


def open_job(job_id: str, *, job_type: str, user_id: Optional[str],
             input_json: Optional[Dict[str, Any]] = None) -> bool:
    from app.db import session_scope
    from app.db.models import Job

    try:
        with session_scope() as s:
            if s.get(Job, str(job_id)) is not None:
                return True
            s.add(Job(id=str(job_id), user_id=user_id, job_type=job_type,
                      status="running", progress=0, input_json=input_json))
        return True
    except Exception as exc:
        print(f"[jobs ledger] mở job thất bại: {exc}", flush=True)
        return False


def close_job(job_id: str, status: str, *, result_type: Optional[str] = None,
              result_id: Optional[str] = None, error_message: Optional[str] = None) -> None:
    from app.db import session_scope
    from app.db.models import Job

    try:
        with session_scope() as s:
            job = s.get(Job, str(job_id))
            if job is None:
                return
            job.status = STATUS_MAP.get(status, "failed")
            job.progress = 100 if job.status == "completed" else job.progress
            if result_type:
                job.result_type = result_type
            if result_id:
                job.result_id = result_id
            if error_message:
                job.error_message = error_message[:2000]
    except Exception as exc:
        print(f"[jobs ledger] đóng job thất bại: {exc}", flush=True)
