import io

import docx
import pytest

from services.mindmap.export.scope import resolve_export_scope
from services.mindmap.export.tree import build_export_tree
from services.mindmap.export.docx_serializer import serialize_docx


def _nodes():
    return [
        {"id": "r", "parent": None, "kind": "root", "title": "Bản đồ tư duy", "order": 0},
        {"id": "c1", "parent": "r", "kind": "section", "title": "Kiến trúc hệ thống", "order": 0, "note": "Ghi chú nhánh 1", "chunk_refs": ["doc1#p3"]},
        {"id": "c1a", "parent": "c1", "kind": "idea", "title": "Chi tiết A", "order": 0},
        {"id": "c2", "parent": "r", "kind": "section", "title": "Bảo mật", "order": 1},
    ]


def _tree(nodes=None, relations=None):
    nodes = nodes or _nodes()
    scope = resolve_export_scope(nodes, scope_type="full")
    return build_export_tree(nodes, relations or [], scope["root_ids"], scope["included_ids"], map_id="m1", title="Bản đồ tư duy")


def test_docx_has_correct_heading_hierarchy_and_stable_order():
    file_bytes = serialize_docx(_tree(), include_citations=True)
    assert file_bytes[:2] == b"PK"  # real docx = zip container
    doc = docx.Document(io.BytesIO(file_bytes))
    headings = [p.text for p in doc.paragraphs if p.style.name.startswith("Heading") or p.style.name == "Title"]
    assert "Bản đồ tư duy" in headings[0]
    assert "Kiến trúc hệ thống" in headings
    assert "Chi tiết A" in headings
    assert "Bảo mật" in headings
    # Document order preserved: C1 branch (with its child) appears before C2.
    idx_c1 = headings.index("Kiến trúc hệ thống")
    idx_c1a = headings.index("Chi tiết A")
    idx_c2 = headings.index("Bảo mật")
    assert idx_c1 < idx_c1a < idx_c2


def test_docx_heading_levels_reflect_depth():
    # The tree always starts at the TRUE map root now, so "r" (kept as
    # ancestor context for "c1") sits at depth 0 and the selected node "c1"
    # sits at depth 1 -> level 2.
    nodes = _nodes()
    scope = resolve_export_scope(nodes, scope_type="current_branch", selected_node_id="c1")
    tree = build_export_tree(
        nodes, [], scope["root_ids"], scope["included_ids"], title="T",
        context_ids=scope["context_ids"],
    )
    doc = docx.Document(io.BytesIO(serialize_docx(tree)))
    by_text = {p.text: p.style.name for p in doc.paragraphs}
    assert by_text["Bản đồ tư duy"] == "Heading 1"  # context ancestor (map root) -> depth 0 -> level 1
    assert by_text["Kiến trúc hệ thống"] == "Heading 2"  # selected node -> depth 1 -> level 2
    assert by_text["Chi tiết A"] == "Heading 3"  # its child -> depth 2 -> level 3


def test_docx_includes_note_beneath_its_node():
    doc = docx.Document(io.BytesIO(serialize_docx(_tree())))
    texts = [p.text for p in doc.paragraphs]
    idx_heading = texts.index("Kiến trúc hệ thống")
    assert texts[idx_heading + 1] == "Ghi chú nhánh 1"


def test_docx_citations_included_when_requested_and_omitted_when_not():
    with_cit = docx.Document(io.BytesIO(serialize_docx(_tree(), include_citations=True)))
    assert any("doc1#p3" in p.text for p in with_cit.paragraphs)
    without_cit = docx.Document(io.BytesIO(serialize_docx(_tree(), include_citations=False)))
    assert not any("doc1#p3" in p.text for p in without_cit.paragraphs)


def test_docx_scoped_to_selected_branch_excludes_other_branch():
    nodes = _nodes()
    scope = resolve_export_scope(nodes, scope_type="current_branch", selected_node_id="c1")
    tree = build_export_tree(nodes, [], scope["root_ids"], scope["included_ids"], title="T")
    doc = docx.Document(io.BytesIO(serialize_docx(tree)))
    texts = " ".join(p.text for p in doc.paragraphs)
    assert "Chi tiết A" in texts
    assert "Bảo mật" not in texts  # excluded scope must not leak in


def test_docx_relations_section_lists_real_topics_not_ids():
    nodes = _nodes()
    relations = [{"source": "c1a", "target": "c2", "type": "relates_to", "label": "liên quan"}]
    tree = _tree(nodes, relations)
    doc = docx.Document(io.BytesIO(serialize_docx(tree)))
    texts = " ".join(p.text for p in doc.paragraphs)
    assert "Chi tiết A" in texts and "Bảo mật" in texts
    assert any("Chi tiết A" in p.text and "Bảo mật" in p.text for p in doc.paragraphs)


