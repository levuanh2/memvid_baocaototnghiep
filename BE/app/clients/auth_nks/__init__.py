"""Adapter NKS — biên giới của mọi thứ thuộc về NKS.

Gỡ NKS = xoá thư mục này + gỡ 1 dòng đăng ký trong `app/application/auth.py` + gỡ
biến môi trường. Lõi auth không import gì ở đây.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

from shared.interfaces.auth import InternalIdentity
from shared.interfaces.profile import ExternalProfile

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
from .profile_mapper import da_ghi_xong, to_profile, to_update_fields

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

    # ── Hồ sơ ────────────────────────────────────────────────────────────────
    #
    # Hai hàm dưới nhận `bi_mat` — chính là access_token do `grants` giữ trong RAM.
    # Chúng KHÔNG tự đăng nhập: chứng từ đã được cấp ở một request trước đó.

    def doc_ho_so(self, bi_mat: str) -> ExternalProfile:
        """Hồ sơ hiện tại ở provider. Nguồn sự thật, không có bản sao nào ở StudyMap."""
        if not self._enabled():
            raise NksNotEnabled("NKS chưa được bật")
        return to_profile(self._client.get_user(bi_mat))

    def ghi_ho_so(self, bi_mat: str, thay_doi: Mapping[str, Any]) -> ExternalProfile:
        """Ghi hồ sơ rồi ĐỌC LẠI, trả về bản mới.

        Đọc lại là bắt buộc chứ không phải cẩn thận thừa: `updateInfo` trả
        `{"success": true, "data": true}` — một boolean, không phải hồ sơ. Tin vào
        thứ vừa gửi đi mà vẽ lên màn hình là hiển thị một trạng thái chưa ai xác nhận;
        provider có thể chuẩn hoá, cắt bớt, hoặc bỏ qua một trường.
        """
        if not self._enabled():
            raise NksNotEnabled("NKS chưa được bật")
        truong = to_update_fields(thay_doi)
        if not da_ghi_xong(self._client.update_info(bi_mat, truong)):
            raise NksProtocolError("NKS không xác nhận đã ghi hồ sơ")
        return to_profile(self._client.get_user(bi_mat))

    def ghi_anh_dai_dien(self, bi_mat: str, data_uri: str) -> ExternalProfile:
        """Ghi ảnh đại diện rồi ĐỌC LẠI, trả về hồ sơ mới.

        Cùng khuôn với `ghi_ho_so` và vì cùng một lý do: `updateAvatar` trả
        `{"success": true, "data": true}`, không trả URL ảnh mới. URL duy nhất đáng
        tin là cái đọc được ở `/nks/user` SAU khi ghi — NKS tự đặt tên file và tự
        quyết đường dẫn.
        """
        if not self._enabled():
            raise NksNotEnabled("NKS chưa được bật")
        if not da_ghi_xong(self._client.update_avatar(bi_mat, data_uri)):
            raise NksProtocolError("NKS không xác nhận đã ghi ảnh đại diện")
        return to_profile(self._client.get_user(bi_mat))
