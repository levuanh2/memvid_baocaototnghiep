"""`/auth/login` sau khi có nhiều provider — tương thích ngược + cô lập lỗi.

Câu hỏi nặng nhất của đợt này KHÔNG phải "NKS chạy chưa" mà là **"login cũ có còn
y nguyên không"**. Frontend hiện tại gửi đúng `{email, password}` và map chuỗi
`invalid_credentials` sang câu tiếng Việt; đổi một trong hai là vỡ màn đăng nhập.
"""

from __future__ import annotations

import os
import uuid

import pytest

TEST_EMAIL_SUFFIX = "@example.com"


@pytest.fixture(scope="module", autouse=True)
def _cleanup_test_users():
    from shared.env_loader import load_project_env
    load_project_env()
    if not (os.getenv("TEST_DATABASE_URL") or "").strip():
        pytest.skip("cần TEST_DATABASE_URL — xem `python -m scripts.setup_test_db --help`")
    yield
    from sqlalchemy import text

    from app.db import get_engine
    with get_engine().begin() as c:
        c.execute(text("DELETE FROM users WHERE email LIKE :pat"),
                  {"pat": "%" + TEST_EMAIL_SUFFIX})


def _tao_user(client, password="password123"):
    email = f"u{uuid.uuid4().hex[:12]}@example.com"
    client.post("/auth/register", json={"email": email, "password": password,
                                        "display_name": "Tester"})
    return email, password


# ── Tương thích ngược ────────────────────────────────────────────────────────
def test_khong_co_provider_van_dang_nhap_nhu_cu(client):
    """Đúng payload frontend đang gửi hôm nay."""
    email, pw = _tao_user(client)
    r = client.post("/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200
    body = r.get_json()
    assert body["token"]
    assert set(body["user"].keys()) == {"id", "email", "display_name", "role"}
    assert body["user"]["email"] == email


def test_sai_mat_khau_van_la_401_invalid_credentials(client):
    """Mã lỗi này là hợp đồng với frontend (AuthContext.friendlyError)."""
    email, _ = _tao_user(client)
    r = client.post("/auth/login", json={"email": email, "password": "sai-het-roi"})
    assert r.status_code == 401
    assert r.get_json()["error"] == "invalid_credentials"


def test_email_khong_ton_tai_van_401_khong_lo_su_ton_tai(client):
    r = client.post("/auth/login",
                    json={"email": f"khong-co-{uuid.uuid4().hex[:8]}@example.com",
                          "password": "password123"})
    assert r.status_code == 401
    assert r.get_json()["error"] == "invalid_credentials"


def test_token_phat_ra_dung_duoc_voi_middleware_cu(client):
    """Token vẫn do `tokens.make_token` phát và `/auth/me` vẫn đọc được."""
    email, pw = _tao_user(client)
    tok = client.post("/auth/login", json={"email": email, "password": pw}).get_json()["token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert me.status_code == 200
    assert me.get_json()["user"]["email"] == email


def test_provider_local_tuong_minh_giong_het_khong_ghi_provider(client):
    email, pw = _tao_user(client)
    a = client.post("/auth/login", json={"email": email, "password": pw})
    b = client.post("/auth/login", json={"email": email, "password": pw, "provider": "local"})
    assert a.status_code == b.status_code == 200
    assert a.get_json()["user"] == b.get_json()["user"]


# ── Định tuyến provider ──────────────────────────────────────────────────────
def test_provider_la_thi_400_invalid_provider(client):
    email, pw = _tao_user(client)
    r = client.post("/auth/login",
                    json={"email": email, "password": pw, "provider": "khong-co-that"})
    assert r.status_code == 400
    assert r.get_json()["error"] == "invalid_provider"


def test_nks_tat_thi_400_provider_not_enabled(client, monkeypatch):
    """Mặc định AUTH_NKS_ENABLED chưa bật ⇒ chọn nks phải bị từ chối rõ ràng."""
    monkeypatch.delenv("AUTH_NKS_ENABLED", raising=False)
    email, pw = _tao_user(client)
    r = client.post("/auth/login", json={"email": email, "password": pw, "provider": "nks"})
    assert r.status_code == 400
    assert r.get_json()["error"] == "provider_not_enabled"


# ── Cô lập lỗi: NKS hỏng KHÔNG được kéo theo local ───────────────────────────
@pytest.mark.parametrize("kieu_hong", ["unavailable", "protocol", "not_enabled", "vo_y"])
def test_nks_hong_kieu_gi_local_van_dang_nhap_duoc(client, monkeypatch, kieu_hong):
    from app.clients.auth_nks.errors import (
        NksNotEnabled, NksProtocolError, NksUnavailable,
    )
    from app.application import auth as app_auth

    loi = {
        "unavailable": NksUnavailable("NKS trả 503"),
        "protocol": NksProtocolError("JSON hỏng"),
        "not_enabled": NksNotEnabled("tắt"),
        "vo_y": RuntimeError("lỗi lạ chưa phân loại"),
    }[kieu_hong]

    class NksHong:
        name = "nks"

        def authenticate(self, credentials):
            raise loi

    monkeypatch.setattr(app_auth, "_nks_provider", lambda deps=None: NksHong())

    email, pw = _tao_user(client)
    # NKS hỏng…
    r_nks = client.post("/auth/login", json={"email": email, "password": pw, "provider": "nks"})
    assert r_nks.status_code in (400, 401, 502, 503)
    # …local vẫn đăng nhập bình thường.
    r_local = client.post("/auth/login", json={"email": email, "password": pw})
    assert r_local.status_code == 200
    assert r_local.get_json()["token"]


def test_nks_unavailable_ra_503_khong_phai_401(client, monkeypatch):
    """Provider chết ≠ sai mật khẩu. Trộn hai cái là bảo người dùng đi đổi mật khẩu
    trong khi thứ hỏng là máy chủ NKS."""
    from app.application import auth as app_auth
    from app.clients.auth_nks.errors import NksUnavailable

    class NksChet:
        name = "nks"

        def authenticate(self, credentials):
            raise NksUnavailable("timeout")

    monkeypatch.setattr(app_auth, "_nks_provider", lambda deps=None: NksChet())
    email, pw = _tao_user(client)
    r = client.post("/auth/login", json={"email": email, "password": pw, "provider": "nks"})
    assert r.status_code == 503
    assert r.get_json()["error"] == "provider_unavailable"


def test_nks_xac_thuc_xong_nhung_chua_co_tai_khoan_thi_409_ro_rang(client, monkeypatch):
    """Chặn auto-link theo email: xác thực NKS THÀNH CÔNG vẫn không được mượn tài
    khoản local trùng email. Phải là một mã lỗi riêng, không phải 200."""
    from app.application import auth as app_auth
    from shared.interfaces.auth import InternalIdentity

    email, pw = _tao_user(client)

    class NksTraDanhTinhTrungEmail:
        name = "nks"

        def authenticate(self, credentials):
            return InternalIdentity(provider="nks", provider_user_id="nks-999",
                                    email=email, display_name="Kẻ mạo danh",
                                    role="admin")

    monkeypatch.setattr(app_auth, "_nks_provider", lambda deps=None: NksTraDanhTinhTrungEmail())
    r = client.post("/auth/login", json={"email": email, "password": pw, "provider": "nks"})
    assert r.status_code == 409
    assert r.get_json()["error"] == "identity_not_linked"
    # Và tuyệt đối không phát token cho danh tính đó.
    assert "token" not in r.get_json()
