"""E2E NKS THẬT — chạy tay, có chủ ý, chỉ khi người dùng cấp credential.

Chạy TOÀN BỘ chuỗi qua route thật `POST /auth/login`, không mock tầng nào:

    tài khoản NKS thật → NKS login API → NKS user info → InternalIdentity
    → identities (DB TEST) → users (DB TEST) → token itsdangerous → HTTP 200

Khác `test_auth_nks.py::test_e2e_that` (chỉ gọi adapter một lần): ở đây đo cả định
tuyến HTTP, ghi danh tính, đăng nhập lại, và một lần sai mật khẩu.

**Không in credential.** Username, password, access_token không bao giờ vào stdout,
log hay khẳng định. Bản tóm tắt cuối chỉ có dữ liệu an toàn; `provider_user_id` là
định danh public của NKS nên được phép hiện.

Chạy đúng MỘT lượt cho mỗi bước — không thử nhiều endpoint, không dò mật khẩu.
"""

from __future__ import annotations

import logging
import os

import pytest

_THIEU = [t for t in ("AUTH_NKS_E2E", "NKS_TEST_USERNAME", "NKS_TEST_PASSWORD")
          if not (os.getenv(t) or "").strip()]

pytestmark = pytest.mark.skipif(
    bool(_THIEU) or os.getenv("AUTH_NKS_E2E") != "1",
    reason=f"E2E thật cần AUTH_NKS_E2E=1 + credential (thiếu: {_THIEU or 'AUTH_NKS_E2E=1'})",
)


def _bao_cao(dong: dict) -> None:
    """In bản tóm tắt AN TOÀN. Chỉ những khoá được liệt kê mới ra ngoài."""
    print("\n" + "=" * 62)
    print("  NKS LIVE E2E — SANITIZED SUMMARY")
    print("=" * 62)
    for k, v in dong.items():
        print(f"  {k:<28}{v}")
    print("=" * 62)


@pytest.fixture()
def bat_nks(monkeypatch):
    """Bật provider trong tiến trình để người chạy chỉ phải cấp 3 biến credential."""
    monkeypatch.setenv("AUTH_NKS_ENABLED", "1")
    monkeypatch.setenv("AUTH_PROVIDERS", "local,nks")


