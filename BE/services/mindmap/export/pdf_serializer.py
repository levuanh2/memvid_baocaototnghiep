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

from services.mindmap.export.image_guard import validate_map_image
from services.mindmap.export.pdf_layout import (
    OutlineBlock, centered_fit_rect, choose_map_orientation, fits_on_page,
    indent_for_depth, wrap_multiline,
)

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
# No italic variant of the bundled DejaVu fonts exists (assets/fonts has only
# the regular weight) — a context-only ancestor is distinguished by muted
# gray text instead, overriding branch color for that one line.
CONTEXT_TEXT_RGB = (0.55, 0.55, 0.55)

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


def _measure_font(font: str) -> "fitz.Font":
    """A page-independent font object for real-glyph-metric text
    measurement (wrap decisions) -- the SAME font file `_register_font`
    embeds for drawing, so a wrap decision can never disagree with what
    actually gets painted."""
    return fitz.Font(fontfile=str(FONT_FILES.get(font, FONT_FILES["sans"])))


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
        lines.append({"depth": node["depth"], "text": node["topic"] or "", "root_index": root_index, "is_context": bool(node.get("is_context"))})
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


def _entry_color(entry: dict[str, Any], branch_color_mode: str) -> tuple[float, float, float]:
    if entry.get("is_context"):
        return CONTEXT_TEXT_RGB
    if entry["root_index"] >= 0:
        return _root_branch_color(entry["root_index"], branch_color_mode) or DEFAULT_TEXT_RGB
    return DEFAULT_TEXT_RGB


def _build_blocks(
    entries: list[dict[str, Any]], *, measure_font: "fitz.Font", page_w: float, margin: float,
    branch_color_mode: str,
) -> list[OutlineBlock]:
    """Converts flat logical outline entries (one topic/note/citation/...
    line each) into OutlineBlocks whose `.height` reflects the REAL number
    of wrapped physical lines -- the fix for the "chồng chữ" bug, where a
    multi-paragraph note's extra lines were invisible to the cursor math."""
    available_width = page_w - 2 * margin
    blocks: list[OutlineBlock] = []
    for entry in entries:
        indent = indent_for_depth(entry["depth"], available_width, INDENT_PER_DEPTH)
        max_width = max(available_width - indent, 10.0)  # never a zero/negative wrap width
        wrapped = wrap_multiline(entry["text"], font=measure_font, fontsize=BASE_FONT_SIZE, max_width=max_width)
        blocks.append(OutlineBlock(
            lines=wrapped, x=margin + indent, fontsize=BASE_FONT_SIZE,
            color=_entry_color(entry, branch_color_mode), line_height=LINE_HEIGHT,
        ))
    return blocks


def _draw_block(page: "fitz.Page", block: OutlineBlock, *, y: float, font_alias: str) -> None:
    for i, line in enumerate(block.lines):
        if line:  # an empty wrapped line (blank paragraph) still advances the cursor, just draws nothing
            page.insert_text((block.x, y + i * block.line_height), line, fontsize=block.fontsize, fontname=font_alias, color=block.color)


