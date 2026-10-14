"""PR H2 Phase 2 — RED tests for services.mindmap.export.geometry_manifest
(net-new module, does not exist on base 01ec09f). Every test in this file
is expected to fail at COLLECTION with ModuleNotFoundError until Phase 3
creates the module — this is the correct, honest "red" state for a
pure net-new module with no existing public behavior to probe (unlike
PR H's pdf_layout.py, which was extracted from already-live serialize_pdf
behavior testable through the public API). See the Phase 2 checkpoint
report for the explicit red-via-ImportError vs red-via-assertion split.

Contract pinned here (Phase 1.5 closure audit, approved):
  - manifest schema: {version, image_width_px, image_height_px,
    nodes:[{id,x,y,width,height,font_size_px}], connectors:[{x,y,width,height}]}
  - NO `effective_scale`/`capture_scale` field — everything already in
    bitmap pixel coordinates by the time it reaches the BE.
  - validate_manifest(manifest, *, decoded_image_w, decoded_image_h,
    expected_rendered_ids) -> None, raises GeometryManifestError subclasses.
  - canonical_manifest_json(manifest) -> str — deterministic regardless of
    client key/array order; node rows sorted by id, connector rows sorted
    by (x,y,width,height), floats rounded to 3 decimals.
  - geometry_source_fingerprint(nodes, relations, rendered_ids) -> str —
    parent/order/topic + relations with BOTH endpoints in rendered_ids;
    branchColorMode/appearance NOT included (color doesn't affect geometry).
"""
from __future__ import annotations

import json

import pytest

from services.mindmap.export.geometry_manifest import (
    GeometryManifestError,
    canonical_manifest_json,
    geometry_source_fingerprint,
    validate_manifest,
)


def _node(id_="c0", x=80, y=80, w=289, h=92, font=26.65):
    return {"id": id_, "x": x, "y": y, "width": w, "height": h, "font_size_px": font}


def _manifest(nodes=None, connectors=None, iw=1022, ih=3720, version=1):
    return {
        "version": version, "image_width_px": iw, "image_height_px": ih,
        "nodes": nodes if nodes is not None else [_node()],
        "connectors": connectors if connectors is not None else [],
    }


# ---- schema / type / finite / bounds -------------------------------------

def test_version_must_be_exactly_1():
    m = _manifest(version=2)
    with pytest.raises(GeometryManifestError):
        validate_manifest(m, decoded_image_w=1022, decoded_image_h=3720, expected_rendered_ids={"c0"})


def test_rejects_non_finite_numbers():
    m = _manifest(nodes=[_node(x=float("nan"))])
    with pytest.raises(GeometryManifestError):
        validate_manifest(m, decoded_image_w=1022, decoded_image_h=3720, expected_rendered_ids={"c0"})


def test_rejects_infinity():
    m = _manifest(nodes=[_node(w=float("inf"))])
    with pytest.raises(GeometryManifestError):
        validate_manifest(m, decoded_image_w=1022, decoded_image_h=3720, expected_rendered_ids={"c0"})


def test_rejects_negative_dimensions():
    m = _manifest(nodes=[_node(w=-10)])
    with pytest.raises(GeometryManifestError):
        validate_manifest(m, decoded_image_w=1022, decoded_image_h=3720, expected_rendered_ids={"c0"})


def test_rejects_negative_coordinates():
    m = _manifest(nodes=[_node(x=-5)])
    with pytest.raises(GeometryManifestError):
        validate_manifest(m, decoded_image_w=1022, decoded_image_h=3720, expected_rendered_ids={"c0"})


def test_decoded_image_dimensions_must_match_manifest_exactly():
    """FE-reported image_width_px/height_px must equal the REAL decoded
    PNG dimensions -- a mismatch means the manifest was built against a
    different capture than the one actually uploaded (stale or tampered)."""
    m = _manifest(iw=1022, ih=3720)
    with pytest.raises(GeometryManifestError):
        validate_manifest(m, decoded_image_w=1000, decoded_image_h=3720, expected_rendered_ids={"c0"})


def test_rect_outside_image_bounds_beyond_tolerance_rejected():
    m = _manifest(nodes=[_node(x=1000, w=100)])  # x+w=1100 > image_w=1022, overflow 78px
    with pytest.raises(GeometryManifestError):
        validate_manifest(m, decoded_image_w=1022, decoded_image_h=3720, expected_rendered_ids={"c0"})


def test_rect_overflow_within_2px_tolerance_is_clamped_not_rejected():
    m = _manifest(nodes=[_node(x=1021, w=2)])  # x+w=1023, 1px over -- within tolerance, clamp
    validate_manifest(m, decoded_image_w=1022, decoded_image_h=3720, expected_rendered_ids={"c0"})


# ---- exact ID equality against expected_rendered_ids ----------------------

def test_manifest_node_ids_must_equal_expected_rendered_ids_exactly():
    m = _manifest(nodes=[_node("c0"), _node("c1", x=400)])
    with pytest.raises(GeometryManifestError):
        validate_manifest(m, decoded_image_w=1022, decoded_image_h=3720, expected_rendered_ids={"c0"})  # c1 is a superset id, must reject


def test_manifest_missing_an_expected_rendered_id_is_rejected():
    m = _manifest(nodes=[_node("c0")])
    with pytest.raises(GeometryManifestError):
        validate_manifest(m, decoded_image_w=1022, decoded_image_h=3720, expected_rendered_ids={"c0", "c1"})  # subset -- must reject


