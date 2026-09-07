"""Phản hồi NKS → `InternalIdentity`.

**Lược đồ "User Info" của NKS CHƯA XÁC MINH.** Tài liệu `NKS API.md` không có trong
kho, và không lấy được phản hồi thành công vì không có tài khoản thật. Đo được chỉ
gồm envelope lỗi:

    {"success": false, "code": 500, "error": "...", "message": "Unauthorized"}

Vì vậy file này **dò theo danh sách tên trường ứng viên** thay vì bịa một lược đồ.
Luật: không tìm thấy định danh thì NÉM `NksProtocolError`, TUYỆT ĐỐI không tự sinh
một id thay thế — một id bịa sẽ âm thầm gộp hai người NKS khác nhau vào một tài
khoản StudyMap.

Có phản hồi thật rồi thì rút danh sách ứng viên xuống đúng một tên và xoá ghi chú này.

**Cập nhật 2026-09-07 — đã có phản hồi thật.** Đo trên sáu tài khoản test in trong
`docs/NKS API.md`: `data` là object người dùng phẳng, 56 trường, `id` là số nguyên,
`email`/`name` có thật, và `role` là OBJECT `{"id", "name"}` (hoặc `null`). Chỉ
đường đọc NHÓM được sửa theo phép đo đó (xem `_ten_nhom`); các danh sách ứng viên
còn lại giữ nguyên vì thu hẹp chúng là việc riêng, không thuộc bản sửa lỗi vai trò.
"""

from __future__ import annotations

from typing import Any, Mapping

from shared.interfaces.auth import InternalIdentity

from .errors import NksProtocolError
from .roles import map_role

PROVIDER = "nks"

# Thứ tự = ưu tiên. Tên nào cũng CHƯA XÁC MINH.
UNG_VIEN_ID = ("id", "user_id", "userId", "uid", "member_id", "nks_id", "code")
UNG_VIEN_EMAIL = ("email", "mail", "email_address")
UNG_VIEN_TEN = ("full_name", "fullname", "name", "display_name", "username")
UNG_VIEN_NHOM = ("group", "type", "role", "user_type", "group_name", "member_type")
UNG_VIEN_TOKEN = ("access_token", "accessToken", "token")


def _boc(body: Mapping[str, Any]) -> Mapping[str, Any]:
    """Lấy phần dữ liệu. NKS bọc trong `data`/`user`/`result` hay để phẳng — chưa rõ."""
    for khoa in ("data", "user", "result", "user_info", "userInfo"):
        v = body.get(khoa)
        if isinstance(v, Mapping) and v:
            return v
    return body


def _lay(d: Mapping[str, Any], ung_vien: tuple[str, ...]) -> Any:
    for k in ung_vien:
        v = d.get(k)
        if v not in (None, ""):
            return v
    return None


def _ten_nhom(d: Mapping[str, Any]) -> str | None:
    """Tên nhóm NKS dưới dạng chuỗi, hoặc `None`.

    Phản hồi thật (đo 2026-09-07) để `role` là một OBJECT, và có thể là `null` hẳn:

        "role": {"id": 8, "name": "teacher"},   ← tài khoản Faculty
        "role": null,                            ← tài khoản Member
        "role_id": 8,

    `_lay` lấy đúng khoá `role` nhưng nhận về một `dict`. Bản trước lọc
    `isinstance(nhom, (str, int))` ngay tại chỗ gọi, nên `dict` rơi thành `None` và
    `map_role(None)` trả `learner` — MỌI người dùng NKS thành learner, kể cả
    Manager. Bảng ánh xạ có đúng tới đâu cũng vô nghĩa khi giá trị không tới được nó.

    `role_id` cố ý KHÔNG dùng làm nguồn thay thế: nó là số nội bộ của NKS, và đổi
    một hàng trong bảng roles bên họ sẽ khiến StudyMap cấp nhầm quyền mà không ai
    biết. Chỉ `role.name` mới quyết định vai trò.
    """
    nhom = _lay(d, UNG_VIEN_NHOM)
    if isinstance(nhom, Mapping):
        nhom = nhom.get("name")
    return nhom if isinstance(nhom, (str, int)) else None


def doc_access_token(body: Mapping[str, Any]) -> str:
    """Rút access_token khỏi phản hồi login. Giá trị KHÔNG được log ở bất kỳ đâu."""
    tok = _lay(body, UNG_VIEN_TOKEN) or _lay(_boc(body), UNG_VIEN_TOKEN)
    if not tok or not isinstance(tok, str):
        raise NksProtocolError("phản hồi đăng nhập NKS không có access_token")
    return tok


def to_identity(body: Mapping[str, Any]) -> InternalIdentity:
    """User Info → InternalIdentity. Thiếu định danh ⇒ ném, không đoán."""
    if not isinstance(body, Mapping):
        raise NksProtocolError("User Info của NKS không phải object")
    d = _boc(body)

    raw_id = _lay(d, UNG_VIEN_ID)
    if raw_id in (None, ""):
        raise NksProtocolError(
            "User Info của NKS không có trường định danh nào nhận ra được")

    email = _lay(d, UNG_VIEN_EMAIL)
    ten = _lay(d, UNG_VIEN_TEN)
    nhom = _ten_nhom(d)

    return InternalIdentity(
        provider=PROVIDER,
        provider_user_id=str(raw_id),
        email=str(email).strip().lower() if email else None,
        display_name=str(ten).strip() if ten else None,
        role=map_role(nhom),
        # Chỉ nhóm thô để chẩn đoán ánh xạ. KHÔNG có token, KHÔNG có mật khẩu.
        metadata={"nks_group": str(nhom)} if nhom else {},
    )
