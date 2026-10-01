from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_LOCK = threading.RLock()
_PLANS = {
    "free": (200_000, 8_000),
    "plus": (2_000_000, 32_000),
    "pro": (10_000_000, 64_000),
}


def _db_path() -> Path:
    value = (os.getenv("USAGE_DB_PATH") or "").strip()
    if value:
        return Path(value)
    base = (os.getenv("DATA_DIR") or "").strip()
    if base:
        return Path(base) / "usage.sqlite"
    from shared.paths import BE_ROOT
    return BE_ROOT / "usage.sqlite"


def _conn() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _reset_at() -> str:
    now = datetime.now(timezone.utc)
    if now.month == 12:
        next_month = now.replace(year=now.year + 1, month=1, day=1)
    else:
        next_month = now.replace(month=now.month + 1, day=1)
    return next_month.isoformat()


def init_db() -> None:
    with _LOCK:
        conn = _conn()
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS usage_entitlements (
                    user_id TEXT PRIMARY KEY,
                    plan_code TEXT NOT NULL DEFAULT 'free',
                    monthly_token_limit INTEGER NOT NULL,
                    per_request_token_limit INTEGER NOT NULL,
                    reset_at TEXT NOT NULL,
                    admin_override INTEGER NOT NULL DEFAULT 0,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    version INTEGER NOT NULL DEFAULT 1,
                    effective_date TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS usage_reservations (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    feature TEXT NOT NULL,
                    operation TEXT NOT NULL,
                    request_id TEXT,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    reserved_tokens INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'reserved',
                    created_at TEXT NOT NULL,
                    released_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_usage_res_user_status ON usage_reservations(user_id, status);
                CREATE TABLE IF NOT EXISTS usage_events (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    account_id TEXT,
                    feature TEXT NOT NULL,
                    operation TEXT NOT NULL,
                    provider TEXT,
                    model TEXT,
                    request_id TEXT,
                    job_id TEXT,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    input_tokens INTEGER NOT NULL DEFAULT 0,
                    output_tokens INTEGER NOT NULL DEFAULT 0,
                    embedding_tokens INTEGER NOT NULL DEFAULT 0,
                    cached_input_tokens INTEGER NOT NULL DEFAULT 0,
                    total_tokens INTEGER NOT NULL DEFAULT 0,
                    usage_source TEXT NOT NULL,
                    estimated_cost REAL,
                    currency TEXT,
                    status TEXT NOT NULL,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_usage_events_user_created ON usage_events(user_id, created_at);
                """
            )
            conn.commit()
        finally:
            conn.close()


class QuotaExceeded(Exception):
    def __init__(self, *, feature: str, used: int, reserved: int, limit: int, remaining: int, reset_at: str) -> None:
        self.payload = {
            "code": "quota_exceeded", "feature": feature, "used": used,
            "reserved": reserved, "limit": limit, "remaining": remaining,
            "reset_at": reset_at, "upgrade_available": True,
        }
        super().__init__("AI token quota exceeded")


def _entitlement(conn: sqlite3.Connection, user_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM usage_entitlements WHERE user_id=?", (user_id,)).fetchone()
    if row:
        return row
    plan = (os.getenv("DEFAULT_USAGE_PLAN") or "free").strip().lower()
    monthly, per_request = _PLANS.get(plan, _PLANS["free"])
    conn.execute(
        "INSERT INTO usage_entitlements(user_id,plan_code,monthly_token_limit,per_request_token_limit,reset_at,effective_date) VALUES(?,?,?,?,?,?)",
        (user_id, plan, monthly, per_request, _reset_at(), _now()),
    )
    return conn.execute("SELECT * FROM usage_entitlements WHERE user_id=?", (user_id,)).fetchone()


def _totals(conn: sqlite3.Connection, user_id: str) -> tuple[int, int]:
    used = conn.execute("SELECT COALESCE(SUM(total_tokens),0) FROM usage_events WHERE user_id=? AND status IN ('committed','success')", (user_id,)).fetchone()[0]
    reserved = conn.execute("SELECT COALESCE(SUM(reserved_tokens),0) FROM usage_reservations WHERE user_id=? AND status='reserved'", (user_id,)).fetchone()[0]
    return int(used), int(reserved)


def reserve(user_id: str, *, feature: str, operation: str, tokens: int, idempotency_key: str, request_id: str | None = None) -> dict[str, Any]:
    if not user_id or not idempotency_key:
        raise ValueError("user_id and idempotency_key are required")
    amount = max(0, int(tokens))
    init_db()
    with _LOCK:
        conn = _conn()
        try:
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute("SELECT * FROM usage_reservations WHERE idempotency_key=?", (idempotency_key,)).fetchone()
            if existing:
                return dict(existing)
            ent = _entitlement(conn, user_id)
            if not ent["enabled"]:
                raise QuotaExceeded(feature=feature, used=0, reserved=0, limit=0, remaining=0, reset_at=ent["reset_at"])
            if amount > ent["per_request_token_limit"]:
                used, reserved = _totals(conn, user_id)
                raise QuotaExceeded(feature=feature, used=used, reserved=reserved, limit=ent["per_request_token_limit"], remaining=max(0, ent["per_request_token_limit"] - used - reserved), reset_at=ent["reset_at"])
            used, reserved = _totals(conn, user_id)
            if used + reserved + amount > ent["monthly_token_limit"]:
                raise QuotaExceeded(feature=feature, used=used, reserved=reserved, limit=ent["monthly_token_limit"], remaining=max(0, ent["monthly_token_limit"] - used - reserved), reset_at=ent["reset_at"])
            rid = uuid.uuid4().hex
            conn.execute("INSERT INTO usage_reservations(id,user_id,feature,operation,request_id,idempotency_key,reserved_tokens,created_at) VALUES(?,?,?,?,?,?,?,?)", (rid, user_id, feature, operation, request_id, idempotency_key, amount, _now()))
            conn.commit()
            return dict(conn.execute("SELECT * FROM usage_reservations WHERE id=?", (rid,)).fetchone())
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def commit_reservation(reservation_id: str, *, input_tokens: int = 0, output_tokens: int = 0, embedding_tokens: int = 0, cached_input_tokens: int = 0, provider: str | None = None, model: str | None = None, usage_source: str = "provider", status: str = "committed", metadata: dict[str, Any] | None = None, job_id: str | None = None) -> dict[str, Any]:
    init_db()
    total = max(0, int(input_tokens)) + max(0, int(output_tokens)) + max(0, int(embedding_tokens))
    with _LOCK:
        conn = _conn()
        try:
            conn.execute("BEGIN IMMEDIATE")
            reservation = conn.execute("SELECT * FROM usage_reservations WHERE id=?", (reservation_id,)).fetchone()
            if not reservation:
                raise ValueError("unknown usage reservation")
            existing = conn.execute("SELECT * FROM usage_events WHERE idempotency_key=?", (reservation["idempotency_key"],)).fetchone()
            if existing:
                return dict(existing)
            ent = _entitlement(conn, reservation["user_id"])
            used, _ = _totals(conn, reservation["user_id"])
            if total > reservation["reserved_tokens"] and used + total > ent["monthly_token_limit"]:
                raise QuotaExceeded(feature=reservation["feature"], used=used, reserved=0, limit=ent["monthly_token_limit"], remaining=max(0, ent["monthly_token_limit"] - used), reset_at=ent["reset_at"])
            event_id = uuid.uuid4().hex
            conn.execute("INSERT INTO usage_events(id,user_id,feature,operation,provider,model,request_id,job_id,idempotency_key,input_tokens,output_tokens,embedding_tokens,cached_input_tokens,total_tokens,usage_source,status,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (event_id, reservation["user_id"], reservation["feature"], reservation["operation"], provider, model, reservation["request_id"], job_id, reservation["idempotency_key"], int(input_tokens), int(output_tokens), int(embedding_tokens), int(cached_input_tokens), total, usage_source, status, json.dumps(metadata or {}, separators=(",", ":")), _now()))
            conn.execute("UPDATE usage_reservations SET status='committed', released_at=? WHERE id=?", (_now(), reservation_id))
            conn.commit()
            return dict(conn.execute("SELECT * FROM usage_events WHERE id=?", (event_id,)).fetchone())
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def release_reservation(reservation_id: str) -> bool:
    init_db()
    with _LOCK:
        conn = _conn()
        try:
            cur = conn.execute("UPDATE usage_reservations SET status='released', released_at=? WHERE id=? AND status='reserved'", (_now(), reservation_id))
            conn.commit()
            return cur.rowcount == 1
        finally:
            conn.close()


def get_summary(user_id: str) -> dict[str, Any]:
    init_db()
    with _LOCK:
        conn = _conn()
        try:
            ent = _entitlement(conn, user_id)
            used, reserved = _totals(conn, user_id)
            limit = int(ent["monthly_token_limit"])
            breakdown = {row["feature"]: int(row["total"]) for row in conn.execute("SELECT feature, COALESCE(SUM(total_tokens),0) total FROM usage_events WHERE user_id=? AND status IN ('committed','success') GROUP BY feature", (user_id,))}
            return {"plan": ent["plan_code"], "used": used, "reserved": reserved, "limit": limit, "remaining": max(0, limit - used - reserved), "percentage": round((used / limit) * 100, 2) if limit else 100, "reset_at": ent["reset_at"], "breakdown": breakdown}
        finally:
            conn.close()


def list_events(user_id: str, limit: int = 25) -> list[dict[str, Any]]:
    init_db()
    with _LOCK:
        conn = _conn()
        try:
            rows = conn.execute("SELECT id,feature,operation,provider,model,request_id,job_id,input_tokens,output_tokens,embedding_tokens,cached_input_tokens,total_tokens,usage_source,status,created_at FROM usage_events WHERE user_id=? ORDER BY created_at DESC LIMIT ?", (user_id, max(1, min(int(limit), 100)))).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()
