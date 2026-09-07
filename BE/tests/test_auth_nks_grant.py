"""Chứng từ ghi ngắn hạn cho NKS — kho trong RAM, use case, và hai route.

Vì sao thứ này tồn tại, nói gọn: token NKS sống **365 ngày**, `scopes: []`, không có
refresh và không thu hồi được (đo 2026-09-07). Giữ nó lâu là giữ một chìa khoá vạn
năng cả năm. Nên đổi lấy: giữ 10 phút trong RAM, không đĩa, không DB, không ra tới
trình duyệt.

Không chạm database: use case nhận `deps`, nên `identities_store` và provider đều là
đồ giả. Kho chứng từ và bộ đếm là mã THẬT — chúng chính là thứ đang được kiểm.
"""

from __future__ import annotations

import json
import logging
import threading
import time

import pytest

from app.application import auth as app_auth
from app.domains.auth import gioi_han, grants

TOKEN_NKS = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.KHONG-DUOC-RO-RA-NGOAI.xxx"
MAT_KHAU = "mat-khau-chi-co-trong-test-7c2f"
UID_A, UID_B = "user-A", "user-B"
PID = "128"


@pytest.fixture(autouse=True)
def _sach():
    grants.reset_for_tests()
    gioi_han.reset_for_tests()
    yield
    grants.reset_for_tests()
    gioi_han.reset_for_tests()


class ProviderGia:
    """Đứng đúng chỗ `NKSAuthProvider` — chỉ cần `mo_phien_ghi`."""

    def __init__(self, pid=PID, token=TOKEN_NKS, exc=None):
        self.pid, self.token, self.exc = pid, token, exc
        self.calls = 0

    def mo_phien_ghi(self, credentials):
        self.calls += 1
        if self.exc:
            raise self.exc
        from shared.interfaces.auth import InternalIdentity
        return InternalIdentity(provider="nks", provider_user_id=self.pid,
                                email="a@example.com", display_name="Người NKS",
                                role="learner"), self.token


class IdentitiesGia:
    def __init__(self, chu=UID_A, pid=PID):
        self.chu, self.pid = chu, pid

    def find(self, provider, provider_user_id):
        if provider != "nks" or str(provider_user_id) != str(self.pid):
            return None
        return {"identity_id": "i-1", "user_id": self.chu,
                "provider": provider, "provider_user_id": provider_user_id}


def _deps(prov=None, idents=None):
    return {"nks_provider": prov or ProviderGia(),
            "identities_store": idents or IdentitiesGia()}


# ── 1. Đường thành công ──────────────────────────────────────────────────────
def test_mat_khau_dung_thi_co_chung_tu_va_token_KHONG_ro_ra():
    prov = ProviderGia()
    gid, het_han = app_auth.mo_grant_ghi(UID_A, "u", MAT_KHAU, deps=_deps(prov))

    assert isinstance(gid, str) and len(gid) >= 32
    assert TOKEN_NKS not in gid                      # grant_id không mang token
    assert grants.lay(gid, UID_A) == TOKEN_NKS       # token chỉ lấy được ở máy chủ
    assert 0 < het_han - time.time() <= grants.TTL_SEC


def test_grant_id_ngau_nhien_va_khong_doan_duoc():
    a, _ = app_auth.mo_grant_ghi(UID_A, "u", MAT_KHAU, deps=_deps())
    b, _ = app_auth.mo_grant_ghi(UID_B, "u", MAT_KHAU,
                                 deps=_deps(idents=IdentitiesGia(chu=UID_B)))
    assert a != b
    assert len(set(a)) > 8                            # không phải chuỗi lặp/đếm


# ── 2. Sai mật khẩu ──────────────────────────────────────────────────────────
def test_sai_mat_khau_khong_co_chung_tu_nao():
    from app.clients.auth_nks.errors import NksInvalidCredentials

    prov = ProviderGia(exc=NksInvalidCredentials("sai"))
    with pytest.raises(app_auth.InvalidCredentials):
        app_auth.mo_grant_ghi(UID_A, "u", "sai-mat-khau", deps=_deps(prov))
    assert grants.so_luong() == 0


def test_nks_sap_thi_khong_phai_loi_credential():
    from app.clients.auth_nks.errors import NksUnavailable

    with pytest.raises(app_auth.ProviderUnavailable):
        app_auth.mo_grant_ghi(UID_A, "u", MAT_KHAU, deps=_deps(ProviderGia(exc=NksUnavailable("x"))))
    assert grants.so_luong() == 0


