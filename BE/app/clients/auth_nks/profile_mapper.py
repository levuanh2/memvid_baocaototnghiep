"""Hồ sơ NKS ↔ `ExternalProfile`. Danh sách TRẮNG, hai chiều.

Vì sao phải lọc trắng chứ không chuyển tiếp cả object: phản hồi `/nks/user` thật (đo
2026-09-07) có **56 trường**, trong đó có `activation_token`, `sms_token`, `zalo_key`,
`face_id`, `nopass`, `cccd_front`, `cccd_back`, `id_number`, `settings`, `qrcode`,
`vcard`. Chuyển tiếp thẳng ra trình duyệt là rò một nắm bí mật và giấy tờ tuỳ thân
của người dùng chỉ để vẽ một cái form chín ô.

Tên trường của NKS trùng với tên trong `TRUONG_SUA_DUOC` ở hầu hết các ô, nhưng phép
ánh xạ vẫn viết tường minh: trùng nhau hôm nay là sự trùng hợp, không phải hợp đồng.
"""

from __future__ import annotations

from typing import Any, Mapping

from shared.interfaces.profile import TRUONG_SUA_DUOC, ExternalProfile

from .errors import NksProtocolError
from .mapper import PROVIDER, UNG_VIEN_EMAIL, UNG_VIEN_ID, UNG_VIEN_TEN, _boc, _lay, _ten_nhom

#: `trường nội bộ -> trường NKS`. Dùng cho CẢ chiều đọc lẫn chiều ghi.
ANH_XA = {
    "firstname": "firstname",
    "lastname": "lastname",
    "phone": "phone",
    "gender": "gender",
    "dob": "dob",
    "website": "website",
    "pob": "pob",
    "province": "province",
    "intro": "intro",
}

assert set(ANH_XA) == set(TRUONG_SUA_DUOC), "ánh xạ phải phủ đúng danh sách trắng"


def _chuoi(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _gioi_tinh(v: Any) -> int | None:
    """NKS dùng 0/1. Giá trị khác ⇒ `None` — thà không biết còn hơn đoán."""
    if v is None or v == "":
        return None
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if n in (0, 1) else None


def to_profile(body: Mapping[str, Any]) -> ExternalProfile:
    """User Info của NKS → hồ sơ nội bộ. Thiếu định danh ⇒ ném, không đoán."""
    if not isinstance(body, Mapping):
        raise NksProtocolError("User Info của NKS không phải object")
    d = _boc(body)

    raw_id = _lay(d, UNG_VIEN_ID)
    if raw_id in (None, ""):
        raise NksProtocolError("User Info của NKS không có trường định danh nào nhận ra được")

    email = _lay(d, UNG_VIEN_EMAIL)
    return ExternalProfile(
        provider=PROVIDER,
        provider_user_id=str(raw_id),
        email=str(email).strip().lower() if email else None,
        display_name=_chuoi(_lay(d, UNG_VIEN_TEN)),
        # `avatar` là URL https trực tiếp (đo thật). Không phải base64 ở chiều ĐỌC.
        avatar=_chuoi(d.get("avatar")),
        role=_chuoi(_ten_nhom(d)),
        firstname=_chuoi(d.get(ANH_XA["firstname"])),
        lastname=_chuoi(d.get(ANH_XA["lastname"])),
        phone=_chuoi(d.get(ANH_XA["phone"])),
        gender=_gioi_tinh(d.get(ANH_XA["gender"])),
        dob=_chuoi(d.get(ANH_XA["dob"])),
        website=_chuoi(d.get(ANH_XA["website"])),
        pob=_chuoi(d.get(ANH_XA["pob"])),
        province=_chuoi(d.get(ANH_XA["province"])),
        intro=_chuoi(d.get(ANH_XA["intro"])),
    )


def to_update_fields(thay_doi: Mapping[str, Any]) -> dict[str, str]:
    """Thay đổi nội bộ → body form của NKS.

    Khoá ngoài danh sách trắng bị BỎ, không ném: người gọi đã kiểm ở tầng ứng dụng, và
    ở đây thà gửi thiếu một trường còn hơn gửi thừa một trường không ai duyệt.

    `None` được dịch thành chuỗi rỗng — người dùng xoá trắng một ô thì phải xoá được.
    """
    ra: dict[str, str] = {}
    for khoa, gia_tri in (thay_doi or {}).items():
        if khoa not in ANH_XA:
            continue
        ra[ANH_XA[khoa]] = "" if gia_tri is None else str(gia_tri)
    return ra


def da_ghi_xong(body: Mapping[str, Any]) -> bool:
    """`updateInfo` báo thành công chưa?

    Phản hồi thật là `{"success": true, "data": true}` — `data` là boolean trần, không
    phải User Info như bảng Output của tài liệu ghi. Nên chỗ này chỉ đọc `success`, và
    người gọi bắt buộc hỏi lại `/nks/user`.
    """
    return isinstance(body, Mapping) and body.get("success") is True
