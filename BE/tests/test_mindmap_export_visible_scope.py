"""PR E — Document Visible Export, Section 5/7 red tests. Written against
the CURRENT origin/main code (no implementation changes in this commit):
`scope_type="visible"` is rejected synchronously with 400 `invalid_scope_type`
(BE/app/main.py's `_EXPORT_SCOPE_TYPES`), and `services.mindmap.export.scope`
has no `visible_node_ids` concept at all (its own docstring explicitly says
so — see scope.py's module header).

Tree fixture (reused shape from the mindmap-depth-preset-indicator-intent
PR's own fixtures — root with a 3-level chain and a 2-level second branch):
  root
    a (order 0) -> b -> c          (depth 1/2/3)
    e (order 1) -> f               (depth 1/2)

Every assertion below states the TARGET behavior once implemented (exact
error_code, exact included_ids) — none of these are "doesn't raise yet"
placeholders. They are expected to fail against unmodified origin/main.
"""
from __future__ import annotations

import pytest

from services.mindmap.export.scope import (
    resolve_export_scope, UnknownNodeIdError, NoSelectionError, ExportScopeError,
)


def _nodes():
    return [
        {"id": "root", "parent": None, "kind": "root", "title": "Root", "order": 0},
        {"id": "a", "parent": "root", "kind": "section", "title": "A", "order": 0},
        {"id": "b", "parent": "a", "kind": "section", "title": "B", "order": 0},
        {"id": "c", "parent": "b", "kind": "idea", "title": "C", "order": 0},
        {"id": "e", "parent": "root", "kind": "section", "title": "E", "order": 1},
        {"id": "f", "parent": "e", "kind": "idea", "title": "F", "order": 0},
    ]


def _rec(i="m1", nodes=None):
    return {
        "id": i, "schema_version": 2, "title": "Bản đồ tư duy", "sources": ["doc_a"],
        "content_hash": "h" * 64, "created_at": "2026-07-13T00:00:00Z",
        "nodes": nodes if nodes is not None else _nodes(),
        "relations": [], "generator": {"degraded": False, "missing": []},
    }


# ---- Section 5: resolve_export_scope-level red tests (real future contract) ----

def test_visible_root_only_resolves_to_exactly_the_root():
    result = resolve_export_scope(_nodes(), scope_type="visible", visible_node_ids=["root"], include_descendants=False)
    assert result["root_ids"] == ["root"]
    assert result["included_ids"] == {"root"}


def test_visible_depth2_resolves_to_the_canonical_depth2_tree():
    result = resolve_export_scope(
        _nodes(), scope_type="visible", visible_node_ids=["root", "a", "b", "e", "f"], include_descendants=False,
    )
    assert result["included_ids"] == {"root", "a", "b", "e", "f"}


def test_visible_partial_collapse_keeps_exactly_the_given_ancestor_closed_set():
    # "a" branch collapsed at depth1 (only "a" itself visible), "e" branch
    # fully open (e, f visible) -- a real partial-collapse shape.
    result = resolve_export_scope(
        _nodes(), scope_type="visible", visible_node_ids=["root", "a", "e", "f"], include_descendants=False,
    )
    assert result["included_ids"] == {"root", "a", "e", "f"}


def test_visible_full_tree_resolves_to_every_node():
    result = resolve_export_scope(
        _nodes(), scope_type="visible", visible_node_ids=["root", "a", "b", "c", "e", "f"], include_descendants=False,
    )
    assert result["included_ids"] == {"root", "a", "b", "c", "e", "f"}


def test_visible_unknown_id_rejected():
    with pytest.raises(UnknownNodeIdError):
        resolve_export_scope(_nodes(), scope_type="visible", visible_node_ids=["root", "does-not-exist"], include_descendants=False)


def test_visible_cross_map_id_rejected_as_plain_unknown_no_existence_leak():
    # A real id from a DIFFERENT map must read exactly like a fabricated one.
    with pytest.raises(UnknownNodeIdError):
        resolve_export_scope(_nodes(), scope_type="visible", visible_node_ids=["root", "node-from-another-map"], include_descendants=False)


def test_visible_missing_root_rejected_with_its_own_error():
    from services.mindmap.export.scope import VisibleRootMissingError
    with pytest.raises(VisibleRootMissingError):
        resolve_export_scope(_nodes(), scope_type="visible", visible_node_ids=["a", "b"], include_descendants=False)


def test_visible_descendant_without_ancestor_rejected():
    from services.mindmap.export.scope import AncestorNotClosedError
    # "c" present but its parent "b" is NOT -- breaks ancestor-closure.
    with pytest.raises(AncestorNotClosedError):
        resolve_export_scope(_nodes(), scope_type="visible", visible_node_ids=["root", "a", "c"], include_descendants=False)


def test_visible_duplicate_ids_rejected_not_deduped():
    from services.mindmap.export.scope import DuplicateNodeIdError
    with pytest.raises(DuplicateNodeIdError):
        resolve_export_scope(_nodes(), scope_type="visible", visible_node_ids=["root", "a", "a"], include_descendants=False)


