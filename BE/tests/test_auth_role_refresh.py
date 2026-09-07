"""Vai trò của người dùng NKS QUAY LẠI phải được tính lại theo NKS ở mỗi lần đăng nhập.

Bối cảnh: `77ba7fa` sửa chỗ TÍNH vai trò (`role.name` là object, không phải chuỗi).
Nhưng `_gan_danh_tinh_ngoai` chỉ đọc `identity.role` ở nhánh TẠO MỚI; người quay lại
nhận nguyên hàng `users` cũ. Nghĩa là mọi tài khoản NKS đã tồn tại trước bản sửa vẫn
mang `learner` vĩnh viễn — kể cả Manager — vì `users.role` chưa từng có đường GHI nào
sau lúc INSERT.

Chính sách B: làm mới ở mỗi lần đăng nhập NKS, nhưng chỉ UPDATE khi khác.

Bộ test này KHÔNG chạm database: `giai_quyet_user` nhận `deps`, nên store thật được
thay bằng hai object giả và mọi khẳng định đều đo được ở env không có Postgres. Ca đi
qua HTTP + Postgres thật nằm ở `test_auth_nks_e2e_flow.py`.
"""

from __future__ import annotations

import pytest

from app.application import auth as app_auth
from app.domains.auth import users_store
from shared.interfaces.auth import InternalIdentity

PID = "128"          # `sub`/`id` thật của tài khoản test NKS
IDENTITY_ID = "ident-1"
USER_ID = "user-1"


class UsersGia:
    """Thay `domains.auth.users_store`. Ghi lại mọi lệnh ghi để đo "có UPDATE không"."""

    VAI_TRO_HOP_LE = users_store.VAI_TRO_HOP_LE

    def __init__(self, role="learner"):
        self.rows = {USER_ID: {"user_id": USER_ID, "email": "a@example.com",
                               "display_name": "Người NKS", "role": role,
                               "token_version": 1}}
        self.set_role_calls = []
        self.bump_calls = []

    def get_by_id(self, user_id):
        row = self.rows.get(str(user_id))
        return dict(row) if row else None

    def set_role(self, user_id, role):
        self.set_role_calls.append((str(user_id), role))
        self.rows[str(user_id)]["role"] = role

    def bump_token_version(self, user_id):
        self.bump_calls.append(str(user_id))


class IdentitiesGia:
    """Thay `domains.auth.identities_store`. Tra CHỈ theo (provider, provider_user_id)."""

    EmailRequiredForProvisioning = type("EmailRequiredForProvisioning", (Exception,), {})
    EmailBelongsToAnotherAccount = type("EmailBelongsToAnotherAccount", (Exception,), {})

    def __init__(self, co_lien_ket=True):
        self.co_lien_ket = co_lien_ket
        self.find_calls = []
        self.touched = []
        self.link_calls = []

    def find(self, provider, provider_user_id):
        self.find_calls.append((provider, provider_user_id))
        if not self.co_lien_ket:
            return None
        return {"identity_id": IDENTITY_ID, "user_id": USER_ID,
                "provider": provider, "provider_user_id": provider_user_id}

    def touch_last_login(self, identity_id):
        self.touched.append(identity_id)

    def link_new_user(self, **kw):
        self.link_calls.append(kw)
        return {"user_id": "user-moi", "email": kw.get("email"),
                "display_name": kw.get("display_name"), "role": kw.get("role"),
                "token_version": 1}


def _danh_tinh(role="learner", provider="nks", pid=PID, email="a@example.com"):
    return InternalIdentity(provider=provider, provider_user_id=pid,
                            email=email, display_name="Người NKS", role=role)


def _chay(identity, users, idents):
    return app_auth.giai_quyet_user(
        identity, deps={"users_store": users, "identities_store": idents})


# ── 1. Thăng quyền ───────────────────────────────────────────────────────────
def test_manager_quay_lai_dang_luu_learner_thanh_admin():
    """Ca chính. Trước bản sửa: vẫn `learner` mãi mãi."""
    users, idents = UsersGia(role="learner"), IdentitiesGia()
    user = _chay(_danh_tinh(role="admin"), users, idents)

    assert user["role"] == "admin"                       # dict trả về đã đổi
    assert users.rows[USER_ID]["role"] == "admin"        # hàng users đã đổi
    assert users.set_role_calls == [(USER_ID, "admin")]  # đúng MỘT lệnh ghi
    assert idents.touched == [IDENTITY_ID]               # vẫn chạm last_login như cũ


# ── 2. Hạ quyền ──────────────────────────────────────────────────────────────
def test_ha_quyen_khong_de_lai_admin():
    """NKS hạ Manager xuống `user` ⇒ StudyMap phải bỏ `admin`, không giữ lại."""
    users, idents = UsersGia(role="admin"), IdentitiesGia()
    user = _chay(_danh_tinh(role="learner"), users, idents)

    assert user["role"] == "learner"
    assert users.rows[USER_ID]["role"] == "learner"
    assert users.set_role_calls == [(USER_ID, "learner")]


# ── 3. Không đổi ⇒ không ghi ─────────────────────────────────────────────────
@pytest.mark.parametrize("role", ["learner", "teacher", "admin"])
def test_vai_tro_khong_doi_thi_khong_co_update(role):
    """Đăng nhập thường ngày không được sinh một lệnh ghi vô ích cho mỗi lần."""
    users, idents = UsersGia(role=role), IdentitiesGia()
    user = _chay(_danh_tinh(role=role), users, idents)

    assert user["role"] == role
    assert users.set_role_calls == []
    assert idents.touched == [IDENTITY_ID]


