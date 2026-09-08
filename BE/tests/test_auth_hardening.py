"""Trần số lần thử cho `/auth/login`, `/auth/register`, và thu hồi phiên.

Hai lỗ hổng bản này bịt, cả hai đều nằm ở lớp auth CŨ của StudyMap chứ không phải ở
phần NKS thêm sau:

  1. `/auth/login` và `/auth/register` KHÔNG có trần nào ở production. Bộ đếm cũ chạy
     trên Redis, mà `render.yaml` đặt `REDIS_URL=""` và không bật `RATE_LIMIT_ENABLED`,
     nên `_rate_limit_check` trả về "cho phép" trước cả khi chạm Redis. Với
     `provider=nks`, `/auth/login` là một máy dò mật khẩu KHÔNG cần đăng nhập, nhắm
     vào hệ thống xác thực của người khác.

  2. Không có đường thu hồi nào. `bump_token_version` chỉ được gọi ở luồng đổi mật
     khẩu NKS; đăng xuất không đụng tới nó, và `/auth/refresh` cấp token mới vô hạn từ
     một token còn hạn. Token rò rỉ của người dùng local là token VĨNH VIỄN.

Không chạm database: `users_store` được thay bằng đồ giả, còn `tokens` là mã thật —
chính chữ ký và phép đối chiếu `tv` mới là thứ đang được kiểm.
"""

from __future__ import annotations

import pytest

from app.domains.auth import gioi_han, grants, tokens

UID = "user-A"
EMAIL = "nguoi-dung@example.com"
MAT_KHAU = "mat-khau-chi-co-trong-test-4f21"


class UsersGia:
    """Đủ cho `current_user_from_request`: tra theo id + `token_version` đổi được."""

    def __init__(self):
        self.row = {"user_id": UID, "email": EMAIL, "display_name": "A",
                    "role": "learner", "avatar_url": None, "token_version": 1}
        self.bumps: list[str] = []

    def get_by_id(self, user_id):
        return dict(self.row) if str(user_id) == UID else None

    def bump_token_version(self, user_id):
        self.bumps.append(str(user_id))
        self.row["token_version"] = int(self.row["token_version"]) + 1


@pytest.fixture(autouse=True)
def _sach():
    gioi_han.reset_for_tests()
    grants.reset_for_tests()
    yield
    gioi_han.reset_for_tests()
    grants.reset_for_tests()


@pytest.fixture
def users(monkeypatch):
    """Thay `users_store` ở CẢ HAI chỗ nó được nạp: service (đọc) và main (ghi).

    `identities_store.find_by_user` cũng phải thay: từ khi `/auth/me` và
    `/auth/refresh` trả thêm `provider`, chúng tra bảng `identities` — không thay thì
    bộ test không-database này đâm thẳng vào Postgres và nhận 500.
    """
    from app.domains.auth import identities_store, service, users_store
    gia = UsersGia()
    monkeypatch.setattr(service, "users_store", gia)
    monkeypatch.setattr(users_store, "get_by_id", gia.get_by_id)
    monkeypatch.setattr(users_store, "bump_token_version", gia.bump_token_version)
    monkeypatch.setattr(identities_store, "find_by_user", lambda p, uid: None)
    return gia


def _token(users):
    """Token thật cho phiên hiện tại — ký bằng `tokens.make_token` thật."""
    return tokens.make_token(users.row)


def _bearer(tok):
    return {"Authorization": f"Bearer {tok}"}


def _dang_nhap_hong(monkeypatch, exc_name="InvalidCredentials"):
    """Ép `/auth/login` thất bại theo một lớp lỗi cụ thể, không chạm mạng."""
    from app.application import auth as app_auth
    lop = getattr(app_auth, exc_name)

    def hong(*a, **k):
        raise lop("sai")
    monkeypatch.setattr(app_auth, "dang_nhap", hong)


def _dang_nhap_thanh_cong(monkeypatch, users):
    from app.application import auth as app_auth
    monkeypatch.setattr(app_auth, "dang_nhap", lambda *a, **k: dict(users.row))


# ── 1. Trần cho /auth/login ─────────────────────────────────────────────────
def test_login_bi_chan_sau_nhieu_lan_sai(client, monkeypatch):
    _dang_nhap_hong(monkeypatch)
    than = {"email": EMAIL, "password": "sai"}

    for _ in range(gioi_han.SO_LAN_TOI_DA):
        assert client.post("/auth/login", json=than).status_code == 401

    r = client.post("/auth/login", json=than)
    assert r.status_code == 429
    assert r.get_json()["error"] == "rate_limited"
    assert int(r.headers["Retry-After"]) > 0


