"""PR H2 — geometry manifest validation, canonical hashing, and the
geometry-source stale fingerprint.

Manifest schema (FE -> BE, optional, parallel to map_image_base64):
    {
      "version": 1,
      "image_width_px": int, "image_height_px": int,
      "nodes": [{"id": str, "x": num, "y": num, "width": num, "height": num,
                  "font_size_px": num}, ...],
      "connectors": [{"x": num, "y": num, "width": num, "height": num}, ...],
    }

Everything is already in BITMAP PIXEL coordinates -- no `effective_scale`/
`capture_scale` field travels in the request (Phase 1.5/2 closure audit:
the FE computes `actual_bitmap_width_px / captured_element_css_width_px`
itself and bakes it into every x/y/width/height/font_size_px value before
sending; the BE never needs to know the ratio that produced them).

Security contract (never relaxed): title/note/citation never appear here
-- outline content always comes from the server-side record fetch, exactly
like PR #70. This module validates SHAPE and NUMBERS only.
"""
from __future__ import annotations

import hashlib
import json
import math
from typing import Any

MANIFEST_VERSION = 1
MAX_NODES = 200  # generous headroom above services.mindmap.pipeline.schema.MAX_NODES (120)
MAX_CONNECTORS = 500
MAX_CANONICAL_JSON_BYTES = 256_000
BOUNDS_TOLERANCE_PX = 2.0


class GeometryManifestError(Exception):
    pass


def _is_finite_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _require_rect_fields(obj: dict, label: str) -> None:
    for key in ("x", "y", "width", "height"):
        if key not in obj:
            raise GeometryManifestError(f"{label} missing field '{key}'")
        if not _is_finite_number(obj[key]):
            raise GeometryManifestError(f"{label}.{key} must be a finite number")
    if obj["width"] < 0 or obj["height"] < 0:
        raise GeometryManifestError(f"{label} has a negative dimension")
    if obj["x"] < 0 or obj["y"] < 0:
        raise GeometryManifestError(f"{label} has a negative coordinate")


def _check_within_bounds(obj: dict, image_w: float, image_h: float, label: str) -> None:
    right, bottom = obj["x"] + obj["width"], obj["y"] + obj["height"]
    if right > image_w + BOUNDS_TOLERANCE_PX or bottom > image_h + BOUNDS_TOLERANCE_PX:
        raise GeometryManifestError(f"{label} escapes image bounds beyond the {BOUNDS_TOLERANCE_PX}px tolerance")


def validate_manifest(
    manifest: dict[str, Any], *, decoded_image_w: int, decoded_image_h: int,
    expected_rendered_ids: set[str],
) -> None:
    """Raises GeometryManifestError on any violation. Returns None on success.
    Never mutates `manifest`; callers that want clamped/normalized rects
    should re-derive them (clamping is a presentation-time concern, not a
    validation-time mutation) -- values within the 2px tolerance are simply
    ACCEPTED as-is, not rewritten here."""
    if not isinstance(manifest, dict):
        raise GeometryManifestError("manifest must be an object")
    if manifest.get("version") != MANIFEST_VERSION:
        raise GeometryManifestError(f"manifest.version must be exactly {MANIFEST_VERSION}")

    iw, ih = manifest.get("image_width_px"), manifest.get("image_height_px")
    if not _is_finite_number(iw) or not _is_finite_number(ih) or iw <= 0 or ih <= 0:
        raise GeometryManifestError("manifest image_width_px/image_height_px must be positive finite numbers")
    if int(iw) != int(decoded_image_w) or int(ih) != int(decoded_image_h):
        raise GeometryManifestError(
            f"manifest image dimensions ({iw}x{ih}) do not match the real decoded image ({decoded_image_w}x{decoded_image_h})"
        )

    nodes = manifest.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        raise GeometryManifestError("manifest.nodes must be a non-empty array")
    if len(nodes) > MAX_NODES:
        raise GeometryManifestError(f"manifest.nodes exceeds the {MAX_NODES}-node cap")

    seen_ids: set[str] = set()
    for i, node in enumerate(nodes):
        if not isinstance(node, dict) or not isinstance(node.get("id"), str) or not node.get("id"):
            raise GeometryManifestError(f"nodes[{i}] must be an object with a non-empty string id")
        node_id = node["id"]
        if node_id in seen_ids:
            raise GeometryManifestError(f"duplicate node id: {node_id}")
        seen_ids.add(node_id)
        _require_rect_fields(node, f"nodes[{i}] (id={node_id})")
        _check_within_bounds(node, decoded_image_w, decoded_image_h, f"nodes[{i}] (id={node_id})")
        if "font_size_px" not in node or not _is_finite_number(node["font_size_px"]) or node["font_size_px"] <= 0:
            raise GeometryManifestError(f"nodes[{i}] (id={node_id}).font_size_px must be a positive finite number")

    if seen_ids != set(expected_rendered_ids):
        missing = set(expected_rendered_ids) - seen_ids
        extra = seen_ids - set(expected_rendered_ids)
        raise GeometryManifestError(
            f"manifest node ids do not exactly match the resolved scope's rendered ids "
            f"(missing={sorted(missing)}, extra={sorted(extra)})"
        )

    connectors = manifest.get("connectors")
    if connectors is None:
        connectors = []
    if not isinstance(connectors, list):
        raise GeometryManifestError("manifest.connectors must be an array")
    if len(connectors) > MAX_CONNECTORS:
        raise GeometryManifestError(f"manifest.connectors exceeds the {MAX_CONNECTORS}-connector cap")
    for i, conn in enumerate(connectors):
        if not isinstance(conn, dict):
            raise GeometryManifestError(f"connectors[{i}] must be an object")
        _require_rect_fields(conn, f"connectors[{i}]")
        _check_within_bounds(conn, decoded_image_w, decoded_image_h, f"connectors[{i}]")

    canonical = canonical_manifest_json(manifest)
    if len(canonical.encode("utf-8")) > MAX_CANONICAL_JSON_BYTES:
        raise GeometryManifestError(f"manifest canonical JSON exceeds the {MAX_CANONICAL_JSON_BYTES}-byte cap")


