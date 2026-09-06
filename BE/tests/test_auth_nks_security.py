"""Bí mật NKS không rò ra bất kỳ đâu, và `provider` không mở được đường vòng.

Bổ sung cho `test_auth_nks.py` (rò qua log/exception) và `test_auth_nks_e2e_flow.py`
(rò qua response/DB ở đường thành công). Ở đây soi hai chỗ còn lại:

  * thân phản hồi LỖI — chỗ dễ quên nhất, vì lỗi hay được ghép chuỗi vội;
  * `provider` dùng như một cách bỏ qua kiểm mật khẩu local.
"""

from __future__ import annotations

import logging
import os
import uuid

import pytest

TEST_EMAIL_SUFFIX = "@example.com"
MAT_KHAU_NKS = "mat-khau-nks-chi-co-trong-test-7c1f"
TOKEN_NKS = "nks-access-token-gia-KHONG-DUOC-RO-3ab9"


@pytest.fixture(scope="module", autouse=True)
def _db(client):
    from shared.env_loader import load_project_env
    load_project_env()
    if not (os.getenv("TEST_DATABASE_URL") or "").strip():
        pytest.skip("cần TEST_DATABASE_URL — xem `python -m scripts.setup_test_db --help`")
    yield
    from sqlalchemy import text

    from app.db import get_engine
    with get_engine().begin() as c:
        c.execute(text("DELETE FROM users WHERE email LIKE :p"), {"p": "%" + TEST_EMAIL_SUFFIX})


def _email():
    return f"s{uuid.uuid4().hex[:12]}@example.com"


class NksGia:
    def __init__(self, pid, email, exc=None):
        self.pid, self.email, self.exc = pid, email, exc

    def login(self, username, password, extra=None):
        if self.exc:
            raise self.exc
        return {"success": True, "access_token": TOKEN_NKS}

    def get_user(self, access_token):
        return {"success": True, "data": {"id": self.pid, "email": self.email,
                                          "full_name": "Người NKS"}}


def _cai(monkeypatch, gia):
    from app.application import auth as app_auth
    from app.clients.auth_nks import NKSAuthProvider

    monkeypatch.setattr(app_auth, "_nks_provider",
                        lambda deps=None: NKSAuthProvider(client=gia, enabled=lambda: True))


# ── 4. Bí mật không nằm trong thân phản hồi LỖI ──────────────────────────────
@pytest.mark.parametrize("loi", ["invalid", "unavailable", "protocol"])
def test_than_phan_hoi_loi_khong_chua_mat_khau_hay_token(client, monkeypatch, loi):
    from app.clients.auth_nks.errors import (
        NksInvalidCredentials, NksProtocolError, NksUnavailable,
    )

    exc = {"invalid": NksInvalidCredentials("Tài khoản không tồn tại"),
           "unavailable": NksUnavailable("timeout"),
           "protocol": NksProtocolError("JSON hỏng")}[loi]
    _cai(monkeypatch, NksGia(f"nks-{uuid.uuid4().hex[:8]}", _email(), exc=exc))

    r = client.post("/auth/login", json={"provider": "nks", "username": "nguoi-dung",
                                         "password": MAT_KHAU_NKS})
    than = r.get_data(as_text=True)
    assert MAT_KHAU_NKS not in than
    assert TOKEN_NKS not in than
    assert "nguoi-dung" not in than          # cả định danh cũng không vọng lại
    # Chỉ một mã lỗi máy đọc được, không có chi tiết nội bộ.
    assert set(r.get_json()) == {"error"}


def test_khong_log_mat_khau_khi_di_qua_route(client, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    _cai(monkeypatch, NksGia(f"nks-{uuid.uuid4().hex[:8]}", _email()))
    client.post("/auth/login", json={"provider": "nks", "username": "u",
                                     "password": MAT_KHAU_NKS})
    ban = " ".join(r.getMessage() for r in caplog.records)
    assert MAT_KHAU_NKS not in ban
    assert TOKEN_NKS not in ban


# ── 5. `provider` không phải đường vòng qua kiểm mật khẩu ────────────────────
def test_provider_nks_khong_bo_qua_duoc_mat_khau_local(client, monkeypatch):
    """Có tài khoản local; NKS từ chối ⇒ phải 401, KHÔNG được rơi về local."""
    from app.clients.auth_nks.errors import NksInvalidCredentials

    em = _email()
    client.post("/auth/register", json={"email": em, "password": "password123",
                                        "display_name": "Chủ"})
    _cai(monkeypatch, NksGia("nks-x", em, exc=NksInvalidCredentials("sai")))

    r = client.post("/auth/login", json={"provider": "nks", "email": em,
                                         "password": "password123"})
    assert r.status_code == 401
    assert "token" not in r.get_json()


def test_provider_local_khong_bi_nks_can_thiep(client, monkeypatch):
    """Chọn local thì adapter NKS KHÔNG được gọi, dù nó đang bật."""
    goi = {"n": 0}

    class NksDemLuot(NksGia):
        def login(self, username, password, extra=None):
            goi["n"] += 1
            return super().login(username, password, extra)

    _cai(monkeypatch, NksDemLuot("nks-y", _email()))
    em = _email()
    client.post("/auth/register", json={"email": em, "password": "password123",
                                        "display_name": "Chủ"})
    r = client.post("/auth/login", json={"email": em, "password": "password123"})
    assert r.status_code == 200
    assert goi["n"] == 0


def test_provider_khong_nang_duoc_quyen_cua_tai_khoan_local_san_co(client, monkeypatch):
    """NKS khai `Manager` (→admin) trùng email tài khoản local ⇒ không đổi vai trò."""
    em = _email()
    client.post("/auth/register", json={"email": em, "password": "password123",
                                        "display_name": "Chủ"})

    class NksManager(NksGia):
        def get_user(self, access_token):
            return {"success": True, "data": {"id": "nks-leo-thang", "email": em,
                                              "full_name": "Kẻ mạo danh",
                                              "group": "Manager"}}

    _cai(monkeypatch, NksManager("nks-leo-thang", em))
    r = client.post("/auth/login", json={"provider": "nks", "username": "u",
                                         "password": MAT_KHAU_NKS})
    assert r.status_code == 409

    from sqlalchemy import text

    from app.db import get_engine
    with get_engine().begin() as c:
        assert c.execute(text("SELECT role FROM users WHERE email=:e"),
                         {"e": em}).scalar_one() == "learner"


def test_provider_rong_hoac_hoa_thuong_van_ve_local(client):
    """`provider: ""` / `"LOCAL"` không được biến thành một nhánh lạ."""
    em = _email()
    client.post("/auth/register", json={"email": em, "password": "password123",
                                        "display_name": "Chủ"})
    for gt in ("", "local", "LOCAL", "  local  "):
        r = client.post("/auth/login", json={"email": em, "password": "password123",
                                             "provider": gt})
        assert r.status_code == 200, f"provider={gt!r}"