def test_duplicate_node_id_rejected():
    m = _manifest(nodes=[_node("c0"), _node("c0", x=500)])
    with pytest.raises(GeometryManifestError):
        validate_manifest(m, decoded_image_w=1022, decoded_image_h=3720, expected_rendered_ids={"c0"})


# ---- size / count caps -----------------------------------------------------

def test_node_count_cap_enforced():
    nodes = [_node(f"c{i}", x=i) for i in range(500)]
    m = _manifest(nodes=nodes, iw=5000, ih=5000)
    with pytest.raises(GeometryManifestError):
        validate_manifest(m, decoded_image_w=5000, decoded_image_h=5000, expected_rendered_ids={f"c{i}" for i in range(500)})


def test_canonical_json_byte_size_cap_256kb():
    # pathological: an absurdly long id string, repeated, to blow past 256KB
    nodes = [_node("x" * 2200 + str(i), x=i) for i in range(120)]
    m = _manifest(nodes=nodes, iw=5000, ih=5000)
    with pytest.raises(GeometryManifestError):
        validate_manifest(m, decoded_image_w=5000, decoded_image_h=5000, expected_rendered_ids={n["id"] for n in nodes})


# ---- canonical JSON / hash determinism -------------------------------------

def test_canonical_json_is_order_independent():
    nodes_a = [_node("a", x=5), _node("b", x=1)]
    nodes_b = [_node("b", x=1), _node("a", x=5)]
    c1 = canonical_manifest_json(_manifest(nodes=nodes_a))
    c2 = canonical_manifest_json(_manifest(nodes=nodes_b))
    assert c1 == c2


def test_canonical_json_connector_order_independent():
    conn_a = [{"x": 1, "y": 2, "width": 3, "height": 4}, {"x": 9, "y": 9, "width": 1, "height": 1}]
    conn_b = list(reversed(conn_a))
    c1 = canonical_manifest_json(_manifest(connectors=conn_a))
    c2 = canonical_manifest_json(_manifest(connectors=conn_b))
    assert c1 == c2


def test_canonical_json_rounds_float_noise():
    m1 = _manifest(nodes=[_node(x=1.0000001, font=26.650001)])
    m2 = _manifest(nodes=[_node(x=1.0, font=26.65)])
    assert canonical_manifest_json(m1) == canonical_manifest_json(m2)


def test_canonical_json_is_valid_json():
    c = canonical_manifest_json(_manifest())
    json.loads(c)  # must not raise


# ---- geometry source fingerprint -------------------------------------------

def test_geometry_fingerprint_includes_topic_and_order():
    nodes = [{"id": "c0", "parent": "r", "order": 0, "title": "A"}, {"id": "r", "parent": None, "order": 0, "title": "Root"}]
    rendered = {"c0", "r"}
    fp1 = geometry_source_fingerprint(nodes, [], rendered)
    nodes2 = [{"id": "c0", "parent": "r", "order": 0, "title": "B"}, {"id": "r", "parent": None, "order": 0, "title": "Root"}]  # topic changed
    fp2 = geometry_source_fingerprint(nodes2, [], rendered)
    assert fp1 != fp2


def test_geometry_fingerprint_unaffected_by_note_or_citations():
    base_nodes = [{"id": "c0", "parent": "r", "order": 0, "title": "A", "note": "n1", "chunk_refs": ["x"]}, {"id": "r", "parent": None, "order": 0, "title": "Root"}]
    changed_nodes = [{"id": "c0", "parent": "r", "order": 0, "title": "A", "note": "n2 completely different", "chunk_refs": ["y", "z"]}, {"id": "r", "parent": None, "order": 0, "title": "Root"}]
    rendered = {"c0", "r"}
    assert geometry_source_fingerprint(base_nodes, [], rendered) == geometry_source_fingerprint(changed_nodes, [], rendered)


def test_geometry_fingerprint_only_counts_relations_with_both_endpoints_rendered():
    nodes = [{"id": "c0", "parent": "r", "order": 0, "title": "A"}, {"id": "c1", "parent": "r", "order": 1, "title": "B"}, {"id": "r", "parent": None, "order": 0, "title": "Root"}]
    rendered = {"c0", "r"}  # c1 NOT rendered
    relations_with_dangling_endpoint = [{"source": "c0", "target": "c1", "type": "relates_to", "label": ""}]
    fp_with = geometry_source_fingerprint(nodes, relations_with_dangling_endpoint, rendered)
    fp_without = geometry_source_fingerprint(nodes, [], rendered)
    assert fp_with == fp_without  # a relation touching an UNrendered node must not affect the fingerprint


def test_geometry_fingerprint_changes_when_both_endpoints_rendered_relation_changes():
    nodes = [{"id": "c0", "parent": "r", "order": 0, "title": "A"}, {"id": "c1", "parent": "r", "order": 1, "title": "B"}, {"id": "r", "parent": None, "order": 0, "title": "Root"}]
    rendered = {"c0", "c1", "r"}
    fp_no_rel = geometry_source_fingerprint(nodes, [], rendered)
    fp_with_rel = geometry_source_fingerprint(nodes, [{"source": "c0", "target": "c1", "type": "relates_to", "label": ""}], rendered)
    assert fp_no_rel != fp_with_rel
