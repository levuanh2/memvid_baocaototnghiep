"""Use case: sinh sơ đồ tư duy (Mindmap v3).

Chuyển từ `app/main.py` ở Phase 1 — **di chuyển nguyên trạng**, không refactor logic,
không đổi thứ tự xử lý, không đổi cách bắt lỗi, không đổi mốc trạng thái.

`app.main.run_mindmap_job` vẫn còn dưới dạng wrapper mỏng: RQ serialize hàm theo
`module.qualname`, nên job ĐANG NẰM TRONG HÀNG ĐỢI vẫn resolve được sau khi deploy.

Ràng buộc tầng: file này KHÔNG import flask, faiss, ollama.
"""

from __future__ import annotations

import os
import uuid
from typing import Any, Optional

from app.application.shared import _job_error_text, _langgraph_invoke

def run_mindmap_job(job_id: str, source_names: list[str], mm_input: dict,
                    content_hash: str, user_id: Optional[str] = None,
                    *, graph: Any = None, already_claimed: bool = False) -> None:
    """Mindmap v3 execution body. Runs in a daemon thread (QUEUE_ENABLED=false) OR an RQ
    worker process (QUEUE_ENABLED=true) — identical behaviour, no Flask request context
    needed. Enqueued by dotted path `app.main.run_mindmap_job`. The graph owns the
    done/result write (atomic); this wraps errors -> job error. Cancellation uses the
    existing cooperative flag (mindmap graph `_guard` checks jobs_store cancel_requested)."""
    print(f"mindmap_job_running job_id={job_id}", flush=True)
    lease_owner = f"mindmap:{os.getpid()}:{uuid.uuid4().hex[:8]}"
    from app.domains.jobs import guided_store
    if not already_claimed:
        if guided_store.use_postgres():
            current = guided_store.get_job(job_id, user_id=user_id)
            # `current is None` means this job_id was never inserted into the
            # guided ledger at all -- i.e. it's a legacy V2 job (guided_store
            # only tracks Guided V3 jobs, see its module docstring), not an
            # unclaimed Guided job. Only reject when the job IS in the ledger
            # but wasn't actually claimed (no lease_owner) -- that's the real
            # duplicate-invocation guard this branch exists for.
            if current is not None and not current.get("lease_owner"):
                print(f"mindmap_job_not_claimed job_id={job_id}", flush=True)
                return
        else:
            from app.domains.jobs.jobs_store import claim_job
            if not claim_job(job_id, lease_owner, lease_seconds=int(os.getenv("GUIDED_JOB_LEASE_SECONDS", "900"))):
                print(f"mindmap_job_not_claimed job_id={job_id}", flush=True)
                return
    from app.graphs.logger import begin_llm_count, flush_llm_count
    _llm_counter = begin_llm_count()
    try:
        from app.domains.jobs.jobs_store import update_job as _uj
        try:
            if guided_store.use_postgres():
                guided_store.update_job(job_id, status="running", stage="generating", current_node="Mindmap", heartbeat=True)
            else:
                _uj(job_id, status="running", current_node="Mindmap")
        except Exception:
            pass
        if graph is None:
            raise RuntimeError("MINDMAP_GRAPH chưa khởi tạo — kiểm tra logs khởi động.")
        _langgraph_invoke(graph, {
            "job_id": job_id, "source_names": source_names, "mm_input": mm_input,
            "content_hash": content_hash, "user_id": user_id,  # Phase D: record owner
            "progress": 0, "current_node": "", "error": None,
        }, thread_id=job_id)
        print(f"mindmap_job_done job_id={job_id}", flush=True)
    except Exception as e:
        if guided_store.use_postgres():
            guided_store.update_job(job_id, status="failed", stage="failed", error_code="generation_failed", error_message=_job_error_text(e))
        else:
            from app.domains.jobs.jobs_store import update_job
            update_job(job_id, status="error", error_text=_job_error_text(e))
        print(f"mindmap_job_failed job_id={job_id} err={str(e)[:80]}", flush=True)
    finally:
        flush_llm_count(job_id, _llm_counter)