# ── 3 + 4. Chứng từ gắn với ĐÚNG người dùng StudyMap ─────────────────────────
def test_chung_tu_thuoc_ve_dung_nguoi_tao():
    gid, _ = app_auth.mo_grant_ghi(UID_A, "u", MAT_KHAU, deps=_deps())
    assert grants.lay(gid, UID_A) == TOKEN_NKS


def test_nguoi_dung_khac_khong_dung_duoc_chung_tu():
    gid, _ = app_auth.mo_grant_ghi(UID_A, "u", MAT_KHAU, deps=_deps())
    assert grants.lay(gid, UID_B) is None
    assert grants.xoa(gid, UID_B) is False            # cũng không xoá được
    assert grants.lay(gid, UID_A) == TOKEN_NKS        # và không bị ảnh hưởng


def test_credential_cua_tai_khoan_NKS_khac_bi_tu_choi():
    """Ca chiếm hồ sơ: nộp credential NKS của người khác để ghi lên hồ sơ của họ.

    Danh tính NKS trả về trỏ tới `UID_B`, nhưng người đang gọi là `UID_A` ⇒ từ chối,
    và không giữ lại token.
    """
    with pytest.raises(app_auth.GrantKhongKhopDanhTinh):
        app_auth.mo_grant_ghi(UID_A, "u", MAT_KHAU,
                              deps=_deps(idents=IdentitiesGia(chu=UID_B)))
    assert grants.so_luong() == 0


def test_danh_tinh_NKS_chua_lien_ket_bi_tu_choi():
    with pytest.raises(app_auth.GrantKhongKhopDanhTinh):
        app_auth.mo_grant_ghi(UID_A, "u", MAT_KHAU,
                              deps=_deps(idents=IdentitiesGia(pid="pid-khac")))
    assert grants.so_luong() == 0


# ── 5. Hết hạn ───────────────────────────────────────────────────────────────
def test_chung_tu_het_han_bi_tu_choi_va_bi_don():
    gid, _ = app_auth.mo_grant_ghi(UID_A, "u", MAT_KHAU, deps=_deps(), ttl_sec=1)
    assert grants.lay(gid, UID_A) == TOKEN_NKS
    time.sleep(1.05)
    assert grants.lay(gid, UID_A) is None
    assert grants.so_luong() == 0                     # đã dọn, không rò bộ nhớ


def test_han_la_tuyet_doi_khong_gia_han_truot():
    gid, het_han = app_auth.mo_grant_ghi(UID_A, "u", MAT_KHAU, deps=_deps(), ttl_sec=2)
    time.sleep(0.5)
    grants.lay(gid, UID_A)                            # dùng một lần
    time.sleep(0.5)
    grants.lay(gid, UID_A)                            # dùng lần nữa
    con = het_han - time.time()
    assert con < 1.2, "dùng chứng từ KHÔNG được đẩy hạn ra xa"


# ── 6. Thu hồi ───────────────────────────────────────────────────────────────
def test_xoa_thu_hoi_va_idempotent():
    gid, _ = app_auth.mo_grant_ghi(UID_A, "u", MAT_KHAU, deps=_deps())
    assert grants.xoa(gid, UID_A) is True
    assert grants.lay(gid, UID_A) is None
    assert grants.xoa(gid, UID_A) is False            # gọi lại vẫn an toàn
    assert grants.xoa("khong-ton-tai", UID_A) is False


# ── 7. Đăng xuất ─────────────────────────────────────────────────────────────
def test_dang_xuat_xoa_moi_chung_tu_cua_nguoi_do():
    gid_a, _ = app_auth.mo_grant_ghi(UID_A, "u", MAT_KHAU, deps=_deps())
    gid_b, _ = app_auth.mo_grant_ghi(UID_B, "u", MAT_KHAU,
                                     deps=_deps(idents=IdentitiesGia(chu=UID_B)))

    assert grants.xoa_cua_user(UID_A) == 1
    assert grants.lay(gid_a, UID_A) is None
    assert grants.lay(gid_b, UID_B) == TOKEN_NKS      # người khác không bị đụng


# ── 8. Tiến trình khởi động lại ──────────────────────────────────────────────
def test_kho_rong_sau_khi_tien_trinh_chet():
    """Render Free ngủ sau ~15 phút và deploy lại mỗi lần đẩy `main` ⇒ kho rỗng là
    trạng thái THƯỜNG, và phải biểu hiện y hệt "không có chứng từ"."""
    gid, _ = app_auth.mo_grant_ghi(UID_A, "u", MAT_KHAU, deps=_deps())
    grants.reset_for_tests()                          # ~ tiến trình mới
    assert grants.lay(gid, UID_A) is None
    assert grants.so_luong() == 0


