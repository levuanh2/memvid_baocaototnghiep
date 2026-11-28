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

import uuid

import docx
from docx.enum.section import WD_ORIENT
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.opc.packuri import PackURI
from docx.opc.part import Part
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

from services.mindmap.export.image_guard import validate_map_image
from shared.paths import BE_ROOT

MAX_HEADING_LEVEL = 9

# V9.3 typography (owner decisions 2026-11-26 and 2026-11-28): "sans" is Be Vietnam Pro, the app's
# UI font, and the DOCX EMBEDS it (ECMA-376 obfuscated TrueType, ~130 KiB) so Word shows it on machines
# that do not have it installed. "serif" stays Times New Roman (ships with Office). The TTF is the
# same official OFL file the PDF embeds (assets/fonts/BeVietnamPro-Regular.ttf, fsType 0).
FONT_NAMES = {"sans": "Be Vietnam Pro", "serif": "Times New Roman"}
EMBEDDED_FONT_FILES = {"sans": BE_ROOT / "assets" / "fonts" / "BeVietnamPro-Regular.ttf"}
_FONT_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font"
_OBFUSCATED_FONT_CT = "application/vnd.openxmlformats-officedocument.obfuscatedFont"
# A fixed key keeps the output reproducible; the obfuscation is a format requirement, not a secret.
_FONT_KEY = "{" + str(uuid.uuid5(uuid.NAMESPACE_URL, "studymap/export/bevietnampro-regular")).upper() + "}"
_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _embed_regular_font(doc: "docx.document.Document", name: str, ttf: bytes) -> None:
    """Embed `ttf` as the regular face of `name` (fontTable entry + obfuscated part + settings flag)."""
    key = bytes.fromhex(_FONT_KEY.strip("{}").replace("-", ""))[::-1]
    data = bytes(b ^ key[i % 16] for i, b in enumerate(ttf[:32])) + ttf[32:]
    font_table = doc.part.part_related_by(RT.FONT_TABLE)
    font_part = Part(PackURI("/word/fonts/font1.odttf"), _OBFUSCATED_FONT_CT, data, doc.part.package)
    rid = font_table.relate_to(font_part, _FONT_REL)
    entry = (f'<w:font w:name="{name}"><w:charset w:val="00"/><w:family w:val="swiss"/>'
             f'<w:pitch w:val="variable"/><w:embedRegular r:id="{rid}" w:fontKey="{_FONT_KEY}"/></w:font>')
    xml = font_table.blob.decode("utf-8")
    font_table._blob = xml.replace("</w:fonts>", entry + "</w:fonts>").encode("utf-8")
    settings = doc.settings.element
    if settings.find(f"{{{_W}}}embedTrueTypeFonts") is None:
        flag = settings.makeelement(f"{{{_W}}}embedTrueTypeFonts", {})
        zoom = settings.find(f"{{{_W}}}zoom")
        # CT_Settings order: ... zoom, removePersonalInformation, ..., embedTrueTypeFonts, ... proofState
        (zoom.addnext(flag) if zoom is not None else settings.insert(0, flag))
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
    for run in heading.runs:
        if color is not None:
            run.font.color.rgb = color
        # An ancestor kept only as orientation context (PR B's "is_context")
        # renders italic — the only way to tell it apart from a branch the
        # user actually selected, without touching heading level/shape/theme.
        if node.get("is_context"):
            run.font.italic = True
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
    if font in EMBEDDED_FONT_FILES or font not in FONT_NAMES:
        _embed_regular_font(doc, font_name, EMBEDDED_FONT_FILES["sans"].read_bytes())
    # Every heading level the outline can use, plus Title. The template's theme attributes
    # (w:asciiTheme="majorHAnsi" ...) take precedence over w:ascii, so they are removed; before this,
    # headings kept the theme font whatever was chosen (agy review of #218, P2).
    for style_name in ("Normal", "Title", *(f"Heading {i}" for i in range(1, MAX_HEADING_LEVEL + 1))):
        try:
            style = doc.styles[style_name]
        except KeyError:
            continue
        style.font.name = font_name
        r_fonts = style.element.rPr.rFonts
        for attr in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
            r_fonts.attrib.pop(qn(attr), None)

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
