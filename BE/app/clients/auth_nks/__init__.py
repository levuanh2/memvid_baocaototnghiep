"""Adapter NKS — biên giới của mọi thứ thuộc về NKS.

Gỡ NKS = xoá thư mục này + gỡ 1 dòng đăng ký trong `app/application/auth.py` + gỡ
biến môi trường. Lõi auth không import gì ở đây.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

from shared.interfaces.auth import InternalIdentity

from . import client as _client
from . import config
from .errors import (
    NksError,
    NksInvalidCredentials,
    NksNotEnabled,
    NksProtocolError,
    NksUnavailable,
)
from .mapper import PROVIDER, doc_access_token, to_identity

NAME = PROVIDER

__all__ = [
    "NKSAuthProvider", "NAME", "config",
    "NksError", "NksInvalidCredentials", "NksNotEnabled",
    "NksProtocolError", "NksUnavailable",
]


class NKSAuthProvider:
    """Đăng nhập NKS: login → access_token → /nks/user → InternalIdentity.

    `access_token` sống đúng trong phạm vi hàm `authenticate` — không trả ra, không
    ghi log, không lưu DB, không vào token StudyMap.

    Ngoại lệ DUY NHẤT là `mo_phien_ghi`, đường dành cho chứng từ ghi ngắn hạn: nó trả
    token ra để `domains.auth.grants` giữ trong RAM tối đa 10 phút. `authenticate`
    KHÔNG đổi — đường đăng nhập vẫn huỷ token ngay như cũ.
    """

    name = NAME

    def __init__(self, client=None, enabled=None):
        # Inject để test không chạm mạng.
        self._client = client if client is not None else _client
        self._enabled = enabled if enabled is not None else config.enabled

    def authenticate(self, credentials: Mapping[str, Any]) -> InternalIdentity:
        if not self._enabled():
            raise NksNotEnabled("NKS chưa được bật")

        identifier = credentials.get("identifier") or ""
        password = credentials.get("password") or ""
        if not identifier or not password:
            raise NksInvalidCredentials("thiếu tài khoản hoặc mật khẩu")

        extra: Optional[dict] = credentials.get("nks_extra") or None

        login_body = self._client.login(identifier, password, extra=extra)
        access_token = doc_access_token(login_body)

        # Ưu tiên User Info từ /nks/user (nguồn thẩm quyền). Login có kèm sẵn thông
        # tin hay không thì CHƯA XÁC MINH, nên không dựa vào.
        user_body = self._client.get_user(access_token)
        try:
            return to_identity(user_body)
        finally:
            # Không giữ tham chiếu tới token sau khi hết việc.
            del access_token

    def mo_phien_ghi(self, credentials: Mapping[str, Any]) -> tuple[InternalIdentity, str]:
        """Như `authenticate`, nhưng TRẢ RA access_token cùng danh tính.

        Chỉ một người gọi: use case cấp chứng từ ghi. Token đi thẳng vào
        `domains.auth.grants` (RAM, 10 phút) và không đi đâu khác — không log, không
        DB, không response, không exception.

        Vẫn hỏi `/nks/user` chứ không tin mỗi phản hồi login: danh tính trả về là thứ
        tầng trên dùng để kiểm token này có đúng của tài khoản NKS đã liên kết với
        người dùng StudyMap đang gọi hay không. Thiếu bước đó thì bất kỳ ai cũng có
        thể nộp credential NKS của người khác và ghi lên hồ sơ của họ.
        """
        if not self._enabled():
            raise NksNotEnabled("NKS chưa được bật")

        identifier = credentials.get("identifier") or ""
        password = credentials.get("password") or ""
        if not identifier or not password:
            raise NksInvalidCredentials("thiếu tài khoản hoặc mật khẩu")

        extra: Optional[dict] = credentials.get("nks_extra") or None
        access_token = doc_access_token(self._client.login(identifier, password, extra=extra))
        return to_identity(self._client.get_user(access_token)), access_token