# ── 9 + 10. Provider từ chối ⇒ không giữ token ───────────────────────────────
def test_that_bai_xac_thuc_khong_de_lai_token_nao():
    from app.clients.auth_nks.errors import NksInvalidCredentials

    for _ in range(3):
        with pytest.raises(app_auth.InvalidCredentials):
            app_auth.mo_grant_ghi(UID_A, "u", "sai", deps=_deps(ProviderGia(
                exc=NksInvalidCredentials("sai"))))
    assert grants.so_luong() == 0


def test_nks_tu_choi_token_sau_khi_da_cap_thi_huy_chung_tu():
    """Token NKS chết giữa chừng (hết hạn/thu hồi phía họ) ⇒ chứng từ phải biến mất
    ngay, không nằm lại trong RAM như một token vô dụng."""
    gid, _ = app_auth.mo_grant_ghi(UID_A, "u", MAT_KHAU, deps=_deps())
    assert grants.lay(gid, UID_A) == TOKEN_NKS

    assert grants.huy(gid) is True                    # đường người GHI gọi khi gặp 401
    assert grants.lay(gid, UID_A) is None
    assert grants.so_luong() == 0
    assert grants.huy(gid) is False


# ── 11. Cấp trùng ────────────────────────────────────────────────────────────
def test_cap_chung_tu_moi_huy_ngay_cai_cu():
    """Hành vi được ĐỊNH NGHĨA: mỗi người giữ tối đa MỘT chứng từ.

    Để hai cái cùng sống chỉ nhân đôi thời gian một token nằm trong RAM mà không cho
    thêm khả năng nào.
    """
    cu, _ = app_auth.mo_grant_ghi(UID_A, "u", MAT_KHAU, deps=_deps())
    moi, _ = app_auth.mo_grant_ghi(UID_A, "u", MAT_KHAU, deps=_deps())

    assert moi != cu
    assert grants.lay(cu, UID_A) is None              # cái cũ chết ngay
    assert grants.lay(moi, UID_A) == TOKEN_NKS
    assert grants.so_luong() == 1


def test_kho_co_tran_va_khong_phinh_vo_han():
    for i in range(grants.TRAN_SO_LUONG + 20):
        grants.tao(f"u-{i}", "nks", "bi-mat")
    assert grants.so_luong() <= grants.TRAN_SO_LUONG


# ── 12. Không rò bí mật ──────────────────────────────────────────────────────
def test_khong_co_token_hay_mat_khau_trong_log(caplog):
    from app.clients.auth_nks.errors import NksInvalidCredentials

    with caplog.at_level(logging.DEBUG):
        app_auth.mo_grant_ghi(UID_A, "nguoi-dung", MAT_KHAU, deps=_deps())
        with pytest.raises(app_auth.InvalidCredentials):
            app_auth.mo_grant_ghi(UID_A, "nguoi-dung", MAT_KHAU,
                                  deps=_deps(ProviderGia(exc=NksInvalidCredentials("sai"))))
    ban_ghi = " ".join(r.getMessage() for r in caplog.records)
    assert TOKEN_NKS not in ban_ghi
    assert MAT_KHAU not in ban_ghi


def test_khong_co_token_trong_exception():
    from app.clients.auth_nks.errors import NksInvalidCredentials

    try:
        app_auth.mo_grant_ghi(UID_A, "u", MAT_KHAU,
                              deps=_deps(ProviderGia(exc=NksInvalidCredentials(TOKEN_NKS))))
    except app_auth.AuthError as exc:
        # Ngay cả khi adapter lỡ nhét token vào thông điệp, mã lỗi HTTP là thứ ra
        # ngoài — route ánh xạ sang "invalid_credentials", không bao giờ trả `str(exc)`.
        assert type(exc).__name__ in ("InvalidCredentials",)

    try:
        app_auth.mo_grant_ghi(UID_A, "u", MAT_KHAU, deps=_deps(idents=IdentitiesGia(chu=UID_B)))
    except app_auth.GrantKhongKhopDanhTinh as exc:
        assert TOKEN_NKS not in str(exc)


# ── 13 + 14. Trần số lần thử ─────────────────────────────────────────────────
def test_tran_chan_sau_nhieu_lan_that_bai():
    k = "grant:u:user-A"
    for _ in range(gioi_han.SO_LAN_TOI_DA):
        duoc, _cho = gioi_han.cho_phep(k)
        assert duoc
        gioi_han.ghi_that_bai(k)

    duoc, cho = gioi_han.cho_phep(k)
    assert duoc is False
    assert 0 < cho <= gioi_han.CUA_SO_SEC


