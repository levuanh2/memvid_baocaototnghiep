"""Real PDF serializer (PyMuPDF/fitz — already a dependency, used elsewhere
for READING PDFs during ingest; this module uses the same library to WRITE
one). No rendering surface exists on the backend for the visual mind-map
layout itself (that's the client's snapdom capture) — "map" mode embeds a
client-supplied image (real bytes, same as docx_serializer's
`map_image_bytes`), never a server-side re-render. "outline" mode is real
generated content: the export tree's own hierarchy as indented text, with
genuine page breaks (or one custom-sized page, in `single_page` mode) —
never a placeholder page.

Every option here is driven by format_capabilities.json's "pdf" entry
(services/mindmap/export/capabilities.py normalizes a request against it
before this function ever sees it) — this module doesn't decide what's
valid, only how to render what capabilities.py already validated.
"""
from __future__ import annotations

from typing import Any, Optional

import fitz

from shared.paths import BE_ROOT

PAGE_SIZES_PT = {"A4": (595.0, 842.0), "A3": (842.0, 1191.0)}
MARGINS_PT = {"narrow": 24.0, "normal": 40.0, "wide": 64.0}
LINE_HEIGHT = 16.0
BASE_FONT_SIZE = 11.0
INDENT_PER_DEPTH = 16.0

BACKGROUND_RGB = {"white": (1.0, 1.0, 1.0), "dark": (0.08, 0.09, 0.11)}
MONOCHROME_RGB = (0.169, 0.149, 0.125)  # #2B2620 — matches FE's mindmapExportAppearance.js MONOCHROME_COLOR
CUSTOM_PALETTE_RGB = [  # matches FE's CUSTOM_PALETTE hex values exactly
    (0x12 / 255, 0x6C / 255, 0xF2 / 255),  # #126CF2
    (0x8C / 255, 0x4D / 255, 0xFF / 255),  # #8C4DFF
    (0x16 / 255, 0xA0 / 255, 0x85 / 255),  # #16A085
    (0xF2 / 255, 0x35 / 255, 0x3A / 255),  # #F2353A
]
DEFAULT_TEXT_RGB = (0.0, 0.0, 0.0)

# PyMuPDF's built-in "helv"/base-14 fonts are WinAnsi-only and mangle every
# Vietnamese diacritic (ế, ồ, ư, ệ... silently become "?"/mojibake) — this
# was caught by this module's own round-trip tests asserting the real
# Vietnamese substring appears in the extracted text, not by eyeballing
# output. DejaVu Sans/Serif have full Vietnamese Unicode coverage and a
# redistribution-permissive license (Bitstream Vera-derived; see
# assets/fonts/LICENSE_DEJAVU), so they're bundled as real repo assets and
# embedded into the PDF, rather than assuming any font is installed in the
# production container.
FONT_FILES = {
    "sans": BE_ROOT / "assets" / "fonts" / "DejaVuSans.ttf",
    "serif": BE_ROOT / "assets" / "fonts" / "DejaVuSerif.ttf",
}
FONT_ALIASES = {"sans": "dejavu-sans", "serif": "dejavu-serif"}


def _hex_to_rgb01(value: str) -> tuple[float, float, float]:
    v = value.lstrip("#")
    return (int(v[0:2], 16) / 255, int(v[2:4], 16) / 255, int(v[4:6], 16) / 255)


def _resolve_background(background: str) -> tuple[float, float, float]:
    if background in BACKGROUND_RGB:
        return BACKGROUND_RGB[background]
    if background and background.startswith("#"):
        return _hex_to_rgb01(background)
    return BACKGROUND_RGB["white"]


def _register_font(page: "fitz.Page", font: str) -> str:
    alias = FONT_ALIASES.get(font, FONT_ALIASES["sans"])
    page.insert_font(fontname=alias, fontfile=str(FONT_FILES.get(font, FONT_FILES["sans"])))
    return alias


def _fill_background(page: "fitz.Page", background: str) -> None:
    page.draw_rect(page.rect, color=None, fill=_resolve_background(background))