def test_visible_include_descendants_true_rejected():
    from services.mindmap.export.scope import InvalidVisibleScopeError
    with pytest.raises(InvalidVisibleScopeError):
        resolve_export_scope(_nodes(), scope_type="visible", visible_node_ids=["root"], include_descendants=True)


@pytest.mark.parametrize("bad_ids", [
    None, "root", 123, [], [None], [123], [""], [["root"]], [{"id": "root"}],
])
def test_visible_malformed_ids_shape_rejected(bad_ids):
    from services.mindmap.export.scope import InvalidVisibleScopeError
    with pytest.raises(InvalidVisibleScopeError):
        resolve_export_scope(_nodes(), scope_type="visible", visible_node_ids=bad_ids, include_descendants=False)


def test_visible_id_over_max_length_rejected():
    from services.mindmap.export.scope import InvalidVisibleScopeError
    too_long = "x" * 513  # MAX_VISIBLE_NODE_ID_LENGTH = 512
    with pytest.raises(InvalidVisibleScopeError):
        resolve_export_scope(_nodes(), scope_type="visible", visible_node_ids=["root", too_long], include_descendants=False)


def test_visible_over_count_limit_rejected():
    from services.mindmap.export.scope import InvalidVisibleScopeError
    # len(nodes) here is 6 -- any request over that (and well under the 5000
    # hard ceiling) must still reject deterministically, not silently pass
    # through to the per-id unknown-id loop.
    huge = ["root"] + [f"id-{i}" for i in range(50)]
    with pytest.raises(InvalidVisibleScopeError):
        resolve_export_scope(_nodes(), scope_type="visible", visible_node_ids=huge, include_descendants=False)


def test_full_current_branch_selected_branches_unaffected_by_visible_contract():
    # Guard: existing scope types must keep working exactly as today.
    result = resolve_export_scope(_nodes(), scope_type="full")
    assert result["included_ids"] == {"root", "a", "b", "c", "e", "f"}
    result = resolve_export_scope(_nodes(), scope_type="current_branch", selected_node_id="a")
    assert result["included_ids"] == {"a", "b", "c"}
    result = resolve_export_scope(_nodes(), scope_type="selected_branches", selected_branch_root_ids=["a", "e"])
    assert result["included_ids"] == {"a", "b", "c", "e", "f"}


# ---- Section 5 + 7: route-level (Flask test client) red tests ----

def _protect(main, monkeypatch, uid, on=True):
    monkeypatch.setattr(main, "_auth_protect_enabled", lambda: on)
    monkeypatch.setattr(main, "_current_user_id", lambda: uid)


@pytest.fixture()
def be(client):
    import app.main as main
    return main


@pytest.fixture()
def sync_enqueue(monkeypatch):
    from app.jobs import queue as queue_mod

    def _run_now(func, args=(), queue: str = "ingest", job_id=None, **kwargs):
        func(*args)
        return {"mode": "thread"}

    monkeypatch.setattr(queue_mod, "enqueue_job", _run_now)


@pytest.fixture()
def export_dir(tmp_path, monkeypatch):
    from app.domains.jobs import export_jobs
    monkeypatch.setattr(export_jobs, "export_output_dir", lambda: tmp_path)
    return tmp_path


def _stub_get_record(monkeypatch, be, owner="userA", record=None):
    from app.domains.mindmap import store
    rec = record or _rec()
    monkeypatch.setattr(store, "get_record", lambda mid, user_id=None, enforce_owner=False: (
        rec if (not enforce_owner or user_id == owner) and mid == rec["id"] else None
    ))
    return rec


def test_visible_root_only_end_to_end(be, client, monkeypatch, sync_enqueue, export_dir):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    create = client.post("/mindmaps/m1/exports", json={
        "format": "pdf",
        "scope": {"scope_type": "visible", "visible_node_ids": ["root"], "include_descendants": False},
    })
    assert create.status_code == 202
    job_id = create.get_json()["job_id"]
    status = client.get(f"/mindmaps/exports/{job_id}")
    assert status.get_json()["status"] == "done"
    assert status.get_json()["result"]["node_count"] == 1


def test_visible_depth2_end_to_end(be, client, monkeypatch, sync_enqueue, export_dir):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    create = client.post("/mindmaps/m1/exports", json={
        "format": "pdf",
        "scope": {"scope_type": "visible", "visible_node_ids": ["root", "a", "b", "e", "f"], "include_descendants": False},
    })
    assert create.status_code == 202
    job_id = create.get_json()["job_id"]
    status = client.get(f"/mindmaps/exports/{job_id}")
    assert status.get_json()["status"] == "done"
    assert status.get_json()["result"]["node_count"] == 5


def test_visible_cross_map_id_rejected_at_route(be, client, monkeypatch):
    _stub_get_record(monkeypatch, be, owner="userA")
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.post("/mindmaps/m1/exports", json={
        "format": "pdf",
        "scope": {"scope_type": "visible", "visible_node_ids": ["root", "node-from-another-map"], "include_descendants": False},
    })
    assert resp.status_code == 400
    assert resp.get_json()["error_code"] == "unknown_node_id"


