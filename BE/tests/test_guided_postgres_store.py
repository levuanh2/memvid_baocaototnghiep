"""Postgres-only durability tests for the Guided V3 ledger.

These tests intentionally refuse to use DATABASE_URL. Set TEST_DATABASE_URL to a
disposable Postgres database after applying Alembic migrations; otherwise the
Postgres integration gate is BLOCKED, not green by SQLite substitution.
"""
from __future__ import annotations

import concurrent.futures
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.domains.jobs import guided_store


TEST_DSN = (os.getenv("TEST_DATABASE_URL") or "").strip()
pytestmark = pytest.mark.skipif(
    not TEST_DSN or not TEST_DSN.startswith(("postgres://", "postgresql://")),
    reason="TEST_DATABASE_URL must point to a disposable Postgres database",
)


@pytest.fixture(autouse=True)
def _postgres_backend(monkeypatch):
    monkeypatch.setenv("GUIDED_JOB_STORE_BACKEND", "postgres")
    monkeypatch.setenv("JOBS_DATABASE_URL", TEST_DSN)
    guided_store.reset_engine()
    # claim_next_job() is a real FIFO queue (oldest queued row wins) — a row left
    # over from a previous test run is older than anything this test creates and
    # would get claimed instead, making claim assertions flaky/wrong rather than
    # a real concurrency bug. Each test gets a clean table.
    with guided_store._get_engine().begin() as conn:
        conn.execute(text("TRUNCATE guided_mindmap_jobs, guided_mindmap_worker_heartbeats"))
    yield
    guided_store.reset_engine()


def _job():
    key = "test-" + uuid.uuid4().hex
    return {
        "job_id": str(uuid.uuid4()), "user_id": "test-user-" + uuid.uuid4().hex,
        "key": key, "fingerprint": "fp-" + uuid.uuid4().hex,
    }


def test_same_key_same_payload_is_one_row_and_reloadable():
    j = _job()
    first = guided_store.create_idempotent_job(j["job_id"], user_id=j["user_id"],
        idempotency_key=j["key"], request_fingerprint=j["fingerprint"],
        source_ids_json="[\"source\"]", guided_config_json="{}")
    second = guided_store.create_idempotent_job(str(uuid.uuid4()), user_id=j["user_id"],
        idempotency_key=j["key"], request_fingerprint=j["fingerprint"],
        source_ids_json="[\"source\"]", guided_config_json="{}")
    assert first[0] == "created" and second[0] == "existing"
    assert first[1]["job_id"] == second[1]["job_id"]
    assert guided_store.get_job(first[1]["job_id"], user_id=j["user_id"])["job_id"] == first[1]["job_id"]


def test_same_key_different_payload_is_conflict():
    j = _job()
    guided_store.create_idempotent_job(j["job_id"], user_id=j["user_id"],
        idempotency_key=j["key"], request_fingerprint=j["fingerprint"],
        source_ids_json="[]", guided_config_json="{}")
    outcome, _ = guided_store.create_idempotent_job(str(uuid.uuid4()), user_id=j["user_id"],
        idempotency_key=j["key"], request_fingerprint="different",
        source_ids_json="[]", guided_config_json="{}")
    assert outcome == "conflict"


def test_concurrent_claims_have_one_winner():
    j = _job()
    guided_store.create_idempotent_job(j["job_id"], user_id=j["user_id"],
        idempotency_key=j["key"], request_fingerprint=j["fingerprint"],
        source_ids_json="[]", guided_config_json="{}")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(lambda n: guided_store.claim_next_job(f"worker-{n}", 60), range(2)))
    assert sum(row is not None and row["job_id"] == j["job_id"] for row in rows) == 1


def test_migration_reapplies_safely():
    # Additive migrations must be repeat-safe -- re-running `alembic upgrade head`
    # against an already-migrated database (e.g. a redeploy) must not error or
    # duplicate the guided tables.
    env = dict(os.environ, TEST_DATABASE_URL=TEST_DSN)
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
        cwd=os.path.join(os.path.dirname(__file__), ".."), env=env,
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stderr