def _round3(v: float) -> float:
    return round(float(v), 3)


def canonical_manifest_json(manifest: dict[str, Any]) -> str:
    """Deterministic JSON regardless of client key/array order -- the SAME
    manifest content sent with nodes/connectors in a different order must
    hash identically. Used for render_input_sha256 (Section 6/8)."""
    nodes_sorted = sorted(manifest.get("nodes") or [], key=lambda n: n["id"])
    nodes_norm = [
        {
            "id": n["id"], "x": _round3(n["x"]), "y": _round3(n["y"]),
            "width": _round3(n["width"]), "height": _round3(n["height"]),
            "font_size_px": _round3(n["font_size_px"]),
        }
        for n in nodes_sorted
    ]
    connectors_sorted = sorted(
        manifest.get("connectors") or [],
        key=lambda c: (_round3(c["x"]), _round3(c["y"]), _round3(c["width"]), _round3(c["height"])),
    )
    connectors_norm = [
        {"x": _round3(c["x"]), "y": _round3(c["y"]), "width": _round3(c["width"]), "height": _round3(c["height"])}
        for c in connectors_sorted
    ]
    payload = {
        "version": manifest.get("version"),
        "image_width_px": manifest.get("image_width_px"),
        "image_height_px": manifest.get("image_height_px"),
        "nodes": nodes_norm,
        "connectors": connectors_norm,
    }
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def render_input_sha256(map_image_bytes: bytes, manifest: dict[str, Any] | None) -> str | None:
    """None when there is no manifest at all (legacy request) -- the
    caller must then NOT add a render_input_sha256 key to the fingerprint
    payload at all, keeping byte-for-byte PR #70 compatibility (Section 8)."""
    if manifest is None:
        return None
    image_sha = hashlib.sha256(map_image_bytes).hexdigest()
    manifest_sha = hashlib.sha256(canonical_manifest_json(manifest).encode("utf-8")).hexdigest()
    return hashlib.sha256(f"{image_sha}:{manifest_sha}".encode("utf-8")).hexdigest()


def geometry_source_fingerprint(nodes: list[dict], relations: list[dict], rendered_ids: set[str]) -> str:
    """Deterministic hash of exactly the record CONTENT that determines
    canvas geometry for `rendered_ids` -- id/parent/order/topic, plus any
    relation whose BOTH endpoints are rendered (a relation drawn to a node
    NOT on the canvas draws nothing, so it cannot move any box). Note and
    citations are intentionally excluded: they render only in the OUTLINE
    page, never as part of a map-canvas node's own box geometry (that is
    `visible_snapshot_fingerprint`'s job, already covering outline
    content staleness independently). branchColorMode/appearance color is
    excluded too -- color never changes a node's box size or position."""
    by_id = {n["id"]: n for n in nodes}
    node_rows = [
        {
            "id": node_id,
            "parent": (by_id.get(node_id) or {}).get("parent"),
            "order": int((by_id.get(node_id) or {}).get("order") or 0),
            "topic": (by_id.get(node_id) or {}).get("title") or "",
        }
        for node_id in sorted(rendered_ids)
    ]
    relation_rows = sorted(
        (
            {"source": r.get("source"), "target": r.get("target"), "type": r.get("type") or "relates_to", "label": r.get("label") or ""}
            for r in (relations or [])
            if r.get("source") in rendered_ids and r.get("target") in rendered_ids
        ),
        key=lambda r: (r["source"] or "", r["target"] or "", r["type"] or ""),
    )
    payload = {"nodes": node_rows, "relations": relation_rows}
    return hashlib.sha256(json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")).hexdigest()
