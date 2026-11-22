"""Codex task63 recheck (BLOCK): per-phase inputs, env-file ambiguity, canonicalization,
default ACLs, private output on reuse, and the real-graph E2E server's database guard."""
import os
import subprocess
import sys
from pathlib import Path

import pytest

from scripts import supabase_test_probe as probe

REF = "abcdefghijklmnopqrst"
PROD = "zyxwvutsrqponmlkjihg"
HOST = "aws-0-ap-southeast-1.pooler.supabase.com"
BE = Path(__file__).resolve().parents[1]


def _env(**over):
    env = {
        "OWNER_URL_SESSION": f"postgresql://postgres.{REF}:pw@{HOST}:5432/postgres",
        "OWNER_URL_TRANSACTION": f"postgresql://postgres.{REF}:pw@{HOST}:6543/postgres",
        "APP_URL_SESSION": f"postgresql://studymap_app.{REF}:pw@{HOST}:5432/postgres",
        "APP_URL_TRANSACTION": f"postgresql://studymap_app.{REF}:pw@{HOST}:6543/postgres",
        "READONLY_URL_SESSION": f"postgresql://studymap_readonly.{REF}:pw@{HOST}:5432/postgres",
        "READONLY_URL_TRANSACTION": f"postgresql://studymap_readonly.{REF}:pw@{HOST}:6543/postgres",
        "SUPABASE_URL": f"https://{REF}.supabase.co",
        "SUPABASE_SECRET_KEY": "k", "SUPABASE_PUBLISHABLE_KEY": "k",
    }
    env.update(over)
    return {k: v for k, v in env.items() if v is not None}


# ── P1: each phase names its inputs; a missing one stops before any connection ──────
@pytest.mark.parametrize("phase, missing", [
    ("identity", "APP_URL_TRANSACTION"), ("identity", "READONLY_URL_TRANSACTION"),
    ("identity", "OWNER_URL_TRANSACTION"), ("rls", "READONLY_URL_SESSION"),
    ("rls", "APP_URL_SESSION"), ("deny", "APP_URL_SESSION"), ("restapi", "SUPABASE_URL"),
    ("restapi", "SUPABASE_PUBLISHABLE_KEY"), ("restapi", "SUPABASE_SECRET_KEY")])
def test_each_phase_requires_its_inputs(phase, missing):
    assert probe.phase_input_problems([phase], _env(**{missing: None}))


def test_complete_inputs_pass_every_phase_check():
    assert probe.phase_input_problems(list(probe.PHASES), _env()) == []


