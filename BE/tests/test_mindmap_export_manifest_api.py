"""PR H2 Phase 2 (normalized) — PUBLIC-SURFACE red tests only. Every test
in this file imports NOTHING that doesn't already exist on base `01ec09f`
(the route in app/main.py, the worker in app/application/mindmap_export.py,
and serialize_pdf in services/mindmap/export/pdf_serializer.py are all
real, already-shipped code) -- every failure below is a real assertion or
a TypeError at a specific public call site, never an ImportError at
collection. Helper/unit tests for the net-new geometry_manifest.py module
and pdf_layout.py's exact_grid_search/NavigationBands live in
test_geometry_manifest.py / test_pdf_layout_tiling.py instead, and ship
alongside the commit that creates those APIs, not this one.
"""
from __future__ import annotations

import base64
import io

import pytest
from PIL import Image

from services.mindmap.export.pdf_serializer import serialize_pdf
from services.mindmap.export.tree import build_export_tree
from services.mindmap.export.scope import resolve_export_scope


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


def _stub_get_record(monkeypatch, be, owner="userA", record=None):
    from app.domains.mindmap import store
    rec = record or _rec()
    monkeypatch.setattr(store, "get_record", lambda mid, user_id=None, enforce_owner=False: (
        rec if (not enforce_owner or user_id == owner) and mid == rec["id"] else None
    ))
    return rec