def _root_branch_color(index: int, branch_color_mode: str) -> Optional[tuple[float, float, float]]:
    if branch_color_mode == "monochrome":
        return MONOCHROME_RGB
    if branch_color_mode == "customPalette":
        return CUSTOM_PALETTE_RGB[index % len(CUSTOM_PALETTE_RGB)]
    return None  # "keep" -> default text color


def _source_name(chunk_ref: str) -> str:
    """Derives a friendlier source label from a raw chunk_ref ("doc1#p3" ->
    "doc1") — never fabricated, just a reformatting of data already on the
    node; NodeV2 has no separate per-node source-name field to read instead."""
    return chunk_ref.split("#", 1)[0]


def _outline_lines(tree: dict[str, Any], content: dict[str, bool]) -> list[dict[str, Any]]:
    """One entry per rendered line: {depth, text, root_index}."""
    lines: list[dict[str, Any]] = []

    def walk(node: dict, root_index: int) -> None:
        lines.append({"depth": node["depth"], "text": node["topic"] or "", "root_index": root_index})
        if content.get("notes") and node.get("note"):
            lines.append({"depth": node["depth"] + 1, "text": f"— {node['note']}", "root_index": root_index})
        if content.get("citations") and node.get("citations"):
            lines.append({"depth": node["depth"] + 1, "text": f"Trích dẫn: {', '.join(node['citations'])}", "root_index": root_index})
        if content.get("sourceNames") and node.get("citations"):
            names = sorted({_source_name(c) for c in node["citations"]})
            lines.append({"depth": node["depth"] + 1, "text": f"Nguồn: {', '.join(names)}", "root_index": root_index})
        for c in node["children"]:
            walk(c, root_index)

    for i, root in enumerate(tree["roots"]):
        walk(root, i)
    return lines


def _draw_legend(page: "fitz.Page", tree: dict[str, Any], *, font: str, margin: float, branch_color_mode: str, y: float) -> float:
    x = margin
    for i, root in enumerate(tree["roots"]):
        color = _root_branch_color(i, branch_color_mode) or DEFAULT_TEXT_RGB
        page.draw_circle((x + 4, y - 3), 3, color=None, fill=color)
        label = root["topic"] or ""
        page.insert_text((x + 12, y), label, fontsize=BASE_FONT_SIZE - 2, fontname=font, color=DEFAULT_TEXT_RGB)
        x += 12 + 7 * len(label) + 20
    return y + LINE_HEIGHT


def _draw_branding(page: "fitz.Page", *, font: str, w: float, h: float, margin: float) -> None:
    page.insert_text((w - margin - 60, h - margin / 2), "StudyMap", fontsize=9, fontname=font, color=(0.5, 0.5, 0.5))


def _write_relations_lines(tree: dict[str, Any]) -> list[str]:
    if not tree.get("relations"):
        return []
    by_id: dict[str, str] = {}

    def collect(node: dict) -> None:
        by_id[node["node_id"]] = node["topic"]
        for c in node["children"]:
            collect(c)

    for root in tree["roots"]:
        collect(root)
    out = ["", "Quan hệ giữa các node:"]
    for rel in tree["relations"]:
        src = by_id.get(rel["source"], rel["source"])
        dst = by_id.get(rel["target"], rel["target"])
        label = f" ({rel['label']})" if rel.get("label") else ""
        out.append(f"  {src} -> {dst}{label}")
    return out


