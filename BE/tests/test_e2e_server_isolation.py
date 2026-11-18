"""Each start of the E2E server (BE/scripts/run_e2e_server.py) gets its own empty stores.

Issue 19 (#159, 2026-11-17): the server did not set MEMORY_DIR, so the mind map and
summary SQLite stores fell back to BE/memory/ inside the checkout. A second local
Playwright run saw the first run's maps and the "zero maps" spec failed (CI starts from
a fresh checkout and never noticed). A MEMORY_DIR or *_DB_PATH left in the shell (or in
a developer's .env) could also point the E2E server at real data.

The server sets its environment at import time, before importing the app, so each check
runs in a fresh interpreter. Nothing here starts the server or touches a database.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

BE = Path(__file__).resolve().parents[1]

_PROBE = r"""
import json, os, sys
sys.path.insert(0, os.getcwd())
import importlib.util
spec = importlib.util.spec_from_file_location("e2e_server", "scripts/run_e2e_server.py")
spec.loader.exec_module(importlib.util.module_from_spec(spec))
from app.domains.mindmap import store as mindmap_store
from app.domains.summary import store as summary_store
from app.domains.jobs import export_jobs
print(json.dumps({
    "data_dir": os.environ["DATA_DIR"],
    "env": {k: os.environ.get(k) for k in (
        "MEMORY_DIR", "INDEX_DIR", "MD_DIR", "INPUT_DOCS_DIR", "MINDMAPS_DB_PATH",
        "SUMMARIES_DB_PATH", "CONVERSATIONS_DB_PATH", "JOBS_DB_PATH", "LOG_DB_PATH",
        "USAGE_DB_PATH")},
    "mindmaps": str(mindmap_store.db_path()),
    "summaries": str(summary_store.db_path()),
    "exports": str(export_jobs.EXPORT_OUTPUT_DIR) if hasattr(export_jobs, "EXPORT_OUTPUT_DIR") else None,
}))
"""


def _start(tmp_path, **env):
    """What one E2E server start resolves, in its own interpreter."""
    clean = {k: v for k, v in os.environ.items()
             if k not in ("DATA_DIR", "MEMORY_DIR", "INDEX_DIR", "MD_DIR", "INPUT_DOCS_DIR",
                          "MINDMAPS_DB_PATH", "SUMMARIES_DB_PATH", "CONVERSATIONS_DB_PATH",
                          "JOBS_DB_PATH", "LOG_DB_PATH", "USAGE_DB_PATH")}
    clean.update({"SKIP_DOTENV": "1", "PYTHONUTF8": "1", "TMPDIR": str(tmp_path),
                  "TEMP": str(tmp_path), "TMP": str(tmp_path), **env})
    out = subprocess.run([sys.executable, "-c", _PROBE], cwd=BE, env=clean,
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-2000:]
    return json.loads(out.stdout.strip().splitlines()[-1])


def _inside(path, root):
    return Path(path).resolve().is_relative_to(Path(root).resolve())


def test_the_map_and_summary_stores_live_in_the_servers_own_directory(tmp_path):
    s = _start(tmp_path)
    for store in ("mindmaps", "summaries"):
        assert _inside(s[store], s["data_dir"]), (store, s[store])
        assert not _inside(s[store], BE / "memory"), (store, s[store])
    for name in ("MEMORY_DIR", "INDEX_DIR", "MD_DIR", "INPUT_DOCS_DIR"):
        assert _inside(s["env"][name], s["data_dir"]), (name, s["env"][name])


def test_two_starts_never_share_a_directory(tmp_path):
    first, second = _start(tmp_path), _start(tmp_path)
    assert first["data_dir"] != second["data_dir"]
    assert first["mindmaps"] != second["mindmaps"]
    assert not Path(second["mindmaps"]).exists(), "the second start found an existing store"


def test_a_given_data_dir_is_a_parent_never_reused_as_is(tmp_path):
    parent = tmp_path / "e2e-data"
    parent.mkdir()
    first = _start(tmp_path, DATA_DIR=str(parent))
    second = _start(tmp_path, DATA_DIR=str(parent))
    assert _inside(first["data_dir"], parent) and _inside(second["data_dir"], parent)
    assert first["data_dir"] != second["data_dir"] != str(parent)


def test_paths_left_in_the_shell_cannot_point_the_server_at_real_data(tmp_path):
    real = tmp_path / "real-memory"
    real.mkdir()
    s = _start(tmp_path, MEMORY_DIR=str(real), MINDMAPS_DB_PATH=str(real / "mindmaps.sqlite"),
               SUMMARIES_DB_PATH=str(real / "summaries.sqlite"),
               CONVERSATIONS_DB_PATH=str(real / "conversations.sqlite"),
               JOBS_DB_PATH=str(real / "jobs.sqlite"), LOG_DB_PATH=str(real / "log.sqlite"),
               USAGE_DB_PATH=str(real / "usage.sqlite"))
    assert not _inside(s["mindmaps"], real) and not _inside(s["summaries"], real)
    assert _inside(s["env"]["MEMORY_DIR"], s["data_dir"])
    for name in ("MINDMAPS_DB_PATH", "SUMMARIES_DB_PATH", "CONVERSATIONS_DB_PATH",
                 "JOBS_DB_PATH", "LOG_DB_PATH", "USAGE_DB_PATH"):
        assert s["env"][name] is None or _inside(s["env"][name], s["data_dir"]), name
    assert list(real.iterdir()) == [], "the server wrote into the shell's directory"


# ── Codex task39: .env and DATABASE_URL ──────────────────────────────────────

_DOTENV_PROBE = r"""
import json, os, sys
from pathlib import Path
sys.path.insert(0, os.getcwd())
import importlib.util
spec = importlib.util.spec_from_file_location("e2e_server", "scripts/run_e2e_server.py")
spec.loader.exec_module(importlib.util.module_from_spec(spec))
# What `app.main` does first (app/main.py: load_project_env(override=False)), with the
# project root pointed at a folder holding a developer's .env.
import shared.paths
shared.paths.BE_ROOT = Path(os.environ["PROBE_FAKE_BE_ROOT"])
from shared.env_loader import load_project_env
load_project_env(override=False)
from app.domains.mindmap import store as mindmap_store
print(json.dumps({"data_dir": os.environ["DATA_DIR"],
                  "mindmaps": str(mindmap_store.db_path()),
                  "jobs_env": os.environ.get("JOBS_DB_PATH"),
                  "gemini": os.environ.get("GEMINI_API_KEY")}))
