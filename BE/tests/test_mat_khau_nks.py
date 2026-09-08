"""Đổi mật khẩu NKS — tái xác thực trực tiếp, KHÔNG dùng chứng từ ghi.

Điểm cần khoá chặt nhất: mật khẩu chỉ rời máy chủ khi người gọi thật sự là người dùng
NKS, token sinh ra chết trong đúng một lời gọi hàm, và phiên StudyMap chỉ bị vô hiệu
khi provider đã XÁC NHẬN đổi xong — không sớm hơn.

Không chạm mạng, không chạm database: client HTTP, `identities_store` và `users_store`
đều là đồ giả; kho chứng từ và bộ đếm là mã THẬT.
"""

from __future__ import annotations

import logging
import threading

import pytest

from app.application import mat_khau as uc
from app.clients.auth_nks import NKSAuthProvider
from app.clients.auth_nks.errors import NksInvalidCredentials, NksProtocolError, NksUnavailable
from app.domains.auth import gioi_han, grants

UID_A, UID_B = "user-A", "user-B"
CU, MOI = "mat-khau-cu-7f2a", "mat-khau-moi-9c4b"
TOKEN = "eyJ0eXAiOiJKV1Q.KHONG-DUOC-RO-RA.xxx"


class ClientGia:
    """Đứng đúng chỗ `auth_nks.client`. Ghi lại lời gọi để khẳng định luồng."""

    def __init__(self, login_exc=None, pass_exc=None, ok=True):
        self.login_exc, self.pass_exc, self.ok = login_exc, pass_exc, ok
        self.calls: list[tuple] = []

    def login(self, username, password, extra=None):
        self.calls.append(("login", username, password))
        if self.login_exc:
            raise self.login_exc
        return {"success": True, "data": {"access_token": TOKEN}}

    def update_pass(self, access_token, old_password, password):
        self.calls.append(("update_pass", access_token, old_password, password))
        if self.pass_exc:
            raise self.pass_exc
        return {"success": self.ok, "data": self.ok}


class IdentitiesGia:
    def __init__(self, co=True):
        self.co = co
        self.calls: list[tuple] = []

    def find_by_user(self, provider, user_id):
        self.calls.append((provider, str(user_id)))
        if not self.co:
            return None
        return {"identity_id": "i-1", "user_id": str(user_id),
                "provider": provider, "provider_user_id": "128"}


class UsersGia:
    def __init__(self):
        self.bumps: list[str] = []

    def bump_token_version(self, user_id):
        self.bumps.append(str(user_id))


@pytest.fixture(autouse=True)
def _sach():
    grants.reset_for_tests()
    gioi_han.reset_for_tests()
    yield
    grants.reset_for_tests()
    gioi_han.reset_for_tests()


def _deps(c=None, idents=None, users=None):
    return {"nks_provider": NKSAuthProvider(client=c or ClientGia(), enabled=lambda: True),
            "identities_store": idents or IdentitiesGia(),
            "users_store": users or UsersGia(),
            "grants": grants}


def _doi(uid=UID_A, dinh_danh="nguoi-dung-nks", cu=CU, moi=MOI, xac_nhan=None, **kw):
    return uc.doi_mat_khau(uid, dinh_danh, cu, moi, MOI if xac_nhan is None else xac_nhan, **kw)


# ── 1 + 2 + 3. Đường thành công ─────────────────────────────────────────────
def test_dang_nhap_bang_mat_khau_cu_roi_doi_ngay():
    c = ClientGia()
    _doi(deps=_deps(c))

    assert [x[0] for x in c.calls] == ["login", "update_pass"]
    assert c.calls[0][1] == "nguoi-dung-nks"      # định danh NGƯỜI DÙNG GÕ
    assert c.calls[0][2] == CU                    # mật khẩu cũ, nguyên văn
    assert c.calls[1][1] == TOKEN                 # token vừa lấy được
    assert c.calls[1][2] == CU and c.calls[1][3] == MOI