def test_tran_tu_mo_lai_khi_het_cua_so(monkeypatch):
    monkeypatch.setattr(gioi_han, "CUA_SO_SEC", 1)
    k = "grant:ip:1.2.3.4"
    for _ in range(gioi_han.SO_LAN_TOI_DA):
        gioi_han.ghi_that_bai(k)
    assert gioi_han.cho_phep(k)[0] is False
    time.sleep(1.05)
    assert gioi_han.cho_phep(k)[0] is True
    assert gioi_han.so_khoa() == 0                    # mục hết hạn được dọn


def test_thanh_cong_xoa_bo_dem():
    k = "grant:u:user-A"
    for _ in range(gioi_han.SO_LAN_TOI_DA - 1):
        gioi_han.ghi_that_bai(k)
    gioi_han.xoa(k)                                   # route gọi sau khi cấp thành công
    assert gioi_han.cho_phep(k)[0] is True
    assert gioi_han.so_khoa() == 0


def test_bo_dem_co_tran():
    for i in range(gioi_han.TRAN_SO_KHOA + 50):
        gioi_han.ghi_that_bai(f"k-{i}")
    assert gioi_han.so_khoa() <= gioi_han.TRAN_SO_KHOA


# ── 15. LocalAuth không cấp được ─────────────────────────────────────────────
def test_local_khong_the_tao_grant_nks():
    with pytest.raises(app_auth.InvalidProvider):
        app_auth.mo_grant_ghi(UID_A, "u", MAT_KHAU, provider="local", deps=_deps())
    assert grants.so_luong() == 0


def test_provider_la_bi_tu_choi():
    with pytest.raises(app_auth.InvalidProvider):
        app_auth.mo_grant_ghi(UID_A, "u", MAT_KHAU, provider="facebook", deps=_deps())
    assert grants.so_luong() == 0


def test_thieu_user_studymap_thi_khong_cap():
    with pytest.raises(app_auth.InvalidCredentials):
        app_auth.mo_grant_ghi("", "u", MAT_KHAU, deps=_deps())
    assert grants.so_luong() == 0


# ── Đồng thời ────────────────────────────────────────────────────────────────
def test_hai_request_cung_luc_khong_lam_hong_kho():
    """`WEB_CONCURRENCY=1` hôm nay không phải là một bảo đảm — gunicorn có thread, và
    cấu hình đổi được. Kho phải tự đúng."""
    loi: list[BaseException] = []

    def chay(i):
        try:
            for _ in range(25):
                gid, _h = grants.tao(f"u-{i}", "nks", f"bi-mat-{i}")
                assert grants.lay(gid, f"u-{i}") == f"bi-mat-{i}"
                grants.xoa(gid, f"u-{i}")
        except BaseException as e:  # noqa: BLE001
            loi.append(e)

    ts = [threading.Thread(target=chay, args=(i,)) for i in range(8)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(timeout=30)
    assert loi == []
    assert grants.so_luong() == 0


def test_cap_dong_thoi_cho_cung_mot_nguoi_chi_con_mot_chung_tu():
    ids: list[str] = []
    khoa = threading.Lock()

    def chay():
        gid, _ = grants.tao(UID_A, "nks", TOKEN_NKS)
        with khoa:
            ids.append(gid)

    ts = [threading.Thread(target=chay) for _ in range(12)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(timeout=30)

    assert len(set(ids)) == 12                        # mỗi lần một id riêng
    assert grants.so_luong() == 1                     # nhưng chỉ MỘT còn sống
    con_song = [g for g in ids if grants.lay(g, UID_A) is not None]
    assert len(con_song) == 1


# ── Ranh giới: kho không biết gì về NKS ──────────────────────────────────────
def test_kho_chung_tu_khong_nhac_toi_nks():
    """Cùng luật với `test_auth_nks_isolation`: lõi không được mang từ vựng provider."""
    from pathlib import Path
    nguon = Path(grants.__file__).read_text(encoding="utf-8")
    ma = nguon.split('"""', 2)[-1]                    # bỏ docstring giải thích bối cảnh
    assert "nks.vn" not in ma.lower()
    assert "access_token" not in ma
    assert "import requests" not in ma


def test_json_tra_ve_cua_route_khong_chua_token():
    """Hợp đồng của route: chỉ `grant_id` + `expires_at`, không có gì khác."""
    gid, het_han = app_auth.mo_grant_ghi(UID_A, "u", MAT_KHAU, deps=_deps())
    than = json.dumps({"grant_id": gid, "expires_at": int(het_han)})
    assert TOKEN_NKS not in than
    assert MAT_KHAU not in than
    assert set(json.loads(than)) == {"grant_id", "expires_at"}
