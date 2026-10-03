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
                    usage_context_data: Optional[dict] = None, *, graph: Any = None,
                    already_claimed: bool = False) -> None:
    """Mindmap v3 execution body. Runs in a daemon thread (QUEUE_ENABLED=false) OR an RQ
    worker process (QUEUE_ENABLED=true) — identical behaviour, no Flask request context
    needed. Enqueued by dotted path `app.main.run_mindmap_job`. The graph owns the
    done/result write (atomic); this wraps errors -> job error. Cancellation uses the
    existing cooperative flag (mindmap graph `_guard` checks jobs_store cancel_requested)."""
    print(f"mindmap_job_running job_id={job_id}", flush=True)
    lease_owner = f"mindmap:{os.getpid()}:{uuid.uuid4().hex[:8]}"
    from app.domains.jobs import guided_store
    guided_job = None
    if guided_store.use_postgres():
        guided_job = guided_store.get_job(job_id, user_id=user_id)
    is_guided_job = guided_job is not None
    if not already_claimed:
        if guided_store.use_postgres():
            # `current is None` means this job_id was never inserted into the
            # guided ledger at all -- i.e. it's a legacy V2 job (guided_store
            # only tracks Guided V3 jobs, see its module docstring), not an
            # unclaimed Guided job. Only reject when the job IS in the ledger
            # but wasn't actually claimed (no lease_owner) -- that's the real
            # duplicate-invocation guard this branch exists for.
            if guided_job is not None and not guided_job.get("lease_owner"):
                print(f"mindmap_job_not_claimed job_id={job_id}", flush=True)
                return
        else:
            from app.domains.jobs.jobs_store import claim_job
            if not claim_job(job_id, lease_owner, lease_seconds=int(os.getenv("GUIDED_JOB_LEASE_SECONDS", "900"))):
                print(f"mindmap_job_not_claimed job_id={job_id}", flush=True)
                return
    from app.graphs.logger import begin_llm_count, flush_llm_count
    from app.domains.usage import (
        UsageReservationContext, finalize_reservation, get_operation_usage,
    )
    usage_context = UsageReservationContext.from_dict(usage_context_data)

    def _finish(status: str) -> None:
        if usage_context is None:
            return
        finalize_reservation(usage_context.reservation_id, status=status)
        usage = get_operation_usage(
            usage_context.reservation_id, user_id=usage_context.user_id,
        )
        try:
            if is_guided_job:
                guided_store.update_job(job_id, usage_summary=usage or {})
            else:
                from app.domains.jobs.jobs_store import update_job
                import json
                update_job(job_id, usage_summary_json=json.dumps(usage or {}, ensure_ascii=False))
        except Exception:
            pass
    _llm_counter = begin_llm_count()
    try:
        from app.domains.jobs.jobs_store import update_job as _uj
        try:
            if is_guided_job:
                guided_store.update_job(job_id, status="running", stage="generating", current_node="Mindmap", heartbeat=True)
            else:
                _uj(job_id, status="running", current_node="Mindmap")
        except Exception:
            pass
        if graph is None:
            raise RuntimeError("MINDMAP_GRAPH chưa khởi tạo — kiểm tra logs khởi động.")
        result_state = _langgraph_invoke(graph, {
            "job_id": job_id, "source_names": source_names, "mm_input": mm_input,
            "content_hash": content_hash, "user_id": user_id,  # Phase D: record owner
            "usage_context": usage_context.to_dict() if usage_context else None,
            "progress": 0, "current_node": "", "error": None,
        }, thread_id=job_id)
        if result_state.get("cancelled"):
            usage = (get_operation_usage(usage_context.reservation_id, user_id=usage_context.user_id)
                     if usage_context else None)
            _finish("failed" if usage and usage.get("total_tokens", 0) else "released")
            if is_guided_job:
                guided_store.update_job(job_id, status="cancelled", stage="cancelled")
            else:
                _uj(job_id, status="cancelled", progress=0, current_node="Cancelled")
        elif result_state.get("error"):
            usage = (get_operation_usage(usage_context.reservation_id, user_id=usage_context.user_id)
                     if usage_context else None)
            _finish("failed" if usage and usage.get("total_tokens", 0) else "released")
            error_text = str(result_state.get("error") or "unknown error")
            if is_guided_job:
                guided_store.update_job(
                    job_id, status="failed", stage="failed",
                    error_code="generation_failed", error_message=error_text,
                )
            else:
                _uj(
                    job_id, status="error", progress=0,
                    current_node="ErrorHandler", error_text=error_text,
                )
        else:
            _finish("committed")
            record = result_state.get("result") or {}
            if is_guided_job:
                guided_store.update_job(
                    job_id, status="done", stage="done",
                    result_map_id=record.get("id"), result=record,
                )
            else:
                _uj(
                    job_id, status="done", progress=100,
                    current_node="AssemblePersist", result=record,
                    result_map_id=record.get("id"),
                )
        print(f"mindmap_job_done job_id={job_id}", flush=True)
    except Exception as e:
        if is_guided_job:
            guided_store.update_job(job_id, status="failed", stage="failed", error_code="generation_failed", error_message=_job_error_text(e))
        else:
            from app.domains.jobs.jobs_store import update_job
            update_job(job_id, status="error", error_text=_job_error_text(e))
        usage = (get_operation_usage(usage_context.reservation_id, user_id=usage_context.user_id)
                 if usage_context else None)
        _finish("failed" if usage and usage.get("total_tokens", 0) else "released")
        print(f"mindmap_job_failed job_id={job_id} err={str(e)[:80]}", flush=True)
    finally:
        flush_llm_count(job_id, _llm_counter)