def test_visible_missing_root_rejected_at_route(be, client, monkeypatch):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.post("/mindmaps/m1/exports", json={
        "format": "pdf", "scope": {"scope_type": "visible", "visible_node_ids": ["a"], "include_descendants": False},
    })
    assert resp.status_code == 400
    assert resp.get_json()["error_code"] == "visible_root_missing"


def test_visible_duplicate_rejected_at_route(be, client, monkeypatch):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.post("/mindmaps/m1/exports", json={
        "format": "pdf", "scope": {"scope_type": "visible", "visible_node_ids": ["root", "root"], "include_descendants": False},
    })
    assert resp.status_code == 400
    assert resp.get_json()["error_code"] == "duplicate_node_id"


def test_visible_orphan_descendant_rejected_at_route(be, client, monkeypatch):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.post("/mindmaps/m1/exports", json={
        "format": "pdf", "scope": {"scope_type": "visible", "visible_node_ids": ["root", "a", "c"], "include_descendants": False},
    })
    assert resp.status_code == 400
    assert resp.get_json()["error_code"] == "ancestor_not_closed"


def test_visible_include_descendants_true_rejected_at_route(be, client, monkeypatch):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.post("/mindmaps/m1/exports", json={
        "format": "pdf", "scope": {"scope_type": "visible", "visible_node_ids": ["root"], "include_descendants": True},
    })
    assert resp.status_code == 400
    assert resp.get_json()["error_code"] == "invalid_visible_scope"


@pytest.mark.parametrize("bad_ids", [None, "root", 123, [], [None], [""]])
def test_visible_malformed_ids_rejected_at_route(be, client, monkeypatch, bad_ids):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.post("/mindmaps/m1/exports", json={
        "format": "pdf", "scope": {"scope_type": "visible", "visible_node_ids": bad_ids, "include_descendants": False},
    })
    assert resp.status_code == 400
    assert resp.get_json()["error_code"] == "invalid_visible_scope"


def test_visible_oversized_payload_rejected_at_route(be, client, monkeypatch):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    huge = ["root"] + [f"id-{i}" for i in range(6000)]
    resp = client.post("/mindmaps/m1/exports", json={
        "format": "pdf", "scope": {"scope_type": "visible", "visible_node_ids": huge, "include_descendants": False},
    })
    assert resp.status_code == 400
    assert resp.get_json()["error_code"] == "invalid_visible_scope"


def test_full_current_branch_selected_branches_status_code_unaffected(be, client, monkeypatch, sync_enqueue, export_dir):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    for scope in (
        {"scope_type": "full"},
        {"scope_type": "current_branch", "selected_node_id": "a"},
        {"scope_type": "selected_branches", "selected_branch_root_ids": ["a", "e"]},
    ):
        resp = client.post("/mindmaps/m1/exports", json={"format": "pdf", "scope": scope})
        assert resp.status_code == 202, scope


def test_legacy_full_scope_job_status_and_download_unaffected(be, client, monkeypatch, sync_enqueue, export_dir):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    create = client.post("/mindmaps/m1/exports", json={"format": "pdf"})
    assert create.status_code == 202
    job_id = create.get_json()["job_id"]
    status = client.get(f"/mindmaps/exports/{job_id}")
    assert status.get_json()["status"] == "done"
    download = client.get(status.get_json()["download_url"])
    assert download.status_code == 200
    assert download.data[:4] == b"%PDF"


# ---- Phase 4: idempotency with canonicalized visible_node_ids ----

def test_idempotency_same_visible_set_different_order_same_fingerprint(be, client, monkeypatch, sync_enqueue, export_dir):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    r1 = client.post("/mindmaps/m1/exports", json={
        "format": "pdf", "idempotency_key": "visible-k1",
        "scope": {"scope_type": "visible", "visible_node_ids": ["root", "a", "e"], "include_descendants": False},
    })
    r2 = client.post("/mindmaps/m1/exports", json={
        "format": "pdf", "idempotency_key": "visible-k1",
        "scope": {"scope_type": "visible", "visible_node_ids": ["e", "root", "a"], "include_descendants": False},
    })
    assert r1.status_code == 202 and r2.status_code == 202
    assert r1.get_json()["job_id"] == r2.get_json()["job_id"]


def test_idempotency_different_visible_set_same_key_conflicts(be, client, monkeypatch, sync_enqueue, export_dir):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    client.post("/mindmaps/m1/exports", json={
        "format": "pdf", "idempotency_key": "visible-k2",
        "scope": {"scope_type": "visible", "visible_node_ids": ["root"], "include_descendants": False},
    })
    resp = client.post("/mindmaps/m1/exports", json={
        "format": "pdf", "idempotency_key": "visible-k2",
        "scope": {"scope_type": "visible", "visible_node_ids": ["root", "a"], "include_descendants": False},
    })
    assert resp.status_code == 409
    assert resp.get_json()["error_code"] == "idempotency_conflict"
