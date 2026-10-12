"""PR E — Phase 3: stale visible-snapshot defense, tested at the worker
boundary (`run_export_job`) directly — exercises the SECOND, independent
record fetch against record states that differ from what the route saw.

Policy under test (services/mindmap/export/scope.py's
visible_snapshot_fingerprint, called from app/application/mindmap_export.py):
  - a visible node's content changed (title/note/citations)       -> stale
  - a visible node was deleted                                     -> stale
    (caught by resolve_export_scope's own unknown/ancestor checks,
    not the fingerprint -- the deleted id simply vanishes from the
    fresh fetch)
  - a visible node was re-parented                                 -> stale
  - a node OUTSIDE the visible set was added                       -> NOT stale
  - a node OUTSIDE the visible set was edited                      -> NOT stale
"""
from __future__ import annotations

from app.application.mindmap_export import run_export_job
from services.mindmap.export.scope import resolve_export_scope, visible_snapshot_fingerprint


def _nodes(c_title="C"):
    return [
        {"id": "root", "parent": None, "kind": "root", "title": "Root", "order": 0},
        {"id": "a", "parent": "root", "kind": "section", "title": "A", "order": 0},
        {"id": "b", "parent": "a", "kind": "section", "title": "B", "order": 0},
        {"id": "c", "parent": "b", "kind": "idea", "title": c_title, "order": 0},
        {"id": "e", "parent": "root", "kind": "section", "title": "E", "order": 1},
        {"id": "f", "parent": "e", "kind": "idea", "title": "F", "order": 0},
    ]


def _rec(nodes):
    return {"id": "m1", "schema_version": 2, "title": "Bản đồ", "nodes": nodes, "relations": []}


VISIBLE = ["root", "a", "b", "e"]  # "c"/"f" NOT in the visible snapshot


def _run(monkeypatch, tmp_path, record_at_run_time, visible_ids=VISIBLE, fingerprint_from=None):
    from app.domains.jobs import export_jobs
    from app.domains.mindmap import store as mindmap_store
    from app.domains.jobs import jobs_store

    monkeypatch.setattr(mindmap_store, "get_record", lambda mid, user_id=None, enforce_owner=False: record_at_run_time)
    monkeypatch.setattr(export_jobs, "export_output_dir", lambda: tmp_path)
    jobs_store.create_job("j1", job_type=export_jobs.EXPORT_JOB_TYPE, status="pending", current_node="Queued", map_id="m1")

    scope_params = {"scope_type": "visible", "visible_node_ids": visible_ids, "include_descendants": False}
    fp_source = fingerprint_from if fingerprint_from is not None else record_at_run_time
    expected_fp = visible_snapshot_fingerprint(fp_source["nodes"], fp_source.get("relations") or [], set(visible_ids))

    run_export_job("j1", "m1", None, "pdf", scope_params, {"mode": "outline"}, None, expected_fp)
    return jobs_store.get_job("j1")


def test_no_change_between_route_and_worker_succeeds(monkeypatch, tmp_path):
    rec = _rec(_nodes())
    job = _run(monkeypatch, tmp_path, rec)
    assert job["status"] == "done"


def test_visible_node_content_changed_is_stale(monkeypatch, tmp_path):
    route_time = _rec(_nodes())  # "a" title "A"
    worker_time = _rec(_nodes())
    worker_time["nodes"][1]["title"] = "A (edited)"  # "a" is in VISIBLE
    job = _run(monkeypatch, tmp_path, worker_time, fingerprint_from=route_time)
    assert job["status"] == "error"
    assert job["error_code"] == "stale_visible_snapshot"


def test_visible_node_deleted_is_stale_via_unknown_id(monkeypatch, tmp_path):
    route_time = _rec(_nodes())
    worker_time = _rec([n for n in _nodes() if n["id"] != "a"])  # "a" (visible) deleted; "b" now orphaned
    job = _run(monkeypatch, tmp_path, worker_time, fingerprint_from=route_time)
    assert job["status"] == "error"
    assert job["error_code"] in ("unknown_node_id", "ancestor_not_closed")


def test_visible_node_reparented_is_stale(monkeypatch, tmp_path):
    route_time = _rec(_nodes())
    worker_time = _rec(_nodes())
    worker_time["nodes"][2]["parent"] = "e"  # "b" (visible) moved from under "a" to under "e"
    job = _run(monkeypatch, tmp_path, worker_time, fingerprint_from=route_time)
    assert job["status"] == "error"
    assert job["error_code"] in ("stale_visible_snapshot", "ancestor_not_closed")


def test_node_added_outside_visible_set_is_not_stale(monkeypatch, tmp_path):
    route_time = _rec(_nodes())
    worker_time = _rec(_nodes())
    worker_time["nodes"].append({"id": "g", "parent": "f", "kind": "idea", "title": "G (new)", "order": 0})
    job = _run(monkeypatch, tmp_path, worker_time, fingerprint_from=route_time)
    assert job["status"] == "done"


def test_node_edited_outside_visible_set_is_not_stale(monkeypatch, tmp_path):
    route_time = _rec(_nodes(c_title="C"))
    worker_time = _rec(_nodes(c_title="C (edited, not in visible set)"))
    job = _run(monkeypatch, tmp_path, worker_time, fingerprint_from=route_time)
    assert job["status"] == "done"


def test_worker_never_leaves_job_stuck_in_running_on_stale(monkeypatch, tmp_path):
    route_time = _rec(_nodes())
    worker_time = _rec(_nodes())
    worker_time["nodes"][1]["title"] = "A (edited)"
    job = _run(monkeypatch, tmp_path, worker_time, fingerprint_from=route_time)
    assert job["status"] in ("error", "done")
    assert job["status"] != "running"
