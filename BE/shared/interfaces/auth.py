"""Seam xác thực — lõi auth chỉ biết `InternalIdentity`, không biết provider nào.

Vì sao tách: thêm một nguồn đăng nhập (NKS) mà không để tên trường/URL của nguồn đó
rò vào route hay application layer. Gỡ provider ra sau này = xoá adapter + wiring,
không đụng lõi.

Cùng khuôn với `interfaces/llm.py`: `typing.Protocol` (structural), nên adapter khớp
mà KHÔNG cần kế thừa.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Protocol, runtime_checkable


@dataclass(frozen=True)
class InternalIdentity:
    """Danh tính đã chuẩn hoá. Đây là thứ DUY NHẤT lõi auth nhìn thấy.

    `role` đã được map sang từ vựng StudyMap (learner/teacher/admin) TRƯỚC khi tới
    đây — lõi không bao giờ thấy tên nhóm của provider ngoài.

    `metadata` chỉ chứa giá trị KHÔNG nhạy cảm (không token, không mật khẩu): nó đi
    vào log chẩn đoán và có thể lộ ra ngoài.
    """

    provider: str
    provider_user_id: str
    email: str | None = None
    display_name: str | None = None
    #: URL ảnh đại diện công khai ở provider, hoặc None. KHÔNG phải bí mật — nó vốn
    #: đã truy cập được không cần xác thực. Lõi chỉ chuyển tiếp; việc duyệt giao thức
    #: nằm ở `shared.interfaces.profile.avatar_hop_le`.
    avatar: str | None = None
    role: str = "learner"
    metadata: Mapping[str, str] = field(default_factory=dict)


@runtime_checkable
class AuthenticationProvider(Protocol):
    """Một nguồn xác thực.

    `authenticate` NÉM khi thất bại (xem `shared.interfaces.errors`-style phân loại
    của từng adapter) chứ không trả None: gọi được mà không có danh tính là lỗi, và
    mỗi loại lỗi đòi một mã HTTP khác nhau.
    """

    name: str

    def authenticate(self, credentials: Mapping[str, Any]) -> InternalIdentity: ...