# ── 4. NKS không trả vai trò ─────────────────────────────────────────────────
def test_nks_khong_co_role_thi_khong_bao_gio_nang_quyen():
    """`role: null` (tài khoản Member thật) ⇒ mapper cho `learner`, KHÔNG được nâng."""
    from app.clients.auth_nks.mapper import to_identity

    ident = to_identity({"success": True, "data": {"id": PID, "email": "a@example.com",
                                                   "name": "X", "role": None}})
    assert ident.role == "learner"

    users, idents = UsersGia(role="learner"), IdentitiesGia()
    assert _chay(ident, users, idents)["role"] == "learner"
    assert users.set_role_calls == []

    # Và nếu hàng đang là admin thì `null` KÉO XUỐNG, không giữ nguyên đặc quyền.
    users2 = UsersGia(role="admin")
    assert _chay(ident, users2, IdentitiesGia())["role"] == "learner"


# ── 5. Mapper hỏng ⇒ không đụng vào hàng đang lưu ────────────────────────────
@pytest.mark.parametrize("role_hong", ["", None, "root", "ADMIN", "Manager", "superuser"])
def test_role_falsy_hoac_ngoai_tap_hop_thi_khong_ghi_de(role_hong):
    """Giá trị lạ = mapper hỏng. Ghi đè lúc đó là biến một lỗi đọc thành một lần đổi quyền.

    "ADMIN"/"Manager" nằm trong danh sách này có chủ đích: chúng KHÔNG phải vai trò
    StudyMap hợp lệ (`ck_users_role` chỉ nhận chữ thường), nên phải bị từ chối chứ
    không được "hiểu ý" mà chuẩn hoá giúp.
    """
    users, idents = UsersGia(role="teacher"), IdentitiesGia()
    user = _chay(_danh_tinh(role=role_hong), users, idents)

    assert users.set_role_calls == []
    assert users.rows[USER_ID]["role"] == "teacher"      # nguyên vẹn
    assert user["role"] == "teacher"
    assert idents.touched == [IDENTITY_ID]               # vẫn đăng nhập được


# ── 6. LocalAuth không dính ──────────────────────────────────────────────────
def test_local_khong_bao_gio_goi_set_role():
    """Nhánh local trả thẳng hàng users; không có provider ngoài nào nói gì về vai trò."""
    users, idents = UsersGia(role="learner"), IdentitiesGia()
    user = app_auth.giai_quyet_user(
        InternalIdentity(provider=app_auth.LOCAL, provider_user_id=USER_ID,
                         email="a@example.com", display_name="A", role="admin"),
        deps={"users_store": users, "identities_store": idents})

    assert user["role"] == "learner"        # vai trò local KHÔNG bị identity ghi đè
    assert users.set_role_calls == []
    assert idents.find_calls == []


# ── 7. Nhận diện vẫn theo (provider, provider_user_id) ───────────────────────
def test_van_tra_theo_provider_va_provider_user_id_khong_theo_email():
    users, idents = UsersGia(role="learner"), IdentitiesGia()
    _chay(_danh_tinh(role="admin", email="email-hoan-toan-khac@example.com"), users, idents)

    assert idents.find_calls == [("nks", PID)]
    assert all("email" not in str(c[0]).lower() for c in idents.find_calls)


def test_danh_tinh_moi_van_di_duong_tao_moi():
    """Không có liên kết ⇒ vẫn `link_new_user`, và vai trò vào thẳng lúc INSERT."""
    users, idents = UsersGia(), IdentitiesGia(co_lien_ket=False)
    user = _chay(_danh_tinh(role="admin"), users, idents)

    assert user["role"] == "admin"
    assert idents.link_calls and idents.link_calls[0]["role"] == "admin"
    assert users.set_role_calls == []       # INSERT đã mang vai trò, không cần UPDATE


# ── 8. Lần gọi SAU thấy vai trò mới mà không cần đăng nhập lại ───────────────
def test_request_ke_tiep_thay_vai_tro_moi_khong_can_token_moi():
    """Token chỉ mang `{uid, tv}`; `current_user_from_request` đọc lại hàng users mỗi
    request. Nên sửa hàng là request kế tiếp thấy ngay — không đổi định dạng token,
    không bump `token_version`, không đá người dùng ra ngoài."""
    from app.domains.auth.service import public_user

    users, idents = UsersGia(role="learner"), IdentitiesGia()
    _chay(_danh_tinh(role="admin"), users, idents)

    lan_sau = users.get_by_id(USER_ID)          # đúng thứ /auth/me sẽ đọc
    assert lan_sau["role"] == "admin"
    assert public_user(lan_sau)["role"] == "admin"
    assert users.bump_calls == []               # KHÔNG vô hiệu token đang dùng
    assert lan_sau["token_version"] == 1


# ── set_role: hàng rào của chính nó ──────────────────────────────────────────
def test_set_role_tu_choi_gia_tri_ngoai_rang_buoc_db():
    """`ck_users_role` chỉ nhận learner/teacher/admin. Chặn ở Python để lỗi hiện ra
    ngay chỗ gọi, thay vì thành `IntegrityError` giữa một transaction."""
    for xau in ["", None, "root", "ADMIN", "Manager", "admin ", 1]:
        with pytest.raises(ValueError):
            users_store.set_role(USER_ID, xau)


def test_set_role_co_mat_va_khai_bao_dung_tap_hop():
    assert callable(users_store.set_role)
    assert users_store.VAI_TRO_HOP_LE == ("learner", "teacher", "admin")
