"""Use case hồ sơ provider ngoài — đọc và ghi qua một chứng từ ghi ngắn hạn.

Tầng này KHÔNG biết NKS: không URL, không tên trường của provider, không `requests`.
Nó thấy `ExternalProfile` và một `grant_id`. Adapter được nạp LƯỜI y như
`application/auth.py`, nên xoá `clients/auth_nks/` vẫn không làm gãy import.

**Không có gì ở đây được lưu vào database StudyMap.** Provider là nguồn sự thật; hồ
sơ sống đúng trong một request rồi biến mất.

Luật về chứng từ, chỉ một câu: provider từ chối bí mật ⇒ HUỶ chứng từ ngay. Giữ lại
một token đã chết chỉ là để một thứ vô dụng nằm trong RAM thêm mười phút, và khiến
lần thử sau thất bại theo một kiểu khó hiểu hơn.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

from shared.interfaces.profile import TRUONG_SUA_DUOC, ExternalProfile

from app.application.auth import (  # noqa: F401 — dùng lại đúng từ vựng lỗi của lõi
    AuthError,
    InvalidProvider,
    NKS,
    ProviderNotEnabled,
    ProviderProtocolError,
    ProviderUnavailable,
    _dich_loi_nks,
    _nks_provider,
)


class GrantKhongHopLe(AuthError):
    """Không có chứng từ, hết hạn, sai chủ, hoặc provider vừa từ chối nó.

    Bốn ca gộp làm một CÓ CHỦ ĐÍCH: phản ứng của giao diện giống hệt nhau (hỏi lại
    mật khẩu, giữ nguyên phần đang gõ dở), và phân biệt chúng là nói cho người gọi
    biết một chứng từ nào đó có tồn tại.
    """


class TruongKhongSuaDuoc(AuthError):
    """Yêu cầu ghi một trường ngoài danh sách trắng."""


def _grants(deps: Optional[Mapping[str, Any]] = None):
    if deps and deps.get("grants") is not None:
        return deps["grants"]
    from app.domains.auth import grants

    return grants


def _lay_bi_mat(user_id: str, grant_id: str, deps=None) -> str:
    kho = _grants(deps)
    bi_mat = kho.lay(str(grant_id or ""), str(user_id or ""), provider=NKS)
    if not bi_mat:
        raise GrantKhongHopLe(NKS)
    return bi_mat


def _provider(deps: Optional[Mapping[str, Any]] = None):
    prov = _nks_provider(deps)
    if prov is None:
        raise ProviderNotEnabled(NKS)
    return prov


def _goi(fn, *, user_id: str, grant_id: str, deps=None):
    """Gọi provider, và huỷ chứng từ nếu bí mật bị từ chối.

    `NksInvalidCredentials` ở ĐÂY không có nghĩa "sai mật khẩu" — không ai vừa gõ mật
    khẩu nào cả. Nó có nghĩa token trong chứng từ đã chết ở phía provider. Nên nó
    thành `GrantKhongHopLe`, không phải `InvalidCredentials`.
    """
    from app.clients.auth_nks.errors import NksInvalidCredentials

    try:
        return fn()
    except NksInvalidCredentials:
        _grants(deps).huy(str(grant_id))
        raise GrantKhongHopLe(NKS) from None
    except AuthError:
        raise
    except Exception as exc:  # noqa: BLE001 — dịch sang từ vựng lõi, không rò chi tiết
        raise _dich_loi_nks(exc) from None


def doc_ho_so(user_id: str, grant_id: str, *, deps=None) -> ExternalProfile:
    """Hồ sơ hiện tại ở provider. Không đọc cache, không đọc DB."""
    bi_mat = _lay_bi_mat(user_id, grant_id, deps)
    prov = _provider(deps)
    return _goi(lambda: prov.doc_ho_so(bi_mat), user_id=user_id, grant_id=grant_id, deps=deps)


def cap_nhat_anh_dai_dien(user_id: str, grant_id: str, raw: bytes, *, deps=None) -> ExternalProfile:
    """Chuẩn hoá ảnh → ghi sang provider → ĐỌC LẠI → lưu URL mới. Trả hồ sơ mới.

    Thứ tự có chủ đích:

    1. **Chuẩn hoá TRƯỚC khi chạm chứng từ.** Ảnh hỏng/quá lớn là lỗi của người dùng,
       không phải của chứng từ; kiểm trước thì một file rác không tiêu tốn một lượt
       gọi ra provider, và cũng không có cơ hội làm chết chứng từ đang tốt.
    2. Ghi, rồi đọc lại — `updateAvatar` chỉ trả một boolean.
    3. `users.avatar_url` chỉ được ghi khi provider đã xác nhận VÀ URL trả về là https
       tuyệt đối. Provider trả rác ⇒ giữ nguyên URL cũ, không xoá: mất ảnh đang hiển
       thị vì một phản hồi lạ là tệ hơn nhiều so với việc hiển thị ảnh cũ thêm một lúc.

    Byte ảnh KHÔNG được lưu ở đâu cả — không đĩa, không DB, không Storage. Chúng sống
    trong một biến của hàm này rồi biến mất.
    """
    from app.domains.media.anh_dai_dien import chuan_hoa

    # Ném `AnhKhongHopLe`/`AnhQuaLon` — route dịch sang 400/413, không đụng chứng từ.
    anh = chuan_hoa(raw)

    bi_mat = _lay_bi_mat(user_id, grant_id, deps)
    prov = _provider(deps)
    ho_so = _goi(lambda: prov.ghi_anh_dai_dien(bi_mat, anh.data_uri),
                 user_id=user_id, grant_id=grant_id, deps=deps)

    from shared.interfaces.profile import avatar_hop_le

    url_moi = avatar_hop_le(ho_so.avatar)
    if url_moi:
        users_store = (deps or {}).get("users_store")
        if users_store is None:
            from app.domains.auth import users_store  # type: ignore[no-redef]
        users_store.set_avatar_url(str(user_id), url_moi)
    return ho_so


def cap_nhat_ho_so(user_id: str, grant_id: str, thay_doi: Mapping[str, Any],
                   *, deps=None) -> ExternalProfile:
    """Ghi các trường được phép rồi trả về hồ sơ MỚI đọc lại từ provider.

    Khoá lạ ⇒ `TruongKhongSuaDuoc`, ném chứ không lặng lẽ bỏ: người gọi tưởng đã lưu
    một ô mà thực ra chưa bao giờ gửi đi là đúng lỗi "nút bấm không gọi gì cả".
    Đây cũng là chỗ chặn `name` và các trường CCCD — chúng không nằm trong danh sách
    trắng nên không có đường nào tới được provider.
    """
    if not isinstance(thay_doi, Mapping) or not thay_doi:
        raise TruongKhongSuaDuoc("không có gì để ghi")
    la = [k for k in thay_doi if k not in TRUONG_SUA_DUOC]
    if la:
        raise TruongKhongSuaDuoc(", ".join(sorted(la)))

    bi_mat = _lay_bi_mat(user_id, grant_id, deps)
    prov = _provider(deps)
    return _goi(lambda: prov.ghi_ho_so(bi_mat, dict(thay_doi)),
                user_id=user_id, grant_id=grant_id, deps=deps)
