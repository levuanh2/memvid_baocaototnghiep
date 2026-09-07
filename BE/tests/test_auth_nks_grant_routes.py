"""Hợp đồng HTTP của `/auth/nks/grant` — không cần database.

Phiên StudyMap được thay bằng cách patch `service.current_user_from_request`, nên bộ
này chạy ở mọi máy, kể cả khi không có `TEST_DATABASE_URL`. Thứ đang đo là hợp đồng
của ROUTE: mã trạng thái, đúng những khoá nào đi ra, ai được gọi, và trần số lần thử.
"""

from __future__ import annotations

import time

import pytest

from app.domains.auth import gioi_han, grants

TOKEN_NKS = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.KHONG-DUOC-RO-RA.xxx"
MAT_KHAU = "mat-khau-chi-co-trong-test-1a9d"
UID_A, UID_B = "user-A", "user-B"


@pytest.fixture(autouse=True)
def _sach():
    grants.reset_for_tests()
    gioi_han.reset_for_tests()
    yield
    grants.reset_for_tests()
    gioi_han.reset_for_tests()


def _dang_nhap_la(monkeypatch, uid):
    """Giả lập một phiên StudyMap hợp lệ mà không cần bảng `users`."""
    from app.domains.auth import service
    monkeypatch.setattr(service, "current_user_from_request",
                        lambda: {"user_id": uid, "email": f"{uid}@example.com",
                                 "display_name": uid, "role": "learner",
                                 "token_version": 1})


def _cap_grant_gia(monkeypatch, *, exc=None, uid_chu=None):
    """Thay use case: route được đo riêng, không kéo theo adapter/NKS."""
    from app.application import auth as app_auth

    def gia(user_id, identifier, password, provider=app_auth.NKS, **kw):
        if exc:
            raise exc
        return grants.tao(str(uid_chu or user_id), "nks", TOKEN_NKS)

    monkeypatch.setattr(app_auth, "mo_grant_ghi", gia)


# ── Phải đăng nhập StudyMap ──────────────────────────────────────────────────
def test_chua_dang_nhap_thi_401(client, monkeypatch):
    from app.domains.auth import service
    monkeypatch.setattr(service, "current_user_from_request", lambda: None)

    r = client.post("/auth/nks/grant", json={"identifier": "u", "password": MAT_KHAU})
    assert r.status_code == 401
    assert r.get_json() == {"error": "unauthorized"}
    assert grants.so_luong() == 0


def test_khong_co_che_do_mo_du_AUTH_PROTECT_APP_APIS_tat(client, monkeypatch):
    """Route này cầm mật khẩu của một hệ thống KHÁC — không được fail-open theo cờ."""
    from app.domains.auth import service
    monkeypatch.setenv("AUTH_PROTECT_APP_APIS", "false")
    monkeypatch.setattr(service, "current_user_from_request", lambda: None)

    assert client.post("/auth/nks/grant", json={"identifier": "u", "password": "x"}).status_code == 401


# ── Thành công: đúng hai khoá đi ra ──────────────────────────────────────────
def test_cap_thanh_cong_tra_dung_grant_id_va_expires_at(client, monkeypatch):
    _dang_nhap_la(monkeypatch, UID_A)
    _cap_grant_gia(monkeypatch)

    r = client.post("/auth/nks/grant", json={"identifier": "u", "password": MAT_KHAU})
    assert r.status_code == 201
    body = r.get_json()
    assert set(body) == {"grant_id", "expires_at"}
    assert TOKEN_NKS not in r.get_data(as_text=True)
    assert MAT_KHAU not in r.get_data(as_text=True)
    assert body["expires_at"] > time.time()
    assert grants.lay(body["grant_id"], UID_A) == TOKEN_NKS


def test_sai_credential_tra_401_chung_chung(client, monkeypatch):
    from app.application import auth as app_auth
    _dang_nhap_la(monkeypatch, UID_A)
    _cap_grant_gia(monkeypatch, exc=app_auth.InvalidCredentials("sai"))

    r = client.post("/auth/nks/grant", json={"identifier": "u", "password": "sai"})
    assert r.status_code == 401
    assert r.get_json() == {"error": "invalid_credentials"}


def test_credential_cua_tai_khoan_khac_tra_Y_HET_sai_mat_khau(client, monkeypatch):
    """Không được phân biệt "sai mật khẩu" với "đúng mật khẩu nhưng của người khác" —
    phân biệt là tiết lộ một tài khoản NKS có tồn tại và đã liên kết."""
    from app.application import auth as app_auth
    _dang_nhap_la(monkeypatch, UID_A)

    _cap_grant_gia(monkeypatch, exc=app_auth.InvalidCredentials("sai"))
    r_sai = client.post("/auth/nks/grant", json={"identifier": "u", "password": "x"})
    _cap_grant_gia(monkeypatch, exc=app_auth.GrantKhongKhopDanhTinh("nks"))
    r_khac = client.post("/auth/nks/grant", json={"identifier": "u", "password": "x"})

    assert r_sai.status_code == r_khac.status_code == 401
    assert r_sai.get_json() == r_khac.get_json()


def test_nks_sap_tra_503_chu_khong_phai_401(client, monkeypatch):
    from app.application import auth as app_auth
    _dang_nhap_la(monkeypatch, UID_A)
    _cap_grant_gia(monkeypatch, exc=app_auth.ProviderUnavailable("x"))

    assert client.post("/auth/nks/grant", json={"identifier": "u", "password": "x"}).status_code == 503


