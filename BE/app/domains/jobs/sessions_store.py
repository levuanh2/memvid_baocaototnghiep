from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Optional


_LOCK = threading.Lock()


def _db_path() -> Path:
    from shared.paths import BE_ROOT
    data_root = Path(os.environ.get("DATA_DIR", str(BE_ROOT)))
    return data_root / "sessions.sqlite"


def init_db() -> None:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK:
        con = sqlite3.connect(str(path), check_same_thread=False)
        try:
            con.execute("PRAGMA journal_mode=WAL;")
            con.execute("PRAGMA synchronous=NORMAL;")
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    updated_at REAL NOT NULL,
                    history_json TEXT NOT NULL,
                    user_id TEXT
                )
                """
            )
            # DB đã có từ trước thì CREATE TABLE IF NOT EXISTS bỏ qua cả cột mới —
            # phải thêm tay. Idempotent: chỉ ALTER khi cột chưa có.
            cols = {r[1] for r in con.execute("PRAGMA table_info(sessions)")}
            if "user_id" not in cols:
                con.execute("ALTER TABLE sessions ADD COLUMN user_id TEXT")
            con.commit()
        finally:
            con.close()


def _cleanup_expired(con: sqlite3.Connection) -> None:
    ttl_h = int(os.environ.get("SESSION_TTL_HOURS", "24"))
    if ttl_h <= 0:
        return
    cutoff = time.time() - ttl_h * 3600
    con.execute("DELETE FROM sessions WHERE updated_at < ?", (cutoff,))


def _dung_chu(row_owner: Optional[str], user_id: Optional[str]) -> bool:
    """Hàng này có thuộc về người đang hỏi không.

    `session_id` là `uuid4()` server sinh nên không dò được, nhưng nó KHÔNG phải thứ
    bí mật: nó đi qua body request, localStorage, log proxy. Biết id của người khác
    là đọc/ghi được phiên của họ, vì bảng này chưa từng biết ai là chủ.

    Hàng cũ (chủ NULL, ghi trước khi có cột) chỉ khớp với lời gọi cũng không có chủ —
    tức chế độ mở, khi không có người dùng nào để tách. Coi NULL là "của mọi người"
    thì rò vẫn nguyên với đúng những hàng đang tồn tại. TTL 24h
    (`SESSION_TTL_HOURS`) dọn hết chúng trong một ngày.
    """
    return (row_owner or None) == (user_id or None)


def get_history(session_id: str, *, limit_messages: int = 8,
                user_id: Optional[str] = None) -> list[dict[str, str]]:
    if not session_id:
        return []
    init_db()
    path = _db_path()
    with _LOCK:
        con = sqlite3.connect(str(path), check_same_thread=False)
        try:
            _cleanup_expired(con)
            row = con.execute(
                "SELECT history_json, user_id FROM sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            if not row or not _dung_chu(row[1], user_id):
                return []
            raw = row[0] or "[]"
            try:
                hist = json.loads(raw)
            except Exception:
                return []
            if not isinstance(hist, list):
                return []
            # Keep only last N messages (role/content dicts)
            out: list[dict[str, str]] = []
            for item in hist[-limit_messages:]:
                if not isinstance(item, dict):
                    continue
                role = str(item.get("role") or "").strip()
                content = str(item.get("content") or "").strip()
                if role and content:
                    out.append({"role": role, "content": content})
            return out
        finally:
            con.commit()
            con.close()


def append_messages(session_id: str, messages: list[dict[str, str]],
                    *, user_id: Optional[str] = None) -> None:
    if not session_id:
        return
    if not messages:
        return
    init_db()
    path = _db_path()
    now = time.time()

    with _LOCK:
        con = sqlite3.connect(str(path), check_same_thread=False)
        try:
            _cleanup_expired(con)
            row = con.execute(
                "SELECT history_json, user_id FROM sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            if row:
                # Chiều GHI cũng phải kiểm chủ: hỏi trên phiên của người khác thì câu
                # của mình không được nằm trong lịch sử của họ, nếu không lượt sau của
                # họ mang theo ngữ cảnh của người lạ.
                if not _dung_chu(row[1], user_id):
                    return
                try:
                    hist = json.loads(row[0] or "[]")
                except Exception:
                    hist = []
            else:
                hist = []

            if not isinstance(hist, list):
                hist = []

            for m in messages:
                if not isinstance(m, dict):
                    continue
                role = str(m.get("role") or "").strip()
                content = str(m.get("content") or "").strip()
                if role and content:
                    hist.append({"role": role, "content": content})

            # cap history to avoid unlimited growth
            cap = int(os.environ.get("SESSION_MAX_MESSAGES", "80"))
            if cap > 0 and len(hist) > cap:
                hist = hist[-cap:]

            con.execute(
                """
                INSERT INTO sessions(session_id, updated_at, history_json, user_id)
                VALUES(?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    updated_at=excluded.updated_at,
                    history_json=excluded.history_json
                """,
                (session_id, now, json.dumps(hist, ensure_ascii=False), user_id or None),
            )
            con.commit()
        finally:
            con.close()

