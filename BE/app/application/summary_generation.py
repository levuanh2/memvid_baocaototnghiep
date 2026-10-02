"""Use case: sinh tóm tắt (Summary v2).

Chuyển từ `app/main.py` ở Phase 1 — **di chuyển nguyên trạng**, không refactor logic,
không đổi thứ tự xử lý, không đổi cách bắt lỗi, không đổi mốc trạng thái.

`app.main.run_summary_job` vẫn còn dưới dạng wrapper mỏng: RQ serialize hàm theo
`module.qualname`, nên job ĐANG NẰM TRONG HÀNG ĐỢI vẫn resolve được sau khi deploy.

Ràng buộc tầng: file này KHÔNG import flask, faiss, ollama.
"""

from __future__ import annotations

from typing import Any, Optional

from app.application.shared import _job_error_text, _langgraph_invoke

def run_summary_job(job_id: str, source_names: list[str], mm_input: dict,
                    content_hash: str, length_mode: str, user_id: Optional[str] = None,
                    mode: str = "standard", usage_context_data: Optional[dict] = None,
                    *, graph: Any = None) -> None:
    """Summary v2 execution body. Runs in a daemon thread (QUEUE_ENABLED=false) OR an RQ
    worker process (QUEUE_ENABLED=true) — identical behaviour, no Flask request context
    needed. Enqueued by dotted path `app.main.run_summary_job`. The graph owns the
    done/result write (atomic); this wraps errors -> job error. Cancellation uses the
    existing cooperative flag (summary graph `_guard` checks jobs_store cancel_requested)."""
    print(f"summary_job_running job_id={job_id}", flush=True)
    # Phase 0 observability: counter LLM call per-job (pipeline pool propagate
    # qua ctx_submit); flush thành node event "LLMCalls" kể cả khi job lỗi.
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
            from app.domains.jobs.jobs_store import update_job
            import json
            update_job(job_id, usage_summary_json=json.dumps(usage or {}, ensure_ascii=False))
        except Exception:
            pass
    _llm_counter = begin_llm_count()
    try:
        from app.domains.jobs.jobs_store import update_job as _uj
        try:
            _uj(job_id, status="running", current_node="Summary")
        except Exception:
            pass
        if graph is None:
            raise RuntimeError("SUMMARY_GRAPH chưa khởi tạo — kiểm tra logs khởi động.")
        result_state = _langgraph_invoke(graph, {
            "job_id": job_id, "source_names": source_names, "mm_input": mm_input,
            "content_hash": content_hash, "length_mode": length_mode, "mode": mode,
            "user_id": user_id,  # Phase D: persisted onto the summary record (owner)
            "usage_context": usage_context.to_dict() if usage_context else None,
            "progress": 0, "current_node": "", "error": None,
        }, thread_id=job_id)
        if result_state.get("error") or result_state.get("cancelled"):
            usage = (
                get_operation_usage(
                    usage_context.reservation_id, user_id=usage_context.user_id,
                )
                if usage_context else None
            )
            _finish("failed" if usage and usage.get("total_tokens", 0) else "released")
            if result_state.get("cancelled"):
                _uj(job_id, status="cancelled", progress=0, current_node="Cancelled")
            else:
                _uj(
                    job_id, status="error", progress=0,
                    current_node="ErrorHandler",
                    error_text=str(result_state.get("error") or "unknown error"),
                )
        else:
            _finish("committed")
            _uj(
                job_id, status="done", progress=100,
                current_node="AssemblePersist", result=result_state.get("result"),
            )
        print(f"summary_job_done job_id={job_id}", flush=True)
    except Exception as e:
        from app.domains.jobs.jobs_store import update_job
        update_job(job_id, status="error", error_text=_job_error_text(e))
        usage = (get_operation_usage(usage_context.reservation_id, user_id=usage_context.user_id)
                 if usage_context else None)
        _finish("failed" if usage and usage.get("total_tokens", 0) else "released")
        print(f"summary_job_failed job_id={job_id} err={str(e)[:80]}", flush=True)
    finally:
        flush_llm_count(job_id, _llm_counter)
