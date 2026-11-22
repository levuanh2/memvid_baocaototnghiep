"""Task63 (Codex P1, then recheck P0): on the Supabase test project, the Storage probe
must never fill a missing variable from `.env` (which may hold production keys), and must
never accept production as the "expected" project. `--strict-env` refuses before any
network call unless all three variables are set explicitly, the URL names --expect-ref,
--deny-ref (production) is given, distinct and absent from every value, and the bucket is
a test-only bucket (`studymap-t63-*`)."""
import os
import subprocess
import sys
from pathlib import Path

import pytest

BE = Path(__file__).resolve().parents[1]
REF = "abcdefghijklmnopqrst"
PROD = "zyxwvutsrqponmlkjihg"


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
REFS = ("--expect-ref", REF, "--deny-ref", PROD)


@pytest.mark.parametrize("missing", sorted(FULL))
def test_strict_env_refuses_a_variable_not_set_explicitly(missing):
    r = _run({k: v for k, v in FULL.items() if k != missing}, *REFS)
    assert r.returncode == 2, r.stdout + r.stderr
    assert "sb_secret_x" not in r.stdout + r.stderr


def test_strict_env_refuses_an_empty_variable():
    assert _run(dict(FULL, SUPABASE_STORAGE_BUCKET=""), *REFS).returncode == 2


@pytest.mark.parametrize("url", [f"https://{PROD}.supabase.co",
                                 f"https://{REF}.supabase.co.evil.com", f"http://{REF}.supabase.co"])
def test_strict_env_refuses_another_project(url):
    assert _run(dict(FULL, SUPABASE_URL=url), *REFS).returncode == 2


def test_strict_env_requires_an_expected_ref():
    assert _run(FULL, "--deny-ref", PROD).returncode == 2


def test_production_passed_as_the_expected_project_is_refused():
    prod = {"SUPABASE_URL": f"https://{PROD}.supabase.co", "SUPABASE_SECRET_KEY": "sb_secret_x",
            "SUPABASE_STORAGE_BUCKET": "documents"}
    assert _run(prod, "--expect-ref", PROD).returncode == 2                   # no --deny-ref
    assert _run(prod, "--expect-ref", PROD, "--deny-ref", PROD).returncode == 2


def test_the_denied_ref_in_any_storage_variable_is_refused():
    r = _run(dict(FULL, SUPABASE_SECRET_KEY=f"key-for-{PROD}"), *REFS)
    assert r.returncode == 2 and PROD not in r.stdout + r.stderr


@pytest.mark.parametrize("bucket", ["documents", "studymap", "t63-test", "studymap-t63-"])
def test_only_a_test_bucket_is_accepted(bucket):
    assert _run(dict(FULL, SUPABASE_STORAGE_BUCKET=bucket), *REFS).returncode == 2


def test_a_complete_test_identity_passes_the_preflight():
    # The preflight passes; the probe then fails to reach the made-up host, which is not 2.
    r = _run(FULL, *REFS)
    assert r.returncode != 2, r.stderr
