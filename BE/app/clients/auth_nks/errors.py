"""Phân loại lỗi NKS.

Vì sao cần bảng riêng thay vì đọc HTTP status: **NKS trả 500 cho cả sai tài khoản.**
Đo thật (không gửi credential thật):

    POST /api/nks/user/login  username không tồn tại
    → HTTP 500 {"success":false,"code":500,
                "error":"Tài khoản không tồn tại","message":"Unauthorized"}

    POST /api/nks/user  không token
    → HTTP 500 {"success":false,"code":500,
                "error":"Token is invalid","message":"Token"}

Map 5xx → "provider chết" theo phản xạ thì mọi lần gõ sai mật khẩu sẽ hiện thành
"NKS đang bảo trì", và người dùng chờ mãi một thứ không bao giờ tự khỏi. Tín hiệu
thật nằm ở `success` + `message` trong thân phản hồi, không nằm ở mã HTTP.
"""

from __future__ import annotations


class NksError(Exception):
    """Gốc của mọi lỗi NKS. Không bao giờ mang theo mật khẩu hay access_token."""


class NksInvalidCredentials(NksError):
    """NKS từ chối cặp tài khoản/mật khẩu."""


class NksUnavailable(NksError):
    """Không gọi được NKS: timeout, DNS, 502/503/504, mất mạng."""


class NksProtocolError(NksError):
    """Gọi được nhưng phản hồi không đúng hợp đồng: JSON hỏng, thiếu access_token,
    thiếu thông tin định danh. Khác `NksUnavailable`: thử lại không cứu được."""


class NksNotEnabled(NksError):
    """Cờ AUTH_NKS_ENABLED tắt hoặc 'nks' không nằm trong AUTH_PROVIDERS."""


# `message` trong envelope NKS khi từ chối xác thực. So khớp KHÔNG phân biệt hoa
# thường; `error` là văn bản tiếng Việt cho người đọc nên không dùng để phân loại.
_MESSAGE_TU_CHOI = {"unauthorized", "token"}


def la_tu_choi_xac_thuc(body: dict) -> bool:
    """Envelope này có phải 'NKS từ chối' không (khác 'NKS hỏng')?"""
    if not isinstance(body, dict):
        return False
    if body.get("success") is not False:
        return False
    return str(body.get("message") or "").strip().lower() in _MESSAGE_TU_CHOI