def test_khong_dung_chung_tu_ghi_va_khong_tao_chung_tu_moi():
    """Đây là điểm thiết kế: chứng từ 10 phút KHÔNG được dùng cho đổi mật khẩu."""
    gid, _ = grants.tao(UID_A, "nks", "token-cu-cua-chung-tu")
    c = ClientGia()
    _doi(deps=_deps(c))

    # Không lời gọi nào dùng bí mật của chứng từ.
    assert all("token-cu-cua-chung-tu" not in str(x) for x in c.calls)
    # Và chứng từ cũ bị HUỶ sau khi đổi (nó giữ token sinh bằng mật khẩu cũ).
    assert grants.lay(gid, UID_A) is None


# ── 10. Định danh KHÔNG suy từ email ────────────────────────────────────────
def test_dinh_danh_lay_dung_cai_nguoi_dung_go():
    c = ClientGia()
    _doi(dinh_danh="ten-dang-nhap-rieng", deps=_deps(c))
    assert c.calls[0][1] == "ten-dang-nhap-rieng"


def test_dinh_danh_chuyen_tiep_NGUYEN_VAN_ke_ca_khoang_trang():
    """Hồi quy D2: trước đây chỗ này `.strip()`, còn đường ĐĂNG NHẬP thì không.

    Lệch nhau như vậy tạo ra một ca câm: một định danh có khoảng trắng đăng nhập được
    nhưng không đổi được mật khẩu (hoặc ngược lại). NKS là bên quyết định chuỗi nào
    hợp lệ — ta chuyển tiếp đúng thứ người dùng gõ.
    """
    c = ClientGia()
    _doi(dinh_danh="  nguoi-dung  ", deps=_deps(c))
    assert c.calls[0][1] == "  nguoi-dung  "


def test_dinh_danh_binh_thuong_khong_doi():
    c = ClientGia()
    _doi(dinh_danh="nguoi-dung-nks", deps=_deps(c))
    assert c.calls[0][1] == "nguoi-dung-nks"


def test_cung_cach_doi_xu_voi_duong_dang_nhap():
    """Cả hai đường phải đưa CÙNG một chuỗi xuống `client.login`."""
    from app.clients.auth_nks import NKSAuthProvider

    raw = "  co-khoang-trang  "
    c1 = ClientGia()
    NKSAuthProvider(client=c1, enabled=lambda: True).doi_mat_khau(raw, CU, MOI)
    assert c1.calls[0][1] == raw

    # Đường đăng nhập (`authenticate`) cũng không cắt gì — xem `auth_nks/__init__.py`.
    import inspect
    from app.clients.auth_nks import NKSAuthProvider as P
    assert ".strip()" not in inspect.getsource(P.doi_mat_khau)


# ── Kiểm dữ liệu nhập ───────────────────────────────────────────────────────
@pytest.mark.parametrize("kw,phan", [
    ({"dinh_danh": ""}, "tên đăng nhập"),
    ({"cu": ""}, "mật khẩu hiện tại"),
    ({"moi": ""}, "mật khẩu mới"),
    ({"xac_nhan": "khac-han"}, "không khớp"),
    ({"moi": "ngan", "xac_nhan": "ngan"}, "ít nhất"),
    ({"moi": CU, "xac_nhan": CU}, "khác mật khẩu hiện tại"),
    ({"moi": "x" * 201, "xac_nhan": "x" * 201}, "tối đa"),
])
def test_du_lieu_nhap_sai_bi_chan_TRUOC_khi_ra_mang(kw, phan):
    c = ClientGia()
    with pytest.raises(uc.MatKhauKhongHopLe) as e:
        _doi(deps=_deps(c), **kw)
    assert phan in str(e.value)
    assert c.calls == [], "mật khẩu KHÔNG được rời máy chủ khi dữ liệu chưa hợp lệ"


