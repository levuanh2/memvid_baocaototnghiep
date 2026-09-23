"""guided_worker.run_once() force-flag gating (2026-09-23 fix).

Root cause: `force` was computed in app/main.py's /generate-mindmap handler
and only gated THAT handler's own immediate cache lookup -- it was never
persisted onto the durable job row, so this worker's own independent
content-hash cache check always reused a matching existing record regardless
of what the original request asked for. Fixed by persisting `force` as a
real column (guided_mindmap_jobs.force) and reading it back here.

Unit-level: mocks app.main and guided_store so no real Postgres is needed.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import app.jobs.guided_worker as gw


def _job(force: bool = False):
    return {"job_id": "job-1", "user_id": "user-1", "source_ids": ["doc_txt"],
            "guided_config": None, "force": force}


def test_force_false_reuses_existing_cache_and_skips_generation():
    """Case A: force=false, matching content hash exists -> cached reused."""
    job = _job(force=False)
    existing = {"id": "map-1"}
    with patch("app.domains.jobs.guided_store.claim_next_job", return_value=job), \
         patch("app.domains.jobs.guided_store.update_job") as mock_update, \
         patch("app.domains.jobs.guided_store.record_worker_heartbeat"), \
         patch("app.main._mindmap_input_and_hash", return_value=({"chunks": []}, "hash1")), \
         patch("app.main.mindmap_store") as mock_store, \
         patch("app.main.run_mindmap_job") as mock_run:
        mock_store.get_by_hash.return_value = existing
        result = gw.run_once("worker-1")

    assert result is True
    mock_store.get_by_hash.assert_called_once_with("hash1", user_id="user-1", enforce_owner=True)
    mock_run.assert_not_called()
    mock_update.assert_called_once_with("job-1", status="done", stage="done",
                                        result_map_id="map-1", result=existing)


def test_force_true_bypasses_cache_and_runs_fresh_generation():
    """Case B: force=true, matching cached artifact exists -> fresh pipeline runs anyway."""
    job = _job(force=True)
    with patch("app.domains.jobs.guided_store.claim_next_job", return_value=job), \
         patch("app.domains.jobs.guided_store.update_job") as mock_update, \
         patch("app.domains.jobs.guided_store.record_worker_heartbeat"), \
         patch("app.main._mindmap_input_and_hash", return_value=({"chunks": []}, "hash1")), \
         patch("app.main.mindmap_store") as mock_store, \
         patch("app.main.run_mindmap_job") as mock_run:
        mock_store.get_by_hash.return_value = {"id": "map-1"}  # exists, but must be ignored
        result = gw.run_once("worker-1")

    assert result is True
    mock_store.get_by_hash.assert_not_called()  # Case D half: no cache lookup at all
    mock_run.assert_called_once_with("job-1", ["doc_txt"], {"chunks": []}, "hash1",
                                     "user-1", already_claimed=True)
    mock_update.assert_not_called()  # done/result is written by run_mindmap_job's own graph, not here


def test_force_true_produces_exactly_one_generation_call():
    """Case D: force=true -> exactly one fresh job/result path, no duplicate work."""
    job = _job(force=True)
    with patch("app.domains.jobs.guided_store.claim_next_job", return_value=job), \
         patch("app.domains.jobs.guided_store.update_job"), \
         patch("app.domains.jobs.guided_store.record_worker_heartbeat"), \
         patch("app.main._mindmap_input_and_hash", return_value=({"chunks": []}, "hash1")), \
         patch("app.main.mindmap_store") as mock_store, \
         patch("app.main.run_mindmap_job") as mock_run:
        gw.run_once("worker-1")

    assert mock_run.call_count == 1
    assert mock_store.get_by_hash.call_count == 0


def test_force_missing_from_job_defaults_to_reuse_behavior():
    """Case E half: an older/legacy row with no `force` key must not crash and
    must behave like force=false (the pre-fix, always-reuse default)."""
    job = _job(force=False)
    del job["force"]
    with patch("app.domains.jobs.guided_store.claim_next_job", return_value=job), \
         patch("app.domains.jobs.guided_store.update_job") as mock_update, \
         patch("app.domains.jobs.guided_store.record_worker_heartbeat"), \
         patch("app.main._mindmap_input_and_hash", return_value=({"chunks": []}, "hash1")), \
         patch("app.main.mindmap_store") as mock_store, \
         patch("app.main.run_mindmap_job") as mock_run:
        mock_store.get_by_hash.return_value = {"id": "map-1"}
        gw.run_once("worker-1")

    mock_store.get_by_hash.assert_called_once()
    mock_run.assert_not_called()