# ── Trần số lần thử ──────────────────────────────────────────────────────────
def test_tran_chan_sau_nhieu_lan_sai_va_KHONG_dem_loi_ha_tang(client, monkeypatch):
    from app.application import auth as app_auth
    _dang_nhap_la(monkeypatch, UID_A)

    # Lỗi hạ tầng: không phải lỗi của người đang gõ ⇒ không được tính vào trần.
    _cap_grant_gia(monkeypatch, exc=app_auth.ProviderUnavailable("x"))
    for _ in range(gioi_han.SO_LAN_TOI_DA + 3):
        assert client.post("/auth/nks/grant", json={"identifier": "u", "password": "x"}).status_code == 503

    # Sai mật khẩu thì có.
    _cap_grant_gia(monkeypatch, exc=app_auth.InvalidCredentials("sai"))
    for _ in range(gioi_han.SO_LAN_TOI_DA):
        assert client.post("/auth/nks/grant", json={"identifier": "u", "password": "x"}).status_code == 401

    r = client.post("/auth/nks/grant", json={"identifier": "u", "password": "x"})
    assert r.status_code == 429
    assert r.get_json()["error"] == "rate_limited"
    assert int(r.headers["Retry-After"]) > 0


def test_cap_thanh_cong_xoa_bo_dem(client, monkeypatch):
    from app.application import auth as app_auth
    _dang_nhap_la(monkeypatch, UID_A)

    _cap_grant_gia(monkeypatch, exc=app_auth.InvalidCredentials("sai"))
    for _ in range(gioi_han.SO_LAN_TOI_DA - 1):
        client.post("/auth/nks/grant", json={"identifier": "u", "password": "x"})

    _cap_grant_gia(monkeypatch)
    assert client.post("/auth/nks/grant", json={"identifier": "u", "password": MAT_KHAU}).status_code == 201

    _cap_grant_gia(monkeypatch, exc=app_auth.InvalidCredentials("sai"))
    assert client.post("/auth/nks/grant", json={"identifier": "u", "password": "x"}).status_code == 401


# ── DELETE ───────────────────────────────────────────────────────────────────
def test_delete_thu_hoi_va_idempotent(client, monkeypatch):
    _dang_nhap_la(monkeypatch, UID_A)
    _cap_grant_gia(monkeypatch)
    gid = client.post("/auth/nks/grant", json={"identifier": "u", "password": MAT_KHAU}
                      ).get_json()["grant_id"]

    r1 = client.delete("/auth/nks/grant", json={"grant_id": gid})
    assert r1.status_code == 200 and r1.get_json() == {"ok": True}
    assert grants.lay(gid, UID_A) is None

    r2 = client.delete("/auth/nks/grant", json={"grant_id": gid})
    assert r2.status_code == 200 and r2.get_json() == {"ok": True}


def test_delete_khong_body_thu_hoi_tat_ca_cua_chinh_minh(client, monkeypatch):
    _dang_nhap_la(monkeypatch, UID_A)
    _cap_grant_gia(monkeypatch)
    gid = client.post("/auth/nks/grant", json={"identifier": "u", "password": MAT_KHAU}
                      ).get_json()["grant_id"]

    assert client.delete("/auth/nks/grant").status_code == 200
    assert grants.lay(gid, UID_A) is None


def test_delete_khong_dung_toi_chung_tu_cua_nguoi_khac(client, monkeypatch):
    _dang_nhap_la(monkeypatch, UID_B)
    _cap_grant_gia(monkeypatch, uid_chu=UID_B)
    gid_b = client.post("/auth/nks/grant", json={"identifier": "u", "password": MAT_KHAU}
                        ).get_json()["grant_id"]

    _dang_nhap_la(monkeypatch, UID_A)                 # A cố thu hồi của B
    r = client.delete("/auth/nks/grant", json={"grant_id": gid_b})
    assert r.status_code == 200                        # idempotent, không lộ gì
    assert grants.lay(gid_b, UID_B) == TOKEN_NKS       # nhưng KHÔNG bị xoá


def test_delete_chua_dang_nhap_thi_401(client, monkeypatch):
    from app.domains.auth import service
    monkeypatch.setattr(service, "current_user_from_request", lambda: None)
    assert client.delete("/auth/nks/grant").status_code == 401


# ── Đăng xuất ────────────────────────────────────────────────────────────────
def test_dang_xuat_xoa_chung_tu(client, monkeypatch):
    _dang_nhap_la(monkeypatch, UID_A)
    _cap_grant_gia(monkeypatch)
    gid = client.post("/auth/nks/grant", json={"identifier": "u", "password": MAT_KHAU}
                      ).get_json()["grant_id"]

    r = client.post("/auth/logout")
    assert r.status_code == 200 and r.get_json() == {"ok": True}
    assert grants.lay(gid, UID_A) is None


def test_dang_xuat_khong_co_phien_van_tra_ok(client, monkeypatch):
    """Hợp đồng cũ của `/auth/logout` không đổi: luôn 200, kể cả token hỏng."""
    from app.domains.auth import service
    monkeypatch.setattr(service, "current_user_from_request", lambda: None)
    r = client.post("/auth/logout")
    assert r.status_code == 200 and r.get_json() == {"ok": True}
