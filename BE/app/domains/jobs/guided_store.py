"""Durable Guided Mind Map job store.

The legacy ``jobs_store`` remains the SQLite store for local development and
V2 jobs.  Guided V3 uses this module in production: PostgreSQL is selected
explicitly (or automatically for a protected web/worker process) and there is
no silent fallback to a process-local queue or /tmp SQLite.
"""
from __future__ import annotations

import hashlib
import json
import os
import socket
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import create_engine, text

_engine = None


def _production_role() -> bool:
    return (os.getenv("PROCESS_ROLE", "").strip().lower() in {"web", "mindmap-worker"}
            or os.getenv("AUTH_PROTECT_APP_APIS", "").strip().lower() in {"1", "true", "yes", "on"})


def use_postgres() -> bool:
    configured = os.getenv("GUIDED_JOB_STORE_BACKEND", "").strip().lower()
    if configured in {"postgres", "postgresql"}:
        return True
    if configured in {"sqlite", "local", "test"}:
        return False
    return _production_role()


def dsn() -> str:
    return (os.getenv("JOBS_DATABASE_URL") or os.getenv("DATABASE_URL") or "").strip()


def _postgres_url(value: str) -> str:
    if value.startswith("postgresql://"):
        return "postgresql+psycopg://" + value[len("postgresql://"):]
    if value.startswith("postgres://"):
        return "postgresql+psycopg://" + value[len("postgres://"):]
    return value


def _get_engine():
    global _engine
    if _engine is None:
        value = dsn()
        if not value:
            raise RuntimeError("durable_store_unavailable")
        kwargs: dict[str, Any] = {"pool_pre_ping": True, "pool_size": 5, "max_overflow": 5}
        if ":6543" in value:
            kwargs["connect_args"] = {"prepare_threshold": None}
        _engine = create_engine(_postgres_url(value), **kwargs)
    return _engine


def reset_engine() -> None:
    global _engine
    if _engine is not None:
        _engine.dispose()
    _engine = None


def health() -> dict[str, Any]:
    if not use_postgres():
        return {"available": True, "backend": "sqlite", "reason": None}
    try:
        with _get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
            conn.execute(text("SELECT 1 FROM guided_mindmap_jobs LIMIT 1"))
        return {"available": True, "backend": "postgres", "reason": None}
    except Exception as exc:
        return {"available": False, "backend": "postgres", "reason": "durable_store_unavailable", "detail": type(exc).__name__}


def _json(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def request_fingerprint(source_ids: list[str], config: dict[str, Any], force: bool = False) -> str:
    raw = _json({"sources": source_ids, "config": config, "force": force})
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _row(row) -> Optional[dict[str, Any]]:
    if row is None:
        return None
    d = dict(row._mapping)
    for key in ("source_ids", "guided_config", "result"):
        raw = d.pop(key + "_json", None)
        if raw is None:
            d[key] = None
        elif isinstance(raw, str):
            try:
                d[key] = json.loads(raw)
            except Exception:
                d[key] = None
        else:
            d[key] = raw
    d["error"] = d.get("error_message")
    d["current_node"] = d.get("stage") or ""
    return d


def _select_sql() -> str:
    return """SELECT job_id,user_id,map_id,result_map_id,idempotency_key,request_fingerprint,
        source_ids_json,guided_config_json,status,stage,attempts,progress,current_node,
        lease_owner,lease_expires_at,heartbeat_at,created_at,updated_at,started_at,
        completed_at,error_code,error_message,force,result_json AS result_json FROM guided_mindmap_jobs"""


def create_idempotent_job(job_id: str, *, user_id: str, idempotency_key: str,
                          request_fingerprint: str, source_ids_json: str,
                          guided_config_json: str, stage: str = "queued",
                          map_id: Optional[str] = None,
                          force: bool = False) -> tuple[str, dict[str, Any]]:
    if not use_postgres():
        from app.domains.jobs.jobs_store import create_idempotent_job as legacy
        return legacy(job_id, user_id=user_id, idempotency_key=idempotency_key,
                      request_fingerprint=request_fingerprint, source_ids_json=source_ids_json,
                      guided_config_json=guided_config_json, stage=stage, force=force)
    now = datetime.now(timezone.utc)
    with _get_engine().begin() as conn:
        conn.execute(text("""INSERT INTO guided_mindmap_jobs
            (job_id,user_id,map_id,idempotency_key,request_fingerprint,source_ids_json,
             guided_config_json,status,stage,force,created_at,updated_at)
            VALUES (:job_id,:user_id,:map_id,:key,:fingerprint,CAST(:sources AS jsonb),
                    CAST(:config AS jsonb),'queued',:stage,:force,:now,:now)
            ON CONFLICT (user_id,idempotency_key) DO NOTHING"""), {
                "job_id": job_id, "user_id": user_id, "map_id": map_id,
                "key": idempotency_key, "fingerprint": request_fingerprint,
                "sources": source_ids_json, "config": guided_config_json,
                "stage": stage, "force": bool(force), "now": now,
            })
        row = conn.execute(text(_select_sql() + " WHERE user_id=:uid AND idempotency_key=:key"),
                           {"uid": user_id, "key": idempotency_key}).fetchone()
    result = _row(row) or {}
    if result.get("request_fingerprint") != request_fingerprint:
        return "conflict", result
    return ("created" if result.get("job_id") == job_id else "existing"), result


def get_job(job_id: str, user_id: Optional[str] = None) -> Optional[dict[str, Any]]:
    if not use_postgres():
        from app.domains.jobs.jobs_store import get_job
        return get_job(job_id)
    where = " WHERE job_id=:job_id" + (" AND user_id=:user_id" if user_id else "")
    with _get_engine().connect() as conn:
        row = conn.execute(text(_select_sql() + where), {"job_id": job_id, "user_id": user_id}).fetchone()
    return _row(row)


def claim_next_job(owner: Optional[str] = None, lease_seconds: int = 900) -> Optional[dict[str, Any]]:
    owner = owner or f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc)
    expires = now + timedelta(seconds=lease_seconds)
    with _get_engine().begin() as conn:
        row = conn.execute(text(_select_sql() + " WHERE (status IN ('queued','pending') OR (status='running' AND lease_expires_at < :now)) AND (not_before IS NULL OR not_before <= :now) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1"), {"now": now}).fetchone()
        if row is None:
            return None
        updated = conn.execute(text("""UPDATE guided_mindmap_jobs SET status='running', stage='retrieving',
            lease_owner=:owner, lease_expires_at=:expires, heartbeat_at=:now,
            started_at=COALESCE(started_at,:now), attempts=attempts+1, updated_at=:now
            WHERE job_id=:job_id RETURNING *"""), {"owner": owner, "expires": expires, "now": now, "job_id": row._mapping["job_id"]}).fetchone()
    return _row(updated)


