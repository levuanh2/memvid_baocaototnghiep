from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

_lock = threading.Lock()

TERMINAL_STATUSES = ("done", "error", "timeout", "cancelled", "interrupted")
# token_buffer bị xóa khi job vào các status này (kết quả cuối đã nằm trong
# result_json). "interrupted" KHÔNG nằm trong tập: HITL/reconcile có thể resume
# và SSE cần buffer để stream tiếp — retention sẽ dọn record interrupted cũ.
_CLEAR_BUFFER_STATUSES = ("done", "error", "timeout", "cancelled")


def _data_dir() -> Path:
    base = (os.environ.get("DATA_DIR") or "").strip()
    if base:
        return Path(base)
    from shared.paths import BE_ROOT
    return BE_ROOT


def db_path() -> Path:
    # Phase 5: JOBS_DB_PATH lets web + RQ worker share ONE jobs.sqlite on a mounted
    # volume (e.g. /app/memory/jobs.sqlite). Unset -> legacy DATA_DIR path (dev/tests).
    override = (os.environ.get("JOBS_DB_PATH") or "").strip()
    if override:
        return Path(override)
    return _data_dir() / "jobs.sqlite"


def get_conn() -> sqlite3.Connection:
    p = db_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(p), check_same_thread=False, timeout=5.0)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    # busy_timeout: tolerate cross-process/-container writers on the shared DB.
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _ensure_job_columns(conn: sqlite3.Connection) -> None:
    cur = conn.execute("PRAGMA table_info(jobs)")
    cols = {row[1] for row in cur.fetchall()}
    if "token_buffer" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN token_buffer TEXT DEFAULT ''")
    if "cancel_requested" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN cancel_requested INT DEFAULT 0")
    # Auth Hardening Phase A: owner column, nullable (unenforced this phase).
    if "user_id" not in cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN user_id TEXT")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id)")
    additive = {
        "map_id": "TEXT",
        "result_map_id": "TEXT",
        "idempotency_key": "TEXT",
        "request_fingerprint": "TEXT",
        "source_ids_json": "TEXT",
        "guided_config_json": "TEXT",
        "stage": "TEXT",
        "attempts": "INT DEFAULT 0",
        "started_at": "TEXT",
        "completed_at": "TEXT",
        "lease_owner": "TEXT",
        "lease_expires_at": "TEXT",
        "error_code": "TEXT",
    }
    for name, definition in additive.items():
        if name not in cols:
            conn.execute(f"ALTER TABLE jobs ADD COLUMN {name} {definition}")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_user_idempotency ON jobs(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key <> ''")


def init_db() -> None:
    with _lock:
        conn = get_conn()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    job_id       TEXT PRIMARY KEY,
                    job_type     TEXT,
                    status       TEXT,
                    progress     INT DEFAULT 0,
                    current_node TEXT,
                    created_at   TEXT,
                    updated_at   TEXT,
                    result_json  TEXT,
                    error_text   TEXT
                );
                """
            )
            _ensure_job_columns(conn)
            conn.commit()
        finally:
            conn.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_job(job_id: str, job_type: str, status: str = "pending", progress: int = 0, current_node: str = "", user_id: Optional[str] = None, **metadata: Any) -> None:
    init_db()
    with _lock:
        conn = get_conn()
        try:
            columns = ["job_id", "job_type", "status", "progress", "current_node", "created_at", "updated_at", "user_id"]
            values: list[Any] = [job_id, job_type, status, int(progress), current_node, _now(), _now(), user_id]
            allowed = ("map_id", "result_map_id", "idempotency_key", "request_fingerprint", "source_ids_json", "guided_config_json", "stage", "attempts", "started_at", "completed_at", "lease_owner", "lease_expires_at", "error_code")
            for key in allowed:
                if key in metadata:
                    columns.append(key)
                    values.append(metadata[key])
            placeholders = ",".join("?" for _ in columns)
            conn.execute(f"INSERT OR IGNORE INTO jobs({','.join(columns)}) VALUES({placeholders})", values)
            conn.commit()
        finally:
            conn.close()


def update_job(job_id: str, **kwargs: Any) -> None:
    """
    Atomic update.
    Allowed keys: job_type, status, progress, current_node, result_json/result(dict), error_text
    """
    if not kwargs:
        return
    init_db()

    if kwargs.get("status") == "error":
        et = kwargs.get("error_text")
        if et is None or (isinstance(et, str) and not et.strip()):
            kwargs["error_text"] = "Lỗi job không có chi tiết (server)."

    fields: list[str] = []
    values: list[Any] = []

    if "result" in kwargs and "result_json" not in kwargs:
        kwargs["result_json"] = json.dumps(kwargs.pop("result"), ensure_ascii=False)

    # Terminal (trừ interrupted — có thể resume): xóa token_buffer TRONG CÙNG UPDATE
    # với status/result (atomic — buffer không bao giờ mất trước khi result được lưu).
    # SSE an toàn: FE lấy answer cuối từ result của status event, token chỉ là preview.
    if kwargs.get("status") in _CLEAR_BUFFER_STATUSES and "token_buffer" not in kwargs:
        kwargs["token_buffer"] = ""

    for k in ("job_type", "status", "progress", "current_node", "result_json", "error_text", "token_buffer", "map_id", "result_map_id", "idempotency_key", "request_fingerprint", "source_ids_json", "guided_config_json", "stage", "attempts", "started_at", "completed_at", "lease_owner", "lease_expires_at", "error_code"):
        if k in kwargs:
            fields.append(f"{k}=?")
            values.append(kwargs[k])

    fields.append("updated_at=?")
    values.append(_now())

    values.append(job_id)

    with _lock:
        conn = get_conn()
        try:
            conn.execute(f"UPDATE jobs SET {', '.join(fields)} WHERE job_id=?", values)
            conn.commit()
        finally:
            conn.close()


def get_job(job_id: str) -> Optional[dict]:
    init_db()
    with _lock:
        conn = get_conn()
        try:
            cur = conn.execute(
                "SELECT job_id, job_type, status, progress, current_node, created_at, updated_at, result_json, error_text, token_buffer, cancel_requested, user_id, map_id, result_map_id, idempotency_key, request_fingerprint, source_ids_json, guided_config_json, stage, attempts, started_at, completed_at, lease_owner, lease_expires_at, error_code FROM jobs WHERE job_id=?",
                (job_id,),
            )
            row = cur.fetchone()
            if not row:
                return None
            result_val = None
            if row[7]:
                try:
                    result_val = json.loads(row[7])
                except Exception:
                    result_val = None
            job = {
                "job_id": row[0],
                "job_type": row[1],
                "status": row[2],
                "progress": row[3],
                "current_node": row[4],
                "created_at": row[5],
                "updated_at": row[6],
                "result": result_val,
                "error": row[8],
                "token_buffer": row[9] if len(row) > 9 and row[9] is not None else "",
                "cancel_requested": bool(row[10]) if len(row) > 10 and row[10] is not None else False,
                "user_id": row[11] if len(row) > 11 else None,
                "map_id": row[12], "result_map_id": row[13], "idempotency_key": row[14],
                "request_fingerprint": row[15], "source_ids": json.loads(row[16]) if row[16] else [],
                "guided_config": json.loads(row[17]) if row[17] else None, "stage": row[18],
                "attempts": row[19] or 0, "started_at": row[20], "completed_at": row[21],
                "lease_owner": row[22], "lease_expires_at": row[23], "error_code": row[24],
            }
            return job
        finally:
            conn.close()


def get_by_idempotency(user_id: Optional[str], idempotency_key: str) -> Optional[dict]:
    """Return the durable job for one user's key, never another user's job."""
    if not user_id or not idempotency_key:
        return None
    init_db()
    job_id = None
    existing_job_id = None
    with _lock:
        conn = get_conn()
        try:
            row = conn.execute("SELECT job_id FROM jobs WHERE user_id=? AND idempotency_key=?", (user_id, idempotency_key)).fetchone()
            job_id = row[0] if row else None
        finally:
            conn.close()
    return get_job(job_id) if job_id else None


def create_idempotent_job(job_id: str, *, user_id: str, idempotency_key: str, request_fingerprint: str, job_type: str = "mindmap", **metadata: Any) -> tuple[str, dict]:
    """Atomically create or retrieve a user's idempotent job.

    Returns (created|existing|conflict, durable row). SQLite's unique partial
    index is the cross-process lock; callers must compare the fingerprint for a
    same-key/different-payload 409.
    """
    init_db()
    existing_job_id = None
    return_outcome = None
    with _lock:
        conn = get_conn()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT job_id, request_fingerprint FROM jobs WHERE user_id=? AND idempotency_key=?", (user_id, idempotency_key)).fetchone()
            if row:
                conn.commit()
                existing_job_id = row[0]
                outcome = "existing" if row[1] == request_fingerprint else "conflict"
                # Read the full row after releasing the store lock below.
                return_outcome = outcome
            else:
                return_outcome = None
            if return_outcome:
                pass
            else:
                columns = ["job_id", "job_type", "status", "progress", "current_node", "created_at", "updated_at", "user_id", "idempotency_key", "request_fingerprint"]
                values: list[Any] = [job_id, job_type, "pending", 0, "Queued", _now(), _now(), user_id, idempotency_key, request_fingerprint]
                for key in ("map_id", "source_ids_json", "guided_config_json", "stage", "attempts", "lease_expires_at"):
                    if key in metadata:
                        columns.append(key); values.append(metadata[key])
                conn.execute(f"INSERT INTO jobs({','.join(columns)}) VALUES({','.join('?' for _ in columns)})", values)
                conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
    if existing_job_id:
        return return_outcome, get_job(existing_job_id)
    return "created", get_job(job_id)


def claim_job(job_id: str, lease_owner: str, lease_seconds: int = 900) -> bool:
    """Atomically claim a queued job or an expired running lease."""
    init_db()
    now = datetime.now(timezone.utc)
    expires = (now + timedelta(seconds=max(1, lease_seconds))).isoformat()
    with _lock:
        conn = get_conn()
        try:
            cur = conn.execute(
                """UPDATE jobs SET status='running', stage=COALESCE(stage,'retrieving'),
                   attempts=COALESCE(attempts,0)+1, started_at=COALESCE(started_at,?),
                   lease_owner=?, lease_expires_at=?, updated_at=?
                   WHERE job_id=? AND (status IN ('pending','queued','interrupted')
                     OR (status='running' AND (lease_expires_at IS NULL OR lease_expires_at < ?)))""",
                (now.isoformat(), lease_owner, expires, now.isoformat(), job_id, now.isoformat()),
            )
            conn.commit()
            return cur.rowcount == 1
        finally:
            conn.close()


def recover_expired_jobs() -> int:
    """Make expired Guided jobs claimable without losing their durable request."""
    init_db()
    now = _now()
    with _lock:
        conn = get_conn()
        try:
            cur = conn.execute("UPDATE jobs SET status='pending', stage='queued', lease_owner=NULL, lease_expires_at=NULL, updated_at=? WHERE job_type='mindmap' AND status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?", (now, now))
            conn.commit()
            return max(cur.rowcount, 0)
        finally:
            conn.close()


def list_recoverable_mindmap_jobs() -> list[dict[str, Any]]:
    """Return queued/expired Guided requests without document content."""
    init_db()
    with _lock:
        conn = get_conn()
        try:
            rows = conn.execute("SELECT job_id, user_id, source_ids_json, guided_config_json, status FROM jobs WHERE job_type='mindmap' AND status IN ('pending','queued') AND source_ids_json IS NOT NULL").fetchall()
            return [{"job_id": r[0], "user_id": r[1], "source_ids": json.loads(r[2] or "[]"), "guided_config": json.loads(r[3] or "{}"), "status": r[4]} for r in rows]
        finally:
            conn.close()


def request_cancel(job_id: str) -> None:
    """Cancel hợp tác: set cờ cho executor đang sống ack giữa các node. Job KHÔNG còn
    executor (pending trong queue, hoặc interrupted sau restart) chuyển THẲNG sang
    'cancelled' — không ai ack cờ, FE sẽ poll vô hạn ("Đang huỷ…" kẹt mãi).
    Trạng thái terminal (done/error/cancelled) giữ nguyên → idempotent, cancel job đã
    xong là no-op an toàn."""
    init_db()
    with _lock:
        conn = get_conn()
        try:
            conn.execute(
                """
                UPDATE jobs SET cancel_requested=1,
                       token_buffer = CASE WHEN status IN ('pending','interrupted')
                                     THEN '' ELSE token_buffer END,
                       status = CASE WHEN status IN ('pending','interrupted')
                                     THEN 'cancelled' ELSE status END,
                       current_node = CASE WHEN status IN ('pending','interrupted')
                                     THEN 'Cancelled' ELSE current_node END,
                       updated_at=?
                WHERE job_id=?
                """,
                (_now(), job_id),
            )
            conn.commit()
        finally:
            conn.close()


def is_cancel_requested(job_id: str) -> bool:
    init_db()
    with _lock:
        conn = get_conn()
        try:
            cur = conn.execute(
                "SELECT cancel_requested FROM jobs WHERE job_id=?",
                (job_id,),
            )
            row = cur.fetchone()
            if not row or row[0] is None:
                return False
            return bool(row[0])
        finally:
            conn.close()


def clear_token_buffer(job_id: str) -> None:
    """Xóa buffer streaming trước khi chạy query job mới."""
    init_db()
    with _lock:
        conn = get_conn()
        try:
            conn.execute(
                "UPDATE jobs SET token_buffer='', updated_at=? WHERE job_id=?",
                (_now(), job_id),
            )
            conn.commit()
        finally:
            conn.close()


def append_token(job_id: str, token: str) -> None:
    """Gắn thêm token vào buffer (SSE đọc incremental)."""
    if token is None:
        return
    s = str(token)
    if not s:
        return
    init_db()
    with _lock:
        conn = get_conn()
        try:
            conn.execute(
                """
                UPDATE jobs SET token_buffer = COALESCE(token_buffer, '') || ?, updated_at=?
                WHERE job_id=?
                """,
                (s, _now(), job_id),
            )
            conn.commit()
        finally:
            conn.close()


def mark_interrupted_jobs() -> None:
    """
    Khi process bị kill, mark các job đang running/pending sang interrupted.
    (Single-process behaviour. Trong queue mode dùng reconcile_interrupted() ở
    app/jobs/queue.py để KHÔNG mark nhầm job worker còn sống.)
    """
    init_db()
    with _lock:
        conn = get_conn()
        try:
            conn.execute(
                """
                UPDATE jobs
                SET status='interrupted', updated_at=?
                WHERE status IN ('pending','running','processing')
                """,
                (_now(),),
            )
            conn.commit()
        finally:
            conn.close()


def list_active_jobs() -> list[tuple[str, str]]:
    """(job_id, job_type) cho các job chưa terminal — dùng cho reconcile queue-aware."""
    init_db()
    with _lock:
        conn = get_conn()
        try:
            cur = conn.execute(
                "SELECT job_id, job_type FROM jobs WHERE status IN ('pending','running','processing')"
            )
            return [(row[0], row[1]) for row in cur.fetchall()]
        finally:
            conn.close()


def _env_int(name: str, default: int) -> int:
    try:
        return int((os.environ.get(name) or "").strip() or default)
    except ValueError:
        return default


def _delete_checkpoints_for_threads(job_ids: list[str]) -> None:
    """Xóa checkpoint langgraph (thread_id = job_id) của các job đã prune.
    Best-effort: DB/table vắng → bỏ qua. Chỉ đụng thread đã terminal quá hạn
    — không có timestamp trong schema checkpoint nên đây là đường xóa an toàn."""
    if not job_ids:
        return
    p = _data_dir() / "checkpoints.sqlite"
    if not p.is_file():
        return
    try:
        conn = sqlite3.connect(str(p), timeout=5.0)
        conn.execute("PRAGMA busy_timeout=5000")
        try:
            ph = ",".join("?" * len(job_ids))
            for table in ("checkpoints", "writes"):
                try:
                    conn.execute(f"DELETE FROM {table} WHERE thread_id IN ({ph})", job_ids)
                except sqlite3.OperationalError:
                    pass  # table vắng (schema langgraph đổi) → bỏ qua
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass  # cleanup không bao giờ được làm hỏng request path


def cleanup_terminal_jobs(retention_days: Optional[int] = None) -> int:
    """Prune job TERMINAL cũ hơn retention (default env JOB_RETENTION_DAYS=7) +
    checkpoint của chúng. Chỉ đụng terminal — running/pending giữ nguyên dù cũ.
    Idempotent, fail-open (lỗi → 0). retention_days <= 0 → tắt."""
    days = retention_days if retention_days is not None else _env_int("JOB_RETENTION_DAYS", 7)
    if days <= 0:
        return 0
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    try:
        init_db()
        with _lock:
            conn = get_conn()
            try:
                ph = ",".join("?" * len(TERMINAL_STATUSES))
                cur = conn.execute(
                    f"SELECT job_id FROM jobs WHERE status IN ({ph}) AND updated_at < ?",
                    (*TERMINAL_STATUSES, cutoff),
                )
                ids = [row[0] for row in cur.fetchall()]
                if ids:
                    idph = ",".join("?" * len(ids))
                    conn.execute(f"DELETE FROM jobs WHERE job_id IN ({idph})", ids)
                    conn.commit()
            finally:
                conn.close()
        _delete_checkpoints_for_threads(ids)
        return len(ids)
    except Exception:
        return 0


def touch_job(job_id: str) -> None:
    """Chạm `updated_at` mà KHÔNG đổi gì khác — nhịp tim cho bước dài không có tiến
    trình để báo (`sweep_stuck_jobs` đo đúng cột này).

    Không dùng `update_job(job_id, progress=...)` thay: báo một con số tiến trình không
    có thật để giữ job sống là nói dối đúng chỗ người dùng đang nhìn.
    """
    init_db()
    with _lock:
        conn = get_conn()
        try:
            conn.execute("UPDATE jobs SET updated_at=? WHERE job_id=?", (_now(), job_id))
            conn.commit()
        finally:
            conn.close()


def sweep_stuck_jobs(stuck_after_seconds: Optional[int] = None) -> int:
    """Job running/processing không heartbeat (updated_at — mọi update_job/append_token
    đều chạm) quá ngưỡng (default env JOB_STUCK_AFTER_SECONDS=900) → 'interrupted'.
    Pending KHÔNG bị đụng (job queue có thể chờ lâu hợp lệ — reconcile_interrupted
    lo orphan pending lúc startup). Idempotent; executor còn sống ghi done/error
    sau đó vẫn thắng (update_job ghi đè). <= 0 → tắt."""
    secs = stuck_after_seconds if stuck_after_seconds is not None else _env_int("JOB_STUCK_AFTER_SECONDS", 900)
    if secs <= 0:
        return 0
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=secs)).isoformat()
    try:
        init_db()
        with _lock:
            conn = get_conn()
            try:
                cur = conn.execute(
                    """
                    UPDATE jobs SET status='interrupted', current_node='StuckSweep', updated_at=?
                    WHERE status IN ('running','processing') AND updated_at < ?
                    """,
                    (_now(), cutoff),
                )
                conn.commit()
                return max(cur.rowcount, 0)
            finally:
                conn.close()
    except Exception:
        return 0


def migrate_from_dict(jobs_dict: dict, job_type: str = "ingest") -> None:
    """
    Chạy 1 lần khi startup để migrate jobs{} cũ sang SQLite (idempotent).
    jobs_dict shape có thể khác nhau; ta chỉ map các trường chung.
    """
    if not isinstance(jobs_dict, dict) or not jobs_dict:
        init_db()
        return

    init_db()
    for jid, j in list(jobs_dict.items()):
        try:
            status = (j or {}).get("status") or "pending"
            progress = int((j or {}).get("progress") or 0)
            current_node = (j or {}).get("current_node") or ""
            result = (j or {}).get("result")
            err = (j or {}).get("error")
            create_job(jid, job_type=job_type, status=status, progress=progress, current_node=current_node)
            update_job(jid, result=result, error_text=err)
        except Exception:
            # best-effort migrate; không crash app
            continue

