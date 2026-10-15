"""H3B — integration-level RED tests: serialize_pdf_with_result end to end
against the real captured 57-node manifest+PNG (see
test_pdf_layout_branch_aware.py's module docstring for exactly how that
fixture was captured and why it's safe/real). Exercises the REAL
build_export_tree, not a hand-built tree dict, so these tests fail if the
wiring between pdf_serializer.py and the real export-tree shape ever
breaks, not just the pure pdf_layout.py math.
"""
from __future__ import annotations

import io

import pytest
from PIL import Image

from services.mindmap.export.pdf_serializer import serialize_pdf_with_result
from services.mindmap.export.tree import build_export_tree
from tests.test_pdf_layout_branch_aware import REAL_57NODE_MANIFEST


REAL_TOP_LEVEL = ["D1", "D2", "D3", "S1", "S2", "S3", "S4", "S5", "S6"]


def _real_fixture_nodes():
    """A flat NodeV2-shaped list (id/parent/kind/title/order) reconstructed
    from the real captured manifest's own node ids, matching the real
    fixture's hierarchy by its id-prefix naming convention (root -> D1/D2/
    D3/S1-S6 -> their own G#/I# descendants) -- the SAME structure
    build_export_tree consumes in production, never a synthetic shortcut.
    "root" itself is never a string-prefix of "D1" etc, so its own
    children must be seeded explicitly (REAL_TOP_LEVEL) -- every deeper
    level DOES follow the prefix convention (e.g. "D1G1" is a prefix match
    under "D1")."""
    all_ids = [n["id"] for n in REAL_57NODE_MANIFEST["nodes"]]

    def children_of(parent_id):
        direct = [nid for nid in all_ids if nid != parent_id and nid.startswith(parent_id)]
        direct_set = set(direct)
        return sorted(d for d in direct if not any(o != d and d.startswith(o) for o in direct_set))

    rows = [{"id": "root", "parent": None, "kind": "root", "title": "fixture root", "order": 0}]
    for order, branch_id in enumerate(REAL_TOP_LEVEL):
        rows.append({"id": branch_id, "parent": "root", "kind": "topic", "title": branch_id, "order": order})

    def walk(node_id):
        for order, child_id in enumerate(children_of(node_id)):
            rows.append({"id": child_id, "parent": node_id, "kind": "topic", "title": child_id, "order": order})
            walk(child_id)

    for branch_id in REAL_TOP_LEVEL:
        walk(branch_id)
    return rows


def _real_fixture_image_bytes():
    """A synthetic PNG at the REAL captured fixture's exact pixel
    dimensions (4650x1908, from REAL_57NODE_MANIFEST) -- the manifest's
    own node/connector rects and font sizes are the real captured geometry
    (see test_pdf_layout_branch_aware.py), so the TILING decision under
    test is real; the image's own pixel CONTENT doesn't affect that
    decision (serialize_pdf_with_result never re-derives geometry from
    pixels) and the real PNG bytes are a scratch QA artifact that is never
    committed to this repo, so this is generated fresh rather than read
    from disk, matching test_mindmap_export_manifest_api.py's own
    PIL-generated-image convention for map_image_base64 fixtures."""
    from PIL import ImageDraw
    w, h = 4650, 1908
    img = Image.new("RGB", (w, h), (255, 255, 255))
    inset = 40  # non-uniform (an inner fill rect) -- image_guard.validate_map_image rejects a single-color image
    ImageDraw.Draw(img).rectangle([inset, inset, w - inset - 1, h - inset - 1], fill=(30, 100, 220))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture()
def real_tree():
    nodes = _real_fixture_nodes()
    all_ids = {n["id"] for n in nodes}
    return build_export_tree(nodes, [], ["root"], all_ids, map_id="h3b-fixture", title="H3B fixture")


@pytest.fixture()
def real_image_bytes():
    return _real_fixture_image_bytes()


def test_real_57node_fixture_gets_readable_detail_pages_not_overview_only(real_tree, real_image_bytes):
    """The actual production-reported failure, fixed: the real manifest
    that H2 alone could only render as a 1-page overview (see
    test_pdf_layout_branch_aware.py's
    test_real_57node_fixture_fails_whole_image_search_within_ceiling) now
    gets real, readable detail pages through the real serializer entry
    point, with no warning."""
    result = serialize_pdf_with_result(
        real_tree, mode="map", page_size="A4",
        map_image_bytes=real_image_bytes, geometry_manifest=REAL_57NODE_MANIFEST,
    )
    assert result.warning is None
    assert result.detail_pages == 9  # one per real top-level branch, matching the real benchmark

    import fitz
    doc = fitz.open(stream=result.content, filetype="pdf")
    try:
        assert doc.page_count == 10  # 1 overview + 9 detail
        xrefs = {img[0] for page in doc for img in page.get_images()}
        assert len(xrefs) == 1, "the same map image must be embedded ONCE and reused, never duplicated per page"
        overview_text = doc[0].get_text()
        for i in range(1, 10):
            assert f"A{i}" in overview_text
        for i in range(1, 10):
            detail_text = doc[i].get_text()
            assert f"A{i}" in detail_text
    finally:
        doc.close()


def test_bare_root_tree_falls_back_to_h2_overview_only_warning(real_image_bytes):
    """A tree with no children under the true root (branch_groups empty)
    must fall straight through to the EXACT H2 behavior/warning shape --
    no regression for a caller that can't supply branch structure."""
    bare_tree = build_export_tree(
        [{"id": "root", "parent": None, "kind": "root", "title": "t", "order": 0}],
        [], ["root"], {"root"}, map_id="m", title="t",
    )
    result = serialize_pdf_with_result(
        bare_tree, mode="map", page_size="A4",
        map_image_bytes=real_image_bytes, geometry_manifest=REAL_57NODE_MANIFEST,
    )
    assert result.detail_pages == 0
    assert result.warning == {
        "code": "detail_pages_skipped_ceiling_exceeded",
        "page_ceiling": 12,
        "best_min_pt_found": 5.24,
    }


def test_legacy_no_manifest_request_is_byte_for_byte_unaffected(real_tree, real_image_bytes):
    """geometry_manifest=None must still be the exact PR #70 path -- H3B
    never even looks at `tree` for a legacy request."""
    result = serialize_pdf_with_result(
        real_tree, mode="map", page_size="A4",
        map_image_bytes=real_image_bytes, geometry_manifest=None,
    )
    assert result.detail_pages == 0
    assert result.warning is None
    import fitz
    doc = fitz.open(stream=result.content, filetype="pdf")
    try:
        assert doc.page_count == 1  # overview only, exactly PR #70
    finally:
        doc.close()
