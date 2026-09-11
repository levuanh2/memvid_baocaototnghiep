"""`/auth/login` đầu-cuối với provider NKS — HTTP → adapter → identities → token.

NKS được thay bằng client giả ở TẦNG HTTP CLIENT (không phải thay cả provider), nên
mọi thứ dưới nó vẫn là mã thật: mapper, role mapper, identities_store, Postgres thật,
và `tokens.make_token` thật. Chỉ đúng một thứ là giả — cuộc gọi mạng ra NKS.

Ca A–H theo đúng thứ tự đề bài.
"""

from __future__ import annotations

import os
import uuid

import pytest

TEST_EMAIL_SUFFIX = "@example.com"


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
    return f"n{uuid.uuid4().hex[:12]}@example.com"


class NksGia:
    """Đứng đúng chỗ `auth_nks.client` — cùng chữ ký `login` / `get_user`."""

    TOKEN = "nks-access-token-KHONG-DUOC-RO-RA-NGOAI"

    def __init__(self, provider_user_id, email, ten="Người NKS", nhom=None,
                 login_exc=None, user_exc=None):
        self.pid, self.email, self.ten, self.nhom = provider_user_id, email, ten, nhom
        self.login_exc, self.user_exc = login_exc, user_exc

    def login(self, username, password, extra=None):
        if self.login_exc:
            raise self.login_exc
        return {"success": True, "access_token": self.TOKEN}

    def get_user(self, access_token):
        if self.user_exc:
            raise self.user_exc
        d = {"id": self.pid, "email": self.email, "full_name": self.ten}
        if self.nhom:
            # Hình dạng THẬT (đo 2026-09-07): `role` là object `{id, name}`, không
            # phải chuỗi trần. Giữ đúng hình dạng này để đường đọc nhóm được test.
            d["role"] = {"id": 0, "name": self.nhom}
        return {"success": True, "data": d}


def _cai_nks(monkeypatch, gia):
    """Bơm client giả vào NKSAuthProvider thật, bật cờ."""
    from app.application import auth as app_auth
    from app.clients.auth_nks import NKSAuthProvider

    monkeypatch.setattr(app_auth, "_nks_provider",
                        lambda deps=None: NKSAuthProvider(client=gia, enabled=lambda: True))


def _dem_identity(pid):
    from sqlalchemy import text

    from app.db import get_engine
    with get_engine().begin() as c:
        return c.execute(text(
            "SELECT count(*) FROM identities WHERE provider='nks' AND provider_user_id=:p"),
            {"p": pid}).scalar_one()


# ── CASE A — local login không đổi ───────────────────────────────────────────
def test_A_local_login_giu_nguyen(client):
    em = _email()
    client.post("/auth/register", json={"email": em, "password": "password123",
                                        "display_name": "Local"})
    r = client.post("/auth/login", json={"email": em, "password": "password123"})
    assert r.status_code == 200
    b = r.get_json()
    assert b["token"]
    assert set(b["user"]) == {"id", "email", "display_name", "role", "avatar", "provider"}


# ── CASE B — NKS thành công (mock) ───────────────────────────────────────────
def test_B_nks_login_tao_user_va_identity(client, monkeypatch):
    pid, em = f"nks-{uuid.uuid4().hex[:8]}", _email()
    _cai_nks(monkeypatch, NksGia(pid, em))

    r = client.post("/auth/login",
                    json={"provider": "nks", "username": "nguoi-dung", "password": "mk"})
    assert r.status_code == 200, r.get_json()
    b = r.get_json()
    assert b["token"]
    assert b["user"]["email"] == em
    assert set(b["user"]) == {"id", "email", "display_name", "role", "avatar", "provider"}
    assert _dem_identity(pid) == 1

    # Token StudyMap dùng được ở endpoint bảo vệ (CASE L của đề bài).
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {b['token']}"})
    assert me.status_code == 200
    assert me.get_json()["user"]["id"] == b["user"]["id"]


def test_B2_access_token_nks_khong_bao_gio_ro_ra(client, monkeypatch):
    pid, em = f"nks-{uuid.uuid4().hex[:8]}", _email()
    _cai_nks(monkeypatch, NksGia(pid, em))
    r = client.post("/auth/login",
                    json={"provider": "nks", "username": "u", "password": "mk"})
    than = r.get_data(as_text=True)
    assert NksGia.TOKEN not in than                      # không ở response
    assert r.get_json()["token"] != NksGia.TOKEN         # không LÀ token StudyMap

    from sqlalchemy import text

    from app.db import get_engine
    with get_engine().begin() as c:
        # không nằm trong users
        assert c.execute(text("SELECT count(*) FROM users WHERE full_name = :t OR email = :t"),
                         {"t": NksGia.TOKEN}).scalar_one() == 0
        # không nằm trong identities
        assert c.execute(text(
            "SELECT count(*) FROM identities WHERE provider_user_id = :t"),
            {"t": NksGia.TOKEN}).scalar_one() == 0


