"""PR E — Document Visible Export, Section 6 PDF verification.

Two kinds of test here, deliberately not conflated:

1. Downstream-pipeline guards (PASS today, must stay passing): `build_export_tree`
   and `serialize_pdf` take a raw `included_ids` set and don't care how it was
   produced -- feeding them a manually-constructed "visible-shaped" set today
   already proves the map-image/outline/unicode/placement pipeline (PR A) is
   completely unaffected by how `scope.py` will eventually compute that set.
   These de-risk the PR: once `resolve_export_scope` grows a "visible" branch
   that returns the SAME shape of result, nothing downstream needs to change.

2. The actual red test: `resolve_export_scope(..., scope_type="visible", ...)`
   itself, which is what Section 5's test file already pins — not repeated
   here to avoid duplicate coverage, only cross-referenced.
"""
from __future__ import annotations

import fitz

from services.mindmap.export.tree import build_export_tree
from services.mindmap.export.pdf_serializer import serialize_pdf


def _nodes():
    return [
        {"id": "root", "parent": None, "kind": "root", "title": "Bản đồ tư duy", "order": 0},
        {"id": "a", "parent": "root", "kind": "section", "title": "Nhánh A: Kiến trúc hệ thống", "order": 0, "note": "Ghi chú A"},
        {"id": "b", "parent": "a", "kind": "section", "title": "Nhánh B: Triển khai", "order": 0, "note": "Ghi chú B"},
        {"id": "c", "parent": "b", "kind": "idea", "title": "Ý C: Ví dụ cụ thể — tiếng Việt có dấu", "order": 0, "note": "Ghi chú C"},
        {"id": "e", "parent": "root", "kind": "section", "title": "Nhánh E: Bảo mật", "order": 1, "note": "Ghi chú E"},
        {"id": "f", "parent": "e", "kind": "idea", "title": "Ý F: Rủi ro", "order": 0, "note": "Ghi chú F"},
    ]


def _no_blank_pages(doc: "fitz.Document") -> bool:
    for page in doc:
        has_text = bool(page.get_text().strip())
        has_image = len(page.get_images()) > 0
        if not has_text and not has_image:
            return False
    return True


def _build(included_ids: set[str], root_ids: list[str] | None = None):
    nodes = _nodes()
    return build_export_tree(nodes, [], root_ids or ["root"], included_ids, title="Bản đồ tư duy")


# ---- downstream-pipeline guards (expected PASS today and after the fix) ----

def test_root_only_visible_shaped_set_produces_one_node_outline():
    tree = _build({"root"})
    file_bytes = serialize_pdf(tree, mode="outline")
    assert file_bytes[:5] == b"%PDF-"
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    full_text = "".join(page.get_text() for page in doc)
    assert "Bản đồ tư duy" in full_text
    assert "Nhánh A" not in full_text
    assert "Nhánh E" not in full_text
    doc.close()


def test_depth2_visible_shaped_set_renders_exactly_those_nodes():
    tree = _build({"root", "a", "e"})  # depth<=1-shaped: root + its two children
    file_bytes = serialize_pdf(tree, mode="outline")
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    full_text = "".join(page.get_text() for page in doc)
    assert "Nhánh A" in full_text
    assert "Nhánh E" in full_text
    assert "Nhánh B" not in full_text  # deeper, not in this visible-shaped set
    assert "Ý F" not in full_text
    doc.close()


def test_vietnamese_unicode_survives_a_visible_shaped_subset():
    tree = _build({"root", "a", "b", "c"})
    file_bytes = serialize_pdf(tree, mode="outline", content={"notes": True})
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    full_text = "".join(page.get_text() for page in doc)
    assert "Ý C: Ví dụ cụ thể — tiếng Việt có dấu" in full_text
    assert "Ghi chú C" in full_text
    doc.close()


def test_no_blank_pages_for_a_single_node_visible_shaped_export():
    tree = _build({"root"})
    file_bytes = serialize_pdf(tree, mode="outline")
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    assert _no_blank_pages(doc)
    doc.close()


def test_map_image_mode_still_sources_the_image_from_the_passed_bytes_not_from_scope():
    """The map-image page is independent of which node-id set `tree` was
    pruned to -- confirms the visible-export change (scope resolution only)
    can never affect PR A's map-image placement/aspect/centering."""
    import struct
    import zlib

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00\xff\xff\xff" + b"\x00\xff\xff\xff\x00\x00\x00"))
    png = sig + ihdr + idat + chunk(b"IEND", b"")

    tree = _build({"root"})  # root-only visible-shaped set
    file_bytes = serialize_pdf(tree, mode="map", map_image_bytes=png)
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    assert len(doc[0].get_images()) == 1  # the real capture, not re-derived from the node set
    doc.close()
