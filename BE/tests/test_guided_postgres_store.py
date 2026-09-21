"""Postgres-only durability tests for the Guided V3 ledger.

These tests intentionally refuse to use DATABASE_URL. Set TEST_DATABASE_URL to a
disposable Postgres database after applying Alembic migrations; otherwise the
Postgres integration gate is BLOCKED, not green by SQLite substitution.
"""
from __future__ import annotations

import concurrent.futures
import os
import uuid

import pytest

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
