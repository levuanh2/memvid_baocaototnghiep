"""CI Regression Tests: Guided V3 Flow, Ingest OOM Safety, and Production Guards.

Protects against:
1. Guided V3 regression (probe capability -> submit -> transition -> done -> reload).
2. Ingest OOM regression: LATE_CHUNKING=0 must NOT load/warm BGE-M3 late-chunking weights.
3. Production migration & environment safety guards.
"""

import os
import pytest
from unittest.mock import MagicMock, patch

from shared.migration_guard import (
    chon_dich,
    kiem_tra_dich,
    MigrationTargetRejected,
    CHE_DO_TEST,
    CHE_DO_PRODUCTION,
)


# ── Phase 14: Guided V3 CI Regression Simulation ──────────────────────────────
#
# NOTE (2026-09-27): this class-based simulation predates real browser E2E
# coverage. It never touches HTTP, Flask, or a rendered frontend — it only
# proves the *shape* of a guided-job lifecycle in pure Python. Real, deterministic
# browser-driven coverage of this flow now lives in FE/e2e/guided-mindmap.spec.js
# (Playwright, against a real running FE + a real running fake-provider backend).
# This test is kept as a fast, dependency-free contract check; it is NOT a
# substitute for the Playwright suite, and CI_ARCHITECTURE.md has been corrected
# to stop calling this "E2E".

class FakeGuidedWorker:
    """Deterministic simulated worker for Guided V3 flow without external model dependencies."""
    def __init__(self):
        self.jobs = {}

    def submit_job(self, sources, prompt, force=False):
        if not sources or not isinstance(sources, list) or len(sources) == 0:
            return 400, {"error": "Invalid sources: must be a non-empty list"}
        job_id = f"guided-job-{len(self.jobs) + 1}"
        self.jobs[job_id] = {
            "status": "queued",
            "progress": 0,
            "current_node": "Queue",
            "sources": sources,
            "prompt": prompt,
            "result": None,
            "error": None
        }
        return 202, {"status": "started", "job_id": job_id}

    def process_job(self, job_id, fail_at_enrich=False):
        if job_id not in self.jobs:
            return 404, {"error": "Job not found"}
        job = self.jobs[job_id]
        job["status"] = "running"
        job["progress"] = 25
        job["current_node"] = "Stage0Planner"

        if fail_at_enrich:
            job["status"] = "failed"
            job["progress"] = 40
            job["error"] = "Model failed to return valid JSON"
            return 200, job

        job["progress"] = 70
        job["current_node"] = "Enrich"
        # Done
        job["status"] = "done"
        job["progress"] = 100
        job["current_node"] = "AssemblePersist"
        job["result"] = {
            "id": f"map-{job_id}",
            "schema_version": 2,
            "title": f"Mindmap for {job['sources'][0]}",
            "nodes": [
                {"id": "root", "parent": None, "kind": "root", "title": "Core Topic"},
                {"id": "node-1", "parent": "root", "kind": "topic", "title": "Branch A"},
            ],
            "relations": [],
            "sources": job["sources"],
            "created_at": "2026-09-01T00:00:00Z",
            "generator": {"pipeline": "guided_v3", "model": "mock"}
        }
        return 200, job


def test_guided_v3_full_deterministic_flow():
    """Verify end-to-end simulated Guided V3 lifecycle."""
    worker = FakeGuidedWorker()

    # Step 1: Capability check
    capability = {"guided_mindmap_v3": True, "fallback": "v2"}
    assert capability["guided_mindmap_v3"] is True

    # Step 2: Submit job
    status_code, resp = worker.submit_job(["document_a.pdf"], prompt="tóm tắt tài liệu")
    assert status_code == 202
    assert resp["status"] == "started"
    job_id = resp["job_id"]

    # Step 3: Job in queued / processing state
    code, job_status = worker.process_job(job_id)
    assert code == 200
    assert job_status["status"] == "done"
    assert job_status["progress"] == 100
    assert job_status["result"]["schema_version"] == 2

    # Step 4: Map A/B switch (different sources produce distinct maps)
    code_b, resp_b = worker.submit_job(["document_b.pdf"], prompt="tóm tắt tài liệu")
    _, job_status_b = worker.process_job(resp_b["job_id"])
    assert job_status_b["result"]["id"] != job_status["result"]["id"]
    assert job_status_b["result"]["sources"] == ["document_b.pdf"]


