"""A backend started by hand on a developer machine must not reach a hosted database or
bucket by accident (dev/test isolation, 2026-11-17).

Why: the developer's `BE/.env` and root `.env` point the database and Storage at one
Supabase project, possibly the production one (GO/NO-GO item 14). `python -m app.main` or a
local gunicorn then reads and writes real learners' data.

When it refuses (all three):
  1. `PROCESS_ROLE` is not `web` / `mindmap-worker`. `docker-compose.prod.yml` sets it on
     both production services, and the deploy runs migrations with `compose run backend`,
     which inherits it.
  2. A `BE/.env` or root `.env` exists on disk: a source checkout. `BE/.dockerignore`
     keeps `.env` out of the image, so a production container never has one, even if
     `PROCESS_ROLE` were missing. CI has none either.
  3. `DATABASE_URL`, `JOBS_DATABASE_URL` or `SUPABASE_URL` points at a non-local host.
Opt out on purpose, after the owner's fingerprint check says the dev project is not the
production one: `STUDYMAP_ALLOW_REMOTE_TARGETS=1`. pytest has its own guards and is skipped
here. No new production variable. Messages name variables, never values.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Mapping, Optional
from urllib.parse import urlsplit

PRODUCTION_ROLES = frozenset({"web", "mindmap-worker"})
TARGET_VARS = ("DATABASE_URL", "JOBS_DATABASE_URL", "SUPABASE_URL")
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "db", "postgres"})


class RemoteTargetRefused(RuntimeError):
    pass


def refusal(environ: Optional[Mapping[str, str]] = None,
            be_root: Optional[Path] = None) -> Optional[str]:
    """The reason to refuse, or None. Pure: reads only `environ` and the two file paths."""
    env = os.environ if environ is None else environ
    if (env.get("PROCESS_ROLE") or "").strip().lower() in PRODUCTION_ROLES:
        return None
    if (env.get("STUDYMAP_ALLOW_REMOTE_TARGETS") or "").strip().lower() in ("1", "true", "yes", "on"):
        return None
    if be_root is None:
        from shared.paths import BE_ROOT

        be_root = BE_ROOT
    if not ((be_root / ".env").exists() or (be_root.parent / ".env").exists()):
        return None
    remote = []
    for name in TARGET_VARS:
        value = (env.get(name) or "").strip()
        if value and (urlsplit(value).hostname or "").lower() not in LOCAL_HOSTS:
            remote.append(name)
    if not remote:
        return None
    return (f"DỪNG: backend chạy từ bản checkout có .env nhưng {remote} trỏ tới máy chủ "
            "ngoài máy này (có thể là dữ liệu học sinh thật). Trỏ chúng về database/bucket "
            "cục bộ, hoặc đặt STUDYMAP_ALLOW_REMOTE_TARGETS=1 sau khi đã xác minh đó không "
            "phải production (docs/ui-ux-v6/06-release-review.md mục 4e).")


def enforce() -> None:
    """Called by `app.main` right after the env files are loaded."""
    if "pytest" in sys.modules:
        return
    reason = refusal()
    if reason:
        raise RemoteTargetRefused(reason)