def test_job_survives_engine_recreation():
    # `guided_store.reset_engine()` + a fresh `_get_engine()` call is the same
    # code path a restarted process takes -- the row must still be readable.
    j = _job()
    guided_store.create_idempotent_job(j["job_id"], user_id=j["user_id"],
        idempotency_key=j["key"], request_fingerprint=j["fingerprint"],
        source_ids_json="[]", guided_config_json="{}")
    guided_store.update_job(j["job_id"], status="done", result_map_id="map-1", stage="done")
    guided_store.reset_engine()
    reloaded = guided_store.get_job(j["job_id"], user_id=j["user_id"])
    assert reloaded is not None
    assert reloaded["status"] == "done"
    assert reloaded["result_map_id"] == "map-1"


def test_expired_lease_is_recovered_by_another_worker():
    j = _job()
    guided_store.create_idempotent_job(j["job_id"], user_id=j["user_id"],
        idempotency_key=j["key"], request_fingerprint=j["fingerprint"],
        source_ids_json="[]", guided_config_json="{}")
    first = guided_store.claim_next_job("worker-A", lease_seconds=1)
    assert first["job_id"] == j["job_id"]
    time.sleep(1.2)  # let the 1-second lease actually expire
    second = guided_store.claim_next_job("worker-B", lease_seconds=60)
    assert second is not None and second["job_id"] == j["job_id"]
    assert second["lease_owner"] == "worker-B"
    # a still-healthy worker must not be able to steal a live lease
    guided_store.create_idempotent_job(str(uuid.uuid4()), user_id=j["user_id"],
        idempotency_key="other-" + uuid.uuid4().hex, request_fingerprint="fp2",
        source_ids_json="[]", guided_config_json="{}")
    third = guided_store.claim_next_job("worker-C", lease_seconds=60)
    assert third["job_id"] != j["job_id"]  # worker-B's fresh lease is not stealable


def test_worker_unhealthy_disables_capability_v2_still_usable():
    assert guided_store.worker_healthy(ttl_seconds=90) is False
    guided_store.record_worker_heartbeat("worker-live")
    assert guided_store.worker_healthy(ttl_seconds=90) is True
    # a stale heartbeat (beyond ttl) must read as unhealthy again, not sticky-true
    with guided_store._get_engine().begin() as conn:
        conn.execute(text(
            "UPDATE guided_mindmap_worker_heartbeats SET heartbeat_at = :old WHERE worker_id='worker-live'"
        ), {"old": datetime.now(timezone.utc) - timedelta(seconds=200)})
    assert guided_store.worker_healthy(ttl_seconds=90) is False
    # V2 (SQLite-backed legacy store) must remain reachable regardless of Postgres health
    from app.domains.jobs import jobs_store
    assert hasattr(jobs_store, "create_idempotent_job")


def test_force_flag_persists_and_survives_claim():
    """2026-09-23 fix: `force` must round-trip API -> durable row -> worker
    claim, since that's the exact gap that let a forced regeneration silently
    replay a stale content-hash cache."""
    j = _job()
    outcome, row = guided_store.create_idempotent_job(j["job_id"], user_id=j["user_id"],
        idempotency_key=j["key"], request_fingerprint=j["fingerprint"],
        source_ids_json="[]", guided_config_json="{}", force=True)
    assert outcome == "created"
    assert row["force"] is True

    fetched = guided_store.get_job(j["job_id"], user_id=j["user_id"])
    assert fetched["force"] is True

    claimed = guided_store.claim_next_job("worker-force", lease_seconds=60)
    assert claimed["job_id"] == j["job_id"]
    assert claimed["force"] is True


def test_force_flag_defaults_false_when_not_passed():
    j = _job()
    _, row = guided_store.create_idempotent_job(j["job_id"], user_id=j["user_id"],
        idempotency_key=j["key"], request_fingerprint=j["fingerprint"],
        source_ids_json="[]", guided_config_json="{}")
    assert row["force"] is False
