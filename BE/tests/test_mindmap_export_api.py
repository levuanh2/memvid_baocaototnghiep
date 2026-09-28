"""Export Studio backend job API (Section 8): auth, ownership, node-membership
and format-option validation, idempotency, and the download token path. The
worker itself is run SYNCHRONOUSLY in these tests (enqueue_job patched to
call the function directly) so job completion is deterministic — a real
background-thread dispatch is exercised by the fact this is the SAME
enqueue_job every other job type already uses in production, not a new path.
"""
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


@pytest.fixture()
def sync_enqueue(monkeypatch):
    """Runs the export job inline instead of on a daemon thread, so tests
    don't need to poll for completion."""
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


def _rec(i="m1", nodes=None):
    return {
        "id": i, "schema_version": 2, "title": "Bản đồ tư duy", "sources": ["doc_a"],
        "content_hash": "h" * 64, "created_at": "2026-07-13T00:00:00Z",
        "nodes": nodes or [
            {"id": "root", "parent": None, "kind": "root", "title": "Bản đồ tư duy", "order": 0},
            {"id": "c1", "parent": "root", "kind": "section", "title": "Kiến trúc hệ thống", "order": 0},
        ],
        "relations": [], "generator": {"degraded": False, "missing": []},
    }


def _stub_get_record(monkeypatch, be, owner="userA", record=None):
    from app.domains.mindmap import store
    rec = record or _rec()
    monkeypatch.setattr(store, "get_record", lambda mid, user_id=None, enforce_owner=False: (
        rec if (not enforce_owner or user_id == owner) and mid == rec["id"] else None
    ))
    return rec


# ---- auth / ownership -------------------------------------------------------

def test_export_routes_401_without_token(be, client, monkeypatch):
    _protect(be, monkeypatch, None, on=True)
    assert client.post("/mindmaps/m1/exports", json={"format": "docx"}).status_code == 401
    assert client.get("/mindmaps/exports/j1").status_code == 401
    assert client.post("/mindmaps/exports/j1/cancel").status_code == 401


def test_export_foreign_map_404(be, client, monkeypatch):
    _stub_get_record(monkeypatch, be, owner="userA")
    _protect(be, monkeypatch, "userB", on=True)
    resp = client.post("/mindmaps/m1/exports", json={"format": "docx"})
    assert resp.status_code == 404


def test_status_cancel_owner_isolation(be, client, monkeypatch):
    from app.domains.jobs import jobs_store as js
    monkeypatch.setattr(js, "get_job", lambda jid: {
        "job_id": jid, "job_type": "mindmap_export", "status": "running", "progress": 10,
        "stage": "building", "result": None, "error": None, "error_code": None, "user_id": "userA",
    })
    cancelled = {}
    monkeypatch.setattr(js, "request_cancel", lambda jid: cancelled.setdefault("jid", jid))
    _protect(be, monkeypatch, "userA", on=True)
    assert client.get("/mindmaps/exports/mj").status_code == 200
    assert client.post("/mindmaps/exports/mj/cancel").status_code == 200 and cancelled.get("jid") == "mj"
    cancelled.clear()
    _protect(be, monkeypatch, "userB", on=True)
    assert client.get("/mindmaps/exports/mj").status_code == 404
    assert client.post("/mindmaps/exports/mj/cancel").status_code == 404
    assert cancelled == {}


# ---- request validation ------------------------------------------------------

def test_invalid_format_rejected(be, client, monkeypatch):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.post("/mindmaps/m1/exports", json={"format": "csv"})
    assert resp.status_code == 400
    assert resp.get_json()["error_code"] == "invalid_format"


def test_unknown_node_id_rejected(be, client, monkeypatch):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.post("/mindmaps/m1/exports", json={
        "format": "docx", "scope": {"scope_type": "current_branch", "selected_node_id": "does-not-exist"},
    })
    assert resp.status_code == 400
    assert resp.get_json()["error_code"] == "unknown_node_id"


def test_pdf_map_mode_without_image_rejected(be, client, monkeypatch):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.post("/mindmaps/m1/exports", json={"format": "pdf", "options": {"mode": "map"}})
    assert resp.status_code == 400
    assert resp.get_json()["error_code"] == "missing_map_image"


def test_invalid_pdf_mode_rejected(be, client, monkeypatch):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.post("/mindmaps/m1/exports", json={"format": "pdf", "options": {"mode": "bogus"}})
    assert resp.status_code == 400
    assert resp.get_json()["error_code"] == "invalid_pdf_mode"


# ---- idempotency --------------------------------------------------------------

def test_idempotency_same_key_returns_same_job(be, client, monkeypatch, sync_enqueue, export_dir):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    body = {"format": "docx", "idempotency_key": "k1"}
    r1 = client.post("/mindmaps/m1/exports", json=body)
    r2 = client.post("/mindmaps/m1/exports", json=body)
    assert r1.status_code == 202 and r2.status_code == 202
    assert r1.get_json()["job_id"] == r2.get_json()["job_id"]


def test_idempotency_key_reused_with_different_payload_conflicts(be, client, monkeypatch, sync_enqueue, export_dir):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    client.post("/mindmaps/m1/exports", json={"format": "docx", "idempotency_key": "k2"})
    resp = client.post("/mindmaps/m1/exports", json={"format": "xlsx", "idempotency_key": "k2"})
    assert resp.status_code == 409
    assert resp.get_json()["error_code"] == "idempotency_conflict"


# ---- end-to-end: create -> poll -> download ------------------------------------

def test_docx_export_end_to_end_real_file_download(be, client, monkeypatch, sync_enqueue, export_dir):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)

    create = client.post("/mindmaps/m1/exports", json={"format": "docx"})
    assert create.status_code == 202
    job_id = create.get_json()["job_id"]

    status = client.get(f"/mindmaps/exports/{job_id}")
    assert status.status_code == 200
    body = status.get_json()
    assert body["status"] == "done"
    assert body["download_url"]

    download = client.get(body["download_url"])
    assert download.status_code == 200
    assert download.data[:2] == b"PK"  # real docx (zip) bytes, not a stub
    assert download.mimetype == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def test_download_requires_valid_token_or_owner(be, client, monkeypatch, sync_enqueue, export_dir):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    create = client.post("/mindmaps/m1/exports", json={"format": "xlsx"})
    job_id = create.get_json()["job_id"]

    # No token, foreign user -> 401.
    _protect(be, monkeypatch, "userB", on=True)
    assert client.get(f"/mindmaps/exports/{job_id}/download").status_code == 401

    # Owner, no token, bearer path -> allowed.
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.get(f"/mindmaps/exports/{job_id}/download")
    assert resp.status_code == 200

    # Tampered token -> 401 even for the real owner request path without a session.
    _protect(be, monkeypatch, None, on=True)
    assert client.get(f"/mindmaps/exports/{job_id}/download?token=not-a-real-token").status_code == 401


def test_download_not_ready_returns_409(be, client, monkeypatch):
    from app.domains.jobs import jobs_store as js
    monkeypatch.setattr(js, "get_job", lambda jid: {
        "job_id": jid, "job_type": "mindmap_export", "status": "running", "user_id": "userA", "result": None,
    })
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.get("/mindmaps/exports/mj/download")
    assert resp.status_code == 409
    assert resp.get_json()["error_code"] == "not_ready"
