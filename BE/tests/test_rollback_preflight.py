"""`scripts.rollback_preflight`: the read-only facts `scripts/rollback.sh` decides on.

One exact line on success; a non-zero exit (and no such line) when the database cannot
be read, so the rollback refuses instead of guessing. No password is ever printed.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from tests.test_review_item_archive_guard import _archived
from tests.test_review_plan_archive import (  # noqa: F401  (fixtures)
    _need_db, _protect, be, owner, planned)

BE_ROOT = Path(__file__).resolve().parents[1]
LINE = re.compile(r"^archive_schema=([01]) archived_topics=(\d+) guard=([01])$", re.M)


def _preflight(url=None):
    env = {k: v for k, v in os.environ.items() if k != "ALEMBIC_ALLOW_PRODUCTION"}
    env.update({"PYTHONUTF8": "1", "SKIP_DOTENV": "1"})
    if url:
        env["TEST_DATABASE_URL"] = url
    return subprocess.run([sys.executable, "-m", "scripts.rollback_preflight",
                           "--moi-truong", "test"], cwd=BE_ROOT, env=env, capture_output=True,
                          text=True, encoding="utf-8", errors="replace", timeout=120)


def test_it_reports_the_archive_schema_the_guard_and_the_archived_count(client, planned,
                                                                       monkeypatch):
    before = _preflight()
    assert before.returncode == 0, before.stderr
    m = LINE.search(before.stdout)
    assert m and m.group(1) == "1" and m.group(3) == "1", before.stdout
    _archived(client, planned, monkeypatch)
    after = LINE.search(_preflight().stdout)
    assert int(after.group(2)) == int(m.group(2)) + 1


def test_an_unreachable_database_fails_closed_without_the_password():
    parts = urlsplit(os.environ["TEST_DATABASE_URL"])
    netloc = parts.netloc.rsplit("@", 1)
    dead = urlunsplit(parts._replace(netloc=f"{netloc[0]}@127.0.0.1:1"))
    r = _preflight(dead)
    assert r.returncode != 0
    assert not LINE.search(r.stdout), "no facts line when nothing was read"
    password = urlsplit(os.environ["TEST_DATABASE_URL"]).password or ""
    assert password and password not in (r.stdout + r.stderr)
