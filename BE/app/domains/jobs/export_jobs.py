"""Mindmap document-export job support (Section 7/8 of the Export Studio
round). Reuses jobs_store.py's existing SQLite ledger as-is (job_type=
EXPORT_JOB_TYPE) rather than inventing a parallel store — same idempotency,
lease/claim, cancel, stuck-sweep and retention machinery every other job
type already gets. What's new here is specific to a job that produces a
DOWNLOADABLE FILE, which no existing job type does:

- a durable output directory (mirrors mindmap_store.py's own MEMORY_DIR
  resolution exactly, so it lands under the SAME bind-mounted
  /app/memory on the real AWS production container docker-compose.prod.yml
  defines — see .playbook/known-issues.md's Section 7 audit entry for why
  DATA_DIR alone can't be trusted and MEMORY_DIR is the durable one),
- files are named by job_id (server-generated UUID, never client input) —
  path traversal is structurally impossible, not just filtered,
- a short-lived HMAC-signed download token (itsdangerous, the SAME
  AUTH_SECRET + serializer pattern app/domains/auth/tokens.py already uses
  for bearer tokens, with its own salt so the two token namespaces can never
  be confused with each other),
- companion file cleanup alongside the existing DB-row cleanup
  (cleanup_terminal_jobs() only prunes rows — see the Section 7 audit note
  on why that alone would leak files forever).
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Optional

from itsdangerous import BadData, SignatureExpired, URLSafeTimedSerializer
from werkzeug.utils import secure_filename

from app.domains.jobs import jobs_store

EXPORT_JOB_TYPE = "mindmap_export"
DOWNLOAD_TOKEN_SALT = "mv-export-download-v1"
DOWNLOAD_TOKEN_TTL_SEC = 300  # short-lived: a fresh token is requested per download, not cached client-side

EXT_FOR_FORMAT = {"docx": "docx", "xlsx": "xlsx", "pdf": "pdf"}


def export_output_dir() -> Path:
    """Same MEMORY_DIR resolution as app.domains.mindmap.store.db_path() —
    deliberately identical env var and fallback, so this lands on the same
    durable volume without needing any new deploy config."""
    memory_dir = (os.environ.get("MEMORY_DIR") or "").strip()
    if memory_dir:
        base = Path(memory_dir)
    else:
        from shared.paths import BE_ROOT
        base = BE_ROOT / "memory"
    out = base / "exports"
    out.mkdir(parents=True, exist_ok=True)
    return out


def output_path_for(job_id: str, fmt: str) -> Path:
    ext = EXT_FOR_FORMAT.get(fmt)
    if not ext:
        raise ValueError(f"unsupported export format: {fmt!r}")
    # job_id is always a server-generated uuid4 hex — never derived from
    # request input — so this path can never escape export_output_dir().
    return export_output_dir() / f"{job_id}.{ext}"


def display_filename(title: str, fmt: str) -> str:
    ext = EXT_FOR_FORMAT.get(fmt, fmt)
    base = secure_filename(title or "mindmap") or "mindmap"
    return f"{base}.{ext}"


def _serializer() -> URLSafeTimedSerializer:
    from app.domains.auth.tokens import _get_secret  # reuse the SAME secret resolution (incl. AUTH_REQUIRE_SECRET fail-closed behavior)
    return URLSafeTimedSerializer(_get_secret(), salt=DOWNLOAD_TOKEN_SALT)


def make_download_token(job_id: str, user_id: Optional[str]) -> str:
    return _serializer().dumps({"job_id": job_id, "uid": user_id})


def read_download_token(token: str) -> Optional[dict]:
    """Returns {"job_id", "uid"} or None if missing/tampered/expired."""
    if not token:
        return None
    try:
        data = _serializer().loads(token, max_age=DOWNLOAD_TOKEN_TTL_SEC)
    except (SignatureExpired, BadData):
        return None
    except Exception:  # noqa: BLE001 — any decode failure is a denied download, never a 500
        return None
    if not isinstance(data, dict) or "job_id" not in data:
        return None
    return data


def new_job_id() -> str:
    return str(uuid.uuid4())


def delete_output_file(job_id: str) -> None:
    """Best-effort: remove whichever extension this job produced, if any.
    Safe to call even if the job never got as far as writing a file."""
    for ext in set(EXT_FOR_FORMAT.values()):
        p = export_output_dir() / f"{job_id}.{ext}"
        try:
            if p.is_file():
                p.unlink()
        except OSError:
            pass  # cleanup must never be the thing that breaks a request path


def cleanup_terminal_export_files(retention_days: Optional[int] = None) -> int:
    """Companion to jobs_store.cleanup_terminal_jobs(): that function deletes
    old TERMINAL job ROWS but has no idea any of them produced a FILE, so it
    never removes one — called this out explicitly in the Section 7 audit.
    This walks the export directory and deletes any file whose job_id is no
    longer a live row in jobs_store at all (already pruned there), which is
    always safe: a row's absence means jobs_store already decided this job
    is old enough to forget, and an export output file has no reason to
    outlive the job record that produced it."""
    out_dir = export_output_dir()
    removed = 0
    try:
        entries = list(out_dir.iterdir())
    except OSError:
        return 0
    for entry in entries:
        if not entry.is_file():
            continue
        job_id = entry.stem
        if jobs_store.get_job(job_id) is None:
            try:
                entry.unlink()
                removed += 1
            except OSError:
                pass
    return removed