"""


def test_a_developers_dotenv_cannot_bring_back_real_paths_or_keys(tmp_path):
    """Popping *_DB_PATH and provider keys made them "missing", which is exactly when
    `load_project_env(override=False)` fills them from BE/.env (Codex task39 191-2)."""
    real = tmp_path / "real-memory"
    real.mkdir()
    fake_root = tmp_path / "BE"
    fake_root.mkdir()
    (fake_root / ".env").write_text(
        f"MINDMAPS_DB_PATH={real / 'mindmaps.sqlite'}\n"
        f"JOBS_DB_PATH={real / 'jobs.sqlite'}\n"
        "GEMINI_API_KEY=not-a-real-key\n", encoding="utf-8")
    clean = {k: v for k, v in os.environ.items()
             if k not in ("DATA_DIR", "MEMORY_DIR", "MINDMAPS_DB_PATH", "JOBS_DB_PATH",
                          "GEMINI_API_KEY", "SKIP_DOTENV")}
    clean.update({"PYTHONUTF8": "1", "TMPDIR": str(tmp_path), "TEMP": str(tmp_path),
                  "TMP": str(tmp_path), "PROBE_FAKE_BE_ROOT": str(fake_root)})
    out = subprocess.run([sys.executable, "-c", _DOTENV_PROBE], cwd=BE, env=clean,
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-2000:]
    s = json.loads(out.stdout.strip().splitlines()[-1])
    assert _inside(s["mindmaps"], s["data_dir"]), s["mindmaps"]
    assert s["jobs_env"] is None or _inside(s["jobs_env"], s["data_dir"]), s["jobs_env"]
    assert s["gemini"] is None, "a provider key came back from .env"


def test_a_database_url_that_is_not_a_local_test_database_is_refused(tmp_path):
    """`setdefault` kept whatever DATABASE_URL the shell had; Playwright passes the whole
    environment to the server, so a real database could receive E2E writes (Codex task39
    191-1). The server now stops before any import that could connect."""
    for url in ("postgresql://u:p@db.example.com:5432/studymap_test",
                "postgresql://u:p@127.0.0.1:5432/studymap"):
        clean = {k: v for k, v in os.environ.items() if k != "DATA_DIR"}
        clean.update({"SKIP_DOTENV": "1", "PYTHONUTF8": "1", "TMPDIR": str(tmp_path),
                      "TEMP": str(tmp_path), "TMP": str(tmp_path), "DATABASE_URL": url})
        out = subprocess.run([sys.executable, "-c", _PROBE], cwd=BE, env=clean,
                             capture_output=True, text=True, timeout=120)
        assert out.returncode != 0, url
        assert "refusing DATABASE_URL" in out.stderr, out.stderr[-500:]
        assert "u:p" not in out.stderr, "the password must not be printed"
    ok = _start(tmp_path, DATABASE_URL="postgresql://u:p@127.0.0.1:55432/e2e_run_test")
    assert ok["data_dir"]