def _png_bytes(w, h, color=(30, 100, 220)):
    img = Image.new("RGB", (w, h), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _png_b64(w, h, color=(30, 100, 220)):
    return base64.b64encode(_png_bytes(w, h, color)).decode()


def _valid_manifest(iw=40, ih=20):
    return {
        "version": 1, "image_width_px": iw, "image_height_px": ih,
        "nodes": [{"id": "c1", "x": 10, "y": 2, "width": 20, "height": 10, "font_size_px": 16}],
        "connectors": [],
    }


def _map_tree(n=1):
    nodes = [{"id": "root", "parent": None, "kind": "root", "title": "Root", "order": 0}]
    for i in range(n):
        nodes.append({"id": f"c{i}", "parent": "root", "kind": "section", "title": f"Nhánh {i}", "order": i})
    scope = resolve_export_scope(nodes, scope_type="full")
    return build_export_tree(nodes, [], scope["root_ids"], scope["included_ids"], title="audit")


# ---- 1. POST export with malformed manifest must 400 ----------------------

def test_malformed_manifest_currently_accepted_instead_of_400(be, client, monkeypatch, sync_enqueue, export_dir):
    """RED: body.get("map_geometry_manifest") is never read by the route
    today, so a structurally invalid manifest (missing required fields,
    wrong version) is silently ignored and the request succeeds (202)
    instead of being rejected with 400 invalid_geometry_manifest."""
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.post("/mindmaps/m1/exports", json={
        "format": "pdf", "idempotency_key": "k-malformed",
        "options": {"mode": "map"},
        "map_image_base64": _png_b64(40, 20),
        "map_geometry_manifest": {"version": 999, "nodes": "not-a-list"},  # garbage
    })
    assert resp.status_code == 400, f"expected 400 for malformed manifest, got {resp.status_code}: {resp.get_json()}"
    assert resp.get_json().get("error_code") == "invalid_geometry_manifest"


# ---- 2. POST export with valid manifest must flow into the render path ----

def test_valid_manifest_currently_never_reaches_serialize_pdf(be, client, monkeypatch, sync_enqueue, export_dir):
    """RED: even a well-formed manifest is dropped on the floor today --
    _serialize()/serialize_pdf() receive no geometry_manifest argument at
    all. Patches the ALREADY-EXISTING serialize_pdf symbol (no new import)
    to record its call kwargs and asserts the manifest was threaded through."""
    import app.application.mindmap_export as worker_mod
    calls = []
    real_serialize_pdf = worker_mod.serialize_pdf

    def _spy(*args, **kwargs):
        calls.append(kwargs)
        return real_serialize_pdf(*args, **kwargs)

    monkeypatch.setattr(worker_mod, "serialize_pdf", _spy)
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    client.post("/mindmaps/m1/exports", json={
        "format": "pdf", "idempotency_key": "k-valid-manifest",
        "options": {"mode": "map"},
        "map_image_base64": _png_b64(40, 20),
        "map_geometry_manifest": _valid_manifest(),
    })
    assert calls, "serialize_pdf was never called"
    assert "geometry_manifest" in calls[0], f"serialize_pdf call kwargs did not include geometry_manifest: {sorted(calls[0].keys())}"
    assert calls[0]["geometry_manifest"] is not None


# ---- 3/4. serialize_pdf's own public contract: new kwarg doesn't exist yet -

def test_serialize_pdf_with_unreadable_manifest_produces_multiple_detail_pages():
    """RED, uncaught TypeError (not wrapped in pytest.raises -- a caught
    expected-exception would report as a pytest PASS today, which is the
    wrong polarity for a red test). Target contract: an overview whose
    manifest shows sub-8pt median must come back as >1 page. Today this
    errors at the call site with TypeError: serialize_pdf() got an
    unexpected keyword argument 'geometry_manifest' -- a real, uncaught
    failure, reported by pytest as this test's failure reason."""
    tree = _map_tree(60)
    unreadable_manifest = {
        "version": 1, "image_width_px": 1000, "image_height_px": 4000,
        "nodes": [{"id": f"c{i}", "x": 50, "y": i * 60, "width": 900, "height": 50, "font_size_px": 20} for i in range(60)],
        "connectors": [],
    }
    pdf_bytes = serialize_pdf(
        tree, mode="map", map_image_bytes=_png_bytes(1000, 4000),
        geometry_manifest=unreadable_manifest,
    )
    import fitz
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    assert doc.page_count > 1, "an unreadable overview with a manifest must produce detail pages"
    doc.close()


def test_small_readable_map_with_manifest_still_one_page_TARGET_CONTRACT():
    """RED, uncaught TypeError (see note above). Target contract: when the
    overview ALREADY meets the readability target, passing a manifest must
    NOT force tiling -- page_count stays 1, identical to PR #70."""
    tree = _map_tree(3)
    readable_manifest = {
        "version": 1, "image_width_px": 800, "image_height_px": 400,
        "nodes": [{"id": "c0", "x": 50, "y": 50, "width": 300, "height": 100, "font_size_px": 60}],
        "connectors": [],
    }
    pdf_bytes = serialize_pdf(
        tree, mode="map", map_image_bytes=_png_bytes(800, 400),
        geometry_manifest=readable_manifest,
    )
    import fitz
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    assert doc.page_count == 1, "an already-readable overview must stay single-page even with a manifest present"
    doc.close()


# ---- 5. valid capture, ceiling exceeded -> overview + warning --------------

def test_ceiling_exceeded_currently_produces_no_warning_at_all(be, client, monkeypatch, sync_enqueue, export_dir):
    """RED: today there is no grid-search/ceiling concept at all -- a job
    whose manifest WOULD need >12 detail tiles to hit 8pt median just
    completes normally with no warning field in its result, because the
    manifest is never read. Target: result.warning.code ==
    'detail_pages_skipped_ceiling_exceeded'."""
    from app.domains.jobs import jobs_store
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    # a pathologically unreadable manifest (tiny font vs huge image) --
    # would need far more than 12 tiles to reach 8pt median once grid
    # search exists.
    huge_manifest = {
        "version": 1, "image_width_px": 200, "image_height_px": 20000,
        "nodes": [{"id": "c1", "x": 10, "y": i * 150, "width": 180, "height": 100, "font_size_px": 10} for i in range(130)],
        "connectors": [],
    }
    resp = client.post("/mindmaps/m1/exports", json={
        "format": "pdf", "idempotency_key": "k-ceiling",
        "options": {"mode": "map"},
        "map_image_base64": _png_b64(200, 1000),  # dims deliberately mismatched too -- not the point of THIS test
        "map_geometry_manifest": huge_manifest,
    })
    assert resp.status_code in (202,)
    job = jobs_store.get_job(resp.get_json()["job_id"])
    result = job.get("result") or {}
    assert result.get("warning", {}).get("code") == "detail_pages_skipped_ceiling_exceeded", \
        f"expected a ceiling-exceeded warning in the job result, got: {result}"


# ---- 6. invalid/clamped capture must not create a job or PDF ---------------

def test_image_dimension_mismatch_currently_does_not_block_job_creation(be, client, monkeypatch, sync_enqueue, export_dir):
    """RED: manifest claims a different image size than the REAL decoded
    PNG -- today nothing compares them (manifest is unread), so the job is
    created and presumably runs on the real image anyway. Target: 400
    invalid_geometry_manifest, no job_id ever minted."""
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    resp = client.post("/mindmaps/m1/exports", json={
        "format": "pdf", "idempotency_key": "k-mismatch",
        "options": {"mode": "map"},
        "map_image_base64": _png_b64(40, 20),  # REAL decoded image is 40x20
        "map_geometry_manifest": _valid_manifest(iw=999, ih=999),  # manifest claims 999x999
    })
    assert resp.status_code == 400, f"expected 400 for image/manifest dimension mismatch, got {resp.status_code}: {resp.get_json()}"
    assert resp.get_json().get("error_code") == "invalid_geometry_manifest"