def test_main_refuses_an_incomplete_identity_run_before_connecting(tmp_path):
    f = tmp_path / "t.env"
    f.write_text(f"OWNER_URL_SESSION=postgresql://postgres.{REF}:pw@{HOST}:5432/postgres\n")
    r = subprocess.run([sys.executable, "-m", "scripts.supabase_test_probe", "identity",
                        "--env-file", str(f), "--expect-ref", REF, "--deny-ref", PROD,
                        "--out", str(tmp_path / "o.json")], cwd=BE, capture_output=True,
                       text=True, encoding="utf-8", env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    assert r.returncode == 2 and "DỪNG" in r.stderr
    assert not (tmp_path / "o.json").exists()


# ── P2: env-file ambiguity and canonicalization ─────────────────────────────────────
def test_a_duplicate_key_in_the_env_file_is_refused(tmp_path):
    f = tmp_path / "t.env"
    f.write_text(f"OWNER_URL_SESSION=postgresql://postgres.{PROD}:pw@{HOST}:5432/postgres\n"
                 f"OWNER_URL_SESSION=postgresql://postgres.{REF}:pw@{HOST}:5432/postgres\n")
    with pytest.raises(ValueError):
        probe.load_env(str(f))


@pytest.mark.parametrize("url", [
    f"postgresql://studymap_app.{REF}:pw@[::1]:5432/postgres",
    f"postgresql://studymap_app.{REF}:pw@[2001:db8::1]:5432/postgres",
    f"postgresql://studymap_app%2E{REF}:pw@{HOST}:5432/postgres",
    f"postgresql://studymap_app.{REF}:pw@{HOST}:5432/postgres#x",
    f"postgresql://studymap_app.{REF}:pw@{HOST}:5432/postgres?sslmode=disable",
    f"mysql://studymap_app.{REF}:pw@{HOST}:5432/postgres",
    "",
])
def test_canonicalization_edge_cases_are_refused(url):
    assert probe.env_problems(_env(APP_URL_SESSION=url), REF, PROD)


@pytest.mark.parametrize("scheme", ["postgres", "postgresql", "postgresql+psycopg2"])
@pytest.mark.parametrize("host", [HOST, HOST.upper(), HOST + "."])
def test_supported_schemes_host_case_and_trailing_dot_pass(scheme, host):
    url = f"{scheme}://studymap_app.{REF}:pw@{host}:5432/postgres"
    assert probe.env_problems(_env(APP_URL_SESSION=url), REF, PROD) == []


# ── P2: default ACLs ────────────────────────────────────────────────────────────────
def test_a_foreign_default_acl_blocks_only_when_that_role_owns_studymap_objects():
    rows = [("supabase_admin", "public", "r", "anon", "SELECT")]
    assert probe.default_acl_problems(rows, revoker="postgres", owners={"postgres"}) == []
    assert probe.default_acl_problems(rows, revoker="postgres", owners={"postgres", "supabase_admin"})


def test_the_owners_own_default_acls_do_not_block_before_g3():
    rows = [("postgres", "public", "r", "anon", "SELECT")]   # apply revokes these at G3
    assert probe.default_acl_problems(rows, revoker="postgres", owners={"postgres"}) == []


# ── P3: an existing output file becomes private ─────────────────────────────────────
def test_an_existing_output_file_is_made_private(tmp_path):
    out = tmp_path / "o.json"
    out.write_text("old")
    os.chmod(out, 0o644)
    probe.write_private(str(out), {"x": 1})
    if os.name == "posix":
        assert (out.stat().st_mode & 0o777) == 0o600
    assert '"x": 1' in out.read_text()


# ── P0: the real-graph E2E server reaches only the database it was told to use ──────
APP_SESSION = f"postgresql://studymap_app.{REF}:pw@{HOST}:5432/postgres"
HOSTED_OK = {"DATABASE_URL": APP_SESSION, "E2E_HOSTED_TEST": "1",
             "E2E_EXPECT_REF": REF, "E2E_DENY_REF": PROD}


@pytest.mark.parametrize("env", [
    {"DATABASE_URL": f"postgresql://studymap_app.{PROD}:pw@{HOST}:5432/postgres"},
    {"DATABASE_URL": APP_SESSION},                                          # hosted, no opt-in
    dict(HOSTED_OK, E2E_DENY_REF=""),                                       # no deny ref
    dict(HOSTED_OK, E2E_EXPECT_REF=PROD),                                   # expect == deny
    dict(HOSTED_OK, DATABASE_URL=f"postgresql://postgres.{REF}:pw@{HOST}:5432/postgres"),  # owner
    dict(HOSTED_OK, DATABASE_URL=f"postgresql://studymap_app.{REF}:pw@db.{REF}.supabase.co:5432/postgres"),
    {"DATABASE_URL": "postgresql://u:p@db.example.com:5432/studymap_test"},
    {"DATABASE_URL": "postgresql://u:p@[2001:db8::1]:5432/studymap_test"},
    {"DATABASE_URL": "postgresql://u:p@127.0.0.1:5432/postgres"},             # loopback, not *_test
    {"DATABASE_URL": "postgresql://u:p@127.0.0.1:5432/x_test?host=10.0.0.5"},  # query moves target
    {},
])
def test_e2e_database_guard_refuses(env):
    assert probe.e2e_database_problems(env)


@pytest.mark.parametrize("env", [
    {"DATABASE_URL": "postgresql://u:p@127.0.0.1:55500/role_test"},
    {"DATABASE_URL": "postgresql://u:p@localhost:5432/studymap_test"},
    HOSTED_OK,
])
def test_e2e_database_guard_accepts(env):
    assert probe.e2e_database_problems(env) == []


def test_run_e2e_server_with_real_graphs_refuses_production_before_importing_the_app():
    env = {k: v for k, v in os.environ.items() if not k.startswith("E2E_")}
    env.update(PYTHONIOENCODING="utf-8", SKIP_DOTENV="1", E2E_REAL_GRAPHS="1",
               DATABASE_URL=f"postgresql://studymap_app.{PROD}:pw@{HOST}:5432/postgres")
    r = subprocess.run([sys.executable, "scripts/run_e2e_server.py"], cwd=BE, env=env,
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 2, r.stdout[-500:] + r.stderr[-500:]
    assert "DỪNG" in r.stderr and "pw@" not in r.stderr and PROD not in r.stderr
    assert "Active providers" not in r.stdout          # the app was never imported


def test_preflight_counts_function_owners_for_default_acl_relevance():
    # Codex recheck2: a foreign role owning only a function in public must make its
    # function default ACLs count (the owners set is built from pg_class AND pg_proc).
    src = (BE / "scripts" / "supabase_test_probe.py").read_text(encoding="utf-8")
    pre = src[src.index("def preflight("):src.index("def inspect(")]
    assert "pg_proc" in pre and "proowner" in pre


def test_the_e2e_guard_is_one_shared_rule():
    from shared import e2e_guard
    assert probe.e2e_database_problems is e2e_guard.e2e_database_problems
