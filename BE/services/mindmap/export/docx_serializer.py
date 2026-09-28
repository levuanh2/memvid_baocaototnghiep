"""Real DOCX serializer (python-docx, already a dependency — used elsewhere
for reading .docx during ingest; this is the same library writing). Produces
a document with real heading hierarchy (depth -> Heading N, capped at
Heading 9 — python-docx's own ceiling), stable node order (document order
from the export tree, not re-sorted), notes as body paragraphs beneath their
node, and optional citation references — never any content not present in
the export tree (no fabrication)."""
from __future__ import annotations

import io
from typing import Any, Optional

import docx
from docx.shared import Pt

MAX_HEADING_LEVEL = 9


def _add_node(doc, node: dict[str, Any], *, include_citations: bool) -> None:
    level = min(node["depth"] + 1, MAX_HEADING_LEVEL)
    doc.add_heading(node["topic"] or "(không có tiêu đề)", level=level)
    if node.get("note"):
        doc.add_paragraph(node["note"])
    if include_citations and node.get("citations"):
        p = doc.add_paragraph()
        run = p.add_run("Nguồn: " + ", ".join(node["citations"]))
        run.italic = True
        run.font.size = Pt(9)
    for child in node["children"]:
        _add_node(doc, child, include_citations=include_citations)


def serialize_docx(
    tree: dict[str, Any], *, include_citations: bool = True, map_image_bytes: Optional[bytes] = None,
) -> bytes:
    """Returns the .docx file's raw bytes. `map_image_bytes` (optional), when
    given, is embedded as a page-width image right after the title — the
    client's own PNG/JPEG capture, never generated here (this module has no
    rendering surface of its own)."""
    doc = docx.Document()
    for style_name in ("Normal", "Heading 1"):
        try:
            doc.styles[style_name].font.name = "Calibri"  # Vietnamese-diacritic-safe on Win/macOS/Linux DOCX viewers
        except KeyError:
            pass

    title = tree.get("title") or "Sơ đồ tư duy"
    doc.add_heading(title, level=0)

    if map_image_bytes:
        doc.add_picture(io.BytesIO(map_image_bytes), width=docx.shared.Inches(6.5))

    for root in tree["roots"]:
        _add_node(doc, root, include_citations=include_citations)

    if tree.get("relations"):
        doc.add_heading("Quan hệ giữa các node", level=1)
        by_id = {}
        for root in tree["roots"]:
            def collect(n):
                by_id[n["node_id"]] = n["topic"]
                for c in n["children"]:
                    collect(c)
            collect(root)
        for rel in tree["relations"]:
            src = by_id.get(rel["source"], rel["source"])
            dst = by_id.get(rel["target"], rel["target"])
            label = f" ({rel['label']})" if rel.get("label") else ""
            doc.add_paragraph(f"{src} → {dst}{label}", style="List Bullet")

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
