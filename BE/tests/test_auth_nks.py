"""NKS auth adapter — không chạm mạng (trừ test E2E tự bỏ qua khi thiếu credential).

Ba nhóm khẳng định:
  1. Hợp đồng: login → access_token → /nks/user → InternalIdentity.
  2. Phân loại lỗi. Điểm nặng nhất: **NKS trả HTTP 500 cho sai tài khoản.** Đo thật
     (không gửi credential thật) ngày 2026-09-05:
        POST /api/nks/user/login  → 500 {"success":false,"code":500,
                                         "error":"Tài khoản không tồn tại",
                                         "message":"Unauthorized"}
     Đọc mã HTTP mà kết luận "provider chết" là biến mọi lần gõ sai mật khẩu thành
     "NKS đang bảo trì".
  3. Bí mật không rò: mật khẩu và access_token không vào log/exception/response.
"""

from __future__ import annotations

import logging
import os

import pytest

from app.clients.auth_nks import NKSAuthProvider
from app.clients.auth_nks.errors import (
    NksInvalidCredentials,
    NksNotEnabled,
    NksProtocolError,
    NksUnavailable,
)
from app.clients.auth_nks.mapper import doc_access_token, to_identity
from app.clients.auth_nks.roles import map_role

MAT_KHAU = "mat-khau-chi-co-trong-test-9f3a"
TOKEN_GIA = "nks-access-token-gia-4b7c"


class ClientGia:
    """Thay `client.py`. Ghi lại lời gọi để khẳng định luồng, không chạm mạng."""

    def __init__(self, login_body=None, user_body=None, login_exc=None, user_exc=None):
        self._login_body = login_body or {"success": True, "access_token": TOKEN_GIA}
        self._user_body = user_body or {"success": True, "data": {"id": "nks-1", "email": "a@b.c"}}
        self._login_exc = login_exc
        self._user_exc = user_exc
        self.calls = []

    def login(self, username, password, extra=None):
        self.calls.append(("login", username, extra))
        if self._login_exc:
            raise self._login_exc
        return self._login_body

    def get_user(self, access_token):
        self.calls.append(("get_user", access_token))
        if self._user_exc:
            raise self._user_exc
        return self._user_body


def _provider(**kw):
    return NKSAuthProvider(client=ClientGia(**kw), enabled=lambda: True)


# ── 1. Đường thành công ──────────────────────────────────────────────────────
def test_login_thanh_cong_ra_internal_identity():
    p = _provider()
    ident = p.authenticate({"identifier": "nguoi-dung", "password": MAT_KHAU})
    assert ident.provider == "nks"
    assert ident.provider_user_id == "nks-1"
    assert ident.email == "a@b.c"
    assert ident.role in ("learner", "teacher", "admin")


def test_luon_hoi_lai_user_info_bang_access_token():
    """Login rồi PHẢI gọi /nks/user — nguồn thẩm quyền của User Info."""
    c = ClientGia()
    p = NKSAuthProvider(client=c, enabled=lambda: True)
    p.authenticate({"identifier": "u", "password": MAT_KHAU})
    assert [x[0] for x in c.calls] == ["login", "get_user"]
    assert c.calls[1][1] == TOKEN_GIA


# ── 2. Phân loại lỗi ─────────────────────────────────────────────────────────
def test_sai_tai_khoan_la_invalid_credentials_du_http_500():
    p = _provider(login_exc=NksInvalidCredentials("Tài khoản không tồn tại"))
    with pytest.raises(NksInvalidCredentials):
        p.authenticate({"identifier": "u", "password": MAT_KHAU})


def test_ha_tang_hong_la_unavailable():
    p = _provider(login_exc=NksUnavailable("NKS trả 503"))
    with pytest.raises(NksUnavailable):
        p.authenticate({"identifier": "u", "password": MAT_KHAU})


def test_timeout_la_unavailable():
    p = _provider(login_exc=NksUnavailable("NKS không phản hồi (ReadTimeout)"))
    with pytest.raises(NksUnavailable):
        p.authenticate({"identifier": "u", "password": MAT_KHAU})


def test_json_hong_la_protocol_error():
    p = _provider(login_exc=NksProtocolError("không phải JSON"))
    with pytest.raises(NksProtocolError):
        p.authenticate({"identifier": "u", "password": MAT_KHAU})


def test_thieu_access_token_la_protocol_error():
    p = _provider(login_body={"success": True})
    with pytest.raises(NksProtocolError):
        p.authenticate({"identifier": "u", "password": MAT_KHAU})


def test_thieu_user_info_la_protocol_error_chu_khong_bia_id():
    """Không có trường định danh ⇒ NÉM. Bịa id là âm thầm gộp hai người vào một tài khoản."""
    p = _provider(user_body={"success": True, "data": {"email": "a@b.c"}})
    with pytest.raises(NksProtocolError):
        p.authenticate({"identifier": "u", "password": MAT_KHAU})


