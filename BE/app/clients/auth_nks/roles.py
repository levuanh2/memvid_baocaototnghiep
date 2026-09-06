"""Nhóm NKS → vai trò StudyMap.

BẮT BUỘC phải có tầng này, không phải cho đẹp: `users.role` có ràng buộc
`ck_users_role CHECK (role IN ('learner','teacher','admin'))`. Ghi thẳng "Manager"
hay "Student" vào cột đó là INSERT chết ngay ở tầng DB.

Bảng để trong adapter: lõi domain không được biết NKS có những nhóm gì. Sửa được
bằng env `NKS_ROLE_MAP="Manager:admin,Faculty:teacher"` để đổi ánh xạ không cần deploy.
"""

from __future__ import annotations

import os

VAI_TRO_HOP_LE = ("learner", "teacher", "admin")
MAC_DINH = "learner"

# Bảy nhóm nêu trong tài liệu NKS. CHƯA XÁC MINH bằng phản hồi thật — tên trường
# chứa nhóm vẫn là UNKNOWN (xem mapper.py), nên bảng này là điểm khởi đầu hợp lý
# chứ không phải sự thật đã đo.
MAC_DINH_MAP = {
    "manager": "admin",
    "faculty": "teacher",
    "student": "learner",
    "member": "learner",
    "citizen": "learner",
    "customer": "learner",
    "driver": "learner",
}


def _map_tu_env() -> dict[str, str]:
    raw = (os.getenv("NKS_ROLE_MAP") or "").strip()
    if not raw:
        return {}
    out: dict[str, str] = {}
    for cap in raw.split(","):
        if ":" not in cap:
            continue
        k, v = cap.split(":", 1)
        v = v.strip().lower()
        if k.strip() and v in VAI_TRO_HOP_LE:
            out[k.strip().lower()] = v
    return out


def map_role(nhom: str | None) -> str:
    """Nhóm NKS → vai trò StudyMap. Không biết thì `learner` — quyền THẤP NHẤT.

    Mặc định phải là quyền thấp nhất: một nhóm lạ (NKS thêm nhóm mới) mà rơi vào
    `admin` là leo thang đặc quyền im lặng.
    """
    if not nhom:
        return MAC_DINH
    key = str(nhom).strip().lower()
    if not key:
        return MAC_DINH
    return {**MAC_DINH_MAP, **_map_tu_env()}.get(key, MAC_DINH)
