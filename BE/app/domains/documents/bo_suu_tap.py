"""Bộ sưu tập — CRUD trên bảng `collections` (Phase 1B).

Tách khỏi `repository.py` vì đây là một thực thể khác, có vòng đời riêng: bộ sưu
tập sống được khi rỗng, và xoá nó KHÔNG xoá tài liệu nào (`ON DELETE SET NULL` —
tài liệu rơi về "chưa phân loại").

Phẳng, cố ý: không cha-con, không bộ sưu tập thông minh.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select

from app.db import session_scope
from app.db.models import Collection, Document

TEN_TOI_DA = 100
MAU_TOI_DA = 20
ICON_TOI_DA = 40

# Sentinel — `None` là GIÁ TRỊ hợp lệ (xoá màu, bỏ khỏi bộ sưu tập), nên nó không
# thể đồng thời mang nghĩa "không gửi trường này". Cùng khuôn `repository.KHONG_DOI`.
KHONG_DOI = object()


def _hang(c: Collection, so_tai_lieu: int = 0) -> Dict[str, Any]:
    return {
        "collection_id": c.id,
        "name": c.name,
        "color": c.color,
        "icon": c.icon,
        "sort_order": int(c.sort_order or 0),
        "archived_at": c.archived_at.isoformat() if c.archived_at else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "document_count": int(so_tai_lieu or 0),
    }


def liet_ke(user_id: Optional[str]) -> List[Dict[str, Any]]:
    """Mọi bộ sưu tập kèm số tài liệu — MỘT truy vấn, không đếm theo từng bộ.

    `outerjoin` chứ không phải join: một bộ sưu tập rỗng vẫn phải hiện ra, nếu không
    người dùng tạo xong bộ sưu tập rồi thấy nó biến mất cho tới khi bỏ tài liệu vào.
    Chỉ đếm tài liệu chưa xoá mềm — số đếm phải khớp thứ người dùng nhìn thấy.
    """
    with session_scope() as s:
        q = (select(Collection, func.count(Document.id))
             .outerjoin(Document, (Document.collection_id == Collection.id)
                        & (Document.status != "deleted"))
             .group_by(Collection.id)
             .order_by(Collection.sort_order, Collection.created_at))
        if user_id is not None:
            q = q.where(Collection.user_id == user_id)
        return [_hang(c, n) for c, n in s.execute(q).all()]


def lay(collection_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Bộ sưu tập của người khác đọc ra `None` — route biến nó thành 404, không 403:
    403 xác nhận id đó có thật, và đó là một oracle."""
    if not collection_id:
        return None
    with session_scope() as s:
        c = s.get(Collection, str(collection_id))
        if c is None:
            return None
        if user_id is not None and c.user_id != user_id:
            return None
        return _hang(c)


def tao(*, user_id: Optional[str], name: str, color: Optional[str] = None,
        icon: Optional[str] = None, sort_order: Optional[int] = None) -> Dict[str, Any]:
    """Thứ tự mặc định = cuối danh sách. Không truyền `sort_order` thì bộ sưu tập mới
    xuất hiện ở cuối chứ không chen lên đầu — chen lên là xáo trộn thứ tự người dùng
    đã tự sắp."""
    with session_scope() as s:
        if sort_order is None:
            q = select(func.coalesce(func.max(Collection.sort_order), -1))
            if user_id is not None:
                q = q.where(Collection.user_id == user_id)
            sort_order = int(s.execute(q).scalar() or -1) + 1
        c = Collection(user_id=user_id, name=name.strip(), color=color, icon=icon,
                       sort_order=int(sort_order))
        s.add(c)
        s.flush()
        s.refresh(c)
        return _hang(c)


def cap_nhat(collection_id: str, *, name: Any = KHONG_DOI, color: Any = KHONG_DOI,
             icon: Any = KHONG_DOI, sort_order: Any = KHONG_DOI,
             archived: Any = KHONG_DOI) -> bool:
    """Vá một phần — chỉ ghi trường được gửi."""
    with session_scope() as s:
        c = s.get(Collection, str(collection_id))
        if c is None:
            return False
        if name is not KHONG_DOI:
            c.name = str(name).strip()
        if color is not KHONG_DOI:
            c.color = color
        if icon is not KHONG_DOI:
            c.icon = icon
        if sort_order is not KHONG_DOI:
            c.sort_order = int(sort_order)
        if archived is not KHONG_DOI:
            c.archived_at = datetime.now(timezone.utc) if archived else None
    return True


def xoa(collection_id: str) -> bool:
    """Xoá bộ sưu tập. Tài liệu bên trong KHÔNG bị xoá — khoá ngoại `SET NULL` đưa
    chúng về "chưa phân loại". Dọn dẹp không được biến thành mất dữ liệu."""
    from app.domains.documents import repository as _docs

    with session_scope() as s:
        c = s.get(Collection, str(collection_id))
        if c is None:
            return False
        s.delete(c)
    _docs.invalidate_cache()   # `documents.collection_id` vừa đổi cho cả một nhóm
    return True
