"""Use case đăng nhập — chọn provider, đổi danh tính lấy phiên StudyMap.

Tầng này KHÔNG biết NKS: không import `requests`, không có URL, không có tên trường
của provider nào. Nó chỉ thấy `InternalIdentity`. Adapter NKS được nạp LƯỜI và bọc
trong `try/ImportError`, nên xoá thư mục `clients/auth_nks/` là local login vẫn chạy
— đó chính là bằng chứng gỡ được.

Phát hành token vẫn là `domains.auth.tokens.make_token` như cũ; middleware không đổi.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

from shared.interfaces.auth import InternalIdentity

LOCAL = "local"
NKS = "nks"
#: Tên provider hệ thống BIẾT — khác với tên được BẬT. Phân biệt hai cái này để
#: "nks" lúc tắt trả "chưa bật" chứ không phải "provider không tồn tại".
KNOWN_PROVIDERS = (LOCAL, NKS)


class AuthError(Exception):
    """Gốc — mỗi lớp con ứng với một mã HTTP ở route."""


class InvalidCredentials(AuthError):
    """Sai thông tin đăng nhập (bất kể provider nào)."""


class InvalidProvider(AuthError):
    """Tên provider không có trong hệ thống."""


class ProviderNotEnabled(AuthError):
    """Provider có tồn tại nhưng đang tắt bằng cấu hình."""


class ProviderUnavailable(AuthError):
    """Không gọi được provider ngoài: timeout / 5xx hạ tầng / mất mạng."""


class ProviderProtocolError(AuthError):
    """Provider trả thứ không đúng hợp đồng — thử lại không cứu được."""


class IdentityNotLinked(AuthError):
    """Không gắn được danh tính ngoài vào một tài khoản StudyMap.

    Từ Phase 3 bảng `identities` đã có, nên đường bình thường là tra-hoặc-tạo. Lỗi
    này chỉ còn cho hai ca mà việc gắn KHÔNG an toàn hoặc không làm được:

      * provider không trả email, trong khi `users.email` là NOT NULL — bịa một email
        là dựng dữ liệu giả trong hồ sơ người dùng;
      * email đó đã thuộc một tài khoản khác chưa hề liên kết — gộp vào chính là
        auto-link theo email, đường chiếm tài khoản.
    """


def _local_provider(deps: Optional[Mapping[str, Any]] = None):
    if deps and deps.get("local_provider") is not None:
        return deps["local_provider"]
    from app.clients.auth_local import LocalAuthProvider

    return LocalAuthProvider()


def _nks_provider(deps: Optional[Mapping[str, Any]] = None):
    """Nạp lười + chịu được việc thư mục adapter BIẾN MẤT.

    `ImportError` → coi như provider chưa bật. Nhờ vậy xoá `clients/auth_nks/` không
    làm module này gãy lúc import, và local login không hề hấn gì.
    """
    if deps and deps.get("nks_provider") is not None:
        return deps["nks_provider"]
    try:
        from app.clients.auth_nks import NKSAuthProvider
    except ImportError:
        return None
    return NKSAuthProvider()


def _dich_loi_nks(exc: Exception) -> AuthError:
    """Lỗi riêng của adapter → lỗi lõi. Bảng này là chỗ DUY NHẤT lõi chạm tên lớp NKS."""
    from app.clients.auth_nks.errors import (
        NksInvalidCredentials,
        NksNotEnabled,
        NksProtocolError,
        NksUnavailable,
    )

    if isinstance(exc, NksInvalidCredentials):
        return InvalidCredentials(str(exc))
    if isinstance(exc, NksNotEnabled):
        return ProviderNotEnabled(str(exc))
    if isinstance(exc, NksUnavailable):
        return ProviderUnavailable(str(exc))
    if isinstance(exc, NksProtocolError):
        return ProviderProtocolError(str(exc))
    return ProviderProtocolError("lỗi provider không xác định")


def xac_thuc(
    identifier: str,
    password: str,
    provider: str = LOCAL,
    *,
    extra: Optional[dict] = None,
    deps: Optional[Mapping[str, Any]] = None,
) -> InternalIdentity:
    """Xác thực ở provider được chọn. Ném `AuthError` khi hỏng."""
    ten = (provider or LOCAL).strip().lower() or LOCAL
    if ten not in KNOWN_PROVIDERS:
        raise InvalidProvider(ten)

    creds = {"identifier": identifier, "password": password, "nks_extra": extra}

    if ten == LOCAL:
        from app.clients.auth_local import InvalidCredentials as LocalInvalid

        try:
            return _local_provider(deps).authenticate(creds)
        except LocalInvalid as exc:
            raise InvalidCredentials(str(exc)) from None

    prov = _nks_provider(deps)
    if prov is None:
        raise ProviderNotEnabled(ten)
    try:
        return prov.authenticate(creds)
    except AuthError:
        raise
    except Exception as exc:  # noqa: BLE001 — dịch sang từ vựng lõi, không rò chi tiết
        raise _dich_loi_nks(exc) from None


def giai_quyet_user(identity: InternalIdentity, *, deps: Optional[Mapping[str, Any]] = None) -> dict:
    """`InternalIdentity` → hàng `users` để phát token.

    Local: danh tính CHÍNH LÀ hàng users, tra lại theo id.
    Ngoài: chưa có chỗ lưu liên kết ⇒ `IdentityNotLinked` (xem docstring lớp đó).
    """
    users_store = (deps or {}).get("users_store")
    if users_store is None:
        from app.domains.auth import users_store  # type: ignore[no-redef]

    if identity.provider == LOCAL:
        user = users_store.get_by_id(identity.provider_user_id)
        if user is None:
            # Hàng biến mất giữa lúc kiểm mật khẩu và lúc tra lại.
            raise InvalidCredentials("user không còn tồn tại")
        return user

    return _gan_danh_tinh_ngoai(identity, deps=deps)


def _gan_danh_tinh_ngoai(identity: InternalIdentity, *, deps: Optional[Mapping[str, Any]] = None) -> dict:
    """Tra-hoặc-tạo liên kết cho danh tính ngoài.

    Nhận ra người quay lại bằng `(provider, provider_user_id)` — KHÔNG bằng email.
    Đó là toàn bộ lý do bảng `identities` tồn tại.
    """
    store = (deps or {}).get("identities_store")
    if store is None:
        from app.domains.auth import identities_store as store  # type: ignore[no-redef]
    users_store = (deps or {}).get("users_store")
    if users_store is None:
        from app.domains.auth import users_store  # type: ignore[no-redef]

    lien_ket = store.find(identity.provider, identity.provider_user_id)
    if lien_ket is not None:
        user = users_store.get_by_id(lien_ket["user_id"])
        if user is None:
            # Liên kết trỏ vào user đã bị xoá. FK ON DELETE CASCADE lẽ ra đã dọn;
            # tới đây nghĩa là dữ liệu lệch — từ chối, đừng tạo user mới đè lên.
            raise IdentityNotLinked(identity.provider)
        store.touch_last_login(lien_ket["identity_id"])
        return user

    try:
        return store.link_new_user(
            provider=identity.provider,
            provider_user_id=identity.provider_user_id,
            email=identity.email,
            display_name=identity.display_name,
            role=identity.role or "learner",
        )
    except (store.EmailRequiredForProvisioning, store.EmailBelongsToAnotherAccount) as exc:
        raise IdentityNotLinked(str(exc)) from None


def dang_nhap(
    identifier: str,
    password: str,
    provider: str = LOCAL,
    *,
    extra: Optional[dict] = None,
    deps: Optional[Mapping[str, Any]] = None,
) -> dict:
    """Đăng nhập đầu-cuối → hàng `users`. Route lấy hàng này đi phát token."""
    identity = xac_thuc(identifier, password, provider, extra=extra, deps=deps)
    return giai_quyet_user(identity, deps=deps)
