"""Transactional AI usage ledger and quota enforcement.

PostgreSQL is the only production backend.  SQLite exists solely as an
explicit adapter for unit tests that set ``USAGE_DB_PATH`` while running under
pytest.  Production schema is owned by Alembic; request code never creates it.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

from sqlalchemy import text

PLAN_LIMITS = {
    "free": (200_000, 8_000),
    "plus": (2_000_000, 32_000),
    "pro": (10_000_000, 64_000),
}
RESERVATION_TERMINAL_STATUSES = {
    "committed", "released", "expired", "failed", "overage",
}
USAGE_SOURCES = {"provider", "estimated", "system"}
SAFE_METADATA_KEYS = {
    "attempt_id", "cache_hit", "error_code", "finish_reason", "latency_ms",
    "partial", "provider_request_id", "quota_exceeded_after_execution",
    "retry_count", "stage",
}

# Unit adapter only.  Production concurrency is protected by PostgreSQL row
# locks and uniqueness constraints, never by this process-local lock.
_SQLITE_TEST_LOCK = threading.RLock()


class QuotaExceeded(Exception):
    def __init__(
        self,
        *,
        feature: str,
        used: int,
        reserved: int,
        limit: int,
        remaining: int,
        reset_at: str,
    ) -> None:
        self.payload = {
            "code": "quota_exceeded",
            "feature": feature,
            "used": used,
            "reserved": reserved,
            "limit": limit,
            "remaining": remaining,
            "reset_at": reset_at,
            "upgrade_available": True,
        }
        super().__init__("AI token quota exceeded")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None = None) -> str:
    return (value or _now()).astimezone(timezone.utc).isoformat()


def _period(now: datetime | None = None) -> tuple[datetime, datetime]:
    now = (now or _now()).astimezone(timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if now.month == 12:
        end = start.replace(year=now.year + 1, month=1)
    else:
        end = start.replace(month=now.month + 1)
    return start, end


def _enforcement_enabled() -> bool:
    return (os.getenv("USAGE_ENFORCEMENT_ENABLED", "0") or "").strip().lower() in {
        "1", "true", "yes", "on",
    }


def _running_pytest() -> bool:
    try:
        from app.db import dang_chay_pytest
        return dang_chay_pytest()
    except Exception:
        return False


def _sqlite_mode() -> bool:
    configured = bool((os.getenv("USAGE_DB_PATH") or "").strip())
    if configured and not _running_pytest():
        raise RuntimeError("USAGE_DB_PATH is a unit-test-only SQLite adapter")
    return configured


def _sqlite_path() -> Path:
    value = (os.getenv("USAGE_DB_PATH") or "").strip()
    if not value:
        raise RuntimeError("USAGE_DB_PATH must be explicit for the SQLite test adapter")
    return Path(value)


def _sqlite_conn() -> sqlite3.Connection:
    path = _sqlite_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


@contextmanager
def _pg() -> Iterator[Any]:
    from app.db import session_scope
    with session_scope() as session:
        yield session


def _dict(row: Any) -> dict[str, Any]:
    return dict(row._mapping) if hasattr(row, "_mapping") else dict(row)


def _plan_values(plan_code: str | None = None) -> tuple[str, int, int]:
    code = (plan_code or os.getenv("DEFAULT_USAGE_PLAN") or "free").strip().lower()
    monthly, per_request = PLAN_LIMITS.get(code, PLAN_LIMITS["free"])
    return code if code in PLAN_LIMITS else "free", monthly, per_request


def _synthetic_entitlement(
    user_id: str,
    *,
    plan_code: str | None = None,
    monthly_limit: int | None = None,
    per_request_limit: int | None = None,
) -> dict[str, Any]:
    code, monthly, per_request = _plan_values(plan_code)
    start, end = _period()
    return {
        "user_id": user_id,
        "plan_code": code,
        "monthly_token_limit": int(monthly_limit or monthly),
        "per_request_token_limit": int(per_request_limit or per_request),
        "period_start": start,
        "period_end": end,
        "reset_at": end,
        "enabled": True,
        "version": 1,
    }


def _sanitize_metadata(
    metadata: dict[str, Any] | None,
    *,
    latency_ms: int | None = None,
) -> dict[str, Any]:
    source = metadata if isinstance(metadata, dict) else {}
    safe = {key: source[key] for key in SAFE_METADATA_KEYS if key in source}
    if latency_ms is not None:
        safe["latency_ms"] = max(0, int(latency_ms))
    return safe


def normalize_provider_usage(
    raw: dict[str, Any] | None,
    *,
    kind: str = "chat",
) -> dict[str, int]:
    """Normalize official provider counters without inventing missing usage.

    ``total_tokens`` is preserved when supplied by the provider.  Cached input
    is recorded separately but is not added again to a provider total that
    already includes it.
    """
    raw = raw if isinstance(raw, dict) else {}

    def integer(*keys: str) -> int:
        for key in keys:
            value = raw.get(key)
            if value is None:
                continue
            try:
                return max(0, int(value))
            except (TypeError, ValueError):
                continue
        return 0

    input_tokens = integer("input_tokens", "prompt_tokens")
    output_tokens = integer("output_tokens", "completion_tokens")
    cached_input_tokens = integer(
        "cached_input_tokens", "prompt_cached_tokens", "cache_read_input_tokens",
    )
    embedding_tokens = integer("embedding_tokens")
    if kind == "embedding" and not embedding_tokens:
        embedding_tokens = integer("total_tokens", "input_tokens", "prompt_tokens")
    provider_total = integer("total_tokens")
    calculated = embedding_tokens if kind == "embedding" else input_tokens + output_tokens
    return {
        "input_tokens": 0 if kind == "embedding" else input_tokens,
        "output_tokens": 0 if kind == "embedding" else output_tokens,
        "cached_input_tokens": cached_input_tokens,
        "embedding_tokens": embedding_tokens,
        "total_tokens": provider_total or calculated,
    }


def init_db() -> None:
    """Initialize only the explicit SQLite unit-test adapter."""
    if not _sqlite_mode():
        return
    with _SQLITE_TEST_LOCK, _sqlite_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS usage_entitlements (
                user_id TEXT PRIMARY KEY,
                plan_code TEXT NOT NULL,
                monthly_token_limit INTEGER NOT NULL,
                per_request_token_limit INTEGER NOT NULL,
                period_start TEXT NOT NULL,
                period_end TEXT NOT NULL,
                reset_at TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                version INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS usage_reservations (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                feature TEXT NOT NULL,
                operation TEXT NOT NULL,
                provider TEXT,
                model TEXT,
                request_id TEXT,
                job_id TEXT,
                idempotency_key TEXT NOT NULL,
                reserved_tokens INTEGER NOT NULL,
                monthly_token_limit INTEGER NOT NULL,
                per_request_token_limit INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'reserved',
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                lease_owner TEXT,
                committed_at TEXT,
                released_at TEXT,
                expired_at TEXT,
                failed_at TEXT,
                terminal_at TEXT,
                period_start TEXT NOT NULL,
                period_end TEXT NOT NULL,
                UNIQUE(user_id, idempotency_key)
            );
            CREATE INDEX IF NOT EXISTS idx_usage_res_user_status
                ON usage_reservations(user_id, status);
            CREATE INDEX IF NOT EXISTS idx_usage_res_expiry
                ON usage_reservations(status, expires_at);
            CREATE INDEX IF NOT EXISTS idx_usage_res_lookup
                ON usage_reservations(request_id, job_id);
            CREATE TABLE IF NOT EXISTS usage_events (
                id TEXT PRIMARY KEY,
                reservation_id TEXT NOT NULL,
                attempt_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                account_id TEXT,
                feature TEXT NOT NULL,
                operation TEXT NOT NULL,
                provider TEXT,
                model TEXT,
                request_id TEXT,
                job_id TEXT,
                idempotency_key TEXT NOT NULL,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                embedding_tokens INTEGER NOT NULL DEFAULT 0,
                cached_input_tokens INTEGER NOT NULL DEFAULT 0,
                total_tokens INTEGER NOT NULL DEFAULT 0,
                usage_source TEXT NOT NULL,
                status TEXT NOT NULL,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                period_start TEXT NOT NULL,
                period_end TEXT NOT NULL,
                UNIQUE(reservation_id, attempt_id)
            );
            CREATE INDEX IF NOT EXISTS idx_usage_events_period
                ON usage_events(user_id, period_start, period_end);
            CREATE INDEX IF NOT EXISTS idx_usage_events_recent
                ON usage_events(user_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_usage_events_lookup
                ON usage_events(request_id, job_id);
            """
        )


