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
    file_bytes = serialize_pdf(_tree(), mode="outline", content={"notes": True})
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


def test_font_selection_sans_vs_serif_embeds_different_fonts():
    sans_bytes = serialize_pdf(_tree(), mode="outline", font="sans")
    serif_bytes = serialize_pdf(_tree(), mode="outline", font="serif")
    doc_sans = fitz.open(stream=sans_bytes, filetype="pdf")
    doc_serif = fitz.open(stream=serif_bytes, filetype="pdf")
    fonts_sans = {f[3] for f in doc_sans[0].get_fonts()}
    fonts_serif = {f[3] for f in doc_serif[0].get_fonts()}
    assert fonts_sans != fonts_serif
    doc_sans.close()
    doc_serif.close()


def test_background_dark_fills_the_page_with_a_dark_pixel_area():
    file_bytes = serialize_pdf(_tree(), mode="outline", background="dark")
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    pix = doc[0].get_pixmap()
    # Corner pixel, far from any text — should reflect the dark fill.
    r, g, b = pix.pixel(2, 2)
    assert r < 60 and g < 60 and b < 70
    doc.close()


def test_background_custom_hex_is_applied():
    file_bytes = serialize_pdf(_tree(), mode="outline", background="#FF0000")
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    pix = doc[0].get_pixmap()
    r, g, b = pix.pixel(2, 2)
    assert r > 200 and g < 40 and b < 40
    doc.close()


def test_margins_narrow_vs_wide_changes_text_start_position():
    narrow = serialize_pdf(_tree(), mode="outline", margins="narrow")
    wide = serialize_pdf(_tree(), mode="outline", margins="wide")
    doc_narrow = fitz.open(stream=narrow, filetype="pdf")
    doc_wide = fitz.open(stream=wide, filetype="pdf")
    x_narrow = doc_narrow[0].get_text("words")[0][0]
    x_wide = doc_wide[0].get_text("words")[0][0]
    assert x_narrow < x_wide
    doc_narrow.close()
    doc_wide.close()


def test_content_citations_and_source_names_render_when_enabled():
    nodes = _nodes(1)
    nodes[1]["chunk_refs"] = ["doc1#p3", "doc2#p7"]
    scope = resolve_export_scope(nodes, scope_type="full")
    tree = build_export_tree(nodes, [], scope["root_ids"], scope["included_ids"], title="T")
    file_bytes = serialize_pdf(tree, mode="outline", content={"citations": True, "sourceNames": True})
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    full_text = "".join(page.get_text() for page in doc)
    assert "doc1#p3" in full_text
    assert "doc1" in full_text and "doc2" in full_text
    doc.close()


def test_content_relations_section_renders_real_topics():
    nodes = _nodes(2)
    relations = [{"source": "c0", "target": "c1", "type": "relates_to", "label": "liên quan"}]
    scope = resolve_export_scope(nodes, scope_type="full")
    tree = build_export_tree(nodes, relations, scope["root_ids"], scope["included_ids"], title="T")
    file_bytes = serialize_pdf(tree, mode="outline", content={"relations": True})
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    full_text = "".join(page.get_text() for page in doc)
    assert "Quan hệ giữa các node" in full_text
    doc.close()


def test_content_legend_and_branding_render_when_enabled():
    file_bytes = serialize_pdf(_tree(), mode="outline", content={"legend": True, "branding": True})
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    full_text = "".join(page.get_text() for page in doc)
    assert "StudyMap" in full_text
    doc.close()

    without = serialize_pdf(_tree(), mode="outline", content={"legend": False, "branding": False})
    doc2 = fitz.open(stream=without, filetype="pdf")
    assert "StudyMap" not in "".join(page.get_text() for page in doc2)
    doc2.close()


def test_branch_color_monochrome_and_custom_palette_change_heading_color():
    keep_bytes = serialize_pdf(_tree(), mode="outline", branch_color_mode="keep")
    mono_bytes = serialize_pdf(_tree(), mode="outline", branch_color_mode="monochrome")
    palette_bytes = serialize_pdf(_tree(), mode="outline", branch_color_mode="customPalette")
    # All three must be valid, distinct renders (color affects the text
    # drawing operators, so the raw page content streams differ).
    assert keep_bytes != mono_bytes
    assert mono_bytes != palette_bytes


def test_scope_exclusion_holds_in_pdf_output():
    nodes = _nodes(3)
    scope = resolve_export_scope(nodes, scope_type="current_branch", selected_node_id="c0")
    tree = build_export_tree(nodes, [], scope["root_ids"], scope["included_ids"], title="T")
    doc = fitz.open(stream=serialize_pdf(tree, mode="outline"), filetype="pdf")
    full_text = "".join(page.get_text() for page in doc)
    assert "Nhánh 0: Kiến trúc hệ thống" in full_text
    assert "Nhánh 1: Kiến trúc hệ thống" not in full_text
    doc.close()