def test_login_khoa_theo_DINH_DANH_chan_botnet_chia_deu_theo_IP(client, monkeypatch):
    """Chỉ khoá theo IP thì nhiều nguồn cùng dò MỘT tài khoản sẽ đi qua trần."""
    _dang_nhap_hong(monkeypatch)
    than = {"email": EMAIL, "password": "sai"}

    for i in range(gioi_han.SO_LAN_TOI_DA):
        client.post("/auth/login", json=than,
                    headers={"X-Forwarded-For": f"10.0.0.{i}"})     # mỗi lần một IP

    # IP thứ N+1 hoàn toàn mới, nhưng cùng định danh ⇒ vẫn bị chặn.
    r = client.post("/auth/login", json=than, headers={"X-Forwarded-For": "10.0.0.200"})
    assert r.status_code == 429


def test_login_khoa_dinh_danh_khong_phan_biet_hoa_thuong(client, monkeypatch):
    """Đổi kiểu chữ mà lách được trần thì trần đó vô nghĩa."""
    _dang_nhap_hong(monkeypatch)
    for _ in range(gioi_han.SO_LAN_TOI_DA):
        client.post("/auth/login", json={"email": EMAIL, "password": "sai"})

    r = client.post("/auth/login", json={"email": EMAIL.upper(), "password": "sai"})
    assert r.status_code == 429


def test_login_dinh_danh_khac_khong_bi_va_lay_theo_IP_thi_co(client, monkeypatch):
    """Khoá định danh phải ĐỘC LẬP; khoá IP thì cố ý dùng chung."""
    _dang_nhap_hong(monkeypatch)
    for _ in range(gioi_han.SO_LAN_TOI_DA):
        client.post("/auth/login", json={"email": "nguoi-khac@example.com", "password": "x"},
                    headers={"X-Forwarded-For": "10.1.1.1"})

    # Cùng IP ⇒ trần IP đã đầy ⇒ chặn. Đó là chủ đích: một IP quét nhiều tài khoản
    # chính là ca cần chặn.
    r = client.post("/auth/login", json={"email": EMAIL, "password": "x"},
                    headers={"X-Forwarded-For": "10.1.1.1"})
    assert r.status_code == 429
    # IP khác + định danh khác ⇒ chưa chạm trần nào.
    r2 = client.post("/auth/login", json={"email": EMAIL, "password": "x"},
                     headers={"X-Forwarded-For": "10.9.9.9"})
    assert r2.status_code == 401


def test_login_su_co_ha_tang_KHONG_tinh_vao_tran(client, monkeypatch):
    """Provider sập không phải lỗi của người đang gõ."""
    _dang_nhap_hong(monkeypatch, "ProviderUnavailable")
    than = {"email": EMAIL, "password": MAT_KHAU, "provider": "nks"}

    for _ in range(gioi_han.SO_LAN_TOI_DA + 3):
        assert client.post("/auth/login", json=than).status_code == 503

    # Hạn mức còn nguyên cho lần gõ đúng.
    assert gioi_han.cho_phep(f"login:ip:{'127.0.0.1'}")[0] is True


def test_login_thanh_cong_xoa_ca_hai_bo_dem(client, monkeypatch, users):
    _dang_nhap_hong(monkeypatch)
    for _ in range(gioi_han.SO_LAN_TOI_DA - 1):
        client.post("/auth/login", json={"email": EMAIL, "password": "sai"})

    _dang_nhap_thanh_cong(monkeypatch, users)
    assert client.post("/auth/login", json={"email": EMAIL, "password": MAT_KHAU}).status_code == 200

    # Bộ đếm đã về 0 — lần sai kế tiếp không được rơi thẳng vào 429.
    _dang_nhap_hong(monkeypatch)
    assert client.post("/auth/login", json={"email": EMAIL, "password": "sai"}).status_code == 401


# ── 2. Trần cho /auth/register ──────────────────────────────────────────────
def test_register_bi_chan_sau_nhieu_lan_hong(client, monkeypatch):
    from app.domains.auth import users_store

    def trung(*a, **k):
        raise users_store.EmailExistsError("trung")
    monkeypatch.setattr(users_store, "create_user", trung)

    than = {"email": "a@example.com", "password": "mat-khau-du-dai"}
    for _ in range(gioi_han.SO_LAN_TOI_DA):
        assert client.post("/auth/register", json=than).status_code == 409

    r = client.post("/auth/register", json=than)
    assert r.status_code == 429
    assert int(r.headers["Retry-After"]) > 0


def test_register_email_trung_duoc_TINH_la_that_bai(client, monkeypatch):
    """Lặp lại "email đã tồn tại" chính là phép dò xem địa chỉ nào đã đăng ký."""
    from app.domains.auth import users_store
    monkeypatch.setattr(users_store, "create_user",
                        lambda *a, **k: (_ for _ in ()).throw(users_store.EmailExistsError("x")))
    client.post("/auth/register", json={"email": "a@example.com", "password": "mat-khau-du-dai"})
    assert gioi_han.so_khoa() == 1


