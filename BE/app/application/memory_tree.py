"""Use case: dựng Memory Tree cho các nguồn đã cho.

Chuyển từ `app/main.py` ở Phase 1 — **di chuyển nguyên trạng**, không refactor logic,
không đổi thứ tự xử lý, không đổi cách bắt lỗi, không đổi mốc trạng thái.

`app.main.run_memory_tree_job` vẫn còn dưới dạng wrapper mỏng: RQ serialize hàm theo
`module.qualname`, nên job ĐANG NẰM TRONG HÀNG ĐỢI vẫn resolve được sau khi deploy.

Ràng buộc tầng: file này KHÔNG import flask, faiss, ollama.
"""

from __future__ import annotations

from typing import List

from app.domains.memory.tree import build_memory_tree_for_sources

def run_memory_tree_job(source_stems: List[str]):
    """Build Memory Tree for the given sources. Runs in a daemon thread
    (QUEUE_ENABLED=false) OR an RQ worker process (QUEUE_ENABLED=true) — identical
    behaviour, no Flask request context. Enqueued by dotted path
    `app.main.run_memory_tree_job`. Fire-and-forget: there is no per-job status store
    today (results land in memory_trees.json, surfaced by /memory-tree-status); errors are
    logged, not persisted, matching the existing contract."""
    print(f"memory_tree_job_running sources={source_stems}", flush=True)
    try:
        build_memory_tree_for_sources(source_stems)
        print(f"memory_tree_job_done sources={source_stems}", flush=True)
    except Exception as exc:
        import traceback
        traceback.print_exc()
        print(f"memory_tree_job_failed sources={source_stems} err={str(exc)[:80]}", flush=True)
