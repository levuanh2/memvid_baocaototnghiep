"""LocalAuthProvider — bọc `users_store.verify_password` sau seam chung.

KHÔNG đổi hành vi: cùng hàm kiểm mật khẩu, cùng "sai thì không nói user có tồn tại
hay không". Chỗ này chỉ đổi HÌNH DẠNG trả về (InternalIdentity thay vì dict user)
để route không phải biết provider nào đang chạy.
"""

from __future__ import annotations

from typing import Any, Mapping

from shared.interfaces.auth import InternalIdentity

NAME = "local"


class InvalidCredentials(Exception):
    """Sai email hoặc mật khẩu. Thông điệp cố ý chung — không lộ user tồn tại."""


class LocalAuthProvider:
    name = NAME

    def __init__(self, verify_password=None):
        # Inject được để test không cần Postgres; mặc định dùng store thật.
        if verify_password is None:
            from app.domains.auth import users_store

            verify_password = users_store.verify_password
        self._verify_password = verify_password

    def authenticate(self, credentials: Mapping[str, Any]) -> InternalIdentity:
        identifier = credentials.get("identifier") or ""
        password = credentials.get("password") or ""
        user = self._verify_password(identifier, password)
        if user is None:
            raise InvalidCredentials()
        return InternalIdentity(
            provider=NAME,
            provider_user_id=str(user["user_id"]),
            email=user.get("email"),
            display_name=user.get("display_name"),
            role=user.get("role") or "learner",
            metadata={},
        )
