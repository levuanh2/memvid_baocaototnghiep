"""Build and visually verify exact-node V2 PDFs from Chromium payloads.

Input is produced by FE/e2e-fixture/exact-branch-artifact-gates.spec.js. The
script deliberately consumes that browser PNG and geometry manifest rather
than generating a synthetic raster. It renders every PDF map page through
PyMuPDF and writes PNG evidence plus a machine-readable report.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import math
import sys
from pathlib import Path

import fitz
from PIL import Image, ImageChops, ImageStat


REPO_ROOT = Path(__file__).resolve().parents[1]
BE_ROOT = REPO_ROOT / "BE"
sys.path.insert(0, str(BE_ROOT))

from services.mindmap.export.geometry_manifest import validate_manifest  # noqa: E402
from services.mindmap.export.pdf_serializer import serialize_pdf_with_result  # noqa: E402
from services.mindmap.export.scope import resolve_export_scope  # noqa: E402
from services.mindmap.export.tree import build_export_tree, flatten_export_tree  # noqa: E402


MAP_ID = "fixture-map-a"
ROOT = f"{MAP_ID}-root"
P = f"{MAP_ID}-m0"
A = f"{P}-s0"
B = f"{P}-s1"
C = f"{P}-s2"


def _node(node_id: str, parent: str | None, title: str, order: int, kind: str = "idea") -> dict:
    return {"id": node_id, "parent": parent, "kind": kind, "title": title, "order": order}


def authoritative_nodes() -> list[dict]:
    """Same ids/shape as the browser fixture, with audit-friendly labels."""
    return [
        _node(ROOT, None, "ROOT_CONTEXT", 0, "root"),
        _node(P, ROOT, "P_CONTEXT", 0, "section"),
        _node(A, P, "A_SELECTED", 0, "section"),
        _node(f"{A}-l0", A, "A_DESC_0", 0),
        _node(f"{A}-l1", A, "A_DESC_1", 1),
        _node(f"{A}-l2", A, "A_DESC_2", 2),
        _node(f"{MAP_ID}-extra0", A, "A_DESC_EXTRA", 99),
        _node(B, P, "B_SELECTED", 1, "section"),
        _node(f"{B}-l0", B, "B_DESC_0", 0),
        _node(f"{B}-l1", B, "B_DESC_1", 1),
        _node(f"{B}-l2", B, "B_DESC_2", 2),
        _node(f"{MAP_ID}-extra1", B, "B_DESC_EXTRA", 99),
        _node(C, P, "C_UNSELECTED", 2, "section"),
        _node(f"{C}-l0", C, "C_DESC_0", 0),
        _node(f"{C}-l1", C, "C_DESC_1", 1),
        _node(f"{C}-l2", C, "C_DESC_2", 2),
    ]


def _rmse(left: Image.Image, right: Image.Image) -> float:
    left = left.convert("RGB")
    right = right.convert("RGB")
    if left.size != right.size:
        return math.inf
    stat = ImageStat.Stat(ImageChops.difference(left, right))
    return math.sqrt(sum(value * value for value in stat.rms) / len(stat.rms))


def verify_mode(request_path: Path, output_dir: Path) -> dict:
    request = json.loads(request_path.read_text(encoding="utf-8"))
    mode = request["options"]["mode"]
    scope_payload = request["scope"]
    image_bytes = base64.b64decode(request["map_image_base64"], validate=True)
    manifest = request["map_geometry_manifest"]
    source = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    nodes = authoritative_nodes()
    scope = resolve_export_scope(nodes, **scope_payload)
    render_ids = scope["included_ids"] | scope["context_ids"]
    validate_manifest(
        manifest,
        decoded_image_w=source.width,
        decoded_image_h=source.height,
        expected_rendered_ids=render_ids,
    )
    tree = build_export_tree(
        nodes, [], scope["root_ids"], scope["included_ids"],
        context_ids=scope["context_ids"], presentation_root_id=scope["presentation_root_id"],
        map_id=MAP_ID, title="Exact node selection V2",
    )
    rows = flatten_export_tree(tree)
    result = serialize_pdf_with_result(
        tree,
        mode=mode,
        page_size=request["options"].get("pageSize", "A4"),
        orientation=request["options"].get("orientation", "portrait"),
        single_page=bool(request["options"].get("singlePage", False)),
        font=request["options"].get("font", "sans"),
        background=request["options"].get("background", "white"),
        branch_color_mode=request["options"].get("branchColorMode", "keep"),
        margins=request["options"].get("margins", "normal"),
        content=request["options"].get("content") or {},
        map_image_bytes=image_bytes,
        geometry_manifest=manifest,
    )

    pdf_path = output_dir / f"gate2-{mode}.pdf"
    pdf_path.write_bytes(result.content)
    doc = fitz.open(stream=result.content, filetype="pdf")
    map_page_indexes = [page.number for page in doc if page.get_images(full=True)]
    outline_page_indexes = [page.number for page in doc if not page.get_images(full=True)]
    assert map_page_indexes, f"{mode}: expected at least one actual map-image page"
    if mode == "map":
        assert not outline_page_indexes, "map mode must not append outline pages"
    else:
        assert outline_page_indexes, "map_and_outline must append outline pages"
        assert min(outline_page_indexes) > max(map_page_indexes), "outline must follow every H3B map/detail page"

    for page_index in map_page_indexes:
        pix = doc[page_index].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        pix.save(output_dir / f"gate2-{mode}-map-page-{page_index + 1}.png")
    for page_index in outline_page_indexes[:1]:
        pix = doc[page_index].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        pix.save(output_dir / f"gate2-{mode}-outline-page-{page_index + 1}.png")

    # Prove the PDF map pages carry the exact Chromium raster, not a second
    # full-map render: extract the embedded XObject and compare actual pixels.
    xrefs = {image[0] for index in map_page_indexes for image in doc[index].get_images(full=True)}
    assert len(xrefs) == 1, "H3C: Chromium source image must be embedded once and reused across detail pages"
    extracted = Image.open(io.BytesIO(doc.extract_image(next(iter(xrefs)))["image"]))
    embedded_rmse = _rmse(source, extracted)
    assert embedded_rmse < 1.0, f"embedded raster diverged from Chromium capture: RMSE={embedded_rmse}"

    outline_text = "\n".join(doc[index].get_text() for index in outline_page_indexes)
    if mode == "map_and_outline":
        for expected in ("P_CONTEXT", "A_SELECTED", "A_DESC_0", "B_SELECTED"):
            assert expected in outline_text
        for absent in ("ROOT_CONTEXT", "A_DESC_1", "B_DESC_0"):
            assert absent not in outline_text
        assert "C_UNSELECTED" not in outline_text

    manifest_ids = {node["id"] for node in manifest["nodes"]}
    for expected in (P, A, f"{A}-l0", B):
        assert expected in manifest_ids
    assert ROOT not in manifest_ids
    assert C not in manifest_ids
    assert f"{C}-l0" not in manifest_ids

    # Pixel-level evidence from the browser raster at the manifest's own node
    # rectangles. Text extraction cannot satisfy these assertions.
    crop_stddev = {}
    for node_id in (P, A, f"{A}-l0", B):
        node = next(item for item in manifest["nodes"] if item["id"] == node_id)
        crop = source.crop((node["x"], node["y"], node["x"] + node["width"], node["y"] + node["height"]))
        value = max(ImageStat.Stat(crop).stddev)
        crop_stddev[node_id] = round(value, 3)
        assert value > 3.0, f"{node_id}: expected visible non-uniform node pixels"

    doc.close()
    row_by_id = {row["node_id"]: row for row in rows}
    return {
        "mode": mode,
        "request_scope": scope_payload,
        "manifest_dimensions": [manifest["image_width_px"], manifest["image_height_px"]],
        "manifest_ids": sorted(manifest_ids),
        "node_count": len(render_ids),
        "context_ids": sorted(scope["context_ids"]),
        "explicit_root_ids": sorted(scope["root_ids"]),
        "presentation_root_id": scope["presentation_root_id"],
        "context_flags": {P: row_by_id[P]["is_context"], A: row_by_id[A]["is_context"], B: row_by_id[B]["is_context"]},
        "pdf_bytes": len(result.content),
        "pdf_pages": len(map_page_indexes) + len(outline_page_indexes),
        "map_pages": [index + 1 for index in map_page_indexes],
        "outline_pages": [index + 1 for index in outline_page_indexes],
        "detail_pages": result.detail_pages,
        "warning": result.warning,
        "unique_embedded_image_xrefs": len(xrefs),
        "embedded_source_rmse": embedded_rmse,
        "node_crop_stddev": crop_stddev,
        "c_absent_from_manifest": C not in manifest_ids,
        "c_absent_from_outline": "C_UNSELECTED" not in outline_text,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--artifact-dir",
        type=Path,
        default=REPO_ROOT / "FE" / "qa-artifacts" / "exact-node-v2",
    )
    args = parser.parse_args()
    args.artifact_dir.mkdir(parents=True, exist_ok=True)
    reports = [
        verify_mode(args.artifact_dir / "gate2-map-request.json", args.artifact_dir),
        verify_mode(args.artifact_dir / "gate2-map_and_outline-request.json", args.artifact_dir),
    ]
    report_path = args.artifact_dir / "gate2-pdf-verification.json"
    report_path.write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")
    print(report_path)
    print(json.dumps(reports, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
