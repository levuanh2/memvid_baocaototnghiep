"""Phase 2 — backend auth MVP (Bearer token).

Uses the shared session-scoped `client` fixture (Flask test_client). Unique emails
per test avoid collisions. AUTH_SECRET is unset in tests → ephemeral per-process
secret (fine within a run).

Từ Phase 1 store chạy trên PostgreSQL (Supabase) thay vì users.sqlite → cần
DATABASE_URL. Không có thì skip cả module. Fixture `_cleanup_test_users` xoá các
tài khoản @example.com sau khi chạy để DB không phình theo mỗi lần test.
"""

from __future__ import annotations

import os
import time
import uuid

import pytest

TEST_EMAIL_SUFFIX = "@example.com"


@pytest.fixture(scope="module", autouse=True)
def _cleanup_test_users():
    # Nạp .env TRONG fixture, không ở module level: lúc pytest collect thì
    # app.main chưa import nên DATABASE_URL chưa có trong os.environ.
    from shared.env_loader import load_project_env
    load_project_env()
    if not (os.getenv("DATABASE_URL") or "").strip():
        pytest.skip("cần DATABASE_URL (PostgreSQL) — xem BE/.env")

    yield
    from sqlalchemy import text

    from app.db import get_engine
    with get_engine().begin() as c:
        c.execute(
            text("DELETE FROM users WHERE email LIKE :pat"),
            {"pat": "%" + TEST_EMAIL_SUFFIX},
        )


def _uniq():
    return f"u{uuid.uuid4().hex[:12]}@example.com"


def _register(client, email=None, password="password123", display_name="Tester"):
    email = email or _uniq()
    r = client.post("/auth/register", json={"email": email, "password": password, "display_name": display_name})
    return email, r


# 1 — register success
def test_register_success(client):
    email, r = _register(client)
    assert r.status_code == 201
    body = r.get_json()
    assert body.get("token")
    assert body["user"]["email"] == email
    assert body["user"]["display_name"] == "Tester"
    assert "id" in body["user"]
    # never leak the hash
    assert "password_hash" not in body
    assert "password_hash" not in body["user"]


# 2 — duplicate email → 409
def test_duplicate_email_rejected(client):
    email, r1 = _register(client)
    assert r1.status_code == 201
    _, r2 = _register(client, email=email)
    assert r2.status_code == 409
    assert r2.get_json()["error"] == "email_exists"


# 3 — invalid input
def test_register_invalid_email(client):
    r = client.post("/auth/register", json={"email": "not-an-email", "password": "password123"})
    assert r.status_code == 400
    assert r.get_json()["error"] == "invalid_email"


def test_register_short_password(client):
    r = client.post("/auth/register", json={"email": _uniq(), "password": "short"})
    assert r.status_code == 400
    assert r.get_json()["error"] == "weak_password"


# 4 — login success
def test_login_success(client):
    email, _ = _register(client, password="correcthorse")
    r = client.post("/auth/login", json={"email": email, "password": "correcthorse"})
    assert r.status_code == 200
    assert r.get_json().get("token")
    assert r.get_json()["user"]["email"] == email


# 5 — login wrong password → generic 401
def test_login_wrong_password(client):
    email, _ = _register(client, password="correcthorse")
    r = client.post("/auth/login", json={"email": email, "password": "wrongpass1"})
    assert r.status_code == 401
    assert r.get_json()["error"] == "invalid_credentials"


def test_login_unknown_email_same_generic_error(client):
    r = client.post("/auth/login", json={"email": _uniq(), "password": "whatever12"})
    assert r.status_code == 401
    assert r.get_json()["error"] == "invalid_credentials"  # no user enumeration


# 6 — /auth/me without token → 401
def test_me_without_token(client):
    r = client.get("/auth/me")
    assert r.status_code == 401


# 7 — /auth/me with valid token → correct user
def test_me_with_valid_token(client):
    email, reg = _register(client)
    token = reg.get_json()["token"]
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.get_json()["user"]["email"] == email


# 8 — tampered token → 401
def test_me_tampered_token(client):
    _, reg = _register(client)
    token = reg.get_json()["token"]
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}xxx"})
    assert r.status_code == 401


# 9 — expired token (unit-level on tokens.read_token)
def test_expired_token_returns_none(monkeypatch):
    from app.domains.auth import tokens
    monkeypatch.setenv("AUTH_SECRET", "unit-test-secret")
    tok = tokens.make_token({"user_id": "u1", "token_version": 1})
    time.sleep(2.1)  # itsdangerous floors age to whole seconds; need age > max_age
    assert tokens.read_token(tok, max_age=1) is None         # expired
    assert tokens.read_token(tok, max_age=3600) is not None  # still valid with a long window


# 10 — token_version bump invalidates old token
def test_token_version_bump_invalidates(client):
    _, reg = _register(client)
    token = reg.get_json()["token"]
    uid = reg.get_json()["user"]["id"]
    from app.domains.auth import users_store
    users_store.bump_token_version(uid)
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401  # old token's tv no longer matches


# 11 — login rate-limit path (monkeypatch the limiter)
def test_login_rate_limited(client, monkeypatch):
    import app.main as main
    monkeypatch.setattr(main, "_rate_limit_check", lambda scope: (False, 7))
    r = client.post("/auth/login", json={"email": _uniq(), "password": "password123"})
    assert r.status_code == 429
    assert r.headers.get("Retry-After") == "7"


# 12 — existing routes stay open (auth did not gate them)
def test_health_still_open(client):
    assert client.get("/health").status_code == 200


def test_logout_ok(client):
    r = client.post("/auth/logout")
    assert r.status_code == 200 and r.get_json()["ok"] is True


# 13 — POST /auth/refresh (đặc tả 12.1)
def test_refresh_returns_new_usable_token(client):
    _, reg = _register(client)
    old = reg.get_json()["token"]

    r = client.post("/auth/refresh", headers={"Authorization": f"Bearer {old}"})
    assert r.status_code == 200
    new = r.get_json()["token"]
    assert new
    assert r.get_json()["user"]["role"] == "learner"

    # token mới dùng được ngay
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {new}"})
    assert me.status_code == 200


def test_refresh_without_token_is_401(client):
    assert client.post("/auth/refresh").status_code == 401


def test_refresh_rejected_after_token_revoked(client):
    """bump_token_version = logout-all → token cũ không refresh được."""
    _, reg = _register(client)
    token = reg.get_json()["token"]
    uid = reg.get_json()["user"]["id"]

    from app.domains.auth import users_store
    users_store.bump_token_version(uid)

    r = client.post("/auth/refresh", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
