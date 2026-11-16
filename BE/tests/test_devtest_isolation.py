"""Dev and test runs must not reach a hosted database or bucket by accident.

`test_db_isolation.py` covers the first incident (pytest falling back to `DATABASE_URL`).
This file covers the holes left after it, found 2026-11-16:

  - pytest accepted any `TEST_DATABASE_URL` whose (host, db) differed from `DATABASE_URL`,
    so a hosted database on another host name (direct host vs pooler, another provider)
    passed. Migrations already required a loopback/CI host and a `_test` name; pytest now
    uses the same rule (`shared.migration_guard.kiem_tra_dich`, test mode).
  - `guided_store.dsn()` fell back to `DATABASE_URL` with no pytest check at all; it is
    used whenever `AUTH_PROTECT_APP_APIS=true` or `GUIDED_JOB_STORE_BACKEND=postgres`
    comes from a developer's `.env`.
  - `SUPABASE_URL` / `SUPABASE_SECRET_KEY` from `BE/.env` reached the test process, so
    an upload through the `client` fixture wrote to the real bucket.
  - `scripts/run_e2e_server.py` (local Playwright) kept the bucket keys from `BE/.env`
    and accepted any `DATABASE_URL` from the shell.

Every host here ends in `.invalid` (RFC 2606): it never resolves, so a regression cannot
open a connection to anything.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from app import db as appdb

BE_ROOT = Path(__file__).resolve().parents[1]
HOSTED_POOLER = "postgresql://postgres.abcdefgh:pw@pooler.region.invalid:5432/postgres"
HOSTED_DIRECT = "postgresql://postgres:pw@db.abcdefgh.invalid:5432/postgres"
LOCAL_TEST = "postgresql://postgres:postgres@127.0.0.1:55432/studymap_test"


# ── pytest: only a disposable local/CI database ───────────────────────────
@pytest.mark.parametrize("test_url, prod_url", [
    (HOSTED_DIRECT, HOSTED_POOLER),          # another host name for a hosted database
    (HOSTED_POOLER.replace("/postgres", "/studymap_test"), HOSTED_POOLER),
    (HOSTED_DIRECT, None),                   # no DATABASE_URL to compare against
    ("postgresql://postgres:postgres@127.0.0.1:55432/postgres", None),  # not a _test db
], ids=["other-host", "hosted-test-name", "no-database-url", "local-not-test-name"])
def test_pytest_refuses_a_test_database_that_is_not_disposable(monkeypatch, test_url, prod_url):
    monkeypatch.setenv("TEST_DATABASE_URL", test_url)
    if prod_url:
        monkeypatch.setenv("DATABASE_URL", prod_url)
    else:
        monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(appdb.DatabaseNotConfigured) as e:
        appdb.database_url()
    assert "pw@" not in str(e.value)


def test_pytest_accepts_a_local_test_database(monkeypatch):
    monkeypatch.setenv("TEST_DATABASE_URL", LOCAL_TEST)
    monkeypatch.setenv("DATABASE_URL", HOSTED_POOLER)
    assert "127.0.0.1:55432/studymap_test" in appdb.database_url()


# ── guided job store ──────────────────────────────────────────────────────
def test_guided_store_never_falls_back_to_DATABASE_URL_under_pytest(monkeypatch):
    from app.domains.jobs import guided_store

    monkeypatch.delenv("JOBS_DATABASE_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", HOSTED_POOLER)
    assert "invalid" not in guided_store.dsn()


def test_guided_store_refuses_a_hosted_jobs_database_under_pytest(monkeypatch):
    from app.domains.jobs import guided_store

    monkeypatch.setenv("JOBS_DATABASE_URL", HOSTED_DIRECT)
    with pytest.raises(appdb.DatabaseNotConfigured):
        guided_store.dsn()


def test_guided_store_accepts_a_local_test_database(monkeypatch):
    from app.domains.jobs import guided_store

    monkeypatch.setenv("JOBS_DATABASE_URL", LOCAL_TEST)
    assert guided_store.dsn() == LOCAL_TEST


# ── object storage ────────────────────────────────────────────────────────
def test_bucket_keys_from_a_dev_env_file_do_not_reach_tests():
    """A test that needs storage sets fake values with monkeypatch and mocks the HTTP
    layer (`test_storage_durability.py`). Nothing else may see real keys.

    Load the env files first, as importing `app.main` (the `client` fixture) does."""
    from app.domains.documents import storage
    from shared.env_loader import load_project_env

    load_project_env()
    assert not storage.is_configured()


# ── local Playwright backend ──────────────────────────────────────────────
def _e2e_server(**env):
    run_env = {k: v for k, v in os.environ.items()
               if k not in ("DATABASE_URL", "SUPABASE_URL", "SUPABASE_SECRET_KEY")}
    run_env.update(env, PYTHONUTF8="1", PORT="0")
    return subprocess.run([sys.executable, "scripts/run_e2e_server.py"], cwd=BE_ROOT,
                          env=run_env, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=60)


@pytest.mark.parametrize("url", [HOSTED_POOLER, HOSTED_DIRECT],
                         ids=["pooler", "direct"])
def test_e2e_server_refuses_a_hosted_database_before_starting(url):
    try:
        r = _e2e_server(DATABASE_URL=url)
    except subprocess.TimeoutExpired:
        pytest.fail("run_e2e_server started a server against a hosted DATABASE_URL")
    assert r.returncode == 2, r.stdout + r.stderr
    assert "DỪNG" in r.stderr and "pw@" not in r.stderr


def test_e2e_server_blanks_bucket_keys_so_env_files_cannot_refill_them():
    """`os.environ.pop` is undone by `load_dotenv`, which fills any variable that is
    absent; an empty string counts as present and stays empty (see conftest)."""
    src = (BE_ROOT / "scripts" / "run_e2e_server.py").read_text(encoding="utf-8")
    blank_loop = src.split('os.environ[_name] = ""', 1)[0].rsplit("for _name in", 1)[-1]
    for name in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "FPT_AI_API_KEY"):
        assert f'"{name}"' in blank_loop, name
        assert f'os.environ.pop("{name}"' not in src, name


# ── owner's EC2 vs dev comparison ─────────────────────────────────────────
def _fp_module():
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "db_target_fingerprint", BE_ROOT / "scripts" / "db_target_fingerprint.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_fingerprint_is_the_same_project_whatever_the_door():
    fp = _fp_module().fingerprint
    pooler_5432 = "postgresql://postgres.abcdefgh:pw@aws-0-x.pooler.supabase.com:5432/postgres"
    pooler_6543 = pooler_5432.replace(":5432/", ":6543/").replace(":pw@", ":other@")
    direct = "postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres"
    api = "https://abcdefgh.supabase.co"
    assert fp(pooler_5432) == fp(pooler_6543) == fp(direct) == fp(api)
    assert fp(pooler_5432) != fp(pooler_5432.replace("abcdefgh", "zyxwvuts"))
    assert fp(LOCAL_TEST) != fp(pooler_5432)


def test_fingerprint_output_never_contains_the_target(tmp_path, capsys, monkeypatch):
    mod = _fp_module()
    for name in mod.NAMES:  # an earlier test may have loaded a dev env file
        monkeypatch.delenv(name, raising=False)
    env_file = tmp_path / "be.env"
    env_file.write_text(
        "DATABASE_URL=postgresql://postgres.abcdefgh:s3cret@aws-0-x.pooler.supabase.com:6543/postgres\n"
        "SUPABASE_URL=https://abcdefgh.supabase.co\n", encoding="utf-8")
    assert mod.main([str(env_file)]) == 0
    out = capsys.readouterr().out
    for secret in ("abcdefgh", "s3cret", "supabase", "pooler", "postgres."):
        assert secret not in out
    assert out.count(mod.fingerprint("https://abcdefgh.supabase.co")) == 2  # same project
    assert "port=6543" in out


def test_fingerprint_follows_the_env_loader_precedence(tmp_path):
    mod = _fp_module()
    be, root = tmp_path / "be.env", tmp_path / "root.env"
    be.write_text("DATABASE_URL=postgresql://u:p@a.invalid/x\n", encoding="utf-8")
    root.write_text("DATABASE_URL=postgresql://u:p@b.invalid/x\n"
                    "SUPABASE_URL=https://r.supabase.co\n", encoding="utf-8")
    v = mod.resolve([str(be), str(root)], {"DATABASE_URL": ""})
    assert v["DATABASE_URL"] == ""                      # present in the process wins
    assert v["SUPABASE_URL"] == "https://r.supabase.co"  # filled from the later file
    assert "a.invalid" in mod.resolve([str(be), str(root)], {})["DATABASE_URL"]


# ── Codex review of #187 (2026-11-16): the effective target, Redis, providers ──
# libpq/psycopg let URL query parameters (`host`, `dbname`, ...) replace the authority
# and path, so a check of the raw URL approved a connection that went elsewhere.
QUERY_HOST = LOCAL_TEST + "?host=db.abcdefgh.invalid"
QUERY_DB = LOCAL_TEST + "?dbname=postgres"


@pytest.mark.parametrize("url", [QUERY_HOST, QUERY_DB, LOCAL_TEST + "?hostaddr=10.0.0.1",
                                 LOCAL_TEST + "?service=prod"],
                         ids=["host", "dbname", "hostaddr", "service"])
def test_query_parameters_cannot_move_the_test_target(monkeypatch, url):
    from app.domains.jobs import guided_store
    from shared.migration_guard import CHE_DO_TEST, MigrationTargetRejected, kiem_tra_dich

    with pytest.raises(MigrationTargetRejected):
        kiem_tra_dich(url, CHE_DO_TEST, env={})
    monkeypatch.setenv("TEST_DATABASE_URL", url)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(appdb.DatabaseNotConfigured):
        appdb.database_url()
    monkeypatch.setenv("JOBS_DATABASE_URL", url)
    with pytest.raises(appdb.DatabaseNotConfigured):
        guided_store.dsn()


def test_harmless_query_parameters_still_pass(monkeypatch):
    monkeypatch.setenv("TEST_DATABASE_URL", LOCAL_TEST + "?sslmode=disable&connect_timeout=5")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert "studymap_test" in appdb.database_url()


def test_effective_target_parsing_matches_sqlalchemy():
    """The guard and SQLAlchemy must agree on where a URL connects (no socket opened)."""
    from sqlalchemy.dialects.postgresql.psycopg import PGDialect_psycopg
    from sqlalchemy.engine import make_url

    _, kw = PGDialect_psycopg().create_connect_args(
        make_url("postgresql+psycopg://u:p@127.0.0.1/studymap_test?host=db.x.invalid&dbname=postgres"))
    assert (kw["host"], kw["dbname"]) == ("db.x.invalid", "postgres")


def test_e2e_server_refuses_a_query_parameter_target():
    r = _e2e_server(DATABASE_URL=QUERY_HOST)
    assert r.returncode == 2, r.stdout + r.stderr


def test_fingerprint_follows_the_effective_target():
    fp = _fp_module().fingerprint
    direct = "postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres"
    disguised = "postgresql://u:p@127.0.0.1/studymap_test?host=db.abcdefgh.supabase.co&dbname=postgres"
    assert fp(disguised) == fp(direct)
    pooler_user_in_query = ("postgresql://127.0.0.1/studymap_test?host=aws-0-x.pooler.supabase.com"
                            "&dbname=postgres&user=postgres.abcdefgh")
    assert fp(pooler_user_in_query) == fp(direct)


@pytest.mark.parametrize("name, value, kept", [
    ("REDIS_URL", "redis://localhost:6379/0", True),        # CI service
    ("REDIS_URL", "redis://redis:6379/0", True),            # compose service name
    ("REDIS_URL", "rediss://default:pw@cache.hosted.invalid:6380", False),
    ("OLLAMA_HOST", "http://127.0.0.1:11434", True),
    ("OLLAMA_HOST", "gpu-box.invalid:11434", False),        # no scheme, still remote
    ("OLLAMA_HOST", "https://ollama.hosted.invalid", False),
])
def test_only_local_services_survive_in_test_runs(name, value, kept):
    from shared.migration_guard import local_service_or_blank

    env = {name: value}
    local_service_or_blank(name, env)
    assert env[name] == (value if kept else "")


def test_an_absent_service_is_set_empty_so_dotenv_cannot_fill_it():
    from shared.migration_guard import local_service_or_blank

    env = {}
    local_service_or_blank("REDIS_URL", env)
    assert env == {"REDIS_URL": ""}


def test_remote_services_and_provider_keys_from_a_dev_env_do_not_reach_tests():
    from shared.env_loader import load_project_env
    from shared.migration_guard import local_service_or_blank

    load_project_env()
    for name in ("GEMINI_API_KEY", "GROQ_API_KEY", "COHERE_API_KEY", "FPT_AI_API_KEY"):
        assert not os.environ.get(name), name
    for name in ("REDIS_URL", "OLLAMA_HOST"):
        env = {name: os.environ.get(name, "")}
        before = env[name]
        local_service_or_blank(name, env)
        assert env[name] == before, f"{name} points at a remote service in a test run"


def test_conftest_and_e2e_server_never_pop_safety_settings():
    """`pop` lets the next `load_dotenv` refill the value from `BE/.env`."""
    for rel in ("tests/conftest.py", "scripts/run_e2e_server.py"):
        src = (BE_ROOT / rel).read_text(encoding="utf-8")
        for name in ("GEMINI_API_KEY", "GROQ_API_KEY", "FPT_AI_API_KEY", "COHERE_API_KEY"):
            assert f'os.environ.pop("{name}"' not in src, (rel, name)
        assert "local_service_or_blank" in src, rel
