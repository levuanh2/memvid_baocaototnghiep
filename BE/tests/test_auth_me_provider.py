"""`provider` phải đi kèm người dùng ở MỌI phản hồi auth.

Vì sao có bộ test này: toàn bộ giao diện hồ sơ NKS đã được viết, commit và đẩy lên
(3ad5745 / 6022e13 / 3df7fa6) nhưng KHÔNG AI THẤY, vì `/auth/me` không trả `provider`.

Chuỗi hỏng:

    public_user() → {id, email, display_name, role, avatar}      ← thiếu provider
    dungHoSo()    → nhanNhaCungCap(undefined) → null
    hoSo.nhaCungCap === null cho MỌI người, kể cả người dùng NKS
      AccountMenu   {hoSo.nhaCungCap === "NKS" && …} → ẩn "Đổi mật khẩu"
      ProfileDrawer laNks = false                     → ẩn nút "Chỉnh sửa"

Triệu chứng: menu chỉ còn "Hồ sơ tài khoản" + "Đăng xuất" — đúng cái giao diện cũ.

Một trường thiếu ở một hàm thuần đã vô hiệu hoá ba tính năng đã hoàn chỉnh, và không
test nào bắt được vì mọi test hồ sơ đều TỰ dựng `user` có sẵn `provider`.

Bài học: khi một cờ hiển thị đến từ máy chủ, phải có test đi qua ĐÚNG endpoint mà
giao diện gọi — không phải qua một dict tự chế trong test.
"""

from __future__ import annotations

import pytest

from app.domains.auth import gioi_han, grants, tokens

UID = "user-A"
EMAIL = "nguoi-dung@example.com"


class UsersGia:
    def __init__(self):
        self.row = {"user_id": UID, "email": EMAIL, "display_name": "A",
                    "role": "learner", "avatar_url": None, "token_version": 1}

    def get_by_id(self, user_id):
        return dict(self.row) if str(user_id) == UID else None

    def bump_token_version(self, user_id):
        self.row["token_version"] = int(self.row["token_version"]) + 1


class IdentitiesGia:
    """`find_by_user` — chiều tra mà `/auth/me` dùng để biết provider."""

    def __init__(self, co_nks=True):
        self.co_nks = co_nks
        self.calls: list[tuple] = []

    def find_by_user(self, provider, user_id):
        self.calls.append((provider, str(user_id)))
        if not self.co_nks:
            return None
        return {"identity_id": "i-1", "user_id": str(user_id),
                "provider": provider, "provider_user_id": "128"}


@pytest.fixture(autouse=True)
def _sach():
    gioi_han.reset_for_tests()
    grants.reset_for_tests()
    yield
    gioi_han.reset_for_tests()
    grants.reset_for_tests()


@pytest.fixture
def moi_truong(monkeypatch):
    from app.domains.auth import identities_store, service, users_store
    users = UsersGia()
    monkeypatch.setattr(service, "users_store", users)
    monkeypatch.setattr(users_store, "get_by_id", users.get_by_id)

    def cai_dat(co_nks=True):
        idents = IdentitiesGia(co_nks=co_nks)
        monkeypatch.setattr(identities_store, "find_by_user", idents.find_by_user)
        return users, idents
    return cai_dat


def _bearer(users):
    return {"Authorization": f"Bearer {tokens.make_token(users.row)}"}


# ── /auth/me ────────────────────────────────────────────────────────────────
def test_auth_me_tra_provider_nks_cho_nguoi_dung_da_lien_ket(client, moi_truong):
    users, idents = moi_truong(co_nks=True)
    r = client.get("/auth/me", headers=_bearer(users))

    assert r.status_code == 200
    u = r.get_json()["user"]
    assert u["provider"] == "nks", "thiếu trường này là ẩn toàn bộ giao diện NKS"
    # Tra bằng user_id qua bảng identities — KHÔNG bằng email, không tin client.
    assert idents.calls == [("nks", UID)]


