"""Helper còn lại sau khi mindmap chuyển sang pipeline skeleton-first.

Chỉ còn MỘT hàm. `attach_mindmap_job_context` / `_notify_progress` và contextvar job đi
kèm đã bị xoá 2026-08-28: 0 caller. Đường progress thật của mindmap là `progress_cb` mà
`server.py` và `mindmap_factory` truyền xuống `pipeline/enrich.py`, không phải contextvar.
"""
from __future__ import annotations

from shared.source_id import canonical_source_stem


def collect_chunks_for_sources(meta: dict, source_names: list) -> list:
    """Collect chunks for the selected sources using canonical source stems."""
    wanted = {canonical_source_stem(s) for s in (source_names or []) if (s or "").strip()}
    wanted.discard("")
    out: list = []
    for key, entry in (meta or {}).items():
        if not isinstance(entry, dict):
            continue
        stem = canonical_source_stem(entry.get("source_stem") or "")
        if not stem or stem not in wanted:
            continue
        from app.domains.vectorstore import chunk_text_store

        text = (chunk_text_store.get_text(int(key)) or "").strip() or (entry.get("text") or "").strip()
        out.append(
            {
                "text": text,
                "key": key,
                "embedding": entry.get("embedding"),
            }
        )
    return out
