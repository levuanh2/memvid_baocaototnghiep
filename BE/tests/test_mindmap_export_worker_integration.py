"""PR H2 Phase 4 Section 1 — END-TO-END route -> worker integration,
proving the full real wiring (not just serializer-level calls):

    POST route -> validate manifest -> render_input_sha256 -> enqueue
    -> run_export_job -> worker revalidate manifest -> stale_geometry_manifest
    check -> layout planner -> serializer -> result.warning/detail_pages
    -> jobs_store.result_json -> poll response

Every test here uses sync_enqueue (the REAL run_export_job function,
called synchronously instead of on a daemon thread -- same harness
pattern as every other export test in this repo) through the REAL
Flask route, never calling serialize_pdf()/run_export_job() directly
except where a test is SPECIFICALLY about the worker's OWN
independent defense (Section 1's "worker revalidate" requirement).
"""
from __future__ import annotations

import base64
import io

import pytest
from PIL import Image, ImageDraw


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


def _mutable_store(monkeypatch, be, record):
    """Like _stub_get_record, but the record dict can be MUTATED by the
    test between the route call and the (synchronous) worker call --
    get_record() always reads whatever `record` currently holds, so a
    test can simulate "the map changed between request and run"."""
    from app.domains.mindmap import store
    monkeypatch.setattr(store, "get_record", lambda mid, user_id=None, enforce_owner=False: (
        dict(record, nodes=list(record["nodes"])) if mid == record["id"] else None
    ))


