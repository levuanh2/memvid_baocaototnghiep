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
