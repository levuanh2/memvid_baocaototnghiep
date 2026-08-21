"""API tìm kiếm ngữ nghĩa (FR-05).

Dùng lại `HybridRetriever` của chat — không dựng đường tìm kiếm thứ hai, hai
đường sẽ lệch nhau. Khác biệt duy nhất: chat cần văn bản để nhồi prompt, còn API
này cần **khoá nghiệp vụ**, nên mỗi hit được tra ngược từ `embedding_id` (int
FAISS) sang `document_chunks.id` (UUID) + `section_id`.

Chunk có trong FAISS nhưng không có trong Postgres (index dựng trước Phase 2) sẽ
bị bỏ: trả về `chunk_id` bịa còn tệ hơn trả thiếu.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

_lock = threading.Lock()
_retrievers: Dict[str, Any] = {}


def get_retriever(index_meta_path: Path):
    """Một retriever cho mỗi index. Cache theo path — `_ensure_loaded` tự nạp lại
    khi file index đổi mtime, nên giữ instance là an toàn."""
    from app.domains.retrieval.hybrid import HybridRetriever

    key = str(index_meta_path)
    with _lock:
        r = _retrievers.get(key)
        if r is None:
            r = HybridRetriever(
                index_path=Path(index_meta_path).with_name("index.faiss"),
                meta_path=Path(index_meta_path),
            )
            _retrievers[key] = r
        return r


def reset_cache() -> None:
    with _lock:
        _retrievers.clear()


def semantic_search(query: str, *, index_meta_path: Path,
                    source_stems: Optional[List[str]] = None,
                    top_k: int = 5,
                    user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Kết quả đã lọc theo quyền sở hữu (FR-05.5).

    `score` là điểm RRF (hợp nhất BM25 + vector) — chỉ so sánh được giữa các kết
    quả trong CÙNG một lần gọi, không phải độ tương đồng 0..1.
    """
    from app.domains.documents import repository as docs_repo

    q = (query or "").strip()
    if not q:
        return []

    hits = get_retriever(index_meta_path).retrieve_scored(
        q, selected_sources=list(source_stems or []) or None, top_k=int(top_k),
    )
    if not hits:
        return []

    found = docs_repo.lookup_by_embedding_ids(
        [str(c.chunk_id) for c, _ in hits], user_id=user_id,
    )
    out: List[Dict[str, Any]] = []
    for chunk, score in hits:
        row = found.get(str(chunk.chunk_id))
        if not row:
            continue
        out.append({
            "chunk_id": row["chunk_id"],
            "document_id": row["document_id"],
            "document_title": row["document_title"],
            "section_id": row["section_id"],
            "chunk_index": row["chunk_index"],
            "score": round(float(score), 6),
            "text": chunk.text,
        })
    return out
