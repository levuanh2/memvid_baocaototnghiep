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
    # CHECK của Postgres không có 'interrupted'. Map TƯỜNG MINH sang 'failed': rơi vào
    # default cũng ra 'failed' nhưng khi đó không ai phân biệt được cố ý với bỏ sót.
    "interrupted": "failed",
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


# Trạng thái cuối trong jobs_store (SQLite). Sổ cái phải theo được những trạng thái này.
_KET_THUC = ("done", "error", "cancelled", "timeout", "interrupted")


def dong_theo_jobs_store(*, qua_han_giay: int = 86400) -> int:
    """Đồng bộ những hàng `running` trong sổ cái với trạng thái thật ở `jobs_store`.

    Vì sao cần: `close_job` chỉ được gọi từ đường job chạy xong bình thường. Bốn đường
    kết thúc còn lại — `sweep_stuck_jobs`, `mark_interrupted_jobs`,
    `reconcile_interrupted`, `request_cancel` — **chỉ ghi SQLite**. Hàng Postgres tương
    ứng nằm `running` vĩnh viễn, nên sổ kiểm toán (thứ `ai_validation_logs.job_id` trỏ
    vào) không bao giờ khớp với chuyện đã xảy ra.

    Hai luật, cả hai đều nói được thành lời:
    1. SQLite có hàng và đã ở trạng thái cuối  -> đóng theo đúng trạng thái đó.
    2. SQLite KHÔNG còn hàng (đã prune) và hàng sổ cái cũ hơn `qua_han_giay`
       -> đóng là `failed`, kèm lý do nói rõ là suy ra chứ không quan sát được.

    Hàng `running` mới mà SQLite chưa có thì để yên: job vừa mở, chưa kịp ghi.

    Trả số hàng đã đóng. Nuốt lỗi như mọi hàm khác trong sổ cái.
    """
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import select

    from app.db import session_scope
    from app.db.models import Job
    from app.domains.jobs.jobs_store import get_job

    dong = 0
    try:
        moc = datetime.now(timezone.utc) - timedelta(seconds=max(0, qua_han_giay))
        with session_scope() as s:
            rows = s.execute(select(Job).where(Job.status == "running")).scalars().all()
            for job in rows:
                that = get_job(str(job.id))
                if that is not None:
                    if that.get("status") not in _KET_THUC:
                        continue
                    job.status = STATUS_MAP.get(that.get("status"), "failed")
                    job.progress = 100 if job.status == "completed" else job.progress
                    if that.get("error_text") and not job.error_message:
                        job.error_message = str(that["error_text"])[:2000]
                    dong += 1
                    continue
                created = job.created_at
                if created is None or (created.tzinfo and created > moc):
                    continue
                job.status = "failed"
                job.error_message = (job.error_message
                                     or "Không còn dấu vết trong jobs_store (đã prune) — "
                                        "trạng thái cuối được suy ra, không quan sát được.")
                dong += 1
    except Exception as exc:
        print(f"[jobs ledger] đồng bộ sổ cái thất bại: {exc}", flush=True)
        return 0
    if dong:
        print(f"jobs_ledger_dong_bo dong={dong}", flush=True)
    return dong