def test_nks_live_e2e(client, monkeypatch, caplog, bat_nks):
    from sqlalchemy import text

    from app.clients.auth_nks import client as nks_client
    from app.clients.auth_nks import config as nks_config
    from app.db import get_engine

    caplog.set_level(logging.DEBUG)
    kq: dict = {"LEVEL": "LEVEL 4 FAIL", "stage": "khởi tạo"}

    # ── 0. Chặn trước: danh tính sinh ra ở đây PHẢI nằm trong DB test ────────
    # NKS là API THẬT, nhưng phía StudyMap thì tuyệt đối không được là production.
    # Hỏi chính kết nối đang dùng, không tin biến môi trường: `TEST_DATABASE_URL`
    # có thể trỏ đi đâu đó khác với những gì người chạy tưởng.
    with get_engine().begin() as c:
        db_song = c.execute(text("SELECT current_database()")).scalar_one()
    kq["test_db_verified"] = db_song
    if db_song != "studymap_test":
        _bao_cao(kq)
        pytest.fail(f"DỪNG: current_database() = {db_song!r}, không phải 'studymap_test'. "
                    "Test này ghi danh tính thật — chỉ chạy trên DB test.")
    ket_qua_endpoint = nks_config.login_url()
    kq["endpoint"] = ket_qua_endpoint
    kq["user_info_endpoint"] = nks_config.user_url()

    # Ghi lại access_token để KIỂM rò rỉ — giữ trong biến cục bộ, không bao giờ in.
    giu = {"token": None}
    that_su_login = nks_client.login

    def login_co_ghi(username, password, extra=None):
        body = that_su_login(username, password, extra=extra)   # HTTP THẬT
        try:
            from app.clients.auth_nks.mapper import doc_access_token
            giu["token"] = doc_access_token(body)
        except Exception:
            pass
        return body

    monkeypatch.setattr(nks_client, "login", login_co_ghi)

    ten = os.environ["NKS_TEST_USERNAME"]
    mk = os.environ["NKS_TEST_PASSWORD"]

    try:
        # ── 1. Một lần đăng nhập thật ────────────────────────────────────────
        kq["stage"] = "1. login qua POST /auth/login"
        r1 = client.post("/auth/login",
                         json={"provider": "nks", "username": ten, "password": mk})
        kq["http_status_lan_1"] = r1.status_code
        if r1.status_code != 200:
            kq["ly_do_that_bai"] = (r1.get_json() or {}).get("error", "?")
            _bao_cao(kq)
            pytest.fail(f"NKS login thất bại ở {kq['stage']}: HTTP {r1.status_code} "
                        f"({kq['ly_do_that_bai']})")

        b1 = r1.get_json()
        kq["studymap_token_tra_ve"] = "yes" if b1.get("token") else "no"
        kq["role_da_map"] = b1["user"]["role"]
        uid = b1["user"]["id"]

        # ── 2. Danh tính đã ghi ──────────────────────────────────────────────
        kq["stage"] = "2. kiểm identities trong DB TEST"
        with get_engine().begin() as c:
            hang = c.execute(text(
                "SELECT provider_user_id, user_id, last_login_at FROM identities "
                "WHERE provider='nks' AND user_id=:u"), {"u": uid}).all()
        assert len(hang) == 1, f"mong đúng 1 identity, thấy {len(hang)}"
        pid = hang[0][0]
        kq["provider_user_id"] = pid
        kq["identity_lan_1"] = "created"
        lan_dau = hang[0][2]

        # ── 3. Đăng nhập lại — dùng lại, không nhân bản ──────────────────────
        kq["stage"] = "3. đăng nhập lại"
        r2 = client.post("/auth/login",
                         json={"provider": "nks", "username": ten, "password": mk})
        kq["http_status_lan_2"] = r2.status_code
        assert r2.status_code == 200
        b2 = r2.get_json()
        assert b2["user"]["id"] == uid, "lần hai ra user KHÁC — đã nhân bản tài khoản"
        with get_engine().begin() as c:
            so, lan_sau = c.execute(text(
                "SELECT count(*), max(last_login_at) FROM identities "
                "WHERE provider='nks' AND provider_user_id=:p"), {"p": pid}).one()
        assert so == 1, f"có {so} identity cho cùng một provider_user_id"
        kq["repeat_login"] = "reused same user + same identity"
        kq["last_login_at_tien"] = "yes" if (lan_sau and lan_dau and lan_sau >= lan_dau) else "no"

        # ── 4. KHÔNG thử sai mật khẩu trên tài khoản THẬT ────────────────────
        # Tài khoản này do bên ngoài cấp và là tài khoản THẬT, không phải tài khoản
        # test. Một lần đăng nhập sai có thể đẩy nó vào khoá tạm thời hoặc giới hạn
        # tần suất ở phía NKS — hỏng một thứ không thuộc về mình để xác nhận một
        # hành vi ĐÃ được chứng minh ở `test_auth_nks.py` (mock) và
        # `test_auth_nks_security.py`. Không đánh đổi như vậy.
        kq["invalid_password_live"] = "NOT_RUN"
        kq["invalid_password_ly_do"] = "tài khoản NKS thật — tránh rủi ro khoá/rate-limit"

        # ── 5. Rò rỉ ─────────────────────────────────────────────────────────
        kq["stage"] = "5. kiểm rò rỉ"
        tok = giu["token"]
        than = r1.get_data(as_text=True) + r2.get_data(as_text=True)
        ban_log = " ".join(r.getMessage() for r in caplog.records)
        ro = []
        if tok:
            if tok in than:
                ro.append("response")
            if tok in ban_log:
                ro.append("log")
            if tok == b1.get("token"):
                ro.append("studymap_token")
            with get_engine().begin() as c:
                n = c.execute(text(
                    "SELECT count(*) FROM identities WHERE provider_user_id=:t"),
                    {"t": tok}).scalar_one()
                n += c.execute(text(
                    "SELECT count(*) FROM users WHERE email=:t OR full_name=:t"),
                    {"t": tok}).scalar_one()
            if n:
                ro.append("database")
        if mk in than or mk in ban_log:
            ro.append("password")
        kq["nks_token_bat_duoc"] = "yes" if tok else "no (không rút được từ phản hồi)"
        kq["nks_token_leaked"] = ",".join(ro) if ro else "no"
        assert not ro, f"RÒ RỈ BÍ MẬT: {ro}"

        kq["stage"] = "hoàn tất"
        kq["LEVEL"] = "LEVEL 4 PASS"
        _bao_cao(kq)
    except Exception:
        if kq.get("LEVEL") != "LEVEL 4 PASS":
            _bao_cao(kq)
        raise