def _write_outline_pages(
    doc: "fitz.Document", tree: dict[str, Any], *, page_size: str, orientation: str, single_page: bool,
    font: str, background: str, branch_color_mode: str, margin: float, content: dict[str, bool],
) -> None:
    lines = _outline_lines(tree, content)
    if content.get("relations"):
        for rel_line in _write_relations_lines(tree):
            lines.append({"depth": 0, "text": rel_line, "root_index": -1})
    w, h = _page_dims(page_size, orientation)

    def draw_header(page: "fitz.Page", font_alias: str) -> float:
        y = margin
        page.insert_text((margin, y), tree.get("title") or "Sơ đồ tư duy", fontsize=BASE_FONT_SIZE + 4, fontname=font_alias, color=DEFAULT_TEXT_RGB)
        y += LINE_HEIGHT * 1.6
        if content.get("legend"):
            y = _draw_legend(page, tree, font=font_alias, margin=margin, branch_color_mode=branch_color_mode, y=y)
            y += LINE_HEIGHT * 0.4
        return y

    if single_page:
        total_h = margin * 2 + max(1, len(lines)) * LINE_HEIGHT + 60
        page = doc.new_page(width=w, height=total_h)
        _fill_background(page, background)
        font_alias = _register_font(page, font)
        y = draw_header(page, font_alias)
        for line in lines:
            color = _root_branch_color(line["root_index"], branch_color_mode) if line["root_index"] >= 0 else DEFAULT_TEXT_RGB
            page.insert_text((margin + line["depth"] * INDENT_PER_DEPTH, y), line["text"], fontsize=BASE_FONT_SIZE, fontname=font_alias, color=color or DEFAULT_TEXT_RGB)
            y += LINE_HEIGHT
        if content.get("branding"):
            _draw_branding(page, font=font_alias, w=w, h=total_h, margin=margin)
        return

    idx = 0
    first = True
    while idx < len(lines) or first:
        page = doc.new_page(width=w, height=h)
        _fill_background(page, background)
        font_alias = _register_font(page, font)
        y = margin
        if first:
            y = draw_header(page, font_alias)
            first = False
        lines_per_page = max(1, int((h - margin - y) // LINE_HEIGHT))
        chunk = lines[idx: idx + lines_per_page]
        for line in chunk:
            color = _root_branch_color(line["root_index"], branch_color_mode) if line["root_index"] >= 0 else DEFAULT_TEXT_RGB
            page.insert_text((margin + line["depth"] * INDENT_PER_DEPTH, y), line["text"], fontsize=BASE_FONT_SIZE, fontname=font_alias, color=color or DEFAULT_TEXT_RGB)
            y += LINE_HEIGHT
        if content.get("branding"):
            _draw_branding(page, font=font_alias, w=w, h=h, margin=margin)
        idx += len(chunk)
        if not chunk and idx >= len(lines):
            break


def _write_image_page(doc: "fitz.Document", image_bytes: bytes, *, page_size: str, orientation: str, background: str, margin: float) -> None:
    w, h = _page_dims(page_size, orientation)
    page = doc.new_page(width=w, height=h)
    _fill_background(page, background)
    rect = fitz.Rect(margin, margin, w - margin, h - margin)
    page.insert_image(rect, stream=image_bytes)


def _page_dims(page_size: str, orientation: str) -> tuple[float, float]:
    w, h = PAGE_SIZES_PT.get(page_size, PAGE_SIZES_PT["A4"])
    return (h, w) if orientation == "landscape" else (w, h)


def serialize_pdf(
    tree: dict[str, Any], *, mode: str = "outline", page_size: str = "A4",
    orientation: str = "portrait", single_page: bool = False,
    map_image_bytes: Optional[bytes] = None,
    font: str = "sans", background: str = "white", branch_color_mode: str = "keep",
    margins: str = "normal", content: Optional[dict[str, bool]] = None,
) -> bytes:
    """mode: "outline" | "map" | "map_and_outline". Returns real PDF bytes."""
    if mode in ("map", "map_and_outline") and not map_image_bytes:
        raise ValueError(f"mode={mode!r} requires map_image_bytes")

    content = content or {}
    margin = MARGINS_PT.get(margins, MARGINS_PT["normal"])

    doc = fitz.open()
    try:
        if mode in ("map", "map_and_outline"):
            _write_image_page(doc, map_image_bytes, page_size=page_size, orientation=orientation, background=background, margin=margin)
        if mode in ("outline", "map_and_outline"):
            _write_outline_pages(
                doc, tree, page_size=page_size, orientation=orientation, single_page=single_page,
                font=font, background=background, branch_color_mode=branch_color_mode, margin=margin, content=content,
            )
        return doc.tobytes()
    finally:
        doc.close()