def _write_entitlement_pg(session: Any, user_id: str) -> dict[str, Any]:
    """Return the current entitlement while holding its row lock."""
    row = session.execute(
        text("SELECT * FROM usage_entitlements WHERE user_id=:uid FOR UPDATE"),
        {"uid": user_id},
    ).mappings().first()
    if row is None:
        entitlement = _synthetic_entitlement(user_id)
        session.execute(
            text(
                """INSERT INTO usage_entitlements
                   (user_id,plan_code,monthly_token_limit,per_request_token_limit,
                    period_start,period_end,reset_at,enabled,version)
                   VALUES (:uid,:plan,:monthly,:per_request,:start,:end,:end,true,1)
                   ON CONFLICT (user_id) DO NOTHING"""
            ),
            {
                "uid": user_id,
                "plan": entitlement["plan_code"],
                "monthly": entitlement["monthly_token_limit"],
                "per_request": entitlement["per_request_token_limit"],
                "start": entitlement["period_start"],
                "end": entitlement["period_end"],
            },
        )
        row = session.execute(
            text("SELECT * FROM usage_entitlements WHERE user_id=:uid FOR UPDATE"),
            {"uid": user_id},
        ).mappings().one()
    if row["period_end"] <= _now():
        start, end = _period()
        session.execute(
            text(
                """UPDATE usage_entitlements
                   SET period_start=:start, period_end=:end, reset_at=:end,
                       version=version+1, updated_at=now()
                   WHERE user_id=:uid"""
            ),
            {"uid": user_id, "start": start, "end": end},
        )
        row = session.execute(
            text("SELECT * FROM usage_entitlements WHERE user_id=:uid FOR UPDATE"),
            {"uid": user_id},
        ).mappings().one()
    return _dict(row)


def _read_entitlement_pg(session: Any, user_id: str) -> dict[str, Any]:
    """Read entitlement without inserting or rolling over on GET paths."""
    row = session.execute(
        text("SELECT * FROM usage_entitlements WHERE user_id=:uid"),
        {"uid": user_id},
    ).mappings().first()
    if row is None:
        return _synthetic_entitlement(user_id)
    entitlement = _dict(row)
    if entitlement["period_end"] <= _now():
        return _synthetic_entitlement(
            user_id,
            plan_code=entitlement["plan_code"],
            monthly_limit=entitlement["monthly_token_limit"],
            per_request_limit=entitlement["per_request_token_limit"],
        )
    return entitlement


