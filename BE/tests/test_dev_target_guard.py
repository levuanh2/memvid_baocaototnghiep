"""`shared.dev_target_guard`: a hand-started backend on a dev machine refuses hosted
targets; production containers and CI are never affected. Pure tests: no network."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from shared import dev_target_guard as g

BE_ROOT = Path(__file__).resolve().parents[1]
HOSTED_DB = "postgresql://u:p@aws-0-x.pooler.supabase.invalid:6543/postgres"
LOCAL_DB = "postgresql://u:p@127.0.0.1:5432/studymap_dev"


@pytest.fixture()
def checkout(tmp_path):
    """A fake BE/ with a .env next to it, as on a developer machine."""
    be = tmp_path / "BE"
    be.mkdir()
    (be / ".env").write_text("X=1\n", encoding="utf-8")
    return be


@pytest.mark.parametrize("name, value", [("DATABASE_URL", HOSTED_DB),
                                         ("JOBS_DATABASE_URL", HOSTED_DB),
                                         ("SUPABASE_URL", "https://abcdefgh.supabase.invalid")])
def test_a_dev_checkout_with_a_hosted_target_is_refused(checkout, name, value):
    reason = g.refusal({name: value}, be_root=checkout)
    assert reason and name in reason and "supabase" not in reason and "p@" not in reason


def test_local_targets_pass(checkout):
    assert g.refusal({"DATABASE_URL": LOCAL_DB, "SUPABASE_URL": ""}, be_root=checkout) is None


@pytest.mark.parametrize("role", ["web", "mindmap-worker", "WEB"])
def test_production_roles_are_never_refused(checkout, role):
    assert g.refusal({"PROCESS_ROLE": role, "DATABASE_URL": HOSTED_DB}, be_root=checkout) is None


def test_no_env_file_on_disk_means_container_or_ci(tmp_path):
    """BE/.dockerignore keeps .env out of the image: no file, no refusal, even without
    PROCESS_ROLE (defence in depth for production)."""
    be = tmp_path / "BE"
    be.mkdir()
    assert g.refusal({"DATABASE_URL": HOSTED_DB}, be_root=be) is None


def test_root_env_file_alone_also_marks_a_checkout(tmp_path):
    be = tmp_path / "BE"
    be.mkdir()
    (tmp_path / ".env").write_text("X=1\n", encoding="utf-8")
    assert g.refusal({"DATABASE_URL": HOSTED_DB}, be_root=be)


def test_explicit_opt_in_passes(checkout):
    env = {"DATABASE_URL": HOSTED_DB, "STUDYMAP_ALLOW_REMOTE_TARGETS": "1"}
    assert g.refusal(env, be_root=checkout) is None


def test_production_compose_sets_the_role_on_every_backend_service():
    """The refusal relies on PROCESS_ROLE in production; a new service without it would
    still be safe (no .env in the image) but must be noticed."""
    compose = (BE_ROOT.parent / "docker-compose.prod.yml").read_text(encoding="utf-8")
    assert compose.count("PROCESS_ROLE: web") == 1
    assert compose.count("PROCESS_ROLE: mindmap-worker") == 1
    dockerignore = (BE_ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines()
    assert ".env" in [line.strip() for line in dockerignore]


def test_app_main_calls_the_guard_after_loading_env_files():
    src = (BE_ROOT / "app" / "main.py").read_text(encoding="utf-8")
    load = src.index("load_project_env(override=False)")
    assert src.index("dev_target_guard") > load
    assert src.index("dev_target_guard") < src.index("def _jobs_update_dispatch")


def test_enforce_raises_outside_pytest(tmp_path):
    """Real process, not pytest: the guard stops the import before anything connects."""
    code = ("import sys; sys.path.insert(0, r'%s');"
            "from shared import dev_target_guard as g;"
            "from pathlib import Path;"
            "g.refusal.__defaults__ = (None, Path(r'%s'));"
            "g.enforce()") % (BE_ROOT, tmp_path)
    (tmp_path / ".env").write_text("X=1\n", encoding="utf-8")
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=60,
                       env={"DATABASE_URL": HOSTED_DB, "SYSTEMROOT": __import__("os").environ.get("SYSTEMROOT", "")})
    assert r.returncode != 0 and "RemoteTargetRefused" in r.stderr