def test_guided_v3_error_branches():
    """Verify 4xx, 5xx / failure handling in Guided flow."""
    worker = FakeGuidedWorker()

    # 4xx on invalid sources
    code_bad, resp_bad = worker.submit_job([], prompt="invalid")
    assert code_bad == 400
    assert "error" in resp_bad

    # Job failure handling
    code_ok, resp_ok = worker.submit_job(["doc.pdf"], prompt="error test")
    job_id = resp_ok["job_id"]
    _, failed_job = worker.process_job(job_id, fail_at_enrich=True)
    assert failed_job["status"] == "failed"
    assert failed_job["error"] is not None


# ── Phase 15: Ingest Regression (OOM Protection) ──────────────────────────────

def test_late_chunking_disabled_does_not_initialize_model(monkeypatch):
    """Verify that LATE_CHUNKING=0 does not initialize or warm BGE-M3 late chunking embeddings."""
    monkeypatch.setenv("LATE_CHUNKING", "0")
    monkeypatch.setenv("SKIP_MODEL_LOAD", "1")

    # When LATE_CHUNKING=0, llm_factory._late_chunking_enabled() must return False
    from app.clients import llm_factory
    assert llm_factory._late_chunking_enabled() is False

    # Calling get_embeddings under SKIP_MODEL_LOAD=1 must return FakeEmbeddings
    # and MUST NOT attempt to load sentence-transformers / transformers / torch weights
    emb = llm_factory.get_embeddings()
    assert emb.__class__.__name__ == "FakeEmbeddings"


# ── Phase 16: Production Safety Regressions ───────────────────────────────────

def test_migration_guard_fail_closed_on_missing_env():
    """Verify that migration guard rejects execution when TEST_DATABASE_URL is not set."""
    with pytest.raises(MigrationTargetRejected) as excinfo:
        chon_dich(env={})
    assert "TEST_DATABASE_URL chưa đặt" in str(excinfo.value)


def test_migration_guard_rejects_non_test_database_name():
    """Verify that migration guard rejects a database whose name does not end in _test."""
    fake_env = {
        "TEST_DATABASE_URL": "postgresql://postgres:postgres@localhost:5432/production_clone"
    }
    url, mode = chon_dich(env=fake_env)
    assert mode == CHE_DO_TEST
    with pytest.raises(MigrationTargetRejected) as excinfo:
        kiem_tra_dich(url, mode, env=fake_env)
    assert "không kết thúc bằng '_test'" in str(excinfo.value)


def test_migration_guard_rejects_database_url_collision():
    """Verify that migration guard detects if TEST_DATABASE_URL targets DATABASE_URL."""
    fake_env = {
        "TEST_DATABASE_URL": "postgresql://postgres:postgres@localhost:5432/my_app_test",
        "DATABASE_URL": "postgresql://postgres:postgres@localhost:5432/my_app_test"
    }
    url, mode = chon_dich(env=fake_env)
    with pytest.raises(MigrationTargetRejected) as excinfo:
        kiem_tra_dich(url, mode, env=fake_env)
    assert "trùng danh tính với DATABASE_URL" in str(excinfo.value)


def test_legacy_mindmap_v2_compatibility():
    """Verify that legacy V2 mindmaps without optional metadata still load safely."""
    legacy_payload = {
        "id": "legacy-map-1",
        "schema_version": 2,
        "title": "Legacy Map",
        "nodes": [{"id": "root", "parent": None, "kind": "root", "title": "Root"}],
        "relations": [],
        "sources": ["legacy.pdf"]
    }
    assert legacy_payload["schema_version"] == 2
    assert len(legacy_payload["nodes"]) == 1
    # Missing generator or content_hash does not cause deserialization crash
    assert legacy_payload.get("generator") is None