def _write_outline_pages(
    doc: "fitz.Document", tree: dict[str, Any], *, page_size: str, orientation: str, single_page: bool,
    font: str, background: str, branch_color_mode: str, margin: float, content: dict[str, bool],
) -> None:
    entries = _outline_lines(tree, content)
    if content.get("relations"):
        for rel_line in _write_relations_lines(tree):
            entries.append({"depth": 0, "text": rel_line, "root_index": -1, "is_context": False})
    w, h = _page_dims(page_size, orientation)
    measure_font = _measure_font(font)
    blocks = _build_blocks(entries, measure_font=measure_font, page_w=w, margin=margin, branch_color_mode=branch_color_mode)

    def draw_header(page: "fitz.Page", font_alias: str) -> float:
        y = margin
        page.insert_text((margin, y), tree.get("title") or "Sơ đồ tư duy", fontsize=BASE_FONT_SIZE + 4, fontname=font_alias, color=DEFAULT_TEXT_RGB)
        y += LINE_HEIGHT * 1.6
        if content.get("legend"):
            y = _draw_legend(page, tree, font=font_alias, margin=margin, branch_color_mode=branch_color_mode, y=y)
            y += LINE_HEIGHT * 0.4
        return y

    if single_page:
        header_h = LINE_HEIGHT * 1.6 + (LINE_HEIGHT * 1.4 if content.get("legend") else 0)
        total_h = margin * 2 + header_h + sum(b.height for b in blocks) + 20
        page = doc.new_page(width=w, height=total_h)
        _fill_background(page, background)
        font_alias = _register_font(page, font)
        y = draw_header(page, font_alias)
        for block in blocks:
            _draw_block(page, block, y=y, font_alias=font_alias)
            y += block.height
        if content.get("branding"):
            _draw_branding(page, font=font_alias, w=w, h=total_h, margin=margin)
        return

    idx = 0
    first = True
    while idx < len(blocks) or first:
        page = doc.new_page(width=w, height=h)
        _fill_background(page, background)
        font_alias = _register_font(page, font)
        y = margin
        if first:
            y = draw_header(page, font_alias)
            first = False
        placed = 0
        for block in blocks[idx:]:
            if not fits_on_page(y, block, h, margin):
                if placed == 0:
                    # Pathological case: a single block (e.g. one gigantic
                    # unbroken token) is taller than an entire fresh page.
                    # Draw it anyway rather than looping forever on a page
                    # that can never fit it -- content is never silently
                    # dropped, even if this one page overflows.
                    _draw_block(page, block, y=y, font_alias=font_alias)
                    y += block.height
                    placed += 1
                break
            _draw_block(page, block, y=y, font_alias=font_alias)
            y += block.height
            placed += 1
        if content.get("branding"):
            _draw_branding(page, font=font_alias, w=w, h=h, margin=margin)
        idx += placed
        if placed == 0 and idx >= len(blocks):
            break


def _write_image_page(doc: "fitz.Document", image_bytes: bytes, *, page_size: str, background: str, margin: float) -> None:
    """mode="map"/"map_and_outline"'s map page. Orientation is chosen by
    the REAL decoded image's own contain-fit scale (PR H contract) -- the
    caller no longer passes an `orientation` for this page at all. The
    destination rect is computed by hand (centered_fit_rect), never left
    to `insert_image`'s own `keep_proportion` (see pdf_layout.py's
    docstring for the confirmed PyMuPDF 1.27.2.3 square-image bug this
    avoids)."""
    pix = fitz.Pixmap(image_bytes)
    img_w, img_h = float(pix.width), float(pix.height)
    choice = choose_map_orientation(img_w, img_h, PAGE_SIZES_PT.get(page_size, PAGE_SIZES_PT["A4"]), margin)
    page = doc.new_page(width=choice.page_w, height=choice.page_h)
    _fill_background(page, background)
    rect = centered_fit_rect(img_w, img_h, choice.page_w, choice.page_h, margin)
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
    """mode: "outline" | "map" | "map_and_outline". Returns real PDF bytes.

    `orientation` (accepted for backward compatibility — old stored job
    options must still parse) no longer controls the map page's own
    orientation: that page always picks whichever of A4 portrait/landscape
    gives the real image a larger contain-fit scale (PR H contract, tie ->
    portrait). It still controls standalone mode="outline" pages exactly
    as before. mode="map_and_outline"'s outline pages are always A4
    portrait, independent of both `orientation` and whatever the map page
    ended up as -- a PDF can legitimately mix a landscape map page with
    portrait outline pages.
    """
    if mode in ("map", "map_and_outline") and not map_image_bytes:
        raise ValueError(f"mode={mode!r} requires map_image_bytes")
    if mode in ("map", "map_and_outline"):
        validate_map_image(map_image_bytes)

    content = content or {}
    margin = MARGINS_PT.get(margins, MARGINS_PT["normal"])

    doc = fitz.open()
    try:
        if mode in ("map", "map_and_outline"):
            _write_image_page(doc, map_image_bytes, page_size=page_size, background=background, margin=margin)
        if mode in ("outline", "map_and_outline"):
            outline_orientation = "portrait" if mode == "map_and_outline" else orientation
            _write_outline_pages(
                doc, tree, page_size=page_size, orientation=outline_orientation, single_page=single_page,
                font=font, background=background, branch_color_mode=branch_color_mode, margin=margin, content=content,
            )
        return doc.tobytes()
    finally:
        doc.close()