def test_register_thanh_cong_xoa_bo_dem(client, monkeypatch, users):
    from app.domains.auth import users_store
    monkeypatch.setattr(users_store, "create_user",
                        lambda *a, **k: (_ for _ in ()).throw(users_store.EmailExistsError("x")))
    for _ in range(gioi_han.SO_LAN_TOI_DA - 1):
        client.post("/auth/register", json={"email": "a@example.com", "password": "mat-khau-du-dai"})

    monkeypatch.setattr(users_store, "create_user", lambda *a, **k: dict(users.row))
    assert client.post("/auth/register",
                       json={"email": "b@example.com", "password": "mat-khau-du-dai"}).status_code == 201
    assert gioi_han.so_khoa() == 0


# ── 3. /auth/logout giữ nguyên nghĩa: chỉ trình duyệt NÀY ───────────────────
def test_logout_khong_dung_den_phien_khac(client, users):
    phien_a, phien_b = _token(users), _token(users)

    assert client.post("/auth/logout", headers=_bearer(phien_a)).status_code == 200

    # Phiên B — điện thoại của chính người đó — vẫn sống.
    assert client.get("/auth/me", headers=_bearer(phien_b)).status_code == 200
    assert users.bumps == []                       # KHÔNG tăng token_version
    # Và ngay cả token A vẫn hợp lệ về mặt chữ ký: đăng xuất là việc của client.
    assert client.get("/auth/me", headers=_bearer(phien_a)).status_code == 200


# ── 4. /auth/logout-all thu hồi tất cả ──────────────────────────────────────
def test_logout_all_vo_hieu_moi_phien(client, users):
    phien_a, phien_b = _token(users), _token(users)

    r = client.post("/auth/logout-all", headers=_bearer(phien_a))
    assert r.status_code == 200
    assert r.get_json() == {"ok": True, "revoked_all": True}
    assert users.bumps == [UID]

    # CẢ HAI token chết — kể cả token vừa dùng để gọi chính endpoint này.
    assert client.get("/auth/me", headers=_bearer(phien_a)).status_code == 401
    assert client.get("/auth/me", headers=_bearer(phien_b)).status_code == 401


def test_logout_all_can_dang_nhap(client, users):
    assert client.post("/auth/logout-all").status_code == 401
    assert client.post("/auth/logout-all", headers=_bearer("khong-phai-token")).status_code == 401
    assert users.bumps == []


def test_logout_all_cung_huy_chung_tu_ghi(client, users):
    """Thu hồi mọi phiên mà để lại một access token của provider ngoài trong RAM thì
    chưa thu hồi được gì cả."""
    gid, _ = grants.tao(UID, "nks", "token-nks-trong-ram")
    assert grants.lay(gid, UID) == "token-nks-trong-ram"

    client.post("/auth/logout-all", headers=_bearer(_token(users)))

    assert grants.lay(gid, UID) is None


# ── 5. Refresh sau logout-all phải hỏng ─────────────────────────────────────
def test_refresh_hong_sau_logout_all(client, users):
    phien = _token(users)
    # Trước khi thu hồi: refresh chạy bình thường (ngữ nghĩa cũ giữ nguyên).
    r_truoc = client.post("/auth/refresh", headers=_bearer(phien))
    assert r_truoc.status_code == 200
    token_moi = r_truoc.get_json()["token"]

    client.post("/auth/logout-all", headers=_bearer(phien))

    # Cả token gốc lẫn token vừa refresh ra đều chết — nếu không thì chuỗi refresh là
    # một đường vòng qua chính phép thu hồi.
    assert client.post("/auth/refresh", headers=_bearer(phien)).status_code == 401
    assert client.post("/auth/refresh", headers=_bearer(token_moi)).status_code == 401


def test_token_cap_lai_SAU_logout_all_van_dung_duoc(client, users):
    """Thu hồi không được làm hỏng tài khoản: đăng nhập lại phải ra token dùng được."""
    client.post("/auth/logout-all", headers=_bearer(_token(users)))
    moi = _token(users)                            # ~ đăng nhập lại, tv đã tăng
    assert client.get("/auth/me", headers=_bearer(moi)).status_code == 200
    assert client.post("/auth/refresh", headers=_bearer(moi)).status_code == 200


# ── 6. Idempotent ───────────────────────────────────────────────────────────
def test_logout_all_goi_nhieu_lan_van_200(client, users):
    for _ in range(3):
        phien = _token(users)                      # mỗi vòng lấy token hiện hành
        assert client.post("/auth/logout-all", headers=_bearer(phien)).status_code == 200
    assert users.bumps == [UID, UID, UID]
    assert users.row["token_version"] == 4


def test_logout_all_bang_token_da_thu_hoi_thi_401_chu_khong_no(client, users):
    phien = _token(users)
    assert client.post("/auth/logout-all", headers=_bearer(phien)).status_code == 200
    # Gọi lại bằng ĐÚNG token đã chết: từ chối sạch, không tăng thêm lần nào.
    assert client.post("/auth/logout-all", headers=_bearer(phien)).status_code == 401
    assert users.bumps == [UID]
