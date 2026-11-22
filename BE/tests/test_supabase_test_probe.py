"""Task63 (Codex BLOCK): the Supabase test-project probe must fail closed.

No network and no database: every case exercises the pure checks that run before any
connection, and the verdict logic that turns probe results into an exit code.
"""
import subprocess
import sys
from pathlib import Path

import pytest

from scripts import supabase_test_probe as probe

REF = "abcdefghijklmnopqrst"        # 20 lowercase letters, the Supabase ref shape
PROD = "zyxwvutsrqponmlkjihg"
HOST = "aws-0-ap-southeast-1.pooler.supabase.com"


def _env(**over):
    env = {
        "OWNER_URL_SESSION": f"postgresql://postgres.{REF}:pw@{HOST}:5432/postgres",
        "OWNER_URL_TRANSACTION": f"postgresql://postgres.{REF}:pw@{HOST}:6543/postgres",
        "APP_URL_SESSION": f"postgresql://studymap_app.{REF}:pw@{HOST}:5432/postgres",
        "APP_URL_TRANSACTION": f"postgresql://studymap_app.{REF}:pw@{HOST}:6543/postgres",
        "READONLY_URL_SESSION": f"postgresql://studymap_readonly.{REF}:pw@{HOST}:5432/postgres",
        "READONLY_URL_TRANSACTION": f"postgresql://studymap_readonly.{REF}:pw@{HOST}:6543/postgres",
        "SUPABASE_URL": f"https://{REF}.supabase.co",
    }
    env.update(over)
    return {k: v for k, v in env.items() if v is not None}


def test_a_well_formed_test_env_passes():
    assert probe.env_problems(_env(), REF, PROD) == []


@pytest.mark.parametrize("expect, deny", [("", PROD), (REF, ""), (REF, REF), ("ABC", PROD),
                                          (REF[:19], PROD)])
def test_refs_must_be_real_distinct_project_refs(expect, deny):
    assert probe.env_problems(_env(), expect, deny)


@pytest.mark.parametrize("key, url", [
    # the test ref only in the password, query or fragment: the user names another project
    ("APP_URL_SESSION", f"postgresql://studymap_app.{PROD}:{REF}@{HOST}:5432/postgres"),
    ("APP_URL_SESSION", f"postgresql://studymap_app.{PROD}:pw@{HOST}:5432/postgres?x={REF}"),
    # wrong role for the key
    ("APP_URL_SESSION", f"postgresql://postgres.{REF}:pw@{HOST}:5432/postgres"),
    ("OWNER_URL_SESSION", f"postgresql://studymap_app.{REF}:pw@{HOST}:5432/postgres"),
    # swapped pooler modes
    ("APP_URL_SESSION", f"postgresql://studymap_app.{REF}:pw@{HOST}:6543/postgres"),
    ("APP_URL_TRANSACTION", f"postgresql://studymap_app.{REF}:pw@{HOST}:5432/postgres"),
    # not the Supabase pooler: custom domain, direct host, IP, look-alike suffix
    ("APP_URL_SESSION", f"postgresql://studymap_app.{REF}:pw@db.example.com:5432/postgres"),
    ("APP_URL_SESSION", f"postgresql://studymap_app.{REF}:pw@db.{REF}.supabase.co:5432/postgres"),
    ("APP_URL_SESSION", f"postgresql://studymap_app.{REF}:pw@10.0.0.5:5432/postgres"),
    ("APP_URL_SESSION", f"postgresql://studymap_app.{REF}:pw@{HOST}.evil.com:5432/postgres"),
    # another database, a query parameter that moves the target
    ("APP_URL_SESSION", f"postgresql://studymap_app.{REF}:pw@{HOST}:5432/other"),
    ("APP_URL_SESSION", f"postgresql://studymap_app.{REF}:pw@{HOST}:5432/postgres?host=prod"),
    # the Data API of another project
    ("SUPABASE_URL", f"https://{PROD}.supabase.co"),
    ("SUPABASE_URL", f"http://{REF}.supabase.co"),
    ("SUPABASE_URL", f"https://{REF}.supabase.co.evil.com"),
])
def test_a_url_that_does_not_structurally_name_the_test_project_is_refused(key, url):
    assert probe.env_problems(_env(**{key: url}), REF, PROD), (key, url)


def test_the_production_ref_anywhere_is_refused():
    env = _env(OWNER_URL_SESSION=f"postgresql://postgres.{REF}:{PROD}@{HOST}:5432/postgres")
    assert probe.env_problems(env, REF, PROD)


def test_an_owner_url_is_always_required():
    assert probe.env_problems(_env(OWNER_URL_SESSION=None), REF, PROD)