# ── CASE C — đăng nhập lại: cùng user, không nhân bản ────────────────────────
def test_C_dang_nhap_lai_dung_lai_user_khong_them_identity(client, monkeypatch):
    pid, em = f"nks-{uuid.uuid4().hex[:8]}", _email()
    _cai_nks(monkeypatch, NksGia(pid, em))

    a = client.post("/auth/login", json={"provider": "nks", "username": "u", "password": "mk"})
    b = client.post("/auth/login", json={"provider": "nks", "username": "u", "password": "mk"})
    assert a.status_code == b.status_code == 200
    assert a.get_json()["user"]["id"] == b.get_json()["user"]["id"]
    assert _dem_identity(pid) == 1

    from sqlalchemy import text

    from app.db import get_engine
    with get_engine().begin() as c:
        assert c.execute(text("SELECT count(*) FROM users WHERE email=:e"),
                         {"e": em}).scalar_one() == 1
        assert c.execute(text(
            "SELECT last_login_at IS NOT NULL FROM identities WHERE provider_user_id=:p"),
            {"p": pid}).scalar_one() is True


# ── CASE D — sai thông tin đăng nhập ─────────────────────────────────────────
def test_D_sai_credential_khong_tao_gi(client, monkeypatch):
    from app.clients.auth_nks.errors import NksInvalidCredentials

    pid, em = f"nks-{uuid.uuid4().hex[:8]}", _email()
    _cai_nks(monkeypatch, NksGia(pid, em, login_exc=NksInvalidCredentials("Tài khoản không tồn tại")))

    r = client.post("/auth/login", json={"provider": "nks", "username": "u", "password": "sai"})
    assert r.status_code == 401
    assert r.get_json()["error"] == "invalid_credentials"
    assert _dem_identity(pid) == 0

    from sqlalchemy import text

    from app.db import get_engine
    with get_engine().begin() as c:
        assert c.execute(text("SELECT count(*) FROM users WHERE email=:e"),
                         {"e": em}).scalar_one() == 0


# ── CASE E — provider tắt ────────────────────────────────────────────────────
def test_E_nks_tat_thi_4xx_sach(client, monkeypatch):
    monkeypatch.delenv("AUTH_NKS_ENABLED", raising=False)
    r = client.post("/auth/login", json={"provider": "nks", "username": "u", "password": "mk"})
    assert r.status_code == 400
    assert r.get_json()["error"] == "provider_not_enabled"


# ── CASE F — provider lạ ─────────────────────────────────────────────────────
def test_F_provider_la_thi_4xx_sach(client):
    r = client.post("/auth/login",
                    json={"provider": "khong-ton-tai", "username": "u", "password": "mk"})
    assert r.status_code == 400
    assert r.get_json()["error"] == "invalid_provider"


# ── CASE G — NKS chết giữa chừng ─────────────────────────────────────────────
def test_G_nks_khong_goi_duoc_thi_503_va_khong_tao_ban_ghi_do_dang(client, monkeypatch):
    from app.clients.auth_nks.errors import NksUnavailable

    pid, em = f"nks-{uuid.uuid4().hex[:8]}", _email()
    _cai_nks(monkeypatch, NksGia(pid, em, login_exc=NksUnavailable("timeout")))

    r = client.post("/auth/login", json={"provider": "nks", "username": "u", "password": "mk"})
    assert r.status_code == 503
    assert r.get_json()["error"] == "provider_unavailable"
    assert _dem_identity(pid) == 0


def test_G2_chet_SAU_khi_login_thanh_cong_van_khong_de_lai_identity(client, monkeypatch):
    """Hỏng ở bước /nks/user — nửa chừng. Không được để lại liên kết dở dang."""
    from app.clients.auth_nks.errors import NksUnavailable

    pid, em = f"nks-{uuid.uuid4().hex[:8]}", _email()
    _cai_nks(monkeypatch, NksGia(pid, em, user_exc=NksUnavailable("503 ở /nks/user")))

    r = client.post("/auth/login", json={"provider": "nks", "username": "u", "password": "mk"})
    assert r.status_code == 503
    assert _dem_identity(pid) == 0


# ── CASE H — local vẫn chạy khi NKS đang bật ─────────────────────────────────
def test_H_local_van_dang_nhap_duoc_khi_nks_bat(client, monkeypatch):
    pid, em_nks = f"nks-{uuid.uuid4().hex[:8]}", _email()
    _cai_nks(monkeypatch, NksGia(pid, em_nks))

    em = _email()
    client.post("/auth/register", json={"email": em, "password": "password123",
                                        "display_name": "Local"})
    r = client.post("/auth/login", json={"email": em, "password": "password123"})
    assert r.status_code == 200
    assert r.get_json()["token"]