def _write_entitlement_sqlite(conn: sqlite3.Connection, user_id: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM usage_entitlements WHERE user_id=?", (user_id,),
    ).fetchone()
    if row is None:
        entitlement = _synthetic_entitlement(user_id)
        conn.execute(
            """INSERT INTO usage_entitlements
               (user_id,plan_code,monthly_token_limit,per_request_token_limit,
                period_start,period_end,reset_at,enabled,version)
               VALUES(?,?,?,?,?,?,?,?,1)""",
            (
                user_id,
                entitlement["plan_code"],
                entitlement["monthly_token_limit"],
                entitlement["per_request_token_limit"],
                _iso(entitlement["period_start"]),
                _iso(entitlement["period_end"]),
                _iso(entitlement["reset_at"]),
                1,
            ),
        )
    else:
        period_end = datetime.fromisoformat(row["period_end"].replace("Z", "+00:00"))
        if period_end <= _now():
            start, end = _period()
            conn.execute(
                """UPDATE usage_entitlements
                   SET period_start=?,period_end=?,reset_at=?,version=version+1
                   WHERE user_id=?""",
                (_iso(start), _iso(end), _iso(end), user_id),
            )
    return dict(conn.execute(
        "SELECT * FROM usage_entitlements WHERE user_id=?", (user_id,),
    ).fetchone())


def _read_entitlement_sqlite(conn: sqlite3.Connection, user_id: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM usage_entitlements WHERE user_id=?", (user_id,),
    ).fetchone()
    if row is None:
        entitlement = _synthetic_entitlement(user_id)
        return {**entitlement, **{
            key: _iso(entitlement[key])
            for key in ("period_start", "period_end", "reset_at")
        }}
    entitlement = dict(row)
    period_end = datetime.fromisoformat(entitlement["period_end"].replace("Z", "+00:00"))
    if period_end <= _now():
        synthetic = _synthetic_entitlement(
            user_id,
            plan_code=entitlement["plan_code"],
            monthly_limit=entitlement["monthly_token_limit"],
            per_request_limit=entitlement["per_request_token_limit"],
        )
        return {**synthetic, **{
            key: _iso(synthetic[key])
            for key in ("period_start", "period_end", "reset_at")
        }}
    return entitlement


def _totals_pg(session: Any, user_id: str, start: Any, end: Any) -> tuple[int, int]:
    params = {"uid": user_id, "start": start, "end": end}
    used = session.execute(
        text(
            """SELECT COALESCE(SUM(total_tokens),0) FROM usage_events
               WHERE user_id=:uid AND period_start=:start AND period_end=:end"""
        ),
        params,
    ).scalar_one()
    reserved = session.execute(
        text(
            """SELECT COALESCE(SUM(GREATEST(
                       r.reserved_tokens - COALESCE(e.actual_tokens, 0), 0)), 0)
               FROM usage_reservations r
               LEFT JOIN (
                   SELECT reservation_id, SUM(total_tokens) AS actual_tokens
                   FROM usage_events GROUP BY reservation_id
               ) e ON e.reservation_id=r.id
               WHERE r.user_id=:uid AND r.period_start=:start AND r.period_end=:end
                 AND r.status='reserved' AND r.expires_at>now()"""
        ),
        params,
    ).scalar_one()
    return int(used), int(reserved)


def _totals_sqlite(
    conn: sqlite3.Connection,
    user_id: str,
    entitlement: dict[str, Any],
) -> tuple[int, int]:
    period = (user_id, entitlement["period_start"], entitlement["period_end"])
    used = conn.execute(
        """SELECT COALESCE(SUM(total_tokens),0) FROM usage_events
           WHERE user_id=? AND period_start=? AND period_end=?""",
        period,
    ).fetchone()[0]
    reserved = conn.execute(
        """SELECT COALESCE(SUM(reserved_tokens),0) FROM usage_reservations
           WHERE user_id=? AND period_start=? AND period_end=?
             AND status='reserved' AND expires_at>?""",
        (*period, _iso()),
    ).fetchone()[0]
    actual_open = conn.execute(
        """SELECT COALESCE(SUM(MIN(r.reserved_tokens, COALESCE(e.actual_tokens,0))),0)
           FROM usage_reservations r
           LEFT JOIN (
             SELECT reservation_id,SUM(total_tokens) AS actual_tokens
             FROM usage_events GROUP BY reservation_id
           ) e ON e.reservation_id=r.id
           WHERE r.user_id=? AND r.period_start=? AND r.period_end=?
             AND r.status='reserved' AND r.expires_at>?""",
        (*period, _iso()),
    ).fetchone()[0]
    return int(used), max(0, int(reserved) - int(actual_open))


def _raise_quota(
    *,
    feature: str,
    entitlement: dict[str, Any],
    used: int,
    reserved: int,
    per_request: bool,
) -> None:
    monthly_limit = int(entitlement["monthly_token_limit"])
    limit = int(entitlement["per_request_token_limit"]) if per_request else monthly_limit
    reset_at = entitlement["reset_at"]
    raise QuotaExceeded(
        feature=feature,
        used=used,
        reserved=reserved,
        limit=limit,
        remaining=max(0, monthly_limit - used - reserved),
        reset_at=_iso(reset_at) if isinstance(reset_at, datetime) else str(reset_at),
    )


