"""Real DOCX serializer (python-docx, already a dependency — used elsewhere
for reading .docx during ingest; this is the same library writing). Produces
a document with real heading hierarchy (depth -> Heading N, capped at
Heading 9 — python-docx's own ceiling), stable node order (document order
from the export tree, not re-sorted) — never any content not present in
the export tree (no fabrication).

Every option here is driven by format_capabilities.json's "docx" entry
(capabilities.py normalizes a request against it before this function ever
sees it) — no background/connector controls exist here on purpose (a
document page has no "canvas" and no connector lines to color)."""
from __future__ import annotations

import io
from typing import Any, Optional

import docx
from docx.enum.section import WD_ORIENT
from docx.shared import Inches, Pt, RGBColor

from services.mindmap.export.image_guard import validate_map_image

MAX_HEADING_LEVEL = 9

FONT_NAMES = {"sans": "Calibri", "serif": "Times New Roman"}  # both Vietnamese-diacritic-safe, both ship with Office/LibreOffice defaults — no embedding needed, DOCX stores real UTF-8 text regardless of the nominal font name
MARGINS_INCHES = {"narrow": 0.5, "normal": 1.0, "wide": 1.5}
MONOCHROME_RGB = RGBColor(0x2B, 0x26, 0x20)  # matches FE's mindmapExportAppearance.js MONOCHROME_COLOR
CUSTOM_PALETTE_RGB = [
    RGBColor(0x12, 0x6C, 0xF2), RGBColor(0x8C, 0x4D, 0xFF),
    RGBColor(0x16, 0xA0, 0x85), RGBColor(0xF2, 0x35, 0x3A),
]  # matches FE's CUSTOM_PALETTE exactly


def _root_heading_color(root_index: int, heading_color_mode: str) -> Optional[RGBColor]:
    if heading_color_mode == "monochrome":
        return MONOCHROME_RGB
    if heading_color_mode == "customPalette":
        return CUSTOM_PALETTE_RGB[root_index % len(CUSTOM_PALETTE_RGB)]
    return None  # "keep" — theme default heading color


def _source_name(chunk_ref: str) -> str:
    """Same derivation as pdf_serializer._source_name — a reformat of the
    node's own chunk_refs, never fabricated data; NodeV2 has no separate
    per-node source-name field."""
    return chunk_ref.split("#", 1)[0]


def _add_node(doc, node: dict[str, Any], *, root_index: int, heading_color_mode: str, content: dict[str, bool]) -> None:
    level = min(node["depth"] + 1, MAX_HEADING_LEVEL)
    heading = doc.add_heading(node["topic"] or "(không có tiêu đề)", level=level)
    color = _root_heading_color(root_index, heading_color_mode)
    if color is not None:
        for run in heading.runs:
            run.font.color.rgb = color
    if content.get("notes", True) and node.get("note"):
        doc.add_paragraph(node["note"])
    if content.get("citations", True) and node.get("citations"):
        p = doc.add_paragraph()
        run = p.add_run("Trích dẫn: " + ", ".join(node["citations"]))
        run.italic = True
        run.font.size = Pt(9)
    if content.get("sourceNames") and node.get("citations"):
        names = sorted({_source_name(c) for c in node["citations"]})
        p = doc.add_paragraph()
        run = p.add_run("Nguồn: " + ", ".join(names))
        run.italic = True
        run.font.size = Pt(9)
    for child in node["children"]:
        _add_node(doc, child, root_index=root_index, heading_color_mode=heading_color_mode, content=content)


def serialize_docx(
    tree: dict[str, Any], *, map_image_bytes: Optional[bytes] = None,
    font: str = "sans", heading_color_mode: str = "keep",
    orientation: str = "portrait", margins: str = "normal",
    content: Optional[dict[str, bool]] = None,
    include_citations: Optional[bool] = None,  # back-compat alias for content.citations
) -> bytes:
    """Returns the .docx file's raw bytes. `map_image_bytes` (optional), when
    given, is embedded as a page-width image right after the title — the
    client's own PNG/JPEG capture, never generated here (this module has no
    rendering surface of its own)."""
    content = dict(content or {})
    if include_citations is not None:
        content.setdefault("citations", include_citations)
    content.setdefault("notes", True)
    content.setdefault("citations", True)
    content.setdefault("relations", True)

    doc = docx.Document()
    font_name = FONT_NAMES.get(font, FONT_NAMES["sans"])
    for style_name in ("Normal", "Heading 1", "Title"):
        try:
            doc.styles[style_name].font.name = font_name
        except KeyError:
            pass

    section = doc.sections[0]
    if orientation == "landscape" and section.orientation != WD_ORIENT.LANDSCAPE:
        section.orientation = WD_ORIENT.LANDSCAPE
        section.page_width, section.page_height = section.page_height, section.page_width
    margin_in = Inches(MARGINS_INCHES.get(margins, MARGINS_INCHES["normal"]))
    section.left_margin = section.right_margin = section.top_margin = section.bottom_margin = margin_in

    title = tree.get("title") or "Sơ đồ tư duy"
    doc.add_heading(title, level=0)

    if map_image_bytes:
        # The map image is optional here, but once supplied it must be a real, non-blank capture
        # (same guard as the PDF map page) — never a silently embedded blank picture.
        validate_map_image(map_image_bytes)
        doc.add_picture(io.BytesIO(map_image_bytes), width=Inches(6.5))

    for i, root in enumerate(tree["roots"]):
        _add_node(doc, root, root_index=i, heading_color_mode=heading_color_mode, content=content)

    if content.get("relations") and tree.get("relations"):
        doc.add_heading("Quan hệ giữa các node", level=1)
        by_id = {}

        def collect(n):
            by_id[n["node_id"]] = n["topic"]
            for c in n["children"]:
                collect(c)

        for root in tree["roots"]:
            collect(root)
        for rel in tree["relations"]:
            src = by_id.get(rel["source"], rel["source"])
            dst = by_id.get(rel["target"], rel["target"])
            label = f" ({rel['label']})" if rel.get("label") else ""
            doc.add_paragraph(f"{src} → {dst}{label}", style="List Bullet")

    if content.get("branding"):
        footer_p = section.footer.paragraphs[0] if section.footer.paragraphs else section.footer.add_paragraph()
        footer_p.text = "StudyMap"

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
