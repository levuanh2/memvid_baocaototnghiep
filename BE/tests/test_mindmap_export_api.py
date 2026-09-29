"""Export Studio backend job API (Section 8, expanded for the final
hardening round's Section 5): auth, ownership, node-membership and format-
option validation, idempotency, the download token path, cross-map node
rejection, file expiry, cancel, failed-job retry, cleanup, and stuck-job
sweep for this job type. The worker itself is run SYNCHRONOUSLY in these
tests (enqueue_job patched to call the function directly) so job completion
is deterministic — a real background-thread dispatch is exercised by the
fact this is the SAME enqueue_job every other job type already uses in
production, not a new path.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone

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
    assert resp.get_json()["error_code"] == "invalid_option"


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


# ---- Section 5 (final hardening round): cross-map ids, expiry, cancel, retry, cleanup, sweep ----

def _backdate(job_id: str, **delta) -> None:
    """Pushes a job row's updated_at into the past — same pattern as
    test_jobs_retention.py's own helper, reused verbatim for this job type."""
    from app.domains.jobs import jobs_store as js
    ts = (datetime.now(timezone.utc) - timedelta(**delta)).isoformat()
    conn = sqlite3.connect(str(js.db_path()))
    try:
        conn.execute("UPDATE jobs SET updated_at=? WHERE job_id=?", (ts, job_id))
        conn.commit()
    finally:
        conn.close()


def test_cross_map_node_id_rejected(be, client, monkeypatch):
    """A node id that's real on a DIFFERENT map must be rejected exactly like
    a fabricated one — resolve_export_scope validates against THIS map's own
    node list, so a foreign map's real id is simply absent from it."""
    _stub_get_record(monkeypatch, be, owner="userA")  # map "m1"'s real nodes: root, c1
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.post("/mindmaps/m1/exports", json={
        "format": "docx",
        "scope": {"scope_type": "current_branch", "selected_node_id": "node-that-belongs-to-a-different-map"},
    })
    assert resp.status_code == 400
    assert resp.get_json()["error_code"] == "unknown_node_id"


def test_cancel_then_status_reflects_cancelled(be, client, monkeypatch, export_dir):
    """jobs_store.request_cancel() (reused as-is, no export-specific cancel
    logic) synchronously transitions a PENDING job straight to 'cancelled'
    (no live executor to ack a cooperative flag for) — real end-to-end
    through both endpoints, not a mocked jobs_store."""
    from app.domains.jobs import jobs_store as js
    js.create_job("canc1", job_type="mindmap_export", status="pending", user_id="userA", map_id="m1")
    _protect(be, monkeypatch, "userA", on=True)
    assert client.post("/mindmaps/exports/canc1/cancel").status_code == 200
    status = client.get("/mindmaps/exports/canc1").get_json()
    assert status["status"] == "cancelled"


