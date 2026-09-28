"""Real PDF serializer (PyMuPDF/fitz — already a dependency, used elsewhere
for READING PDFs during ingest; this module uses the same library to WRITE
one). No rendering surface exists on the backend for the visual mind-map
layout itself (that's the client's snapdom capture) — "map" mode embeds a
client-supplied image (real bytes, same as docx_serializer's
`map_image_bytes`), never a server-side re-render. "outline" mode is real
generated content: the export tree's own hierarchy as indented text, with
genuine page breaks (or one custom-sized page, in `single_page` mode) —
never a placeholder page."""
from __future__ import annotations

from typing import Any, Optional

import fitz

from shared.paths import BE_ROOT

PAGE_SIZES_PT = {"A4": (595.0, 842.0), "A3": (842.0, 1191.0)}
MARGIN = 40.0
LINE_HEIGHT = 16.0
BASE_FONT_SIZE = 11.0
INDENT_PER_DEPTH = 16.0

# PyMuPDF's built-in "helv"/base-14 fonts are WinAnsi-only and mangle every
# Vietnamese diacritic (ế, ồ, ư, ệ... silently become "?"/mojibake) — this
# was caught by this module's own round-trip tests asserting the real
# Vietnamese substring appears in the extracted text, not by eyeballing
# output. DejaVu Sans has full Vietnamese Unicode coverage and a redistribution-
# permissive license (Bitstream Vera-derived; see assets/fonts/LICENSE_DEJAVU),
# so it's bundled as a real repo asset and embedded into the PDF, rather than
# assuming any particular font is installed in the production container.
FONT_PATH = BE_ROOT / "assets" / "fonts" / "DejaVuSans.ttf"
FONT_ALIAS = "dejavu"


def _register_font(page: "fitz.Page") -> str:
    page.insert_font(fontname=FONT_ALIAS, fontfile=str(FONT_PATH))
    return FONT_ALIAS


def _page_dims(page_size: str, orientation: str) -> tuple[float, float]:
    w, h = PAGE_SIZES_PT.get(page_size, PAGE_SIZES_PT["A4"])
    return (h, w) if orientation == "landscape" else (w, h)


def _outline_lines(tree: dict[str, Any]) -> list[tuple[int, str]]:
    """Flat (depth, text) pairs, document order — one line per node."""
    lines: list[tuple[int, str]] = []

    def walk(node: dict) -> None:
        lines.append((node["depth"], node["topic"] or ""))
        if node.get("note"):
            lines.append((node["depth"] + 1, f"— {node['note']}"))
        for c in node["children"]:
            walk(c)

    for root in tree["roots"]:
        walk(root)
    return lines


def _write_outline_pages(doc: "fitz.Document", tree: dict[str, Any], *, page_size: str, orientation: str, single_page: bool) -> None:
    lines = _outline_lines(tree)
    w, h = _page_dims(page_size, orientation)

    if single_page:
        total_h = MARGIN * 2 + max(1, len(lines)) * LINE_HEIGHT + 40
        page = doc.new_page(width=w, height=total_h)
        font = _register_font(page)
        y = MARGIN
        page.insert_text((MARGIN, y), tree.get("title") or "Sơ đồ tư duy", fontsize=BASE_FONT_SIZE + 4, fontname=font)
        y += LINE_HEIGHT * 2
        for depth, text in lines:
            page.insert_text((MARGIN + depth * INDENT_PER_DEPTH, y), text, fontsize=BASE_FONT_SIZE, fontname=font)
            y += LINE_HEIGHT
        return

    usable_h = h - MARGIN * 2
    lines_per_page = max(1, int(usable_h // LINE_HEIGHT) - 2)  # -2 reserves room for the title on page 1
    idx = 0
    first = True
    while idx < len(lines) or first:
        page = doc.new_page(width=w, height=h)
        font = _register_font(page)
        y = MARGIN
        if first:
            page.insert_text((MARGIN, y), tree.get("title") or "Sơ đồ tư duy", fontsize=BASE_FONT_SIZE + 4, fontname=font)
            y += LINE_HEIGHT * 2
            first = False
        chunk = lines[idx: idx + lines_per_page]
        for depth, text in chunk:
            page.insert_text((MARGIN + depth * INDENT_PER_DEPTH, y), text, fontsize=BASE_FONT_SIZE, fontname=font)
            y += LINE_HEIGHT
        idx += len(chunk)
        if not chunk and idx >= len(lines):
            break


def _write_image_page(doc: "fitz.Document", image_bytes: bytes, *, page_size: str, orientation: str) -> None:
    w, h = _page_dims(page_size, orientation)
    page = doc.new_page(width=w, height=h)
    rect = fitz.Rect(MARGIN, MARGIN, w - MARGIN, h - MARGIN)
    page.insert_image(rect, stream=image_bytes)


def serialize_pdf(
    tree: dict[str, Any], *, mode: str = "outline", page_size: str = "A4",
    orientation: str = "portrait", single_page: bool = False,
    map_image_bytes: Optional[bytes] = None,
) -> bytes:
    """mode: "outline" | "map" | "map_and_outline". Returns real PDF bytes."""
    if mode in ("map", "map_and_outline") and not map_image_bytes:
        raise ValueError(f"mode={mode!r} requires map_image_bytes")

    doc = fitz.open()
    try:
        if mode in ("map", "map_and_outline"):
            _write_image_page(doc, map_image_bytes, page_size=page_size, orientation=orientation)
        if mode in ("outline", "map_and_outline"):
            _write_outline_pages(doc, tree, page_size=page_size, orientation=orientation, single_page=single_page)
        return doc.tobytes()
    finally:
        doc.close()
