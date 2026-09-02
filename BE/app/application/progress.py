"""Use case tiến độ học — FR-12.

Mỏng nhất trong ba module của Phase 2C, và cố ý để vậy: `domains/progress/service.py`
đã tổng hợp xong số liệu. Việc còn lại ở tầng này chỉ là gói kết quả theo đúng hình
dạng API và áp bộ lọc `weak`.

Ba thứ KHÔNG nằm ở đây, có lý do cho từng thứ:

- **Cổng sở hữu tài liệu.** `_owned_document` có 12 caller trong `main.py`; kéo nó
  xuống đây là mở phạm vi ra ngoài batch. Route giữ cổng, và chỉ truyền xuống
  `document_id` đã qua cổng.
- **Kẹp `limit`.** Nó đọc `request.args` và trả 400 khi không phải số — thuần HTTP.
- **Cờ auth.** Như mọi use case từ Phase 2B: truyền vào, không tự đọc env.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional


def overview(user_id: Optional[str]) -> Dict[str, Any]:
    from app.domains.progress import service as _progress

    return _progress.overview(user_id)


def concepts(user_id: Optional[str], *, document_id: Optional[str],
             weak_only: bool) -> Dict[str, Any]:
    """Mastery theo concept qua nhiều attempt (FR-12.3, FR-12.4).

    `weak_only` ở đây là "chưa thành thạo" (`status != "mastered"`) — KHÁC với `weak`
    của `/api/attempts/<id>/concept-masteries`, nơi bộ lọc do `gap_analysis` áp. Hai
    khái niệm trùng tên, không trùng nghĩa; đừng gộp.
    """
    from app.domains.progress import service as _progress

    rows: List[Dict[str, Any]] = _progress.concept_progress(user_id, document_id=document_id)
    if weak_only:
        rows = [r for r in rows if r["status"] != "mastered"]
    return {"concepts": rows}


def attempt_history(user_id: Optional[str], *, limit: int) -> Dict[str, Any]:
    """`limit` đã được route kẹp về 1..200 — tầng này không kiểm lại."""
    from app.domains.progress import service as _progress

    return {"attempts": _progress.attempt_history(user_id, limit=limit)}
