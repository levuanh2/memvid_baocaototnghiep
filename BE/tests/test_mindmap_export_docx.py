import io

import docx

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
    # Full scope's tree root is the true document root ("Bản đồ tư duy", depth
    # 0), so its direct children sit at depth 1, not 0 — assert against a
    # branch-scoped tree instead, where the selected node IS the root (depth 0).
    nodes = _nodes()
    scope = resolve_export_scope(nodes, scope_type="current_branch", selected_node_id="c1")
    tree = build_export_tree(nodes, [], scope["root_ids"], scope["included_ids"], title="T")
    doc = docx.Document(io.BytesIO(serialize_docx(tree)))
    by_text = {p.text: p.style.name for p in doc.paragraphs}
    assert by_text["Kiến trúc hệ thống"] == "Heading 1"  # selected node itself -> depth 0 -> level 1
    assert by_text["Chi tiết A"] == "Heading 2"  # its child -> depth 1 -> level 2


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
    """A genuinely valid, minimal 1x1 white PNG, built with real zlib/CRC —
    not hand-typed hex (a single wrong nibble there previously produced a
    corrupt PNG that python-docx's own chunk parser correctly rejected)."""
    import struct
    import zlib

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    raw = b"\x00\xff\xff\xff"  # filter byte + one RGB white pixel
    idat = chunk(b"IDAT", zlib.compress(raw))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


def test_docx_embeds_map_image_when_provided():
    file_bytes = serialize_docx(_tree(), map_image_bytes=_real_1x1_png())
    doc = docx.Document(io.BytesIO(file_bytes))
    assert len(doc.inline_shapes) == 1