def upsert_entitlement(user_id: str, plan_code: str) -> dict[str, Any]:
    """Administrative/test helper; the plan table remains the single truth."""
    code, monthly, per_request = _plan_values(plan_code)
    start, end = _period()
    if _sqlite_mode():
        init_db()
        with _SQLITE_TEST_LOCK, _sqlite_conn() as conn:
            conn.execute(
                """INSERT INTO usage_entitlements
                   (user_id,plan_code,monthly_token_limit,per_request_token_limit,
                    period_start,period_end,reset_at,enabled,version)
                   VALUES(?,?,?,?,?,?,?,1,1)
                   ON CONFLICT(user_id) DO UPDATE SET
                     plan_code=excluded.plan_code,
                     monthly_token_limit=excluded.monthly_token_limit,
                     per_request_token_limit=excluded.per_request_token_limit""",
                (user_id, code, monthly, per_request, _iso(start), _iso(end), _iso(end)),
            )
            conn.commit()
            return _read_entitlement_sqlite(conn, user_id)
    with _pg() as session:
        row = session.execute(
            text(
                """INSERT INTO usage_entitlements
                   (user_id,plan_code,monthly_token_limit,per_request_token_limit,
                    period_start,period_end,reset_at,enabled,version)
                   VALUES (:uid,:plan,:monthly,:per_request,:start,:end,:end,true,1)
                   ON CONFLICT (user_id) DO UPDATE SET
                     plan_code=excluded.plan_code,
                     monthly_token_limit=excluded.monthly_token_limit,
                     per_request_token_limit=excluded.per_request_token_limit,
                     updated_at=now()
                   RETURNING *"""
            ),
            {
                "uid": user_id,
                "plan": code,
                "monthly": monthly,
                "per_request": per_request,
                "start": start,
                "end": end,
            },
        ).mappings().one()
        return _dict(row)


def reserve(
    user_id: str,
    *,
    feature: str,
    operation: str,
    tokens: int,
    idempotency_key: str,
    request_id: str | None = None,
    job_id: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    period_identifier: str | None = None,
    lease_seconds: int = 900,
    lease_owner: str | None = None,
    enforce: bool | None = None,
) -> dict[str, Any]:
    del period_identifier  # period is server-authoritative
    if not user_id or not idempotency_key:
        raise ValueError("user_id and idempotency_key are required")
    amount = max(0, int(tokens))
    expires_at = _now() + timedelta(seconds=max(1, int(lease_seconds)))
    should_enforce = _enforcement_enabled() if enforce is None else bool(enforce)

    if _sqlite_mode():
        init_db()
        with _SQLITE_TEST_LOCK, _sqlite_conn() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                entitlement = _write_entitlement_sqlite(conn, user_id)
                existing = conn.execute(
                    """SELECT * FROM usage_reservations
                       WHERE user_id=? AND idempotency_key=?""",
                    (user_id, idempotency_key),
                ).fetchone()
                if existing:
                    conn.commit()
                    return dict(existing)
                used, reserved = _totals_sqlite(conn, user_id, entitlement)
                if should_enforce and not entitlement["enabled"]:
                    _raise_quota(
                        feature=feature, entitlement=entitlement, used=used,
                        reserved=reserved, per_request=False,
                    )
                if should_enforce and amount > entitlement["per_request_token_limit"]:
                    _raise_quota(
                        feature=feature, entitlement=entitlement, used=used,
                        reserved=reserved, per_request=True,
                    )
                if should_enforce and used + reserved + amount > entitlement["monthly_token_limit"]:
                    _raise_quota(
                        feature=feature, entitlement=entitlement, used=used,
                        reserved=reserved, per_request=False,
                    )
                reservation_id = uuid.uuid4().hex
                conn.execute(
                    """INSERT INTO usage_reservations
                       (id,user_id,feature,operation,provider,model,request_id,job_id,
                        idempotency_key,reserved_tokens,monthly_token_limit,
                        per_request_token_limit,status,created_at,expires_at,
                        lease_owner,period_start,period_end)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'reserved',?,?,?,?,?)""",
                    (
                        reservation_id, user_id, feature, operation, provider, model,
                        request_id, job_id, idempotency_key, amount,
                        int(entitlement["monthly_token_limit"]),
                        int(entitlement["per_request_token_limit"]), _iso(),
                        _iso(expires_at), lease_owner, entitlement["period_start"],
                        entitlement["period_end"],
                    ),
                )
                conn.commit()
                return dict(conn.execute(
                    "SELECT * FROM usage_reservations WHERE id=?", (reservation_id,),
                ).fetchone())
            except Exception:
                conn.rollback()
                raise

    with _pg() as session:
        entitlement = _write_entitlement_pg(session, user_id)
        existing = session.execute(
            text(
                """SELECT * FROM usage_reservations
                   WHERE user_id=:uid AND idempotency_key=:key"""
            ),
            {"uid": user_id, "key": idempotency_key},
        ).mappings().first()
        if existing:
            return _dict(existing)
        used, reserved = _totals_pg(
            session, user_id, entitlement["period_start"], entitlement["period_end"],
        )
        if should_enforce and not entitlement["enabled"]:
            _raise_quota(
                feature=feature, entitlement=entitlement, used=used,
                reserved=reserved, per_request=False,
            )
        if should_enforce and amount > entitlement["per_request_token_limit"]:
            _raise_quota(
                feature=feature, entitlement=entitlement, used=used,
                reserved=reserved, per_request=True,
            )
        if should_enforce and used + reserved + amount > entitlement["monthly_token_limit"]:
            _raise_quota(
                feature=feature, entitlement=entitlement, used=used,
                reserved=reserved, per_request=False,
            )
        reservation_id = uuid.uuid4().hex
        session.execute(
            text(
                """INSERT INTO usage_reservations
                   (id,user_id,feature,operation,provider,model,request_id,job_id,
                    idempotency_key,reserved_tokens,monthly_token_limit,
                    per_request_token_limit,status,created_at,expires_at,lease_owner,
                    period_start,period_end)
                   VALUES
                   (:id,:uid,:feature,:operation,:provider,:model,:request_id,:job_id,
                    :key,:amount,:monthly,:per_request,'reserved',now(),:expires_at,
                    :lease_owner,:start,:end)"""
            ),
            {
                "id": reservation_id,
                "uid": user_id,
                "feature": feature,
                "operation": operation,
                "provider": provider,
                "model": model,
                "request_id": request_id,
                "job_id": job_id,
                "key": idempotency_key,
                "amount": amount,
                "monthly": int(entitlement["monthly_token_limit"]),
                "per_request": int(entitlement["per_request_token_limit"]),
                "expires_at": expires_at,
                "lease_owner": lease_owner,
                "start": entitlement["period_start"],
                "end": entitlement["period_end"],
            },
        )
        return _dict(session.execute(
            text("SELECT * FROM usage_reservations WHERE id=:id"),
            {"id": reservation_id},
        ).mappings().one())


