"""HTTP client tới NKS. Chỗ DUY NHẤT thực sự gọi mạng; địa chỉ lấy từ `config.py`
(và CHỈ nằm ở đó — `test_auth_nks_isolation` quét cả kho để khoá điều này).

Hai luật giữ bí mật, cả hai đều có test khoá:
  1. Không bao giờ log thân yêu cầu (chứa mật khẩu) hay access_token.
  2. Ngoại lệ của `requests` không được nổi lên nguyên trạng — nó có thể mang theo
     URL kèm tham số. Bắt rồi ném lại chỉ với tên lớp, đúng khuôn `llm_factory`.
"""

from __future__ import annotations

from typing import Any, Optional

from . import config
from .errors import NksProtocolError, NksUnavailable, la_tu_choi_xac_thuc, NksInvalidCredentials

# 502/503/504 = hạ tầng trước NKS. Khác hẳn 500 của chính NKS, vốn là cách nó báo
# "sai tài khoản" (xem errors.py).
_MA_HA_TANG = {502, 503, 504}


def _post(url: str, data: dict) -> dict:
    import requests

    try:
        r = requests.post(
            url,
            data=data,
            headers={"Accept": "application/json"},
            timeout=(config.connect_timeout(), config.read_timeout()),
        )
    except Exception as exc:  # noqa: BLE001 — mọi lỗi vận chuyển đều là "không gọi được"
        # CHỈ tên lớp: `exc` của requests có thể mang URL kèm tham số.
        raise NksUnavailable(f"NKS không phản hồi ({type(exc).__name__})") from None

    if r.status_code in _MA_HA_TANG:
        raise NksUnavailable(f"NKS trả {r.status_code}")

    try:
        body = r.json()
    except Exception:  # noqa: BLE001
        # KHÔNG log r.text: trang lỗi có thể chứa dữ liệu phiên.
        raise NksProtocolError(
            f"NKS trả phản hồi không phải JSON (HTTP {r.status_code})") from None

    if not isinstance(body, dict):
        raise NksProtocolError("NKS trả JSON không phải object")

    # Từ chối xác thực tới dưới dạng HTTP 500 — phân loại theo envelope, không theo mã.
    if la_tu_choi_xac_thuc(body):
        raise NksInvalidCredentials("NKS từ chối thông tin đăng nhập")

    if body.get("success") is False:
        raise NksProtocolError(f"NKS báo lỗi (code={body.get('code')})")

    if r.status_code >= 400:
        raise NksUnavailable(f"NKS trả {r.status_code}")

    return body


def login(username: str, password: str, *, extra: Optional[dict] = None) -> dict:
    """Đăng nhập NKS → envelope thô. KHÔNG trả access_token ra ngoài adapter."""
    payload: dict[str, Any] = {
        "username": username,
        "password": password,
        "system": config.system(),
        "device": config.device(),
    }
    # fbtoken/ip_address/location: CHỈ gửi khi thật sự có. Không bịa giá trị giả
    # cho một trường mà mình không biết API dùng để làm gì.
    for k in ("fbtoken", "ip_address", "location"):
        v = (extra or {}).get(k)
        if v:
            payload[k] = v
    return _post(config.login_url(), payload)


def get_user(access_token: str) -> dict:
    if not access_token:
        raise NksProtocolError("thiếu access_token")
    return _post(config.user_url(), {"access_token": access_token})


def update_avatar(access_token: str, data_uri: str) -> dict:
    """Ghi ảnh đại diện → envelope thô.

    `data_uri` là data-URI ĐẦY ĐỦ (`data:image/jpeg;base64,...`), không phải base64
    trần: bảng tài liệu chỉ ghi "Base64" nhưng ảnh chụp Postman cho thấy giá trị thật
    có tiền tố đầy đủ. Xem `docs/nks-api.md`.

    Phản hồi cũng là `{"success": true, "data": true}` — người gọi PHẢI hỏi lại
    `/nks/user` mới biết URL ảnh mới.

    KHÔNG log `data_uri`: nó là toàn bộ ảnh của người dùng dưới dạng chuỗi.
    """
    if not access_token:
        raise NksProtocolError("thiếu access_token")
    if not data_uri:
        raise NksProtocolError("thiếu dữ liệu ảnh")
    return _post(config.update_avatar_url(), {"avatar": data_uri, "access_token": access_token})


def update_info(access_token: str, fields: dict) -> dict:
    """Ghi hồ sơ → envelope thô.

    Phản hồi đo thật (2026-09-07) là `{"success": true, "data": true, ...}` — một
    boolean trần, KHÔNG phải User Info như bảng Output trong tài liệu ghi. Nên người
    gọi bắt buộc phải hỏi lại `/nks/user` mới biết hồ sơ giờ ra sao.

    `fields` đã được lọc trắng ở `mapper.py`; ở đây chỉ ghép thêm credential. Không
    log `fields`: nó chứa số điện thoại, ngày sinh, nơi sinh của người dùng.
    """
    if not access_token:
        raise NksProtocolError("thiếu access_token")
    payload: dict[str, Any] = dict(fields or {})
    payload["access_token"] = access_token
    return _post(config.update_info_url(), payload)
