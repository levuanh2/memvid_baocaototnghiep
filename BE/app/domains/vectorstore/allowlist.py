"""Danh sách CHO PHÉP đưa tài liệu vào index production.

Một luật, và nó là luật DUY NHẤT ở đây:

    KHÔNG tài liệu nào vào index trừ khi có bản ghi tường minh với
    classification = CONFIRMED_PRODUCTION VÀ eligible_for_index = true.

Vắng mặt KHÔNG BAO GIỜ là cho phép. Không có bản ghi = không được index. Đây là điểm
khác biệt với mọi cách làm "lọc dữ liệu rác": danh sách chặn thì cái gì chưa nghĩ ra
sẽ lọt, danh sách cho phép thì cái gì chưa nghĩ ra sẽ bị chặn. Với một kho ngữ liệu
mà 5/11 tài liệu không phân loại nổi, đó là khác biệt giữa "an toàn" và "may".

PHÂN LOẠI và ĐƯỢC INDEX là HAI chuyện. `CONFIRMED_PRODUCTION` + `eligible=false` là
trạng thái hợp lệ và hay gặp. Mã ở đây KHÔNG được coi "không phải test" là "an toàn
để index" — chỉ có cờ tường minh mới cho phép.

Nguồn dữ liệu là một file JSON trong kho mã (`BE/config/`), không phải bảng DB: quyết
định "tài liệu này được vào index" là quyết định của con người và cần được review như
mã — qua pull request, có git blame. Bảng DB thì phải sửa schema production mới dùng
được.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

CONFIRMED_TEST = "CONFIRMED_TEST"
CONFIRMED_PRODUCTION = "CONFIRMED_PRODUCTION"
AMBIGUOUS = "AMBIGUOUS"
UNKNOWN = "UNKNOWN"

PHAN_LOAI_HOP_LE = frozenset({CONFIRMED_TEST, CONFIRMED_PRODUCTION, AMBIGUOUS, UNKNOWN})


class AllowlistError(RuntimeError):
    """File allowlist hỏng. KHÔNG suy diễn tiếp — hỏng thì không ai được index."""


def duong_dan_mac_dinh() -> Path:
    from shared.paths import BE_ROOT

    return Path(os.getenv("INDEX_ALLOWLIST_PATH")
                or (BE_ROOT / "config" / "production_index_allowlist.json"))


def tai(duong_dan: Optional[Path] = None) -> Dict[str, Dict[str, Any]]:
    """Đọc allowlist. Thiếu file → dict RỖNG, tức không ai được index.

    Thiếu file là "chưa ai quyết định gì", và câu trả lời đúng cho chuyện đó là
    "không index gì cả" — chứ không phải "index tất".
    """
    p = Path(duong_dan) if duong_dan is not None else duong_dan_mac_dinh()
    if not p.exists():
        return {}
    try:
        goc = json.loads(p.read_text(encoding="utf-8"))
    except Exception as exc:
        raise AllowlistError(f"không đọc được allowlist {p.name}: {type(exc).__name__}") from None
    muc = goc.get("documents") if isinstance(goc, dict) else None
    if not isinstance(muc, dict):
        raise AllowlistError(f"allowlist {p.name} thiếu khoá `documents`")

    ra: Dict[str, Dict[str, Any]] = {}
    for did, ban in muc.items():
        if not isinstance(ban, dict):
            raise AllowlistError(f"bản ghi {did!r} không phải object")
        pl = ban.get("classification")
        if pl not in PHAN_LOAI_HOP_LE:
            # Phân loại lạ có thể là lỗi gõ của một giá trị hợp lệ. Đoán hộ ở đây là
            # cách một lỗi chính tả biến thành một tài liệu được index.
            raise AllowlistError(
                f"bản ghi {did!r} có classification không hợp lệ: {pl!r}. "
                f"Chỉ nhận: {sorted(PHAN_LOAI_HOP_LE)}")
        if not isinstance(ban.get("eligible_for_index"), bool):
            raise AllowlistError(
                f"bản ghi {did!r} thiếu `eligible_for_index` kiểu bool")
        ra[str(did)] = ban
    return ra


def duoc_index(document_id: str, allowlist: Optional[Dict[str, Dict[str, Any]]] = None) -> bool:
    """Tài liệu này có được vào index production không.

    Đúng MỘT tổ hợp trả về True. Mọi thứ khác — không có bản ghi, AMBIGUOUS, UNKNOWN,
    CONFIRMED_TEST, hay CONFIRMED_PRODUCTION mà cờ tắt — đều là False.
    """
    if allowlist is None:
        allowlist = tai()
    ban = allowlist.get(str(document_id))
    if not isinstance(ban, dict):
        return False
    return (ban.get("classification") == CONFIRMED_PRODUCTION
            and ban.get("eligible_for_index") is True)


def loc_ban_ghi(ban_ghi: Iterable[Dict[str, Any]],
                allowlist: Optional[Dict[str, Dict[str, Any]]] = None,
                ) -> List[Dict[str, Any]]:
    """Giữ lại chỉ những chunk thuộc tài liệu được phép index."""
    if allowlist is None:
        allowlist = tai()
    return [b for b in ban_ghi if duoc_index(b.get("document_id", ""), allowlist)]


def tom_tat(ban_ghi: Iterable[Dict[str, Any]],
            allowlist: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Đếm theo trạng thái cho phép, để báo cáo và để test khẳng định."""
    if allowlist is None:
        allowlist = tai()
    tai_lieu: Dict[str, int] = {}
    for b in ban_ghi:
        did = str(b.get("document_id", ""))
        tai_lieu[did] = tai_lieu.get(did, 0) + 1

    ra = {"eligible_documents": 0, "eligible_chunks": 0,
          "blocked_documents": 0, "blocked_chunks": 0,
          "ambiguous_documents": 0, "ambiguous_chunks": 0,
          "unknown_documents": 0, "unknown_chunks": 0,
          "khong_co_ban_ghi_documents": 0, "khong_co_ban_ghi_chunks": 0}
    for did, n in tai_lieu.items():
        ban = allowlist.get(did)
        if ban is None:
            ra["khong_co_ban_ghi_documents"] += 1
            ra["khong_co_ban_ghi_chunks"] += n
        pl = (ban or {}).get("classification")
        if duoc_index(did, allowlist):
            ra["eligible_documents"] += 1
            ra["eligible_chunks"] += n
        else:
            ra["blocked_documents"] += 1
            ra["blocked_chunks"] += n
        if pl == AMBIGUOUS:
            ra["ambiguous_documents"] += 1
            ra["ambiguous_chunks"] += n
        elif pl == UNKNOWN:
            ra["unknown_documents"] += 1
            ra["unknown_chunks"] += n
    return ra
