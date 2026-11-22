"""Task63 (Codex P1): on the Supabase test project, the Storage probe must never fill a
missing variable from `.env` (which may hold production keys). `--strict-env` refuses
before any network call unless all three are set explicitly and name the test project."""
import os
import subprocess
import sys
from pathlib import Path

import pytest

BE = Path(__file__).resolve().parents[1]
REF = "abcdefghijklmnopqrst"


def _run(env_over, *args):
    env = {k: v for k, v in os.environ.items()
           if k not in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_STORAGE_BUCKET")}
    env.update(env_over, PYTHONIOENCODING="utf-8")
    r = subprocess.run([sys.executable, "-m", "scripts.verify_supabase_storage", "--ci",
                        "--strict-env", *args], cwd=BE, env=env, capture_output=True,
                       text=True, encoding="utf-8", timeout=60)
    # exit 2 alone could be argparse rejecting an unknown flag: require the refusal itself
    assert "unrecognized arguments" not in r.stderr, r.stderr
    if r.returncode == 2:
        assert "DỪNG (strict-env)" in r.stderr, r.stderr
    return r


FULL = {"SUPABASE_URL": f"https://{REF}.supabase.co", "SUPABASE_SECRET_KEY": "sb_secret_x",
        "SUPABASE_STORAGE_BUCKET": "studymap-t63-test"}


@pytest.mark.parametrize("missing", sorted(FULL))
def test_strict_env_refuses_a_variable_not_set_explicitly(missing):
    r = _run({k: v for k, v in FULL.items() if k != missing}, "--expect-ref", REF)
    assert r.returncode == 2, r.stdout + r.stderr
    assert "sb_secret_x" not in r.stdout + r.stderr


def test_strict_env_refuses_an_empty_variable():
    r = _run(dict(FULL, SUPABASE_STORAGE_BUCKET=""), "--expect-ref", REF)
    assert r.returncode == 2


@pytest.mark.parametrize("url", ["https://zyxwvutsrqponmlkjihg.supabase.co",
                                 f"https://{REF}.supabase.co.evil.com", f"http://{REF}.supabase.co"])
def test_strict_env_refuses_another_project(url):
    r = _run(dict(FULL, SUPABASE_URL=url), "--expect-ref", REF)
    assert r.returncode == 2


def test_strict_env_requires_an_expected_ref():
    assert _run(FULL).returncode == 2
