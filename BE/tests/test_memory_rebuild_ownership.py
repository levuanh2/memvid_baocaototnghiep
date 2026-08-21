"""Auth Hardening Phase D — memory-tree and stats ownership."""

from __future__ import annotations

import json

import pytest


def _protect(main, monkeypatch, uid, on=True):
    monkeypatch.setattr(main, "_auth_protect_enabled", lambda: on)
    monkeypatch.setattr(main, "_current_user_id", lambda: uid)


@pytest.fixture()
def be(client):
    import app.main as main
    return main


def _seed_index_and_registry(be, monkeypatch):
    be.INDEX_META_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    be.INDEX_META_JSON_PATH.write_text(json.dumps({
        "0": {"source_stem": "doc_a"},
        "1": {"source_stem": "doc_b"},
        "2": {"source_stem": "doc_l"},  # legacy, no owner
    }), encoding="utf-8")
    # Từ Phase 2 quyền sở hữu đọc từ bảng documents — giả lập qua _load_source_registry.
    monkeypatch.setattr(be, "_load_source_registry", lambda: {
        "idA": {"source_stem": "doc_a", "filename": "a.md", "user_id": "userA"},
        "idB": {"source_stem": "doc_b", "filename": "b.md", "user_id": "userB"},
        "idL": {"source_stem": "doc_l", "filename": "l.md"},
    })


# ---- 401 when protected, no token ------------------------------------------

def test_routes_401_without_token(be, client, monkeypatch):
    _protect(be, monkeypatch, None, on=True)
    assert client.get("/memory-tree-status").status_code == 401
    assert client.get("/memory-tree/doc_a").status_code == 401
    assert client.get("/stats").status_code == 401


# ---- memory-tree isolation -------------------------------------------------

def test_memory_tree_status_owner_scoped(be, client, monkeypatch):
    _seed_index_and_registry(be, monkeypatch)
    from app.domains.memory import tree
    monkeypatch.setattr(tree, "_load_memory_trees", lambda: [])
    _protect(be, monkeypatch, "userA", on=True)
    srcs = {s["source"] for s in client.get("/memory-tree-status").get_json()["sources"]}
    assert srcs == {"doc_a"}  # only owned; legacy doc_l hidden
    _protect(be, monkeypatch, "userB", on=True)
    srcs = {s["source"] for s in client.get("/memory-tree-status").get_json()["sources"]}
    assert srcs == {"doc_b"}
    # flag off → all sources visible (open)
    _protect(be, monkeypatch, None, on=False)
    srcs = {s["source"] for s in client.get("/memory-tree-status").get_json()["sources"]}
    assert srcs == {"doc_a", "doc_b", "doc_l"}


def test_memory_tree_get_owner_isolation(be, client, monkeypatch):
    _seed_index_and_registry(be, monkeypatch)
    from app.domains.memory import tree
    monkeypatch.setattr(tree, "_load_memory_trees", lambda: [
        {"source_stem": "doc_a", "status": "completed", "nodes": [{"type": "document"}]},
    ])
    # foreign stem → 404 (no oracle)
    _protect(be, monkeypatch, "userB", on=True)
    assert client.get("/memory-tree/doc_a").status_code == 404
    # owner → 200
    _protect(be, monkeypatch, "userA", on=True)
    assert client.get("/memory-tree/doc_a").status_code == 200


# ---- stats -----------------------------------------------------------------

def test_stats_requires_auth_when_protected(be, client, monkeypatch):
    _protect(be, monkeypatch, "userA", on=True)
    assert client.get("/stats").status_code == 200
    # flag off → open (unchanged)
    _protect(be, monkeypatch, None, on=False)
    assert client.get("/stats").status_code == 200
