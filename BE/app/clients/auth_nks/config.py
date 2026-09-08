"""Cấu hình NKS — CHỖ DUY NHẤT trong mã có URL của NKS.

Test `test_auth_nks_isolation.py` quét toàn kho để khoá điều đó: thấy "nks.vn" ở
file khác là đỏ.

Đường dẫn đăng nhập KHÔNG phải cái tài liệu ghi. Đo thật:

    POST /api/user/login       → 404, route không tồn tại
    POST /api/nks/user/login   → 500 "Tài khoản không tồn tại"  ← đường thật
    POST /api/nks/user         → 500 "Token is invalid"         ← đúng như tài liệu

Vì vậy `NKS_LOGIN_PATH` để chỉnh được bằng env: nếu NKS đổi lại đúng như tài liệu
thì sửa cấu hình, không phải sửa mã.
"""

from __future__ import annotations

import os

DEFAULT_BASE_URL = "https://account.nks.vn/api"
DEFAULT_LOGIN_PATH = "/nks/user/login"
DEFAULT_USER_PATH = "/nks/user"
DEFAULT_UPDATE_INFO_PATH = "/nks/user/updateInfo"
DEFAULT_UPDATE_AVATAR_PATH = "/nks/user/updateAvatar"


def _s(name: str, default: str = "") -> str:
    return (os.getenv(name) or "").strip() or default


def _truthy(name: str, default: str = "0") -> bool:
    # Cùng hàm đọc cờ với auth/tokens.py — một cách hiểu "bật" cho cả hệ.
    return (os.getenv(name, default) or "").strip().lower() in ("1", "true", "yes", "on")


def base_url() -> str:
    return _s("NKS_AUTH_BASE_URL", DEFAULT_BASE_URL).rstrip("/")


def login_url() -> str:
    return base_url() + _s("NKS_LOGIN_PATH", DEFAULT_LOGIN_PATH)


def user_url() -> str:
    return base_url() + _s("NKS_USER_PATH", DEFAULT_USER_PATH)


def update_info_url() -> str:
    return base_url() + _s("NKS_UPDATE_INFO_PATH", DEFAULT_UPDATE_INFO_PATH)


def update_avatar_url() -> str:
    return base_url() + _s("NKS_UPDATE_AVATAR_PATH", DEFAULT_UPDATE_AVATAR_PATH)


def system() -> str:
    return _s("NKS_SYSTEM", "NKS")


def device() -> str:
    return _s("NKS_DEVICE", "web")


def connect_timeout() -> float:
    try:
        return float(_s("NKS_CONNECT_TIMEOUT_SEC", "5"))
    except ValueError:
        return 5.0


def read_timeout() -> float:
    try:
        return float(_s("NKS_READ_TIMEOUT_SEC", "15"))
    except ValueError:
        return 15.0


def enabled() -> bool:
    """NKS chỉ sống khi BẬT cờ VÀ có tên trong danh sách provider cho phép."""
    if not _truthy("AUTH_NKS_ENABLED"):
        return False
    return "nks" in providers_allowed()


def providers_allowed() -> set[str]:
    raw = _s("AUTH_PROVIDERS", "local")
    return {p.strip().lower() for p in raw.split(",") if p.strip()}