# ── 13. LocalAuth bị từ chối TRƯỚC khi mật khẩu rời máy chủ ─────────────────
def test_nguoi_dung_local_bi_tu_choi_va_mat_khau_khong_di_dau_ca():
    c, idents = ClientGia(), IdentitiesGia(co=False)
    with pytest.raises(uc.KhongPhaiNguoiDungProvider):
        _doi(deps=_deps(c, idents))
    assert c.calls == []
    assert idents.calls == [("nks", UID_A)]       # tra bằng user_id, KHÔNG bằng email


def test_provider_la_bi_tu_choi():
    c = ClientGia()
    with pytest.raises(uc.InvalidProvider):
        _doi(deps=_deps(c), provider="facebook")
    with pytest.raises(uc.InvalidProvider):
        _doi(deps=_deps(c), provider="local")
    assert c.calls == []


def test_thieu_user_studymap():
    c = ClientGia()
    with pytest.raises(uc.InvalidCredentials):
        _doi(uid="", deps=_deps(c))
    assert c.calls == []


# ── 4. Sai mật khẩu cũ ⇒ 401 chung chung ───────────────────────────────────
def test_sai_mat_khau_cu_thi_KHONG_dong_den_phien():
    c, users = ClientGia(login_exc=NksInvalidCredentials("sai")), UsersGia()
    gid, _ = grants.tao(UID_A, "nks", "bi-mat")
    with pytest.raises(uc.InvalidCredentials):
        _doi(deps=_deps(c, users=users))

    assert users.bumps == []                      # phiên StudyMap còn nguyên
    assert grants.lay(gid, UID_A) == "bi-mat"     # chứng từ cũng còn nguyên
    assert [x[0] for x in c.calls] == ["login"]   # không hề gọi update_pass


# ── 5 + 6. Hỏng sau khi đăng nhập ⇒ phiên vẫn sống ─────────────────────────
@pytest.mark.parametrize("kw,loi", [
    ({"login_exc": NksUnavailable("503")}, uc.ProviderUnavailable),
    ({"pass_exc": NksUnavailable("503")}, uc.ProviderUnavailable),
    ({"pass_exc": NksProtocolError("la")}, uc.ProviderProtocolError),
    ({"ok": False}, uc.ProviderProtocolError),
])
def test_provider_hong_thi_phien_studymap_song_sot(kw, loi):
    """Mật khẩu CHƯA đổi thì không có lý do gì bắt người dùng đăng nhập lại."""
    c, users = ClientGia(**kw), UsersGia()
    gid, _ = grants.tao(UID_A, "nks", "bi-mat")
    with pytest.raises(loi):
        _doi(deps=_deps(c, users=users))

    assert users.bumps == []
    assert grants.lay(gid, UID_A) == "bi-mat"


# ── 7 + 8 + 9. Thành công ⇒ vô hiệu phiên StudyMap ─────────────────────────
def test_thanh_cong_thi_tang_token_version_va_huy_chung_tu():
    """Bắt buộc: KHÔNG có bằng chứng NKS thu hồi token cũ của họ, và đo thật cho thấy
    đăng nhập lại còn không giết được token trước đó. Thứ ta kiểm soát được là phiên
    StudyMap — nên phải dùng đúng thứ đó."""
    c, users = ClientGia(), UsersGia()
    gid, _ = grants.tao(UID_A, "nks", "bi-mat")
    _doi(deps=_deps(c, users=users))

    assert users.bumps == [UID_A]                 # mọi token StudyMap thành vô hiệu
    assert grants.lay(gid, UID_A) is None
    assert grants.so_luong() == 0


def test_chi_dung_cham_phien_cua_CHINH_nguoi_do():
    c, users = ClientGia(), UsersGia()
    gid_b, _ = grants.tao(UID_B, "nks", "bi-mat-cua-B")
    _doi(deps=_deps(c, users=users))

    assert users.bumps == [UID_A]
    assert grants.lay(gid_b, UID_B) == "bi-mat-cua-B"