# ── An toàn liên kết: email trùng tài khoản local ⇒ KHÔNG chiếm ──────────────
def test_email_trung_tai_khoan_local_thi_tu_choi_chu_khong_chiem(client, monkeypatch):
    em = _email()
    client.post("/auth/register", json={"email": em, "password": "password123",
                                        "display_name": "Chủ thật"})
    pid = f"nks-{uuid.uuid4().hex[:8]}"
    # NKS khai đúng email đó, còn tự nhận là Manager (→ admin).
    _cai_nks(monkeypatch, NksGia(pid, em, ten="Kẻ mạo danh", nhom="Manager"))

    r = client.post("/auth/login", json={"provider": "nks", "username": "u", "password": "mk"})
    assert r.status_code == 409
    assert r.get_json()["error"] == "identity_not_linked"
    assert "token" not in r.get_json()
    assert _dem_identity(pid) == 0

    # Tài khoản gốc không bị đổi vai trò.
    from sqlalchemy import text

    from app.db import get_engine
    with get_engine().begin() as c:
        assert c.execute(text("SELECT role FROM users WHERE email=:e"),
                         {"e": em}).scalar_one() == "learner"


# ── Ánh xạ vai trò đi hết đường xuống DB ─────────────────────────────────────
# Giá trị `role.name` THẬT, đo 2026-09-07 (xem `roles.py`): "Manager" / "teacher" /
# "user". Nhãn trong tài liệu ("Faculty", "Student"…) KHÔNG phải giá trị API trả về.
@pytest.mark.parametrize("nhom,mong", [("Manager", "admin"), ("teacher", "teacher"),
                                       ("user", "learner"), ("NhomLa", "learner")])
def test_role_nks_map_dung_khi_luu(client, monkeypatch, nhom, mong):
    pid, em = f"nks-{uuid.uuid4().hex[:8]}", _email()
    _cai_nks(monkeypatch, NksGia(pid, em, nhom=nhom))
    r = client.post("/auth/login", json={"provider": "nks", "username": "u", "password": "mk"})
    assert r.status_code == 200
    assert r.get_json()["user"]["role"] == mong


def _role_trong_db(email):
    from sqlalchemy import text

    from app.db import get_engine
    with get_engine().begin() as c:
        return c.execute(text("SELECT role FROM users WHERE email=:e"), {"e": email}).scalar_one()


@pytest.mark.parametrize("dau,sau,mong_dau,mong_sau", [
    ("user", "Manager", "learner", "admin"),      # thăng quyền
    ("Manager", "user", "admin", "learner"),      # hạ quyền — không được giữ lại admin
])
def test_nguoi_quay_lai_duoc_tinh_lai_vai_tro_theo_nks(client, monkeypatch, dau, sau,
                                                       mong_dau, mong_sau):
    """Vai trò đổi ở NKS phải theo người dùng về, ngay lần đăng nhập kế tiếp.

    Trước bản sửa, nhánh "đã có liên kết" trả nguyên hàng `users` cũ, nên hàng đầu
    tiên ghi vào lúc nào thì vai trò đóng băng từ lúc đó.
    """
    pid, em = f"nks-{uuid.uuid4().hex[:8]}", _email()
    gia = NksGia(pid, em, nhom=dau)
    _cai_nks(monkeypatch, gia)

    r1 = client.post("/auth/login", json={"provider": "nks", "username": "u", "password": "mk"})
    assert r1.status_code == 200
    assert r1.get_json()["user"]["role"] == mong_dau
    assert _role_trong_db(em) == mong_dau

    gia.nhom = sau                       # NKS đổi vai trò giữa hai lần đăng nhập
    r2 = client.post("/auth/login", json={"provider": "nks", "username": "u", "password": "mk"})
    assert r2.status_code == 200
    assert r2.get_json()["user"]["role"] == mong_sau
    assert _role_trong_db(em) == mong_sau
    assert _dem_identity(pid) == 1       # vẫn đúng một liên kết, không tạo thêm


def test_auth_me_thay_vai_tro_moi_bang_TOKEN_CU(client, monkeypatch):
    """Token cũ vẫn dùng được và đã thấy vai trò mới — không đổi định dạng token,
    không bump `token_version`, không bắt đăng nhập lại."""
    pid, em = f"nks-{uuid.uuid4().hex[:8]}", _email()
    gia = NksGia(pid, em, nhom="user")
    _cai_nks(monkeypatch, gia)

    r1 = client.post("/auth/login", json={"provider": "nks", "username": "u", "password": "mk"})
    token_cu = r1.get_json()["token"]
    assert r1.get_json()["user"]["role"] == "learner"

    gia.nhom = "Manager"
    client.post("/auth/login", json={"provider": "nks", "username": "u", "password": "mk"})

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token_cu}"})
    assert me.status_code == 200                       # token CŨ vẫn sống
    assert me.get_json()["user"]["role"] == "admin"    # và đã thấy vai trò mới