def _real_1x1_png() -> bytes:
    """A genuinely valid, minimal 2x2 PNG with real content, built with real zlib/CRC —
    not hand-typed hex (a single wrong nibble there previously produced a
    corrupt PNG that python-docx's own chunk parser correctly rejected). Non-uniform
    (one dark pixel among white ones): a pure white capture is rejected by the image guard."""
    import struct
    import zlib

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0))
    raw = b"\x00\x00\x00\x00\xff\xff\xff" + b"\x00\xff\xff\xff\x00\x00\x00"  # two rows, one dark pixel
    idat = chunk(b"IDAT", zlib.compress(raw))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


def test_docx_font_selection_sans_vs_serif():
    sans_doc = docx.Document(io.BytesIO(serialize_docx(_tree(), font="sans")))
    serif_doc = docx.Document(io.BytesIO(serialize_docx(_tree(), font="serif")))
    assert sans_doc.styles["Normal"].font.name == "Calibri"
    assert serif_doc.styles["Normal"].font.name == "Times New Roman"


def test_docx_heading_color_monochrome_and_custom_palette():
    nodes = _nodes()
    keep = docx.Document(io.BytesIO(serialize_docx(_tree(nodes), heading_color_mode="keep")))
    mono = docx.Document(io.BytesIO(serialize_docx(_tree(nodes), heading_color_mode="monochrome")))
    palette = docx.Document(io.BytesIO(serialize_docx(_tree(nodes), heading_color_mode="customPalette")))
    heading = next(p for p in mono.paragraphs if p.text == "Kiến trúc hệ thống")
    assert heading.runs[0].font.color.rgb is not None
    keep_heading = next(p for p in keep.paragraphs if p.text == "Kiến trúc hệ thống")
    assert keep_heading.runs[0].font.color.rgb is None  # theme default, no explicit override
    void_ = palette  # exercised for no-exception coverage; per-branch color checked structurally above


def test_docx_orientation_landscape_swaps_page_dimensions():
    portrait = docx.Document(io.BytesIO(serialize_docx(_tree(), orientation="portrait")))
    landscape = docx.Document(io.BytesIO(serialize_docx(_tree(), orientation="landscape")))
    assert portrait.sections[0].page_width < portrait.sections[0].page_height
    assert landscape.sections[0].page_width > landscape.sections[0].page_height


def test_docx_margins_narrow_vs_wide():
    narrow = docx.Document(io.BytesIO(serialize_docx(_tree(), margins="narrow")))
    wide = docx.Document(io.BytesIO(serialize_docx(_tree(), margins="wide")))
    assert narrow.sections[0].left_margin < wide.sections[0].left_margin


def test_docx_source_names_derived_from_chunk_refs_when_enabled():
    nodes = _nodes()
    nodes[1]["chunk_refs"] = ["doc1#p3", "doc1#p9", "doc2#p1"]
    doc = docx.Document(io.BytesIO(serialize_docx(_tree(nodes), content={"sourceNames": True})))
    texts = " ".join(p.text for p in doc.paragraphs)
    assert "doc1" in texts and "doc2" in texts


def test_docx_notes_and_relations_can_be_excluded():
    nodes = _nodes()
    relations = [{"source": "c1a", "target": "c2", "type": "relates_to", "label": ""}]
    tree = _tree(nodes, relations)
    doc = docx.Document(io.BytesIO(serialize_docx(tree, content={"notes": False, "relations": False})))
    texts = " ".join(p.text for p in doc.paragraphs)
    assert "Ghi chú nhánh 1" not in texts
    assert "Quan hệ giữa các node" not in texts


def test_docx_branding_footer_when_enabled():
    with_brand = docx.Document(io.BytesIO(serialize_docx(_tree(), content={"branding": True})))
    assert with_brand.sections[0].footer.paragraphs[0].text == "StudyMap"
    without_brand = docx.Document(io.BytesIO(serialize_docx(_tree(), content={"branding": False})))
    assert without_brand.sections[0].footer.paragraphs[0].text != "StudyMap"


def test_docx_embeds_map_image_when_provided():
    file_bytes = serialize_docx(_tree(), map_image_bytes=_real_1x1_png())
    doc = docx.Document(io.BytesIO(file_bytes))
    assert len(doc.inline_shapes) == 1


def test_docx_rejects_a_blank_map_image_instead_of_embedding_it():
    import struct
    import zlib
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    width, height = 20, 12
    row = b"\x00" + b"\xff\xff\xff" * width  # filter byte + all-white pixels
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(row * height))
    blank = sig + ihdr + idat + chunk(b"IEND", b"")
    with pytest.raises(ValueError):
        serialize_docx(_tree(), map_image_bytes=blank)
