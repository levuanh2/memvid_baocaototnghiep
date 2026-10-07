"""PR C1 fail-before (origin/main): the export-create route (POST
/mindmaps/<id>/exports) must reject DOCX/XLSX for a NEW job while PDF stays
allowed, and a legacy DOCX/XLSX job already queued/processed by the WORKER
(run_export_job — bypassing the route's own gate entirely, exactly like a
job that was queued before this change deployed) must still complete and
be readable via the existing status/download routes.

On origin/main: creating a DOCX/XLSX job via the route succeeds (202) —
`test_create_docx_rejected_after_format_gating` and
`test_create_xlsx_rejected_after_format_gating` are RED there. The
"legacy guard" tests are deliberately written to ALREADY PASS on
origin/main (they never touch the create route) — they exist to prove the
gating change introduced by this PR does not touch run_export_job,
jobs_store, or the status/download routes at all.
"""
from __future__ import annotations

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


def _rec(i="m1"):
    return {
        "id": i, "schema_version": 2, "title": "Bản đồ tư duy", "sources": ["doc_a"],
        "content_hash": "h" * 64, "created_at": "2026-07-13T00:00:00Z",
        "nodes": [
            {"id": "root", "parent": None, "kind": "root", "title": "Bản đồ tư duy", "order": 0},
            {"id": "c1", "parent": "root", "kind": "section", "title": "Kiến trúc hệ thống", "order": 0},
        ],
        "relations": [], "generator": {"degraded": False, "missing": []},
    }


def _stub_get_record(monkeypatch, owner="userA", record=None):
    from app.domains.mindmap import store
    rec = record or _rec()
    monkeypatch.setattr(store, "get_record", lambda mid, user_id=None, enforce_owner=False: (
        rec if (not enforce_owner or user_id == owner) and mid == rec["id"] else None
    ))
    return rec


# ---- new-job creation: DOCX/XLSX rejected, PDF still allowed ----------------

def test_create_docx_rejected_after_format_gating(be, client, monkeypatch):
    _stub_get_record(monkeypatch)
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.post("/mindmaps/m1/exports", json={"format": "docx"})
    assert resp.status_code == 400
    assert resp.get_json()["error_code"] == "invalid_format"


def test_create_xlsx_rejected_after_format_gating(be, client, monkeypatch):
    _stub_get_record(monkeypatch)
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.post("/mindmaps/m1/exports", json={"format": "xlsx"})
    assert resp.status_code == 400
    assert resp.get_json()["error_code"] == "invalid_format"


def test_create_pdf_still_allowed(be, client, monkeypatch, sync_enqueue, export_dir):
    _stub_get_record(monkeypatch)
    _protect(be, monkeypatch, "userA", on=True)
    create = client.post("/mindmaps/m1/exports", json={"format": "pdf"})
    assert create.status_code == 202
    job_id = create.get_json()["job_id"]
    status = client.get(f"/mindmaps/exports/{job_id}").get_json()
    assert status["status"] == "done"
    download = client.get(status["download_url"])
    assert download.status_code == 200
    assert download.data[:4] == b"%PDF"


# ---- legacy guard: a job the WORKER processes directly (never through the
# gated route — the shape of a job queued before this change deployed) must
# still complete and be readable through the ordinary status/download routes.

def test_legacy_docx_job_processed_by_worker_directly_still_downloads(be, client, monkeypatch, export_dir):
    from app.domains.jobs import jobs_store as js
    from app.application.mindmap_export import run_export_job
    from app.domains.mindmap import store
    rec = _stub_get_record(monkeypatch)
    monkeypatch.setattr(store, "get_record", lambda mid, **kwargs: rec if mid == rec["id"] else None)

    job_id = "legacy-docx-1"
    js.create_job(job_id, job_type="mindmap_export", status="pending", user_id="userA", map_id="m1")
    run_export_job(job_id, "m1", "userA", "docx", {"scope_type": "full"}, {"font": "sans", "content": {}}, None)

    _protect(be, monkeypatch, "userA", on=True)
    status = client.get(f"/mindmaps/exports/{job_id}").get_json()
    assert status["status"] == "done"
    download = client.get(status["download_url"])
    assert download.status_code == 200
    assert download.data[:2] == b"PK"


def test_legacy_xlsx_job_processed_by_worker_directly_still_downloads(be, client, monkeypatch, export_dir):
    from app.domains.jobs import jobs_store as js
    from app.application.mindmap_export import run_export_job
    from app.domains.mindmap import store
    rec = _stub_get_record(monkeypatch)
    monkeypatch.setattr(store, "get_record", lambda mid, **kwargs: rec if mid == rec["id"] else None)

    job_id = "legacy-xlsx-1"
    js.create_job(job_id, job_type="mindmap_export", status="pending", user_id="userA", map_id="m1")
    run_export_job(job_id, "m1", "userA", "xlsx", {"scope_type": "full"}, {"font": "sans", "content": {}}, None)

    _protect(be, monkeypatch, "userA", on=True)
    status = client.get(f"/mindmaps/exports/{job_id}").get_json()
    assert status["status"] == "done"
    download = client.get(status["download_url"])
    assert download.status_code == 200
    assert download.data[:2] == b"PK"