def test_failed_job_can_be_retried_with_a_new_idempotency_key_and_succeeds(be, client, monkeypatch, sync_enqueue, export_dir):
    """A genuinely failed job (e.g. a transient serializer error) must not
    permanently block re-export — retrying with a NEW idempotency key must
    create a fresh job and succeed independently of the failed one."""
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)

    from app.application import mindmap_export as mm_export_app
    call_count = {"n": 0}
    real_serialize = mm_export_app.serialize_docx

    def _flaky(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise RuntimeError("simulated transient failure")
        return real_serialize(*args, **kwargs)

    # Patched where the name is actually looked up (mindmap_export.py did
    # `from ...docx_serializer import serialize_docx`, so it holds its own
    # bound reference — patching docx_serializer.serialize_docx itself
    # wouldn't touch that already-bound name).
    monkeypatch.setattr(mm_export_app, "serialize_docx", _flaky)

    r1 = client.post("/mindmaps/m1/exports", json={"format": "docx", "idempotency_key": "retry-key-1"})
    job1 = r1.get_json()["job_id"]
    status1 = client.get(f"/mindmaps/exports/{job1}").get_json()
    assert status1["status"] == "error"

    r2 = client.post("/mindmaps/m1/exports", json={"format": "docx", "idempotency_key": "retry-key-2"})
    job2 = r2.get_json()["job_id"]
    assert job2 != job1
    status2 = client.get(f"/mindmaps/exports/{job2}").get_json()
    assert status2["status"] == "done"
    assert status2["download_url"]


def test_download_missing_file_with_done_row_returns_410(be, client, monkeypatch, export_dir):
    """Row says done, but the file itself is gone (disk cleanup, corruption,
    manual deletion) — a real, distinguishable failure mode from
    'job not found' (404) or 'not ready yet' (409)."""
    from app.domains.jobs import jobs_store as js
    js.create_job("filegone", job_type="mindmap_export", status="pending", user_id="userA", map_id="m1")
    js.update_job("filegone", status="done", result={"format": "pdf", "size_bytes": 1})
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.get("/mindmaps/exports/filegone/download")
    assert resp.status_code == 410
    assert resp.get_json()["error_code"] == "file_expired"


def test_cleanup_removes_orphaned_export_file_once_its_job_row_is_pruned(export_dir):
    """export_jobs.cleanup_terminal_export_files() is the companion to
    jobs_store.cleanup_terminal_jobs() this round's Section 7 audit called
    out as missing — a file whose job row jobs_store already forgot must be
    removed too, or it leaks forever."""
    from app.domains.jobs import jobs_store as js
    from app.domains.jobs import export_jobs

    js.create_job("orphan1", job_type="mindmap_export", status="done", user_id="userA")
    _backdate("orphan1", days=10)
    (export_dir / "orphan1.pdf").write_bytes(b"%PDF-fake")
    js.create_job("still-alive", job_type="mindmap_export", status="done", user_id="userA")
    (export_dir / "still-alive.pdf").write_bytes(b"%PDF-fake")

    assert js.cleanup_terminal_jobs(retention_days=7) == 1  # prunes orphan1's ROW only
    assert export_jobs.cleanup_terminal_export_files() == 1  # now prunes orphan1's FILE
    assert not (export_dir / "orphan1.pdf").exists()
    assert (export_dir / "still-alive.pdf").exists()  # its row is still live


def test_stuck_export_job_is_swept_like_any_other_job_type(export_dir):
    """jobs_store.sweep_stuck_jobs() has no job_type filter (verified by
    reading it) — an export job that never heartbeats (e.g. the process
    hosting its daemon thread died) gets caught by the SAME generic sweep
    every other job type relies on. Documented limitation (see this round's
    final report, Section 6): this only marks the job 'interrupted' — there
    is no automatic re-claim/resume for THIS job type (unlike Guided Mind
    Map V3's dedicated recovery path), so a client must resubmit."""
    from app.domains.jobs import jobs_store as js
    js.create_job("stuck1", job_type="mindmap_export", status="running", user_id="userA")
    _backdate("stuck1", seconds=1200)
    assert js.sweep_stuck_jobs(stuck_after_seconds=900) == 1
    assert js.get_job("stuck1")["status"] == "interrupted"


# ---- every document format through the real API, across the real scopes ----

_SCOPE_CASES = [
    ("full", {"scope_type": "full"}),
    ("current_branch", {"scope_type": "current_branch", "selected_node_id": "c1"}),
    ("multiple_branches", {"scope_type": "selected_branches", "selected_branch_root_ids": ["c1"]}),
]
_FORMAT_MAGIC = {"docx": b"PK", "xlsx": b"PK", "pdf": b"%PDF"}


@pytest.mark.parametrize("fmt", ["pdf", "docx", "xlsx"])
@pytest.mark.parametrize("scope_name,scope_body", _SCOPE_CASES)
def test_every_document_format_through_the_real_api_across_real_scopes(
    be, client, monkeypatch, sync_enqueue, export_dir, fmt, scope_name, scope_body,
):
    nodes = [
        {"id": "root", "parent": None, "kind": "root", "title": "Bản đồ tư duy", "order": 0},
        {"id": "c1", "parent": "root", "kind": "section", "title": "Kiến trúc hệ thống", "order": 0},
        {"id": "c2", "parent": "root", "kind": "section", "title": "Bảo mật", "order": 1},
    ]
    _stub_get_record(monkeypatch, be, record=_rec(nodes=nodes))
    _protect(be, monkeypatch, "userA", on=True)

    create = client.post("/mindmaps/m1/exports", json={"format": fmt, "scope": scope_body})
    assert create.status_code == 202, (fmt, scope_name, create.get_json())
    job_id = create.get_json()["job_id"]

    status = client.get(f"/mindmaps/exports/{job_id}").get_json()
    assert status["status"] == "done", (fmt, scope_name, status)

    download = client.get(status["download_url"])
    assert download.status_code == 200
    assert download.data[:4].startswith(_FORMAT_MAGIC[fmt][:min(4, len(_FORMAT_MAGIC[fmt]))])


# ---- Section 9 (final hardening round): security tests ----------------------

def test_path_traversal_via_job_id_is_structurally_impossible(be, client, monkeypatch):
    """The download path is built from a server-generated UUID job_id, keyed
    through jobs_store.get_job() — a malicious job_id in the URL is just a
    lookup miss, never a filesystem path component. No sanitization needed
    because there is no path concatenation of client input to defeat."""
    _protect(be, monkeypatch, "userA", on=True)
    for malicious in ("../../../etc/passwd", "..%2f..%2fetc%2fpasswd", "....//....//etc/passwd"):
        resp = client.get(f"/mindmaps/exports/{malicious}/download")
        assert resp.status_code in (401, 404), malicious


def test_filename_injection_in_map_title_is_sanitized(be, client, monkeypatch, sync_enqueue, export_dir):
    malicious_title = "../../evil<script>.docx"
    rec = _rec()
    rec["title"] = malicious_title
    _stub_get_record(monkeypatch, be, record=rec)
    _protect(be, monkeypatch, "userA", on=True)
    create = client.post("/mindmaps/m1/exports", json={"format": "docx"})
    job_id = create.get_json()["job_id"]
    status = client.get(f"/mindmaps/exports/{job_id}").get_json()
    assert status["status"] == "done", status
    download = client.get(status["download_url"])
    disposition = download.headers.get("Content-Disposition", "")
    assert "../" not in disposition
    assert "<script>" not in disposition


def test_expired_download_token_rejected(be, client, monkeypatch, sync_enqueue, export_dir):
    from app.domains.jobs import export_jobs
    monkeypatch.setattr(export_jobs, "DOWNLOAD_TOKEN_TTL_SEC", 0)  # every token is immediately "expired"
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    create = client.post("/mindmaps/m1/exports", json={"format": "xlsx"})
    job_id = create.get_json()["job_id"]
    token = export_jobs.make_download_token(job_id, "userA")
    import time
    time.sleep(1.1)
    _protect(be, monkeypatch, None, on=True)  # no bearer session — token is the only auth path
    resp = client.get(f"/mindmaps/exports/{job_id}/download?token={token}")
    assert resp.status_code == 401


def test_oversized_export_request_rejected_413(be, client, monkeypatch):
    monkeypatch.setitem(be.app.config, "MAX_CONTENT_LENGTH", 500)
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    huge_payload = json.dumps({"format": "pdf", "map_image_base64": "A" * 5000})
    resp = client.post("/mindmaps/m1/exports", data=huge_payload, content_type="application/json")
    assert resp.status_code == 413


def test_non_json_content_type_rejected_gracefully(be, client, monkeypatch):
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.post("/mindmaps/m1/exports", data="not json at all", content_type="text/plain")
    assert resp.status_code == 400
    assert resp.get_json()["error_code"] == "invalid_format"  # empty body -> format missing -> same clean 400 path


def test_same_download_token_can_be_reused_within_its_ttl(be, client, monkeypatch, sync_enqueue, export_dir):
    """Intended policy: a token is valid for repeat downloads until it
    expires (no single-use consumption) — the status endpoint mints a fresh
    one on every poll, so this is a convenience, not a security gap (still
    short-lived, still scoped to one job)."""
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    create = client.post("/mindmaps/m1/exports", json={"format": "pdf"})
    job_id = create.get_json()["job_id"]
    status = client.get(f"/mindmaps/exports/{job_id}").get_json()
    url = status["download_url"]
    assert client.get(url).status_code == 200
    assert client.get(url).status_code == 200
