"""Bảng `identities` trên Postgres THẬT — vòng đời liên kết danh tính ngoài.

Chạy trên DB test (`TEST_DATABASE_URL`), không phải mock: điều cần khoá ở đây là
**ràng buộc của cơ sở dữ liệu** (UNIQUE, FK CASCADE), mà mock thì không có.

Luật trung tâm: nhận ra người quay lại bằng `(provider, provider_user_id)`, KHÔNG
bằng email. Mọi test dưới đây tồn tại để cái đó không bị lặng lẽ đổi.
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
        # identities đi theo user nhờ ON DELETE CASCADE.
        c.execute(text("DELETE FROM users WHERE email LIKE :pat"),
                  {"pat": "%" + TEST_EMAIL_SUFFIX})


def _email():
    return f"i{uuid.uuid4().hex[:12]}@example.com"


def _pid():
    return f"nks-{uuid.uuid4().hex[:10]}"


# ── Vòng đời cơ bản ──────────────────────────────────────────────────────────
def test_tao_lien_ket_moi_roi_tra_lai_duoc():
    from app.domains.auth import identities_store as st

    pid, em = _pid(), _email()
    assert st.find("nks", pid) is None

    user = st.link_new_user(provider="nks", provider_user_id=pid,
                            email=em, display_name="Người NKS")
    assert user["email"] == em
    assert user["role"] == "learner"

    lien_ket = st.find("nks", pid)
    assert lien_ket is not None
    assert lien_ket["user_id"] == user["user_id"]


def test_dang_nhap_lan_hai_dung_lai_user_khong_de_them(client):
    """Ca quan trọng nhất của bảng này: KHÔNG nhân bản user."""
    from sqlalchemy import text

    from app.db import get_engine
    from app.domains.auth import identities_store as st

    pid, em = _pid(), _email()
    u1 = st.link_new_user(provider="nks", provider_user_id=pid, email=em, display_name="A")

    # Lần hai: chỉ tra, không tạo.
    lien_ket = st.find("nks", pid)
    assert lien_ket["user_id"] == u1["user_id"]

    with get_engine().begin() as c:
        so_identity = c.execute(
            text("SELECT count(*) FROM identities WHERE provider='nks' AND provider_user_id=:p"),
            {"p": pid}).scalar_one()
        so_user = c.execute(
            text("SELECT count(*) FROM users WHERE email=:e"), {"e": em}).scalar_one()
    assert so_identity == 1
    assert so_user == 1


def test_touch_last_login_ghi_duoc():
    from sqlalchemy import text

    from app.db import get_engine
    from app.domains.auth import identities_store as st

    pid = _pid()
    st.link_new_user(provider="nks", provider_user_id=pid, email=_email(), display_name="A")
    lk = st.find("nks", pid)
    st.touch_last_login(lk["identity_id"])
    with get_engine().begin() as c:
        v = c.execute(text("SELECT last_login_at FROM identities WHERE id=:i"),
                      {"i": lk["identity_id"]}).scalar_one()
    assert v is not None


# ── Ràng buộc của DB ─────────────────────────────────────────────────────────
def test_cung_provider_user_id_khac_provider_van_la_hai_danh_tinh():
    """Khoá là CẶP (provider, provider_user_id) — không phải riêng id."""
    from app.domains.auth import identities_store as st

    chung = f"trung-{uuid.uuid4().hex[:8]}"
    a = st.link_new_user(provider="nks", provider_user_id=chung, email=_email(), display_name="A")
    b = st.link_new_user(provider="khac", provider_user_id=chung, email=_email(), display_name="B")
    assert a["user_id"] != b["user_id"]
    assert st.find("nks", chung)["user_id"] == a["user_id"]
    assert st.find("khac", chung)["user_id"] == b["user_id"]


def test_trung_danh_tinh_bi_DB_chan():
    """`uq_identities_provider_user` chặn ở tầng DB, không trông vào kiểm tra ứng dụng."""
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    from app.db import get_engine
    from app.domains.auth import identities_store as st

    pid = _pid()
    u = st.link_new_user(provider="nks", provider_user_id=pid, email=_email(), display_name="A")
    with pytest.raises(IntegrityError):
        with get_engine().begin() as c:
            c.execute(text(
                "INSERT INTO identities (id, provider, provider_user_id, user_id) "
                "VALUES (:i,'nks',:p,:u)"),
                {"i": str(uuid.uuid4()), "p": pid, "u": u["user_id"]})


def test_xoa_user_thi_identity_di_theo_cascade():
    from sqlalchemy import text

    from app.db import get_engine
    from app.domains.auth import identities_store as st

    pid = _pid()
    u = st.link_new_user(provider="nks", provider_user_id=pid, email=_email(), display_name="A")
    with get_engine().begin() as c:
        c.execute(text("DELETE FROM users WHERE id=:i"), {"i": u["user_id"]})
    assert st.find("nks", pid) is None


# ── An toàn: KHÔNG auto-link theo email ──────────────────────────────────────
def test_email_da_thuoc_tai_khoan_khac_thi_TU_CHOI(client):
    """Ca chiếm tài khoản. Người dùng local có sẵn; NKS khai đúng email đó."""
    from app.domains.auth import identities_store as st

    em = _email()
    client.post("/auth/register", json={"email": em, "password": "password123",
                                        "display_name": "Chủ thật"})
    with pytest.raises(st.EmailBelongsToAnotherAccount):
        st.link_new_user(provider="nks", provider_user_id=_pid(), email=em,
                         display_name="Kẻ mạo danh")


def test_thieu_email_thi_TU_CHOI_chu_khong_bia():
    """`users.email` NOT NULL. Bịa một địa chỉ là dựng dữ liệu giả trong hồ sơ."""
    from app.domains.auth import identities_store as st

    for thieu in (None, "", "   "):
        with pytest.raises(st.EmailRequiredForProvisioning):
            st.link_new_user(provider="nks", provider_user_id=_pid(), email=thieu,
                             display_name="A")


def test_tai_khoan_sinh_cho_nks_KHONG_dang_nhap_local_duoc(client):
    """Mật khẩu là chuỗi ngẫu nhiên không ai giữ ⇒ mọi lần thử local đều 401."""
    from app.domains.auth import identities_store as st

    em = _email()
    st.link_new_user(provider="nks", provider_user_id=_pid(), email=em, display_name="A")
    for thu in ("", "password123", "123456", "admin", em):
        r = client.post("/auth/login", json={"email": em, "password": thu})
        assert r.status_code == 401, f"đăng nhập local lọt với mật khẩu {thu!r}"
        assert r.get_json()["error"] == "invalid_credentials"


def test_role_map_duoc_luu_dung_va_nam_trong_rang_buoc(client):
    from app.domains.auth import identities_store as st

    for role in ("learner", "teacher", "admin"):
        u = st.link_new_user(provider="nks", provider_user_id=_pid(), email=_email(),
                             display_name="A", role=role)
        assert u["role"] == role
