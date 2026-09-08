"""Hợp đồng HTTP của `POST /me/nks/password` — không cần database.

Đo: mã trạng thái, khoá đi ra, trần số lần thử, và điều quan trọng nhất — phản hồi
KHÔNG bao giờ chứa mật khẩu hay token.
"""

from __future__ import annotations

import pytest

from app.domains.auth import gioi_han, grants

UID_A = "user-A"
CU, MOI = "mat-khau-cu-7f2a", "mat-khau-moi-9c4b"
TOKEN = "eyJ0eXAiOiJKV1Q.KHONG-DUOC-RO-RA.xxx"


@pytest.fixture(autouse=True)
def _sach():
    grants.reset_for_tests()
    gioi_han.reset_for_tests()
    yield
    grants.reset_for_tests()
    gioi_han.reset_for_tests()


def _dang_nhap_la(monkeypatch, uid=UID_A):
    from app.domains.auth import service
    monkeypatch.setattr(service, "current_user_from_request",
                        lambda: {"user_id": uid, "email": "a@example.com",
                                 "display_name": uid, "role": "learner",
                                 "avatar_url": None, "token_version": 1})


def _uc_gia(monkeypatch, fn):
    from app.application import mat_khau as m
    monkeypatch.setattr(m, "doi_mat_khau", fn)


def _than(**kw):
    d = {"identifier": "nguoi-dung-nks", "old_password": CU,
         "password": MOI, "password_confirmation": MOI}
    d.update(kw)
    return d


def _gui(client, **kw):
    return client.post("/me/nks/password", json=_than(**kw))


# ── Xác thực ────────────────────────────────────────────────────────────────
def test_chua_dang_nhap_thi_401(client, monkeypatch):
    from app.domains.auth import service
    monkeypatch.setattr(service, "current_user_from_request", lambda: None)
    assert _gui(client).status_code == 401


def test_khong_co_che_do_mo_du_AUTH_PROTECT_APP_APIS_tat(client, monkeypatch):
    """Route cầm mật khẩu của một hệ thống KHÁC — không được fail-open theo cờ."""
    from app.domains.auth import service
    monkeypatch.setenv("AUTH_PROTECT_APP_APIS", "false")
    monkeypatch.setattr(service, "current_user_from_request", lambda: None)
    assert _gui(client).status_code == 401


def test_than_khong_phai_object_thi_400(client, monkeypatch):
    _dang_nhap_la(monkeypatch)
    r = client.post("/me/nks/password", json=["khong", "phai", "object"])
    assert r.status_code == 400
    assert r.get_json()["error"] == "invalid_password"


# ── Thành công ──────────────────────────────────────────────────────────────
def test_thanh_cong_bao_phai_dang_nhap_lai(client, monkeypatch):
    _dang_nhap_la(monkeypatch)
    nhan = {}

    def doi(uid, dinh_danh, cu, moi, xac_nhan, **kw):
        nhan.update(uid=uid, dinh_danh=dinh_danh, cu=cu, moi=moi, xac_nhan=xac_nhan)
    _uc_gia(monkeypatch, doi)

    r = _gui(client)
    assert r.status_code == 200
    assert r.get_json() == {"ok": True, "reauth_required": True}
    # Tham số đi xuống use case đúng nguyên văn, KHÔNG suy từ email.
    assert nhan["uid"] == UID_A and nhan["dinh_danh"] == "nguoi-dung-nks"
    assert nhan["cu"] == CU and nhan["moi"] == MOI and nhan["xac_nhan"] == MOI


def test_phan_hoi_thanh_cong_khong_chua_mat_khau_hay_token(client, monkeypatch):
    _dang_nhap_la(monkeypatch)
    _uc_gia(monkeypatch, lambda *a, **k: None)
    than = _gui(client).get_data(as_text=True)
    for bi_mat in (CU, MOI, TOKEN, "access_token"):
        assert bi_mat not in than


# ── Lỗi ─────────────────────────────────────────────────────────────────────
def test_du_lieu_nhap_sai_tra_400_kem_cau_doc_duoc(client, monkeypatch):
    """Câu này CHỈ nói về hình dạng dữ liệu, không tiết lộ gì về tài khoản."""
    from app.application import mat_khau as m
    _dang_nhap_la(monkeypatch)

    def doi(*a, **k):
        raise m.MatKhauKhongHopLe("Xác nhận mật khẩu không khớp.")
    _uc_gia(monkeypatch, doi)

    r = _gui(client)
    assert r.status_code == 400
    assert r.get_json()["error"] == "invalid_password"
    assert "không khớp" in r.get_json()["message"]


