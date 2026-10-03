"""Regression for the P0: run_mindmap_job() must not reject a legacy V2 job
just because it's absent from the Guided V3 Postgres ledger (guided_store
only tracks Guided jobs; V2 jobs live in the separate legacy jobs_store).
"""
from __future__ import annotations

from unittest.mock import patch

from app.application import mindmap_generation as mg


def _run(monkeypatch, guided_job, graph_invoked):
    monkeypatch.setattr(
        mg, "_langgraph_invoke",
        lambda *a, **k: (graph_invoked.append(True), {"result": {}})[1],
    )
    with patch("app.domains.jobs.guided_store.use_postgres", return_value=True), \
         patch("app.domains.jobs.guided_store.get_job", return_value=guided_job), \
         patch("app.domains.jobs.guided_store.update_job"):
        mg.run_mindmap_job("job-1", ["doc"], {}, "hash", "user-1", graph=object())


def test_legacy_job_absent_from_ledger_still_runs(monkeypatch):
    """job_id not in guided_mindmap_jobs at all -> legacy V2 job -> must proceed."""
    invoked = []
    _run(monkeypatch, guided_job=None, graph_invoked=invoked)
    assert invoked == [True]


def test_guided_job_unclaimed_still_rejected(monkeypatch):
    """job_id IS in the ledger but has no lease_owner -> genuinely unclaimed -> reject."""
    invoked = []
    _run(monkeypatch, guided_job={"job_id": "job-1", "lease_owner": None}, graph_invoked=invoked)
    assert invoked == []


def test_guided_job_claimed_runs(monkeypatch):
    """job_id is in the ledger and has a lease_owner -> properly claimed -> proceed."""
    invoked = []
    _run(monkeypatch, guided_job={"job_id": "job-1", "lease_owner": "mindmap:123:abcd"}, graph_invoked=invoked)
    assert invoked == [True]
