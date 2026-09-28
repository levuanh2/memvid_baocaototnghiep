import struct
import zlib

import fitz
import pytest

from services.mindmap.export.scope import resolve_export_scope
from services.mindmap.export.tree import build_export_tree
from services.mindmap.export.pdf_serializer import serialize_pdf, PAGE_SIZES_PT


def _nodes(n_children: int = 3):
    nodes = [{"id": "r", "parent": None, "kind": "root", "title": "Bản đồ tư duy", "order": 0}]
    for i in range(n_children):
        nodes.append({"id": f"c{i}", "parent": "r", "kind": "section", "title": f"Nhánh {i}: Kiến trúc hệ thống", "order": i, "note": f"Ghi chú {i}"})
    return nodes


def _tree(n_children: int = 3):
    nodes = _nodes(n_children)
    scope = resolve_export_scope(nodes, scope_type="full")
    return build_export_tree(nodes, [], scope["root_ids"], scope["included_ids"], title="Bản đồ tư duy")


def _real_1x1_png() -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(b"\x00\xff\xff\xff"))
    return sig + ihdr + idat + chunk(b"IEND", b"")


def _no_blank_pages(doc: "fitz.Document") -> bool:
    for page in doc:
        has_text = bool(page.get_text().strip())
        has_image = len(page.get_images()) > 0
        if not has_text and not has_image:
            return False
    return True


def test_outline_mode_produces_valid_paginated_pdf_with_extractable_vietnamese_text():
    file_bytes = serialize_pdf(_tree(), mode="outline")
    assert file_bytes[:5] == b"%PDF-"
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    assert doc.page_count >= 1
    assert _no_blank_pages(doc)
    full_text = "".join(page.get_text() for page in doc)
    assert "Bản đồ tư duy" in full_text
    assert "Nhánh 0: Kiến trúc hệ thống" in full_text
    assert "Ghi chú 0" in full_text
    doc.close()


def test_outline_mode_paginates_when_content_exceeds_one_page():
    file_bytes = serialize_pdf(_tree(n_children=120), mode="outline", single_page=False)
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    assert doc.page_count > 1
    assert _no_blank_pages(doc)
    full_text = "".join(page.get_text() for page in doc)
    assert "Nhánh 119: Kiến trúc hệ thống" in full_text  # last node still present, nothing truncated
    doc.close()


def test_single_page_mode_produces_exactly_one_custom_sized_page_regardless_of_length():
    file_bytes = serialize_pdf(_tree(n_children=80), mode="outline", single_page=True)
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    assert doc.page_count == 1
    assert doc[0].rect.height > PAGE_SIZES_PT["A4"][1]  # taller than a standard page
    full_text = doc[0].get_text()
    assert "Nhánh 79: Kiến trúc hệ thống" in full_text
    doc.close()


@pytest.mark.parametrize("page_size,orientation", [("A4", "portrait"), ("A4", "landscape"), ("A3", "portrait"), ("A3", "landscape")])
def test_page_size_and_orientation_produce_correct_real_dimensions(page_size, orientation):
    file_bytes = serialize_pdf(_tree(), mode="outline", page_size=page_size, orientation=orientation)
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    w, h = PAGE_SIZES_PT[page_size]
    expected = (h, w) if orientation == "landscape" else (w, h)
    rect = doc[0].rect
    assert (round(rect.width), round(rect.height)) == (round(expected[0]), round(expected[1]))
    doc.close()


def test_map_mode_embeds_a_real_image_and_requires_one():
    with pytest.raises(ValueError):
        serialize_pdf(_tree(), mode="map")  # no image bytes -> must fail, not silently produce a blank page

    file_bytes = serialize_pdf(_tree(), mode="map", map_image_bytes=_real_1x1_png())
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    assert doc.page_count == 1
    assert len(doc[0].get_images()) == 1
    doc.close()


def test_map_and_outline_mode_produces_image_page_then_outline_pages():
    file_bytes = serialize_pdf(_tree(), mode="map_and_outline", map_image_bytes=_real_1x1_png())
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    assert doc.page_count == 2
    assert len(doc[0].get_images()) == 1
    assert "Bản đồ tư duy" in doc[1].get_text()
    assert _no_blank_pages(doc)
    doc.close()


def test_scope_exclusion_holds_in_pdf_output():
    nodes = _nodes(3)
    scope = resolve_export_scope(nodes, scope_type="current_branch", selected_node_id="c0")
    tree = build_export_tree(nodes, [], scope["root_ids"], scope["included_ids"], title="T")
    doc = fitz.open(stream=serialize_pdf(tree, mode="outline"), filetype="pdf")
    full_text = "".join(page.get_text() for page in doc)
    assert "Nhánh 0: Kiến trúc hệ thống" in full_text
    assert "Nhánh 1: Kiến trúc hệ thống" not in full_text
    doc.close()