def test_sai_mat_khau_va_KHONG_PHAI_nguoi_NKS_tra_Y_HET_nhau(client, monkeypatch):
    """Phân biệt hai ca đó là nói cho người gọi biết một tài khoản NKS có tồn tại."""
    from app.application import mat_khau as m
    _dang_nhap_la(monkeypatch)

    _uc_gia(monkeypatch, lambda *a, **k: (_ for _ in ()).throw(m.InvalidCredentials("sai")))
    r_sai = _gui(client)
    _uc_gia(monkeypatch, lambda *a, **k: (_ for _ in ()).throw(m.KhongPhaiNguoiDungProvider("nks")))
    r_local = _gui(client)

    assert r_sai.status_code == r_local.status_code == 401
    assert r_sai.get_json() == r_local.get_json() == {"error": "invalid_credentials"}


def test_nks_sap_tra_503(client, monkeypatch):
    from app.application import mat_khau as m
    _dang_nhap_la(monkeypatch)
    _uc_gia(monkeypatch, lambda *a, **k: (_ for _ in ()).throw(m.ProviderUnavailable("x")))
    assert _gui(client).status_code == 503


# ── Trần số lần thử ─────────────────────────────────────────────────────────
def test_tran_chan_sau_nhieu_lan_sai_mat_khau(client, monkeypatch):
    from app.application import mat_khau as m
    _dang_nhap_la(monkeypatch)
    _uc_gia(monkeypatch, lambda *a, **k: (_ for _ in ()).throw(m.InvalidCredentials("sai")))

    for _ in range(gioi_han.SO_LAN_TOI_DA):
        assert _gui(client).status_code == 401
    r = _gui(client)
    assert r.status_code == 429
    assert r.get_json()["error"] == "rate_limited"
    assert int(r.headers["Retry-After"]) > 0


def test_su_co_ha_tang_KHONG_tinh_vao_tran(client, monkeypatch):
    """NKS sập không phải lỗi của người đang gõ — tính vào trần sẽ khoá người dùng
    thật vì một sự cố phía provider."""
    from app.application import mat_khau as m
    _dang_nhap_la(monkeypatch)
    _uc_gia(monkeypatch, lambda *a, **k: (_ for _ in ()).throw(m.ProviderUnavailable("x")))

    for _ in range(gioi_han.SO_LAN_TOI_DA + 3):
        assert _gui(client).status_code == 503

    # Vẫn còn nguyên hạn mức cho lần gõ đúng.
    _uc_gia(monkeypatch, lambda *a, **k: None)
    assert _gui(client).status_code == 200


def test_du_lieu_nhap_sai_KHONG_tinh_vao_tran(client, monkeypatch):
    """Gõ nhầm ô xác nhận không phải là dò mật khẩu."""
    from app.application import mat_khau as m
    _dang_nhap_la(monkeypatch)
    _uc_gia(monkeypatch, lambda *a, **k: (_ for _ in ()).throw(m.MatKhauKhongHopLe("lệch")))

    for _ in range(gioi_han.SO_LAN_TOI_DA + 3):
        assert _gui(client).status_code == 400

    _uc_gia(monkeypatch, lambda *a, **k: None)
    assert _gui(client).status_code == 200


def test_doi_thanh_cong_xoa_bo_dem(client, monkeypatch):
    from app.application import mat_khau as m
    _dang_nhap_la(monkeypatch)
    _uc_gia(monkeypatch, lambda *a, **k: (_ for _ in ()).throw(m.InvalidCredentials("sai")))
    for _ in range(gioi_han.SO_LAN_TOI_DA - 1):
        _gui(client)

    _uc_gia(monkeypatch, lambda *a, **k: None)
    assert _gui(client).status_code == 200

    _uc_gia(monkeypatch, lambda *a, **k: (_ for _ in ()).throw(m.InvalidCredentials("sai")))
    assert _gui(client).status_code == 401       # bộ đếm đã về 0


def test_tran_theo_IP_doc_lap_voi_tran_theo_nguoi_dung(client, monkeypatch):
    """Người dùng bị khoá không được kéo theo mọi người khác cùng IP, và ngược lại."""
    from app.application import mat_khau as m
    _dang_nhap_la(monkeypatch, "user-X")
    _uc_gia(monkeypatch, lambda *a, **k: (_ for _ in ()).throw(m.InvalidCredentials("sai")))
    for _ in range(gioi_han.SO_LAN_TOI_DA):
        _gui(client)
    assert _gui(client).status_code == 429

    # Người khác, CÙNG IP ⇒ khoá IP đã đầy nên cũng bị chặn. Đó là chủ đích: một IP
    # dò nhiều tài khoản chính là ca cần chặn.
    _dang_nhap_la(monkeypatch, "user-Y")
    assert _gui(client).status_code == 429
