"""PR H2 Phase 2 — RED tests against the EXISTING create_mindmap_export
route (app/main.py), pinning the Section 8 fingerprint gap: today's
request_fingerprint hashes only {map_id, format, scope, options} --
map_image_base64 is decoded/validated but never hashed, and (until this
PR) no map_geometry_manifest field exists in the request body at all. So
two requests sharing an idempotency_key but carrying DIFFERENT image
bytes or DIFFERENT geometry manifests are silently treated as "the same
request" today (outcome="existing", same job_id returned) -- that is
exactly the bug Section 8's render_input_sha256 must close.

These tests import nothing new (route/module already exist on base
01ec09f) -- they fail by a REAL assertion against current behavior, never
ImportError. Mirrors the existing idempotency-conflict test pattern in
test_mindmap_export_api.py.
"""
from __future__ import annotations

import base64

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


def _stub_get_record(monkeypatch, be, owner="userA", record=None):
    from app.domains.mindmap import store
    rec = record or _rec()
    monkeypatch.setattr(store, "get_record", lambda mid, user_id=None, enforce_owner=False: (
        rec if (not enforce_owner or user_id == owner) and mid == rec["id"] else None
    ))
    return rec


def _png_b64(color=(30, 100, 220)):
    from PIL import Image
    import io
    img = Image.new("RGB", (40, 20), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _manifest(x=80):
    return {
        "version": 1, "image_width_px": 40, "image_height_px": 20,
        "nodes": [{"id": "c1", "x": x, "y": 2, "width": 20, "height": 10, "font_size_px": 16}],
        "connectors": [],
    }


def _map_body(idempotency_key, image_color=(30, 100, 220), manifest=None):
    body = {
        "format": "pdf", "idempotency_key": idempotency_key,
        "options": {"mode": "map"},
        "map_image_base64": _png_b64(image_color),
    }
    if manifest is not None:
        body["map_geometry_manifest"] = manifest
    return body


def test_same_key_different_manifest_currently_WRONGLY_treated_as_same_request(be, client, monkeypatch, sync_enqueue, export_dir):
    """RED (Section 8): today's fingerprint ignores map_geometry_manifest
    entirely, so two requests sharing idempotency_key but carrying
    DIFFERENT manifests get silently merged into one job instead of a 409
    idempotency_conflict. This assertion states the TARGET (post-fix)
    contract -- it currently fails because r2 comes back 202/"existing"
    with the same job_id as r1, not 409."""
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    client.post("/mindmaps/m1/exports", json=_map_body("k-manifest", manifest=_manifest(x=80)))
    r2 = client.post("/mindmaps/m1/exports", json=_map_body("k-manifest", manifest=_manifest(x=999)))
    assert r2.status_code == 409, f"expected idempotency_conflict for a changed manifest, got {r2.status_code}: {r2.get_json()}"
    assert r2.get_json().get("error_code") == "idempotency_conflict"


def test_same_key_different_image_currently_WRONGLY_treated_as_same_request(be, client, monkeypatch, sync_enqueue, export_dir):
    """RED (Section 8): request_fingerprint today is {map_id, format,
    scope, options} ONLY -- map_image_base64 bytes are decoded/validated
    but never hashed. Two requests sharing idempotency_key with a
    DIFFERENT image currently return the same job_id instead of 409."""
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    client.post("/mindmaps/m1/exports", json=_map_body("k-image", image_color=(30, 100, 220)))
    r2 = client.post("/mindmaps/m1/exports", json=_map_body("k-image", image_color=(200, 10, 10)))
    assert r2.status_code == 409, f"expected idempotency_conflict for a changed image, got {r2.status_code}: {r2.get_json()}"
    assert r2.get_json().get("error_code") == "idempotency_conflict"


def test_same_key_same_manifest_different_json_key_order_is_the_same_request(be, client, monkeypatch, sync_enqueue, export_dir):
    """Target contract: canonical_manifest_json must make client array/key
    order irrelevant -- re-sending the SAME manifest content with its
    `nodes` array reordered must still resolve to the SAME job. This one
    already incidentally "passes" today for the WRONG reason (manifest is
    ignored entirely) -- kept here as a named pin so Phase 3's real fix is
    verified for the RIGHT reason once canonicalization lands, not just
    because the field is unread. See Phase 2 report for why this is
    flagged ALREADY-GREEN / not counted among the fail count."""
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    m = {
        "version": 1, "image_width_px": 40, "image_height_px": 20,
        "nodes": [
            {"id": "c1", "x": 80, "y": 2, "width": 20, "height": 10, "font_size_px": 16},
            {"id": "root", "x": 0, "y": 0, "width": 10, "height": 10, "font_size_px": 20},
        ],
        "connectors": [],
    }
    m_reordered = dict(m)
    m_reordered["nodes"] = list(reversed(m["nodes"]))
    r1 = client.post("/mindmaps/m1/exports", json=_map_body("k-order", manifest=m))
    r2 = client.post("/mindmaps/m1/exports", json=_map_body("k-order", manifest=m_reordered))
    assert r1.status_code == 202 and r2.status_code == 202
    assert r1.get_json()["job_id"] == r2.get_json()["job_id"]


def test_legacy_request_without_manifest_fingerprint_unaffected(be, client, monkeypatch, sync_enqueue, export_dir):
    """Backward-compat baseline (ALREADY GREEN today, kept as a regression
    pin, not a Phase-2 red test): a plain outline-mode request with no
    image/manifest at all must keep behaving exactly like PR #70 -- same
    key + same params -> same job."""
    _stub_get_record(monkeypatch, be)
    _protect(be, monkeypatch, "userA", on=True)
    body = {"format": "pdf", "idempotency_key": "k-legacy", "options": {"mode": "outline"}}
    r1 = client.post("/mindmaps/m1/exports", json=body)
    r2 = client.post("/mindmaps/m1/exports", json=body)
    assert r1.status_code == 202 and r2.status_code == 202
    assert r1.get_json()["job_id"] == r2.get_json()["job_id"]