def commit_reservation(
    reservation_id: str,
    *,
    attempt_id: str = "final",
    close_reservation: bool = True,
    input_tokens: int = 0,
    output_tokens: int = 0,
    embedding_tokens: int = 0,
    cached_input_tokens: int = 0,
    total_tokens: int | None = None,
    provider: str | None = None,
    model: str | None = None,
    usage_source: str = "system",
    status: str = "committed",
    metadata: dict[str, Any] | None = None,
    job_id: str | None = None,
    latency_ms: int | None = None,
) -> dict[str, Any]:
    if not attempt_id:
        raise ValueError("attempt_id is required")
    if usage_source not in USAGE_SOURCES:
        raise ValueError("invalid usage_source")
    normalized_input = max(0, int(input_tokens))
    normalized_output = max(0, int(output_tokens))
    normalized_embedding = max(0, int(embedding_tokens))
    normalized_cached = max(0, int(cached_input_tokens))
    calculated_total = normalized_input + normalized_output + normalized_embedding
    actual_total = calculated_total if total_tokens is None else max(0, int(total_tokens))
    safe_metadata = _sanitize_metadata(metadata, latency_ms=latency_ms)

    def event_values(
        reservation: Any, used: int, reservation_used: int,
    ) -> tuple[str, str]:
        overage = (
            reservation_used + actual_total > int(reservation["reserved_tokens"])
            or used + actual_total > int(reservation["monthly_token_limit"])
        )
        event_status = "overage" if overage else status
        if overage:
            safe_metadata["quota_exceeded_after_execution"] = True
        if event_status in {"failed", "partial"}:
            reservation_status = "failed"
        elif event_status == "overage":
            reservation_status = "overage"
        else:
            reservation_status = "committed"
        return event_status, reservation_status

    if _sqlite_mode():
        init_db()
        with _SQLITE_TEST_LOCK, _sqlite_conn() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                reservation = conn.execute(
                    "SELECT * FROM usage_reservations WHERE id=?", (reservation_id,),
                ).fetchone()
                if not reservation:
                    raise ValueError("unknown usage reservation")
                existing = conn.execute(
                    """SELECT * FROM usage_events
                       WHERE reservation_id=? AND attempt_id=?""",
                    (reservation_id, attempt_id),
                ).fetchone()
                if existing:
                    conn.commit()
                    return dict(existing)
                if reservation["status"] != "reserved":
                    raise ValueError("usage reservation is already terminal")
                reservation_period = {
                    "period_start": reservation["period_start"],
                    "period_end": reservation["period_end"],
                }
                used, _ = _totals_sqlite(
                    conn, reservation["user_id"], reservation_period,
                )
                reservation_used = int(conn.execute(
                    """SELECT COALESCE(SUM(total_tokens),0) FROM usage_events
                       WHERE reservation_id=?""",
                    (reservation_id,),
                ).fetchone()[0])
                event_status, reservation_status = event_values(
                    reservation, used, reservation_used,
                )
                event_id = uuid.uuid4().hex
                conn.execute(
                    """INSERT INTO usage_events
                       (id,reservation_id,attempt_id,user_id,feature,operation,provider,model,
                        request_id,job_id,idempotency_key,input_tokens,output_tokens,
                        embedding_tokens,cached_input_tokens,total_tokens,usage_source,
                        status,metadata_json,created_at,period_start,period_end)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        event_id, reservation_id, attempt_id, reservation["user_id"],
                        reservation["feature"], reservation["operation"],
                        provider or reservation["provider"], model or reservation["model"],
                        reservation["request_id"], job_id or reservation["job_id"],
                        reservation["idempotency_key"], normalized_input,
                        normalized_output, normalized_embedding, normalized_cached,
                        actual_total, usage_source, event_status,
                        json.dumps(safe_metadata, separators=(",", ":")), _iso(),
                        reservation["period_start"], reservation["period_end"],
                    ),
                )
                if close_reservation or reservation_status == "overage":
                    now = _iso()
                    conn.execute(
                        """UPDATE usage_reservations
                           SET status=?, committed_at=?, failed_at=?, terminal_at=?
                           WHERE id=?""",
                        (
                            reservation_status,
                            None if reservation_status == "failed" else now,
                            now if reservation_status == "failed" else None,
                            now,
                            reservation_id,
                        ),
                    )
                conn.commit()
                return dict(conn.execute(
                    "SELECT * FROM usage_events WHERE id=?", (event_id,),
                ).fetchone())
            except Exception:
                conn.rollback()
                raise

    with _pg() as session:
        reservation = session.execute(
            text("SELECT * FROM usage_reservations WHERE id=:id FOR UPDATE"),
            {"id": reservation_id},
        ).mappings().first()
        if not reservation:
            raise ValueError("unknown usage reservation")
        existing = session.execute(
            text(
                """SELECT * FROM usage_events
                   WHERE reservation_id=:id AND attempt_id=:attempt_id"""
            ),
            {"id": reservation_id, "attempt_id": attempt_id},
        ).mappings().first()
        if existing:
            return _dict(existing)
        if reservation["status"] != "reserved":
            raise ValueError("usage reservation is already terminal")
        # Serialize account commits without rolling the entitlement. A delayed
        # worker may be closing a reservation from the preceding billing period.
        session.execute(
            text("SELECT user_id FROM usage_entitlements WHERE user_id=:uid FOR UPDATE"),
            {"uid": reservation["user_id"]},
        ).first()
        used, _ = _totals_pg(
            session,
            reservation["user_id"],
            reservation["period_start"],
            reservation["period_end"],
        )
        reservation_used = int(session.execute(
            text(
                """SELECT COALESCE(SUM(total_tokens),0) FROM usage_events
                   WHERE reservation_id=:id"""
            ),
            {"id": reservation_id},
        ).scalar_one())
        event_status, reservation_status = event_values(
            reservation, used, reservation_used,
        )
        event_id = uuid.uuid4().hex
        session.execute(
            text(
                """INSERT INTO usage_events
                   (id,reservation_id,attempt_id,user_id,feature,operation,provider,model,
                    request_id,job_id,idempotency_key,input_tokens,output_tokens,
                    embedding_tokens,cached_input_tokens,total_tokens,usage_source,
                    status,metadata_json,created_at,period_start,period_end)
                   VALUES
                   (:id,:reservation_id,:attempt_id,:uid,:feature,:operation,:provider,:model,
                    :request_id,:job_id,:key,:input,:output,:embedding,:cached,:total,
                    :source,:status,CAST(:metadata AS JSONB),now(),:start,:end)"""
            ),
            {
                "id": event_id,
                "reservation_id": reservation_id,
                "attempt_id": attempt_id,
                "uid": reservation["user_id"],
                "feature": reservation["feature"],
                "operation": reservation["operation"],
                "provider": provider or reservation["provider"],
                "model": model or reservation["model"],
                "request_id": reservation["request_id"],
                "job_id": job_id or reservation["job_id"],
                "key": reservation["idempotency_key"],
                "input": normalized_input,
                "output": normalized_output,
                "embedding": normalized_embedding,
                "cached": normalized_cached,
                "total": actual_total,
                "source": usage_source,
                "status": event_status,
                "metadata": json.dumps(safe_metadata, separators=(",", ":")),
                "start": reservation["period_start"],
                "end": reservation["period_end"],
            },
        )
        if close_reservation or reservation_status == "overage":
            session.execute(
                text(
                    """UPDATE usage_reservations
                       SET status=:status,
                           committed_at=CASE WHEN :status='failed' THEN NULL ELSE now() END,
                           failed_at=CASE WHEN :status='failed' THEN now() ELSE NULL END,
                           terminal_at=now()
                       WHERE id=:id"""
                ),
                {"status": reservation_status, "id": reservation_id},
            )
        return _dict(session.execute(
            text("SELECT * FROM usage_events WHERE id=:id"), {"id": event_id},
        ).mappings().one())


def release_reservation(reservation_id: str, *, status: str = "released") -> bool:
    if status not in {"released", "failed"}:
        raise ValueError("release status must be released or failed")
    now = _now()
    if _sqlite_mode():
        init_db()
        with _SQLITE_TEST_LOCK, _sqlite_conn() as conn:
            cur = conn.execute(
                """UPDATE usage_reservations
                   SET status=?, released_at=?, failed_at=?, terminal_at=?
                   WHERE id=? AND status='reserved'""",
                (
                    status,
                    _iso(now) if status == "released" else None,
                    _iso(now) if status == "failed" else None,
                    _iso(now),
                    reservation_id,
                ),
            )
            conn.commit()
            return cur.rowcount == 1
    with _pg() as session:
        cur = session.execute(
            text(
                """UPDATE usage_reservations
                   SET status=:status,
                       released_at=CASE WHEN :status='released' THEN :now ELSE NULL END,
                       failed_at=CASE WHEN :status='failed' THEN :now ELSE NULL END,
                       terminal_at=:now
                   WHERE id=:id AND status='reserved'"""
            ),
            {"status": status, "now": now, "id": reservation_id},
        )
        return cur.rowcount == 1


def finalize_reservation(
    reservation_id: str,
    *,
    status: str = "committed",
) -> bool:
    """Close a multi-attempt reservation without inventing a usage event."""
    if status == "released":
        return release_reservation(reservation_id)
    if status not in {"committed", "failed"}:
        raise ValueError("final status must be committed, failed, or released")
    now = _now()
    if _sqlite_mode():
        init_db()
        with _SQLITE_TEST_LOCK, _sqlite_conn() as conn:
            cur = conn.execute(
                """UPDATE usage_reservations
                   SET status=?, committed_at=?, failed_at=?, terminal_at=?
                   WHERE id=? AND status='reserved'""",
                (
                    status,
                    _iso(now) if status == "committed" else None,
                    _iso(now) if status == "failed" else None,
                    _iso(now),
                    reservation_id,
                ),
            )
            conn.commit()
            return cur.rowcount == 1
    with _pg() as session:
        cur = session.execute(
            text(
                """UPDATE usage_reservations
                   SET status=:status,
                       committed_at=CASE WHEN :status='committed' THEN :now ELSE NULL END,
                       failed_at=CASE WHEN :status='failed' THEN :now ELSE NULL END,
                       terminal_at=:now
                   WHERE id=:id AND status='reserved'"""
            ),
            {"status": status, "now": now, "id": reservation_id},
        )
        return cur.rowcount == 1


def claim_reservation(
    reservation_id: str,
    *,
    lease_owner: str,
    lease_seconds: int = 900,
) -> bool:
    """Claim an unowned/expired reservation; never steal a live lease."""
    if not lease_owner:
        raise ValueError("lease_owner is required")
    now = _now()
    expires = now + timedelta(seconds=max(1, int(lease_seconds)))
    if _sqlite_mode():
        init_db()
        with _SQLITE_TEST_LOCK, _sqlite_conn() as conn:
            cur = conn.execute(
                """UPDATE usage_reservations
                   SET lease_owner=?,expires_at=?
                   WHERE id=? AND status='reserved'
                     AND (lease_owner IS NULL OR lease_owner=? OR expires_at<=?)""",
                (lease_owner, _iso(expires), reservation_id, lease_owner, _iso(now)),
            )
            conn.commit()
            return cur.rowcount == 1
    with _pg() as session:
        cur = session.execute(
            text(
                """UPDATE usage_reservations
                   SET lease_owner=:owner,expires_at=:expires
                   WHERE id=:id AND status='reserved'
                     AND (lease_owner IS NULL OR lease_owner=:owner OR expires_at<=:now)"""
            ),
            {"owner": lease_owner, "expires": expires, "id": reservation_id, "now": now},
        )
        return cur.rowcount == 1


def renew_reservation_lease(
    reservation_id: str,
    *,
    lease_owner: str,
    lease_seconds: int = 900,
) -> bool:
    """Extend only the current live owner's lease."""
    expires = _now() + timedelta(seconds=max(1, int(lease_seconds)))
    if _sqlite_mode():
        init_db()
        with _SQLITE_TEST_LOCK, _sqlite_conn() as conn:
            cur = conn.execute(
                """UPDATE usage_reservations SET expires_at=?
                   WHERE id=? AND status='reserved' AND lease_owner=?""",
                (_iso(expires), reservation_id, lease_owner),
            )
            conn.commit()
            return cur.rowcount == 1
    with _pg() as session:
        cur = session.execute(
            text(
                """UPDATE usage_reservations SET expires_at=:expires
                   WHERE id=:id AND status='reserved' AND lease_owner=:owner"""
            ),
            {"expires": expires, "id": reservation_id, "owner": lease_owner},
        )
        return cur.rowcount == 1


def reconcile_stale_reservations(
    *,
    now: datetime | None = None,
    limit: int = 500,
) -> int:
    cutoff = (now or _now()).astimezone(timezone.utc)
    bounded = max(1, min(int(limit), 5_000))
    if _sqlite_mode():
        init_db()
        with _SQLITE_TEST_LOCK, _sqlite_conn() as conn:
            ids = [row[0] for row in conn.execute(
                """SELECT id FROM usage_reservations
                   WHERE status='reserved' AND expires_at<=?
                   ORDER BY expires_at LIMIT ?""",
                (_iso(cutoff), bounded),
            ).fetchall()]
            if not ids:
                return 0
            placeholders = ",".join("?" for _ in ids)
            cur = conn.execute(
                f"""UPDATE usage_reservations
                    SET status='expired',expired_at=?,terminal_at=?
                    WHERE status='reserved' AND id IN ({placeholders})""",
                (_iso(cutoff), _iso(cutoff), *ids),
            )
            conn.commit()
            return cur.rowcount
    with _pg() as session:
        cur = session.execute(
            text(
                """WITH stale AS (
                     SELECT id FROM usage_reservations
                     WHERE status='reserved' AND expires_at<=:cutoff
                     ORDER BY expires_at
                     FOR UPDATE SKIP LOCKED
                     LIMIT :limit
                   )
                   UPDATE usage_reservations AS r
                   SET status='expired',expired_at=:cutoff,terminal_at=:cutoff
                   FROM stale WHERE r.id=stale.id AND r.status='reserved'"""
            ),
            {"cutoff": cutoff, "limit": bounded},
        )
        return cur.rowcount


def get_reservation(
    reservation_id: str,
    *,
    user_id: str | None = None,
) -> dict[str, Any] | None:
    if _sqlite_mode():
        init_db()
        with _SQLITE_TEST_LOCK, _sqlite_conn() as conn:
            if user_id is None:
                row = conn.execute(
                    "SELECT * FROM usage_reservations WHERE id=?", (reservation_id,),
                ).fetchone()
            else:
                row = conn.execute(
                    """SELECT * FROM usage_reservations
                       WHERE id=? AND user_id=?""",
                    (reservation_id, user_id),
                ).fetchone()
            return dict(row) if row else None
    with _pg() as session:
        sql = "SELECT * FROM usage_reservations WHERE id=:id"
        params: dict[str, Any] = {"id": reservation_id}
        if user_id is not None:
            sql += " AND user_id=:uid"
            params["uid"] = user_id
        row = session.execute(text(sql), params).mappings().first()
        return _dict(row) if row else None


def get_operation_usage(
    reservation_id: str,
    *,
    user_id: str | None = None,
) -> dict[str, Any] | None:
    """Return a safe per-operation aggregate, optionally owner-scoped."""
    reservation = get_reservation(reservation_id, user_id=user_id)
    if not reservation:
        return None
    select_sql = """SELECT input_tokens,output_tokens,embedding_tokens,
                            cached_input_tokens,total_tokens,usage_source,status,
                            provider,model,metadata_json
                     FROM usage_events WHERE reservation_id={placeholder}
                     ORDER BY created_at,id"""
    if _sqlite_mode():
        init_db()
        with _SQLITE_TEST_LOCK, _sqlite_conn() as conn:
            events = [dict(row) for row in conn.execute(
                select_sql.format(placeholder="?"), (reservation_id,),
            ).fetchall()]
    else:
        with _pg() as session:
            events = [_dict(row) for row in session.execute(
                text(select_sql.format(placeholder=":id")), {"id": reservation_id},
            ).mappings().all()]
    totals = {
        key: sum(int(event.get(key) or 0) for event in events)
        for key in (
            "input_tokens", "output_tokens", "embedding_tokens",
            "cached_input_tokens", "total_tokens",
        )
    }
    latencies: list[int] = []
    for event in events:
        metadata = event.get("metadata_json") or {}
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except ValueError:
                metadata = {}
        if isinstance(metadata, dict) and metadata.get("latency_ms") is not None:
            latencies.append(max(0, int(metadata["latency_ms"])))
    sources = {str(event.get("usage_source")) for event in events}
    statuses = {str(event.get("status")) for event in events}
    return {
        **totals,
        "latency_ms": sum(latencies) if latencies else None,
        "provider": next((event.get("provider") for event in reversed(events)
                          if event.get("provider")), reservation.get("provider")),
        "model": next((event.get("model") for event in reversed(events)
                       if event.get("model")), reservation.get("model")),
        "usage_source": (
            next(iter(sources)) if len(sources) == 1 else
            ("mixed" if sources else "system")
        ),
        "estimated": "estimated" in sources,
        # A semantic-cache judge may itself call a provider before approving
        # reuse. Only present the operation as a free cache hit when the whole
        # reservation has zero evidenced provider usage.
        "cache_hit": "cache_hit" in statuses and totals["total_tokens"] == 0,
        "attempt_count": len(events),
        "status": reservation["status"],
    }


def get_summary(user_id: str) -> dict[str, Any]:
    """Read-only usage summary; missing/expired entitlement is synthesized."""
    if _sqlite_mode():
        init_db()
        with _SQLITE_TEST_LOCK, _sqlite_conn() as conn:
            entitlement = _read_entitlement_sqlite(conn, user_id)
            used, reserved = _totals_sqlite(conn, user_id, entitlement)
            rows = conn.execute(
                """SELECT feature,COALESCE(SUM(total_tokens),0) AS total
                   FROM usage_events
                   WHERE user_id=? AND period_start=? AND period_end=?
                   GROUP BY feature""",
                (user_id, entitlement["period_start"], entitlement["period_end"]),
            ).fetchall()
            breakdown = {row["feature"]: int(row["total"]) for row in rows}
    else:
        with _pg() as session:
            entitlement = _read_entitlement_pg(session, user_id)
            used, reserved = _totals_pg(
                session,
                user_id,
                entitlement["period_start"],
                entitlement["period_end"],
            )
            rows = session.execute(
                text(
                    """SELECT feature,COALESCE(SUM(total_tokens),0) AS total
                       FROM usage_events
                       WHERE user_id=:uid AND period_start=:start AND period_end=:end
                       GROUP BY feature"""
                ),
                {
                    "uid": user_id,
                    "start": entitlement["period_start"],
                    "end": entitlement["period_end"],
                },
            ).mappings()
            breakdown = {row["feature"]: int(row["total"]) for row in rows}
    limit = int(entitlement["monthly_token_limit"])
    reset_at = entitlement["reset_at"]
    start = entitlement["period_start"]
    end = entitlement["period_end"]
    return {
        "plan": entitlement["plan_code"],
        "used": used,
        "reserved": reserved,
        "limit": limit,
        "per_request_token_limit": int(entitlement["per_request_token_limit"]),
        "remaining": max(0, limit - used - reserved),
        "percentage": round((used / limit) * 100, 2) if limit else 100,
        "reset_at": _iso(reset_at) if isinstance(reset_at, datetime) else reset_at,
        "period_start": _iso(start) if isinstance(start, datetime) else start,
        "period_end": _iso(end) if isinstance(end, datetime) else end,
        "enforcement_enabled": _enforcement_enabled(),
        "breakdown": breakdown,
    }


def list_events(
    user_id: str,
    limit: int = 25,
    *,
    cursor: str | None = None,
) -> list[dict[str, Any]]:
    bounded = max(1, min(int(limit), 100))
    if _sqlite_mode():
        init_db()
        with _SQLITE_TEST_LOCK, _sqlite_conn() as conn:
            sql = """SELECT id,reservation_id,attempt_id,feature,operation,provider,model,
                            request_id,job_id,input_tokens,output_tokens,
                            embedding_tokens,cached_input_tokens,total_tokens,
                            usage_source,status,metadata_json,created_at,
                            period_start,period_end
                     FROM usage_events WHERE user_id=?"""
            params: list[Any] = [user_id]
            if cursor:
                sql += " AND created_at<?"
                params.append(cursor)
            sql += " ORDER BY created_at DESC,id DESC LIMIT ?"
            params.append(bounded)
            return [dict(row) for row in conn.execute(sql, params).fetchall()]
    with _pg() as session:
        sql = """SELECT id,reservation_id,attempt_id,feature,operation,provider,model,
                        request_id,job_id,input_tokens,output_tokens,
                        embedding_tokens,cached_input_tokens,total_tokens,
                        usage_source,status,metadata_json,created_at,
                        period_start,period_end
                 FROM usage_events WHERE user_id=:uid"""
        params: dict[str, Any] = {"uid": user_id, "limit": bounded}
        if cursor:
            try:
                params["cursor"] = datetime.fromisoformat(cursor.replace("Z", "+00:00"))
            except (TypeError, ValueError) as exc:
                raise ValueError("invalid events cursor") from exc
            sql += " AND created_at<:cursor"
        sql += " ORDER BY created_at DESC,id DESC LIMIT :limit"
        return [_dict(row) for row in session.execute(text(sql), params).mappings().all()]