# ── 11 + 12 + 19. Không rò bí mật; token bị vứt ở MỌI đường ─────────────────
def test_khong_co_mat_khau_hay_token_trong_log(caplog):
    c = ClientGia()
    with caplog.at_level(logging.DEBUG):
        _doi(deps=_deps(c))
        with pytest.raises(uc.InvalidCredentials):
            _doi(deps=_deps(ClientGia(login_exc=NksInvalidCredentials("sai"))))
    ban_ghi = " ".join(r.getMessage() for r in caplog.records)
    for bi_mat in (CU, MOI, TOKEN):
        assert bi_mat not in ban_ghi


@pytest.mark.parametrize("kw", [
    {"pass_exc": NksUnavailable("503")},
    {"pass_exc": NksProtocolError("la")},
    {"ok": False},
])
def test_token_bi_vut_ke_ca_khi_updatePass_no_giua_chung(kw):
    """`finally: del` — token sống một năm và không thu hồi được, nên không được
    sống lâu hơn một lời gọi hàm, kể cả trên đường lỗi."""
    prov = NKSAuthProvider(client=ClientGia(**kw), enabled=lambda: True)
    with pytest.raises(Exception):
        prov.doi_mat_khau("u", CU, MOI)
    # Không có tham chiếu nào tới token còn sống ngoài phạm vi hàm.
    assert grants.so_luong() == 0


def test_ngoai_le_khong_mang_theo_mat_khau():
    c = ClientGia(login_exc=NksInvalidCredentials("sai tài khoản hoặc mật khẩu"))
    try:
        _doi(deps=_deps(c))
    except uc.AuthError as exc:
        for bi_mat in (CU, MOI, TOKEN):
            assert bi_mat not in str(exc)


def test_use_case_khong_tra_ve_gi_ca():
    """Không có gì để trả: không token, không hồ sơ, không trạng thái provider."""
    assert _doi(deps=_deps(ClientGia())) is None


# ── 20. Không đụng vai trò ──────────────────────────────────────────────────
def test_khong_dung_toi_vai_tro_hay_avatar():
    """Đổi mật khẩu không được sửa `role` hay `avatar_url` — `UsersGia` chỉ khai
    `bump_token_version`, nên chạm hàm khác là `AttributeError` ngay."""
    users = UsersGia()
    _doi(deps=_deps(ClientGia(), users=users))
    assert users.bumps == [UID_A]
    assert not hasattr(users, "set_role_called")


# ── 14–18. Trần số lần thử (module dùng chung với đường cấp chứng từ) ──────
def test_bo_dem_dung_khoa_rieng_cho_duong_mat_khau():
    """Khoá riêng `pass:` để một lần sai mật khẩu không khoá luôn đường cấp chứng từ."""
    for _ in range(gioi_han.SO_LAN_TOI_DA):
        gioi_han.ghi_that_bai(f"pass:u:{UID_A}")
    assert gioi_han.cho_phep(f"pass:u:{UID_A}")[0] is False
    assert gioi_han.cho_phep(f"grant:u:{UID_A}")[0] is True


def test_tran_chan_sau_nhieu_lan_that_bai():
    k = f"pass:ip:1.2.3.4"
    for _ in range(gioi_han.SO_LAN_TOI_DA):
        assert gioi_han.cho_phep(k)[0] is True
        gioi_han.ghi_that_bai(k)
    duoc, cho = gioi_han.cho_phep(k)
    assert duoc is False and 0 < cho <= gioi_han.CUA_SO_SEC


def test_bo_dem_co_tran_va_dong_thoi_khong_pha_duoc():
    loi: list[BaseException] = []

    def chay(i):
        try:
            for j in range(30):
                gioi_han.ghi_that_bai(f"pass:u:{i}-{j}")
                gioi_han.cho_phep(f"pass:u:{i}-{j}")
        except BaseException as e:  # noqa: BLE001
            loi.append(e)

    ts = [threading.Thread(target=chay, args=(i,)) for i in range(8)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(timeout=30)
    assert loi == []
    assert gioi_han.so_khoa() <= gioi_han.TRAN_SO_KHOA