def test_provider_tat_thi_khong_goi_mang():
    c = ClientGia()
    p = NKSAuthProvider(client=c, enabled=lambda: False)
    with pytest.raises(NksNotEnabled):
        p.authenticate({"identifier": "u", "password": MAT_KHAU})
    assert c.calls == []          # tắt = KHÔNG một request nào rời máy


def test_thieu_mat_khau_bi_chan_truoc_khi_goi_mang():
    c = ClientGia()
    p = NKSAuthProvider(client=c, enabled=lambda: True)
    with pytest.raises(NksInvalidCredentials):
        p.authenticate({"identifier": "u", "password": ""})
    assert c.calls == []


# ── 3. Ánh xạ ────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("nhom,mong_doi", [
    ("Manager", "admin"),
    ("Faculty", "teacher"),
    ("Student", "learner"),
    ("Member", "learner"),
    ("Citizen", "learner"),
    ("Customer", "learner"),
    ("Driver", "learner"),
])
def test_map_role_bay_nhom_tai_lieu(nhom, mong_doi):
    assert map_role(nhom) == mong_doi


def test_nhom_la_va_thieu_nhom_deu_ve_quyen_thap_nhat():
    """Nhóm NKS mới thêm không được rơi vào admin — đó là leo thang đặc quyền im lặng."""
    assert map_role("MotNhomHoanToanMoi") == "learner"
    assert map_role(None) == "learner"
    assert map_role("") == "learner"


def test_map_role_khong_bao_gio_tra_gia_tri_ngoai_rang_buoc_db():
    """`ck_users_role` chỉ nhận learner/teacher/admin — trả khác là INSERT chết."""
    for nhom in ["Manager", "Faculty", "Student", "la", None, "", "ADMIN", "root"]:
        assert map_role(nhom) in ("learner", "teacher", "admin")


def test_mapper_doc_duoc_ca_dang_phang_va_dang_boc():
    """Lược đồ CHƯA XÁC MINH nên mapper dò nhiều tên; khoá cả hai hình dạng đã dự phòng."""
    phang = to_identity({"id": "x1", "email": "E@B.C", "full_name": "Tên"})
    assert phang.provider_user_id == "x1"
    assert phang.email == "e@b.c"          # chuẩn hoá thường
    boc = to_identity({"data": {"user_id": "x2", "name": "Tên 2"}})
    assert boc.provider_user_id == "x2"


def test_doc_access_token_chap_nhan_ca_hai_vi_tri():
    assert doc_access_token({"access_token": "t1"}) == "t1"
    assert doc_access_token({"data": {"token": "t2"}}) == "t2"


# ── 4. Bí mật không rò ───────────────────────────────────────────────────────
def test_mat_khau_va_token_khong_vao_log(caplog):
    caplog.set_level(logging.DEBUG)
    p = _provider()
    p.authenticate({"identifier": "u", "password": MAT_KHAU})
    ban_ghi = " ".join(r.getMessage() for r in caplog.records)
    assert MAT_KHAU not in ban_ghi
    assert TOKEN_GIA not in ban_ghi


def test_mat_khau_va_token_khong_nam_trong_thong_diep_loi():
    p = _provider(user_body={"success": True, "data": {}})
    with pytest.raises(NksProtocolError) as ei:
        p.authenticate({"identifier": "u", "password": MAT_KHAU})
    assert MAT_KHAU not in str(ei.value)
    assert TOKEN_GIA not in str(ei.value)


def test_access_token_khong_lot_vao_internal_identity():
    """Token NKS không được đi kèm danh tính — từ đó nó sẽ chảy vào response/DB."""
    ident = _provider().authenticate({"identifier": "u", "password": MAT_KHAU})
    assert TOKEN_GIA not in repr(ident)
    assert not any(TOKEN_GIA in str(v) for v in ident.metadata.values())


# ── 5. E2E thật — bỏ qua khi không có credential ─────────────────────────────
@pytest.mark.skipif(
    os.getenv("AUTH_NKS_E2E") != "1"
    or not os.getenv("NKS_TEST_USERNAME")
    or not os.getenv("NKS_TEST_PASSWORD"),
    reason="cần AUTH_NKS_E2E=1 + NKS_TEST_USERNAME/NKS_TEST_PASSWORD",
)
def test_e2e_that():
    """Gọi NKS thật. KHÔNG in credential/token — chỉ khẳng định hình dạng."""
    from app.clients.auth_nks import client as nks_client

    body = nks_client.login(os.environ["NKS_TEST_USERNAME"], os.environ["NKS_TEST_PASSWORD"])
    tok = doc_access_token(body)
    assert isinstance(tok, str) and tok
    ident = to_identity(nks_client.get_user(tok))
    assert ident.provider_user_id
