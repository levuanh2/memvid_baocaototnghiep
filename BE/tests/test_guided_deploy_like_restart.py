"""Deploy-like restart proof for the Guided V3 durable job pipeline.

Runs two ACTUAL separate OS processes (a "worker A" and a "worker B") against
the same disposable test Postgres, proving lease-expiry recovery and
duplicate-map prevention survive a real process boundary -- not just an
in-process thread race. This is a durability proof, not a real-provider
generation proof: the worker script below stands in for the LLM pipeline with
a deterministic, injected completion instead of calling any real provider.
Production worker code (app/jobs/guided_worker.py) is untouched by this test
and always binds to the real provider.
"""
from __future__ import annotations

import os
import subprocess
import sys
import textwrap
import time
import uuid

import pytest

from app.domains.jobs import guided_store

TEST_DSN = (os.getenv("TEST_DATABASE_URL") or "").strip()
pytestmark = pytest.mark.skipif(
    not TEST_DSN or not TEST_DSN.startswith(("postgres://", "postgresql://")),
    reason="TEST_DATABASE_URL must point to a disposable Postgres database",
)

_WORKER_SCRIPT = textwrap.dedent("""
    import os, sys, time
    from app.domains.jobs import guided_store

    worker_id, hold_seconds, result_map_id = sys.argv[1], float(sys.argv[2]), sys.argv[3]
    job = guided_store.claim_next_job(worker_id, lease_seconds=int(os.environ["LEASE_SECONDS"]))
    if not job:
        print("NO_JOB")
        sys.exit(1)
    print("CLAIMED", job["job_id"])
    sys.stdout.flush()
    if hold_seconds > 0:
        time.sleep(hold_seconds)  # simulate a real, slow generation call
        sys.exit(9)  # process dies mid-job -- deploy/kill/OOM stand-in, never marks done
    # deterministic "generation complete" -- test provider, not a real one
    existing = guided_store.get_job(job["job_id"])
    if existing.get("result_map_id"):
        print("ALREADY_DONE", existing["result_map_id"])
    else:
        guided_store.update_job(job["job_id"], status="done", stage="done", result_map_id=result_map_id)
        print("DONE", result_map_id)
""")


def _run_worker(tmp_path, worker_id: str, hold_seconds: float, result_map_id: str, env: dict) -> subprocess.CompletedProcess:
    script = tmp_path / f"worker_{worker_id}.py"
    script.write_text(_WORKER_SCRIPT)
    be_dir = os.path.join(os.path.dirname(__file__), "..")
    run_env = dict(env, PYTHONPATH=os.path.abspath(be_dir))
    return subprocess.run(
        [sys.executable, str(script), worker_id, str(hold_seconds), result_map_id],
        cwd=be_dir, env=run_env, capture_output=True, text=True, timeout=30,
    )


def test_web_and_worker_restart_recovery_is_single_map(tmp_path, monkeypatch):
    env = dict(os.environ, TEST_DATABASE_URL=TEST_DSN, JOBS_DATABASE_URL=TEST_DSN,
               GUIDED_JOB_STORE_BACKEND="postgres", LEASE_SECONDS="1")
    # the "web process" role here is this test's own process -- it must talk to
    # the same Postgres backend the subprocess workers use, not fall back to
    # the local SQLite legacy store.
    monkeypatch.setenv("GUIDED_JOB_STORE_BACKEND", "postgres")
    monkeypatch.setenv("JOBS_DATABASE_URL", TEST_DSN)
    guided_store.reset_engine()

    # "web process" enqueues the job (this test process stands in for it)
    job_id, user_id, key = str(uuid.uuid4()), "restart-user-" + uuid.uuid4().hex, "restart-" + uuid.uuid4().hex
    guided_store.create_idempotent_job(job_id, user_id=user_id, idempotency_key=key,
        request_fingerprint="fp-restart", source_ids_json="[]", guided_config_json="{}")

    # Worker A claims it, then dies mid-job (a real subprocess exiting non-zero,
    # simulating a deploy/OOM/crash) -- its lease is left to expire.
    dead = _run_worker(tmp_path, "worker-A", hold_seconds=1.5, result_map_id="unused", env=env)
    assert "CLAIMED" in dead.stdout, dead.stdout + dead.stderr
    assert dead.returncode == 9

    time.sleep(1.3)  # let worker A's 1-second lease actually expire

    # Worker B, a genuinely separate process, recovers the expired lease and completes it.
    recovered = _run_worker(tmp_path, "worker-B", hold_seconds=0, result_map_id="map-restart-1", env=env)
    assert "DONE map-restart-1" in recovered.stdout, recovered.stdout + recovered.stderr

    # "web process restarts" -- fresh engine, fresh poll, same as a real redeploy.
    guided_store.reset_engine()
    polled = guided_store.get_job(job_id, user_id=user_id)
    assert polled["status"] == "done"
    assert polled["result_map_id"] == "map-restart-1"

    # Resubmitting the same idempotency key after the restart returns the same job/map.
    resubmit_outcome, resubmit_row = guided_store.create_idempotent_job(
        str(uuid.uuid4()), user_id=user_id, idempotency_key=key, request_fingerprint="fp-restart",
        source_ids_json="[]", guided_config_json="{}")
    assert resubmit_outcome == "existing"
    assert resubmit_row["job_id"] == job_id
    assert resubmit_row["result_map_id"] == "map-restart-1"

    # Exactly one result map for this job -- a third worker claiming nothing
    # (job already done) and calling the reconciliation branch would no-op.
    with guided_store._get_engine().connect() as conn:
        from sqlalchemy import text
        count = conn.execute(text(
            "SELECT COUNT(*) FROM guided_mindmap_jobs WHERE job_id=:j AND result_map_id IS NOT NULL"
        ), {"j": job_id}).scalar()
    assert count == 1
