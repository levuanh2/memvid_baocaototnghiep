"""Nhóm NKS → vai trò StudyMap.

BẮT BUỘC phải có tầng này, không phải cho đẹp: `users.role` có ràng buộc
`ck_users_role CHECK (role IN ('learner','teacher','admin'))`. Ghi thẳng "Manager"
hay "Student" vào cột đó là INSERT chết ngay ở tầng DB.

Bảng để trong adapter: lõi domain không được biết NKS có những nhóm gì. Sửa được
bằng env `NKS_ROLE_MAP="Manager:admin,teacher:teacher"` để đổi ánh xạ không cần deploy.

Khoá là `role.name` của NKS, KHÔNG phải `role_id` — xem `mapper._ten_nhom`.
"""

from __future__ import annotations

import os

VAI_TRO_HOP_LE = ("learner", "teacher", "admin")
MAC_DINH = "learner"

# ĐO ĐƯỢC 2026-09-07 trên sáu tài khoản test in trong `docs/NKS API.md`, đọc
# `data.role` của `/nks/user`:
#
#   nhãn tài liệu │ role_id │ role.name  │ StudyMap
#   ──────────────┼─────────┼────────────┼──────────
#   Manager       │   11    │ "Manager"  │ admin
#   Faculty       │    8    │ "teacher"  │ teacher
#   Driver        │    2    │ "user"     │ learner
#   Student       │    2    │ "user"     │ learner
#   Member        │  null   │  (vắng)    │ learner
#
# Bảng cũ khoá theo NHÃN TRONG TÀI LIỆU ("faculty", "student", "driver", "member",
# "citizen", "customer"). Không nhãn nào trong số đó là giá trị API trả về — API
# nói "teacher" và "user" — nên ngoài "manager" thì không khoá nào từng khớp.
# Chỉ ba giá trị dưới đây là thứ đã QUAN SÁT ĐƯỢC; giá trị lạ vẫn về `learner`.
MAC_DINH_MAP = {
    "manager": "admin",
    "teacher": "teacher",
    "user": "learner",
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