def _png_b64(w, h, color=(30, 100, 220)):
    img = Image.new("RGB", (w, h), (255, 255, 255))
    inset = max(1, min(w, h) // 20)
    if w > 2 * inset and h > 2 * inset:
        ImageDraw.Draw(img).rectangle([inset, inset, w - inset - 1, h - inset - 1], fill=color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _manifest(iw=40, ih=20, extra_id=None):
    nodes = [
        {"id": "root", "x": 0, "y": 0, "width": 8, "height": 8, "font_size_px": 20},
        {"id": "c1", "x": 10, "y": 2, "width": 20, "height": 10, "font_size_px": 16},
    ]
    if extra_id:
        nodes.append({"id": extra_id, "x": 1, "y": 1, "width": 2, "height": 2, "font_size_px": 10})
    return {"version": 1, "image_width_px": iw, "image_height_px": ih, "nodes": nodes, "connectors": []}


# ---- 1. full real route -> worker path, manifest reaches the worker ------

def test_valid_manifest_flows_through_the_real_worker_to_a_done_job_with_tiling_metadata(be, client, monkeypatch, sync_enqueue, export_dir):
    from app.domains.jobs import jobs_store
    _mutable_store(monkeypatch, be, _rec())
    _protect(be, monkeypatch, "userA", on=True)

    resp = client.post("/mindmaps/m1/exports", json={
        "format": "pdf", "idempotency_key": "k-e2e",
        "options": {"mode": "map"},
        "map_image_base64": _png_b64(40, 20),
        "map_geometry_manifest": _manifest(),
    })
    assert resp.status_code == 202, resp.get_json()
    job_id = resp.get_json()["job_id"]
    job = jobs_store.get_job(job_id)
    assert job["status"] == "done", job
    assert job["result"]["format"] == "pdf"
    # small/readable overview -> no warning, no forced tiling -- same PR #70
    # single-page contract, verified through the REAL worker, not a direct
    # serialize_pdf() call.
    assert job["result"].get("warning") is None


def test_content_fit_flows_route_to_worker_and_writes_a_bounded_content_shaped_pdf(
    be, client, monkeypatch, sync_enqueue, export_dir,
):
    import fitz
    from app.domains.jobs import export_jobs, jobs_store

    _mutable_store(monkeypatch, be, _rec())
    _protect(be, monkeypatch, "userA", on=True)
    manifest = {
        "version": 1,
        "image_width_px": 2436,
        "image_height_px": 296,
        "nodes": [
            {"id": "root", "x": 80, "y": 100, "width": 300, "height": 80, "font_size_px": 24},
            {"id": "c1", "x": 1900, "y": 100, "width": 300, "height": 80, "font_size_px": 24},
        ],
        "connectors": [{"x": 380, "y": 138, "width": 1520, "height": 4}],
    }
    resp = client.post("/mindmaps/m1/exports", json={
        "format": "pdf",
        "idempotency_key": "k-h4-content-fit-worker",
        "options": {"mode": "map", "pageSize": "content_fit"},
        "map_image_base64": _png_b64(2436, 296),
        "map_geometry_manifest": manifest,
    })
    assert resp.status_code == 202, resp.get_json()
    job_id = resp.get_json()["job_id"]
    job = jobs_store.get_job(job_id)
    assert job["status"] == "done", job
    assert job["result"]["node_count"] == 2
    assert job["result"].get("warning") is None

    doc = fitz.open(stream=export_jobs.output_path_for(job_id, "pdf").read_bytes(), filetype="pdf")
    page = doc[0]
    assert (page.rect.width, page.rect.height) == pytest.approx((1298, 228), abs=0.1)
    image = page.get_image_rects(page.get_images(full=True)[0][0])[0]
    assert image.width / image.height == pytest.approx(2436 / 296, rel=0.005)
    assert max(page.rect.width, page.rect.height) <= 1440
    doc.close()


# ---- 2. worker REVALIDATES the manifest independently (RED until fixed) ---

def test_worker_independently_rejects_a_manifest_whose_node_ids_dont_match_fresh_scope(monkeypatch, export_dir):
    """RED: calls run_export_job DIRECTLY (as if route validation were
    somehow bypassed/buggy) with a manifest whose node ids do NOT match
    the fresh record's resolved scope -- a node id the record doesn't even
    have. Section 1 requires the WORKER to independently revalidate, not
    just trust whatever the route already checked once. Today the worker
    has no second validate_manifest() call at all (only the stale-
    FINGERPRINT check, which compares hashes, not structural validity) --
    this manifest sails straight into serialize_pdf_with_result."""
    from app.domains.jobs import jobs_store, export_jobs
    from app.domains.mindmap import store
    from app.application.mindmap_export import run_export_job

    record = _rec()
    monkeypatch.setattr(store, "get_record", lambda mid, user_id=None, enforce_owner=False: record if mid == "m1" else None)

    job_id = "job-revalidate-1"
    jobs_store.create_job(job_id, job_type=export_jobs.EXPORT_JOB_TYPE, status="pending", current_node="Queued", map_id="m1")
    bad_manifest = _manifest(extra_id="node-that-does-not-exist-in-the-record")
    run_export_job(
        job_id, "m1", None, "pdf", {"scope_type": "full"}, {"mode": "map"},
        base64.b64decode(_png_b64(40, 20)), None, bad_manifest, None,
    )
    job = jobs_store.get_job(job_id)
    assert job["status"] == "error", f"expected the worker to independently reject an invalid manifest, got: {job}"
    assert job.get("error_code") == "invalid_geometry_manifest", job


# ---- 3. record changes between request and worker -> stale_geometry_manifest

def test_record_structural_change_between_request_and_worker_fails_the_job_as_stale(be, client, monkeypatch, sync_enqueue, export_dir):
    record = _rec()
    _mutable_store(monkeypatch, be, record)
    _protect(be, monkeypatch, "userA", on=True)

    # Patch create_mindmap_export's own module-level enqueue to mutate the
    # record AFTER the route has computed expected_geometry_fp but BEFORE
    # the (synchronous) worker call reads it -- simulates a real edit
    # landing in the window between request and run.
    from app.jobs import queue as queue_mod

    def _mutate_then_run(func, args=(), queue="ingest", job_id=None, **kwargs):
        record["nodes"][1]["title"] = "Kiến trúc hệ thống (đã sửa)"  # topic change -> geometry fingerprint changes
        func(*args)
        return {"mode": "thread"}

    monkeypatch.setattr(queue_mod, "enqueue_job", _mutate_then_run)

    from app.domains.jobs import jobs_store
    resp = client.post("/mindmaps/m1/exports", json={
        "format": "pdf", "idempotency_key": "k-stale-geom",
        "options": {"mode": "map"},
        "map_image_base64": _png_b64(40, 20),
        "map_geometry_manifest": _manifest(),
    })
    assert resp.status_code == 202
    job = jobs_store.get_job(resp.get_json()["job_id"])
    assert job["status"] == "error", job
    assert job.get("error_code") == "stale_geometry_manifest", job


# ---- 4. legacy job (no manifest) still runs exactly like PR #70 -----------

def test_legacy_job_without_manifest_still_runs_to_done(be, client, monkeypatch, sync_enqueue, export_dir):
    from app.domains.jobs import jobs_store
    _mutable_store(monkeypatch, be, _rec())
    _protect(be, monkeypatch, "userA", on=True)

    resp = client.post("/mindmaps/m1/exports", json={
        "format": "pdf", "idempotency_key": "k-legacy-e2e",
        "options": {"mode": "outline"},
    })
    assert resp.status_code == 202
    job = jobs_store.get_job(resp.get_json()["job_id"])
    assert job["status"] == "done", job
    assert "warning" not in (job["result"] or {})


def test_selected_siblings_pdf_and_status_count_match_the_exact_render_tree(
    be, client, monkeypatch, sync_enqueue, export_dir,
):
    """P remains context for A/B, while sibling C is absent everywhere."""
    import fitz
    from app.domains.jobs import export_jobs, jobs_store

    nodes = [
        {"id": "root", "parent": None, "kind": "root", "title": "Root", "order": 0},
        {"id": "p", "parent": "root", "kind": "section", "title": "Parent P", "order": 0},
        {"id": "a", "parent": "p", "kind": "idea", "title": "Selected A", "order": 0},
        {"id": "b", "parent": "p", "kind": "idea", "title": "Selected B", "order": 1},
        {"id": "c", "parent": "p", "kind": "idea", "title": "Unselected C", "order": 2},
    ]
    _mutable_store(monkeypatch, be, _rec(nodes=nodes))
    _protect(be, monkeypatch, "userA", on=True)

    resp = client.post("/mindmaps/m1/exports", json={
        "format": "pdf",
        "idempotency_key": "k-exact-selected-siblings",
        "scope": {
            "scope_type": "selected_branches",
            "selected_branch_root_ids": ["a", "b"],
            "include_descendants": False,
        },
        "options": {"mode": "outline"},
    })
    assert resp.status_code == 202, resp.get_json()
    job_id = resp.get_json()["job_id"]
    job = jobs_store.get_job(job_id)
    assert job["status"] == "done", job
    assert job["result"]["node_count"] == 3  # P context + exact A + B

    pdf_path = export_jobs.output_path_for(job_id, "pdf")
    doc = fitz.open(stream=pdf_path.read_bytes(), filetype="pdf")
    text = "".join(page.get_text() for page in doc)
    doc.close()
    assert "Root" not in text
    assert "Parent P" in text
    assert "Selected A" in text
    assert "Selected B" in text
    assert "Unselected C" not in text


# ---- 5. warning flows serializer -> jobs_store.result -> poll response ----

def test_ceiling_warning_flows_from_serializer_through_jobs_store_to_poll_response(be, client, monkeypatch, sync_enqueue, export_dir):
    from app.domains.jobs import jobs_store
    n = 130
    nodes = [{"id": "root", "parent": None, "kind": "root", "title": "Root", "order": 0}] + [
        {"id": f"c{i}", "parent": "root", "kind": "section", "title": f"Nhánh {i}", "order": i} for i in range(n)
    ]
    _mutable_store(monkeypatch, be, _rec(nodes=nodes))
    _protect(be, monkeypatch, "userA", on=True)

    row_h = (10000 - 100) / n
    manifest = {
        "version": 1, "image_width_px": 200, "image_height_px": 10000,
        "nodes": (
            [{"id": "root", "x": 10, "y": 0, "width": 180, "height": 80, "font_size_px": 20}]
            + [{"id": f"c{i}", "x": 10, "y": 100 + i * row_h, "width": 180, "height": min(60, row_h - 2), "font_size_px": 10} for i in range(n)]
        ),
        "connectors": [],
    }
    resp = client.post("/mindmaps/m1/exports", json={
        "format": "pdf", "idempotency_key": "k-warn-flow",
        "options": {"mode": "map"},
        "map_image_base64": _png_b64(200, 10000),
        "map_geometry_manifest": manifest,
    })
    assert resp.status_code == 202
    job_id = resp.get_json()["job_id"]
    # same path the FE's pollMindmapExportUntilDone hits
    poll_resp = client.get(f"/mindmaps/exports/{job_id}")
    body = poll_resp.get_json()
    assert body["status"] == "done", body
    assert body["result"]["warning"]["code"] == "detail_pages_skipped_ceiling_exceeded", body
    job = jobs_store.get_job(job_id)
    assert job["result"]["warning"]["code"] == "detail_pages_skipped_ceiling_exceeded"