def test_auth_me_tra_local_cho_nguoi_dung_khong_lien_ket(client, moi_truong):
    users, _ = moi_truong(co_nks=False)
    u = client.get("/auth/me", headers=_bearer(users)).get_json()["user"]
    assert u["provider"] == "local"


def test_auth_me_van_giu_nguyen_cac_truong_cu(client, moi_truong):
    """Thêm một khoá, không được đổi hay bỏ khoá nào — FE đang đọc đúng các tên này."""
    users, _ = moi_truong()
    u = client.get("/auth/me", headers=_bearer(users)).get_json()["user"]
    assert set(u) == {"id", "email", "display_name", "role", "avatar", "provider"}
    assert u["id"] == UID and u["email"] == EMAIL
    assert u["role"] == "learner"


def test_auth_me_khong_lo_bi_mat(client, moi_truong):
    users, _ = moi_truong()
    than = client.get("/auth/me", headers=_bearer(users)).get_data(as_text=True)
    for cam in ("password_hash", "token_version", "access_token"):
        assert cam not in than


def test_auth_me_van_401_khi_khong_co_token(client, moi_truong):
    moi_truong()
    assert client.get("/auth/me").status_code == 401


# ── /auth/login ─────────────────────────────────────────────────────────────
@pytest.mark.parametrize("provider,mong", [("nks", "nks"), ("local", "local"), (None, "local")])
def test_login_tra_provider_ngay_lap_tuc(client, monkeypatch, moi_truong, provider, mong):
    """Không có `provider` ở phản hồi đăng nhập thì giao diện NKS bị ẩn cho tới lần
    tải trang kế tiếp — người dùng đăng nhập xong không thấy mục nào của mình."""
    from app.application import auth as app_auth
    users, _ = moi_truong()
    monkeypatch.setattr(app_auth, "dang_nhap", lambda *a, **k: dict(users.row))

    than = {"email": EMAIL, "password": "mat-khau-du-dai"}
    if provider is not None:
        than["provider"] = provider

    u = client.post("/auth/login", json=than).get_json()["user"]
    assert u["provider"] == mong


def test_login_provider_lay_tu_duong_xac_thuc_khong_phai_tu_client(client, monkeypatch, moi_truong):
    """Giá trị trả về là provider mà máy chủ VỪA dùng để xác thực."""
    from app.application import auth as app_auth
    users, _ = moi_truong()
    nhan = {}

    def dang_nhap(identifier, password, provider, **kw):
        nhan["provider"] = provider
        return dict(users.row)
    monkeypatch.setattr(app_auth, "dang_nhap", dang_nhap)

    u = client.post("/auth/login", json={"email": EMAIL, "password": "x", "provider": "NKS"}
                    ).get_json()["user"]
    assert nhan["provider"] == "NKS"     # nguyên văn xuống lõi
    assert u["provider"] == "nks"        # chuẩn hoá khi đi ra


# ── /auth/register + /auth/refresh ─────────────────────────────────────────
def test_register_luon_la_local(client, monkeypatch, moi_truong):
    from app.domains.auth import users_store
    users, _ = moi_truong()
    monkeypatch.setattr(users_store, "create_user", lambda *a, **k: dict(users.row))

    u = client.post("/auth/register",
                    json={"email": "b@example.com", "password": "mat-khau-du-dai"}
                    ).get_json()["user"]
    assert u["provider"] == "local"


def test_refresh_giu_nguyen_hinh_dang_voi_auth_me(client, moi_truong):
    """Refresh trả về `user` cùng bộ khoá với `/auth/me`; lệch nhau là FE thấy
    provider biến mất sau một lần refresh."""
    users, _ = moi_truong(co_nks=True)
    r_me = client.get("/auth/me", headers=_bearer(users)).get_json()["user"]
    r_rf = client.post("/auth/refresh", headers=_bearer(users)).get_json()["user"]

    assert set(r_me) == set(r_rf)
    assert r_rf["provider"] == "nks"