@pytest.mark.parametrize("url", [
    f"postgresql://postgres.{REF}:pw@{HOST}:5432/postgres",
    "postgresql://studymap_owner:pw@db.example.com:5432/role_test",
    "postgresql://studymap_owner:pw@127.0.0.1:55500/role",          # not a *_test database
])
def test_local_mode_accepts_only_a_loopback_test_database(url):
    assert probe.local_env_problems({"OWNER_URL_SESSION": url})


def test_local_mode_accepts_a_loopback_test_database():
    assert probe.local_env_problems(
        {"OWNER_URL_SESSION": "postgresql://studymap_owner:pw@127.0.0.1:55500/role_test"}) == []


def test_local_mode_refuses_any_data_api_url():
    assert probe.local_env_problems({
        "OWNER_URL_SESSION": "postgresql://studymap_owner:pw@127.0.0.1:55500/role_test",
        "SUPABASE_URL": f"https://{REF}.supabase.co"})


# ── verdicts: every failure is an exit code, not just a string in the JSON ──────────
def test_any_allowed_denial_fails():
    assert probe.failures({"deny": {"truncate": "refused InsufficientPrivilege sqlstate=42501",
                                    "reindex": "ALLOWED"}})


def test_a_denial_by_another_error_than_42501_fails():
    assert probe.failures({"deny": {"truncate": "refused OperationalError sqlstate=08006"}})


def test_a_phase_exception_or_missing_input_fails():
    assert probe.failures({"inspect": "phase raised OperationalError sqlstate=08006"})
    assert probe.failures({"restapi": {"SUPABASE_SECRET_KEY": "not given"}})


@pytest.mark.parametrize("result", [
    {"status": 200, "rows_returned": 0},
    {"status": 404, "postgrest_code": None},
    {"status": 500, "postgrest_code": None},
    {"status": 429, "postgrest_code": None},
    {"error": "URLError"},
])
def test_only_a_database_denial_counts_as_data_api_refused(result):
    assert probe.failures({"restapi": {"SUPABASE_SECRET_KEY": result}})


@pytest.mark.parametrize("result", [{"status": 401, "postgrest_code": "42501"},
                                    {"status": 403, "postgrest_code": "42501"}])
def test_a_postgrest_permission_denial_passes(result):
    assert probe.failures({"restapi": {"SUPABASE_SECRET_KEY": result}}) == []


def test_rls_counts_that_differ_fail():
    assert probe.failures({"rls": {"tables_that_differ": ["quiz_answers"]}})


def test_identity_that_differs_between_roles_or_modes_fails():
    same = ["role_test", 5, "2026-11-22 10:00:00+07", "170006"]
    ok = {"OWNER_URL_SESSION": [["studymap_owner", *same]] * 3,
          "APP_URL_SESSION": [["studymap_app", *same]] * 3}
    assert probe.identity_problems(ok, {"OWNER_URL_SESSION": "studymap_owner",
                                        "APP_URL_SESSION": "studymap_app"}) == []
    moved = dict(ok, APP_URL_SESSION=[["studymap_app", "role_test", 6, same[2], same[3]]])
    assert probe.identity_problems(moved, {"OWNER_URL_SESSION": "studymap_owner",
                                           "APP_URL_SESSION": "studymap_app"})
    wrong_role = dict(ok, APP_URL_SESSION=[["studymap_owner", *same]])
    assert probe.identity_problems(wrong_role, {"OWNER_URL_SESSION": "studymap_owner",
                                                "APP_URL_SESSION": "studymap_app"})


# ── G0b: grants the owner cannot revoke must stop the plan before G3 ────────────────
def test_an_api_grant_made_by_another_grantor_blocks_g3():
    rows = [("table", "quiz_answers", "anon", "SELECT", "postgres"),
            ("table", "quiz_answers", "service_role", "UPDATE", "supabase_admin")]
    problems = probe.unrevokable_api_grants(rows, revoker="postgres")
    assert len(problems) == 1 and "supabase_admin" in problems[0]


def test_grants_by_the_revoker_do_not_block():
    rows = [("sequence", "s", "anon", "USAGE", "postgres")]
    assert probe.unrevokable_api_grants(rows, revoker="postgres") == []


def test_main_exits_nonzero_when_the_env_is_refused(tmp_path):
    env_file = tmp_path / "t.env"
    env_file.write_text(f"OWNER_URL_SESSION=postgresql://postgres.{PROD}:pw@{HOST}:5432/postgres\n")
    r = subprocess.run([sys.executable, "-m", "scripts.supabase_test_probe", "inspect",
                        "--env-file", str(env_file), "--expect-ref", REF, "--deny-ref", PROD,
                        "--out", str(tmp_path / "o.json")],
                       cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True,
                       encoding="utf-8", env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8"})
    assert r.returncode != 0
    assert "pw" not in r.stdout + r.stderr.replace("pw@", "")  # never echo the password
    assert PROD not in r.stdout + r.stderr
