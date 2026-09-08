"""Use case đổi mật khẩu ở provider ngoài.

Tách khỏi `application/profile.py` vì nó KHÔNG dùng chứng từ ghi, và lý do đó là điểm
chính của cả file này: `updatePass` bắt buộc có `old_password`, nên người dùng phải gõ
mật khẩu hiện tại dù thế nào. Tái dùng chứng từ 10 phút ở đây không tiết kiệm được
thao tác nào, mà lại biến một chứng từ bị đánh cắp từ "sửa được hồ sơ" thành "khoá
được chủ tài khoản ra ngoài". Nên đường này tự đăng nhập, đổi, rồi vứt token ngay.

Sau khi đổi thành công, StudyMap TỰ vô hiệu phiên của mình. Không được giả định NKS
thu hồi các token cũ của họ — đo thật cho thấy đăng nhập lại KHÔNG giết token cũ, và
không có endpoint thu hồi nào (`docs/nks-api.md`). Thứ duy nhất trong tầm kiểm soát
là phiên StudyMap, nên phải dùng đúng thứ đó.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

from app.application.auth import (  # noqa: F401 — dùng lại từ vựng lỗi của lõi
    AuthError,
    InvalidCredentials,
    InvalidProvider,
    NKS,
    ProviderNotEnabled,
    ProviderProtocolError,
    ProviderUnavailable,
    _dich_loi_nks,
    _nks_provider,
)

#: Độ dài tối thiểu. NKS KHÔNG công bố luật mật khẩu nào, nên đây cố ý là mức tối
#: thiểu chung của StudyMap (`domains.auth.service.MIN_PASSWORD_LEN`), không phải một
#: luật bịa ra thay NKS. Nếu NKS khắt khe hơn, họ từ chối và ta chuyển tiếp lỗi đó.
DAI_TOI_THIEU = 8
#: Trần độ dài — chặn một thân request khổng lồ đội lốt mật khẩu.
DAI_TOI_DA = 200


class MatKhauKhongHopLe(AuthError):
    """Dữ liệu nhập không qua kiểm ở phía StudyMap. Thông điệp AN TOÀN để hiển thị:
    nó chỉ nói về hình dạng dữ liệu, không tiết lộ gì về tài khoản."""


class KhongPhaiNguoiDungProvider(AuthError):
    """Tài khoản StudyMap này không liên kết với provider ngoài nào.

    Từ chối TRƯỚC khi bất kỳ mật khẩu nào rời khỏi máy chủ: người dùng local không có
    gì để đổi ở NKS, và chuyển tiếp mật khẩu của họ sang hệ thống của người khác là
    một việc không ai yêu cầu.
    """


def kiem_tra_dau_vao(identifier: str, cu: str, moi: str, xac_nhan: str) -> None:
    """Kiểm hình dạng dữ liệu. Ném `MatKhauKhongHopLe` kèm câu hiển thị được.

    KHÔNG bịa luật của NKS: chỉ những điều kiện mà bản thân StudyMap cần để yêu cầu
    có nghĩa (đủ trường, xác nhận khớp, mới khác cũ) cộng với mức tối thiểu chung.
    """
    if not (identifier or "").strip():
        raise MatKhauKhongHopLe("Vui lòng nhập tên đăng nhập.")
    if not cu:
        raise MatKhauKhongHopLe("Vui lòng nhập mật khẩu hiện tại.")
    if not moi:
        raise MatKhauKhongHopLe("Vui lòng nhập mật khẩu mới.")
    if moi != xac_nhan:
        raise MatKhauKhongHopLe("Xác nhận mật khẩu không khớp.")
    if len(moi) < DAI_TOI_THIEU:
        raise MatKhauKhongHopLe(f"Mật khẩu mới cần ít nhất {DAI_TOI_THIEU} ký tự.")
    if len(moi) > DAI_TOI_DA:
        raise MatKhauKhongHopLe(f"Mật khẩu mới tối đa {DAI_TOI_DA} ký tự.")
    if moi == cu:
        raise MatKhauKhongHopLe("Mật khẩu mới phải khác mật khẩu hiện tại.")


def doi_mat_khau(
    user_id: str,
    identifier: str,
    mat_khau_cu: str,
    mat_khau_moi: str,
    xac_nhan: str,
    *,
    provider: str = NKS,
    deps: Optional[Mapping[str, Any]] = None,
) -> None:
    """Đổi mật khẩu ở provider, rồi vô hiệu phiên StudyMap. Ném `AuthError` khi hỏng.

    Thứ tự có chủ đích, và mỗi bước chỉ chạy khi bước trước đã chắc chắn:

    1. Kiểm dữ liệu nhập — rẻ, không rời máy chủ.
    2. Người gọi có phải người dùng của provider không? Nếu không, mật khẩu KHÔNG
       được gửi đi đâu cả.
    3. Đổi ở provider. Hỏng ở đây ⇒ ném, và phiên StudyMap KHÔNG bị đụng tới: mật
       khẩu chưa đổi thì không có lý do gì bắt người dùng đăng nhập lại.
    4. CHỈ khi provider đã xác nhận: huỷ chứng từ ghi, rồi tăng `token_version`.

    `identifier` chuyển tiếp NGUYÊN VĂN — không suy ra từ `users.email`, và cũng
    KHÔNG cắt khoảng trắng. Định danh ở NKS không nhất thiết là email, và đường đăng
    nhập (`clients/auth_nks/__init__.py`) cũng không cắt gì cả; hai đường phải đối xử
    với cùng một chuỗi y hệt nhau, nếu không sẽ có tài khoản đăng nhập được mà không
    đổi được mật khẩu. NKS là bên quyết định chuỗi nào hợp lệ, không phải ta.
    """
    kiem_tra_dau_vao(identifier, mat_khau_cu, mat_khau_moi, xac_nhan)

    ten = (provider or "").strip().lower()
    if ten != NKS:
        raise InvalidProvider(ten)
    if not user_id:
        raise InvalidCredentials("thiếu người dùng StudyMap")

    store = (deps or {}).get("identities_store")
    if store is None:
        from app.domains.auth import identities_store as store  # type: ignore[no-redef]
    if store.find_by_user(ten, str(user_id)) is None:
        raise KhongPhaiNguoiDungProvider(ten)

    prov = _nks_provider(deps)
    if prov is None:
        raise ProviderNotEnabled(ten)

    try:
        prov.doi_mat_khau(identifier, mat_khau_cu, mat_khau_moi)
    except AuthError:
        raise
    except Exception as exc:  # noqa: BLE001 — dịch sang từ vựng lõi, không rò chi tiết
        raise _dich_loi_nks(exc) from None

    # ── Từ đây trở xuống: mật khẩu ĐÃ đổi ở provider. ────────────────────────
    _vo_hieu_phien_studymap(str(user_id), deps)


def _vo_hieu_phien_studymap(user_id: str, deps: Optional[Mapping[str, Any]] = None) -> None:
    """Huỷ chứng từ ghi + tăng `token_version`.

    Bắt buộc, không phải cẩn thận thừa: KHÔNG có bằng chứng nào cho thấy NKS thu hồi
    token cũ sau khi đổi mật khẩu, và đo thật cho thấy đăng nhập lại còn không giết
    được token trước đó. Thứ StudyMap kiểm soát được là phiên của chính nó, nên đổi
    mật khẩu phải đá mọi phiên StudyMap ra — kể cả phiên trên máy khác.

    Chứng từ ghi bị huỷ trước: nó đang giữ một token sinh ra bằng mật khẩu CŨ.
    """
    grants = (deps or {}).get("grants")
    if grants is None:
        from app.domains.auth import grants  # type: ignore[no-redef]
    users_store = (deps or {}).get("users_store")
    if users_store is None:
        from app.domains.auth import users_store  # type: ignore[no-redef]

    grants.xoa_cua_user(user_id)
    users_store.bump_token_version(user_id)