def update_job(job_id: str, **kwargs: Any) -> None:
    if not use_postgres():
        from app.domains.jobs.jobs_store import update_job as legacy
        return legacy(job_id, **kwargs)
    mapping = {"status": "status", "progress": "progress", "stage": "stage",
               "current_node": "current_node", "result_map_id": "result_map_id",
               "error_code": "error_code", "error_message": "error_message",
               "error_text": "error_message", "result_json": "result_json",
               "result": "result_json", "lease_owner": "lease_owner",
               "lease_expires_at": "lease_expires_at", "not_before": "not_before"}
    fields = ["updated_at=NOW()"]
    values: dict[str, Any] = {"job_id": job_id}
    for source, target in mapping.items():
        if source not in kwargs:
            continue
        fields.append(f"{target}=:v_{target}")
        value = kwargs[source]
        values[f"v_{target}"] = _json(value) if target == "result_json" and not isinstance(value, str) else value
    if kwargs.get("status") == "done":
        fields += ["completed_at=COALESCE(completed_at,NOW())", "lease_owner=NULL", "lease_expires_at=NULL"]
    if kwargs.get("status") in {"error", "failed"}:
        fields += ["completed_at=COALESCE(completed_at,NOW())", "lease_owner=NULL", "lease_expires_at=NULL"]
    if kwargs.get("heartbeat") or kwargs.get("status") == "running":
        fields.append("heartbeat_at=NOW()")
    with _get_engine().begin() as conn:
        conn.execute(text("UPDATE guided_mindmap_jobs SET " + ",".join(fields) + " WHERE job_id=:job_id"), values)


def record_worker_heartbeat(worker_id: str, ttl_seconds: int = 90) -> None:
    with _get_engine().begin() as conn:
        conn.execute(text("""INSERT INTO guided_mindmap_worker_heartbeats(worker_id,heartbeat_at,ttl_seconds)
            VALUES (:id,NOW(),:ttl) ON CONFLICT(worker_id) DO UPDATE SET heartbeat_at=NOW(),ttl_seconds=:ttl"""), {"id": worker_id, "ttl": ttl_seconds})


def worker_healthy(ttl_seconds: int = 90) -> bool:
    if not use_postgres():
        return True
    try:
        with _get_engine().connect() as conn:
            row = conn.execute(text("SELECT 1 FROM guided_mindmap_worker_heartbeats WHERE heartbeat_at > NOW() - (:ttl * INTERVAL '1 second') LIMIT 1"), {"ttl": ttl_seconds}).fetchone()
        return row is not None
    except Exception:
        return False

