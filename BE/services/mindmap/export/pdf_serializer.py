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

from dataclasses import dataclass
from typing import Any, Optional

import fitz

from services.mindmap.export.image_guard import validate_map_image
from services.mindmap.export.pdf_layout import (
    NavigationBands, OutlineBlock, Rect, TARGET_MEDIAN_PT, TARGET_MIN_PT,
    branch_aware_grid_search_verbose, centered_fit_rect, choose_map_orientation, exact_grid_search_verbose,
    fits_on_page, indent_for_depth, place_detail_tile, wrap_multiline,
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

# PR H2 -- when a geometry manifest is present and the overview alone can't
# hit this readability target, overview+detail tiling kicks in. Region-code
# overlay colour reuses the PR H "Hướng trang tự động" accent blue so the
# two features read as one coherent system, not two unrelated designs.
REGION_ACCENT_RGB = (0.169, 0.337, 0.831)  # ~ #2B56D4, matches Export Studio's accent blue family


@dataclass(frozen=True)
class PdfSerializationResult:
    """Wraps serialize_pdf's real output for callers that need more than
    raw bytes (the worker, for job result metadata) -- serialize_pdf()
    itself keeps returning plain `bytes` for every existing caller
    (unwraps `.content`), so PR #70's own public contract never changes."""
    content: bytes
    detail_pages: int
    warning: Optional[dict[str, Any]]


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


def _region_code(index: int) -> str:
    return f"A{index + 1}"


def _draw_region_overlay(page: "fitz.Page", *, overview_rect: "fitz.Rect", image_w: float, image_h: float, tiles: list[Rect], font_alias: str) -> None:
    """Draws each detail tile's boundary as a thin dashed outline over the
    overview image, with a small non-filling-the-region corner badge
    (never a solid fill -- must never occlude a node under it). The badge
    sits at the region's own top-left corner, inside the dashed border."""
    scale = overview_rect.width / image_w if image_w else 0.0
    for i, tile in enumerate(tiles):
        rx0 = overview_rect.x0 + tile.x * scale
        ry0 = overview_rect.y0 + tile.y * scale
        rx1 = overview_rect.x0 + tile.right * scale
        ry1 = overview_rect.y0 + tile.bottom * scale
        region_rect = fitz.Rect(rx0, ry0, rx1, ry1)
        page.draw_rect(region_rect, color=REGION_ACCENT_RGB, width=0.75, dashes="[3 2] 0")
        code = _region_code(i)
        badge = fitz.Rect(rx0 + 4, ry0 + 4, rx0 + 14 + 7 * len(code), ry0 + 18)
        page.draw_rect(badge, color=REGION_ACCENT_RGB, fill=(1, 1, 1), width=0.75)
        page.insert_text((badge.x0 + 4, badge.y1 - 5), code, fontsize=9, fontname=font_alias, color=REGION_ACCENT_RGB)


def _draw_overview_legend(page: "fitz.Page", *, region_count: int, font_alias: str, margin: float, page_h: float) -> None:
    codes = ", ".join(_region_code(i) for i in range(region_count))
    page.insert_text((margin, page_h - margin + 18), f"Overview — vùng chi tiết: {codes}", fontsize=9, fontname=font_alias, color=(0.3, 0.3, 0.3))


def _draw_detail_header(page: "fitz.Page", *, code: str, font_alias: str, margin: float) -> None:
    page.insert_text((margin, margin - 14), f"Chi tiết — vùng {code}", fontsize=13, fontname=font_alias, color=DEFAULT_TEXT_RGB)


def _node_effective_pts(nodes: list[dict], rect_w_pt: float, tile_w_px: float) -> list[float]:
    return [float(n["font_size_px"]) * rect_w_pt / tile_w_px for n in nodes if tile_w_px]


def _node_effective_pt_by_id(nodes: list[dict], node_id: str, rect_w_pt: float, tile_w_px: float) -> Optional[float]:
    if not tile_w_px:
        return None
    node = next((n for n in nodes if n["id"] == node_id), None)
    if node is None:
        return None
    return float(node["font_size_px"]) * rect_w_pt / tile_w_px


def _true_root_node_id(tree: dict[str, Any]) -> Optional[str]:
    true_root = (tree.get("roots") or [None])[0]
    return true_root["node_id"] if true_root else None


def _branch_groups_from_tree(tree: dict[str, Any]) -> list[tuple[str, set[str]]]:
    """[(branch_id, {node_id, ...}), ...] in document order, one entry per
    DIRECT CHILD of the map's true root (`tree["roots"][0]`) -- the export
    tree always has exactly one entry in `roots` (build_export_tree's own
    contract: one tree from the true root, never one per selected branch),
    so "top-level branch" here means the root's own children, not
    `tree["roots"]` itself. Each set is that child's own node_id plus every
    descendant's node_id (the branch's full subtree) -- never the root's
    own id, which is never inside any branch's own detail crop (H3B).
    Empty when the tree is just a bare root with no children (nothing to
    branch-tile; the caller's whole-image search already covers that)."""
    true_root = (tree.get("roots") or [None])[0]
    if not true_root:
        return []

    def collect(node: dict[str, Any], into: set[str]) -> None:
        into.add(node["node_id"])
        for c in node["children"]:
            collect(c, into)

    groups: list[tuple[str, set[str]]] = []
    for child in true_root["children"]:
        ids: set[str] = set()
        collect(child, ids)
        groups.append((child["node_id"], ids))
    return groups


def _write_image_or_detail_pages(
    doc: "fitz.Document", image_bytes: bytes, *, page_size: str, background: str, margin: float,
    geometry_manifest: Optional[dict[str, Any]] = None, tree: Optional[dict[str, Any]] = None,
) -> tuple[int, Optional[dict[str, Any]]]:
    """mode="map"/"map_and_outline"'s map page(s). Returns
    (detail_page_count, warning). Orientation/placement for the OVERVIEW
    page (and, when tiling, every detail page) is chosen by the real
    decoded image's own contain-fit scale (PR H contract) -- destination
    rects are always computed by hand (never `insert_image`'s own
    `keep_proportion` -- see pdf_layout.py's docstring for the confirmed
    PyMuPDF square-image bug this avoids). When `geometry_manifest` is
    None, behavior is BYTE-FOR-BYTE PR #70 (no manifest, no tiling logic
    even touched).
    """
    pix = fitz.Pixmap(image_bytes)
    img_w, img_h = float(pix.width), float(pix.height)
    page_size_pt = PAGE_SIZES_PT.get(page_size, PAGE_SIZES_PT["A4"])
    choice = choose_map_orientation(img_w, img_h, page_size_pt, margin)
    overview_page = doc.new_page(width=choice.page_w, height=choice.page_h)
    _fill_background(overview_page, background)
    overview_rect = centered_fit_rect(img_w, img_h, choice.page_w, choice.page_h, margin)
    # Insert ONCE; the returned xref is REUSED (never re-embedded/
    # re-compressed) for every detail page below -- see pdf_layout.py's
    # place_detail_tile and the Phase 1.5 Pillow-vs-PyMuPDF benchmark
    # (~4x faster, ~35-48% less peak RSS than per-tile Pillow crop+encode).
    xref = overview_page.insert_image(overview_rect, stream=image_bytes)

    if geometry_manifest is None:
        return 0, None

    bands = NavigationBands(margin_pt=margin)
    overview_pts = _node_effective_pts(geometry_manifest.get("nodes") or [], overview_rect.width, img_w)
    if overview_pts:
        overview_pts_sorted = sorted(overview_pts)
        median_pt = overview_pts_sorted[len(overview_pts_sorted) // 2]
        min_pt = overview_pts_sorted[0]
        if median_pt >= TARGET_MEDIAN_PT and min_pt >= TARGET_MIN_PT:
            return 0, None  # overview is already readable -- stays single-page, exactly like PR #70

    result, candidates = exact_grid_search_verbose(geometry_manifest, bands=bands, page_size_pt=page_size_pt)
    tiles: list[Rect]
    if result is not None:
        tiles = result.tiles
    else:
        # H3B — exact_grid_search's single uniform grid over the WHOLE image
        # couldn't hit the readability target within the page ceiling. Try
        # tiling each top-level branch against its OWN bounding box instead
        # (see pdf_layout.py's branch_aware_grid_search for the real,
        # measured win this produces over a uniform grid when branches are
        # spread out with real empty space between them). Only attempted
        # here, never before the whole-image search, so every map that
        # already worked under H2 renders byte-for-byte identically.
        branch_groups = _branch_groups_from_tree(tree) if tree is not None else []
        # H3B review finding — branch-aware tiling deliberately never puts
        # the true root inside any branch's own detail crop (it's the one
        # node every branch's ancestor path already excludes), so without
        # this check root would ONLY ever be as readable as the overview
        # page happens to make it -- unlike H2's whole-image tiling, where
        # root was covered by some tile too and got a detail-page-level
        # font like everything else. Give root its OWN single-node detail
        # region, exactly like a branch, whenever the overview's own scale
        # doesn't already make it independently readable (own font pt,
        # never the median/min of the whole overview, which root's own
        # label does not have to carry).
        # A single-node group's own "meets target" bar is necessarily the
        # stricter TARGET_MEDIAN_PT (median_pt == min_pt for one node), and
        # unlike a multi-node branch there is no "add a tile" escape hatch
        # (a lone node can only ever occupy exactly one tile -- splitting
        # it is never a valid candidate). If root's own label is wide
        # enough that even an isolated full-page crop can't clear that bar,
        # branch_aware_grid_search_verbose below returns None for the
        # WHOLE attempt (same explicit, bounded "can't do it" as any other
        # branch that can't be tiled) rather than silently shipping an
        # unreadable root.
        root_id = _true_root_node_id(tree) if tree is not None else None
        if root_id and branch_groups:
            root_overview_pt = _node_effective_pt_by_id(geometry_manifest.get("nodes") or [], root_id, overview_rect.width, img_w)
            if root_overview_pt is None or root_overview_pt < TARGET_MIN_PT:
                branch_groups = [(root_id, {root_id})] + branch_groups
        branch_result, branch_best_attempted = (
            branch_aware_grid_search_verbose(geometry_manifest, branch_groups, bands=bands, page_size_pt=page_size_pt)
            if branch_groups else (None, 0.0)
        )
        if branch_result is not None and branch_result.all_meet_target:
            tiles = branch_result.tiles
        else:
            # Neither strategy can produce a fully readable result within
            # the page ceiling -- explicit warning, never a silently
            # degraded "success" (same contract as PR H2). best_min_pt_found
            # reports the best REAL measurement from whichever attempt got
            # closer -- branch_best_attempted is 0.0 only when branch-aware
            # truly never measured anything (e.g. no branch groups at all),
            # never a number implying a search that didn't run.
            whole_image_best = max((c.min_pt for c in candidates), default=0.0)
            return 0, {
                "code": "detail_pages_skipped_ceiling_exceeded",
                "page_ceiling": 12,
                "best_min_pt_found": round(max(whole_image_best, branch_best_attempted), 2),
            }

    font_alias = _register_font(overview_page, "sans")
    _draw_region_overlay(overview_page, overview_rect=overview_rect, image_w=img_w, image_h=img_h, tiles=tiles, font_alias=font_alias)
    _draw_overview_legend(overview_page, region_count=len(tiles), font_alias=font_alias, margin=margin, page_h=choice.page_h)

    for i, tile in enumerate(tiles):
        placement = place_detail_tile(tile.w, tile.h, bands, page_size_pt)
        detail_page = doc.new_page(width=placement.page_w, height=placement.page_h)
        _fill_background(detail_page, background)
        detail_font_alias = _register_font(detail_page, "sans")
        code = _region_code(i)
        _draw_detail_header(detail_page, code=code, font_alias=detail_font_alias, margin=margin)
        # Crop-via-placement-and-page-clip (Phase 1.5 Section 9): insert the
        # SAME full image (reusing `xref`, never re-embedding its bytes),
        # scaled so tile.x/tile.y lands exactly at the detail rect's own
        # origin; everything outside the page's own MediaBox is clipped by
        # MuPDF at render time -- no second copy of pixel data is stored.
        scale = placement.image_rect.w / tile.w if tile.w else 0.0
        full_w_pt, full_h_pt = img_w * scale, img_h * scale
        rx0 = placement.image_rect.x - tile.x * scale
        ry0 = placement.image_rect.y - tile.y * scale
        full_place_rect = fitz.Rect(rx0, ry0, rx0 + full_w_pt, ry0 + full_h_pt)
        detail_page.insert_image(full_place_rect, xref=xref)

    return len(tiles), None


def _page_dims(page_size: str, orientation: str) -> tuple[float, float]:
    w, h = PAGE_SIZES_PT.get(page_size, PAGE_SIZES_PT["A4"])
    return (h, w) if orientation == "landscape" else (w, h)


def _serialize_pdf_impl(
    tree: dict[str, Any], *, mode: str = "outline", page_size: str = "A4",
    orientation: str = "portrait", single_page: bool = False,
    map_image_bytes: Optional[bytes] = None,
    font: str = "sans", background: str = "white", branch_color_mode: str = "keep",
    margins: str = "normal", content: Optional[dict[str, bool]] = None,
    geometry_manifest: Optional[dict[str, Any]] = None,
) -> PdfSerializationResult:
    """mode: "outline" | "map" | "map_and_outline".

    `orientation` (accepted for backward compatibility — old stored job
    options must still parse) no longer controls the map page's own
    orientation: that page always picks whichever of A4 portrait/landscape
    gives the real image a larger contain-fit scale (PR H contract, tie ->
    portrait). It still controls standalone mode="outline" pages exactly
    as before. mode="map_and_outline"'s outline pages are always A4
    portrait, independent of both `orientation` and whatever the map page
    ended up as -- a PDF can legitimately mix a landscape map page with
    portrait outline pages.

    `geometry_manifest` (PR H2, optional): when present AND the overview
    alone doesn't meet the readability target, the map page becomes an
    overview + N detail pages instead of one page -- see
    _write_image_or_detail_pages. None (the default) is byte-for-byte
    PR #70 behavior; this parameter is never required.
    """
    if mode in ("map", "map_and_outline") and not map_image_bytes:
        raise ValueError(f"mode={mode!r} requires map_image_bytes")
    if mode in ("map", "map_and_outline"):
        validate_map_image(map_image_bytes)

    content = content or {}
    margin = MARGINS_PT.get(margins, MARGINS_PT["normal"])

    doc = fitz.open()
    try:
        detail_pages, warning = 0, None
        if mode in ("map", "map_and_outline"):
            detail_pages, warning = _write_image_or_detail_pages(
                doc, map_image_bytes, page_size=page_size, background=background, margin=margin,
                geometry_manifest=geometry_manifest, tree=tree,
            )
        if mode in ("outline", "map_and_outline"):
            outline_orientation = "portrait" if mode == "map_and_outline" else orientation
            _write_outline_pages(
                doc, tree, page_size=page_size, orientation=outline_orientation, single_page=single_page,
                font=font, background=background, branch_color_mode=branch_color_mode, margin=margin, content=content,
            )
        # insert_image(stream=<RGBA PNG>) decodes the raster into an RGB
        # XObject plus an alpha soft mask. Without deflate, PyMuPDF writes
        # both streams as raw pixels (width * height * 4 bytes) even when the
        # source PNG is tiny; reusing one xref across detail pages avoids
        # duplication but cannot avoid that single raw-pixel expansion.
        # Deflating at final serialization preserves the decoded dimensions,
        # geometry coordinates, xref reuse, alpha, and page layout while
        # compressing every eligible PDF stream in one bounded final pass.
        return PdfSerializationResult(content=doc.tobytes(deflate=True), detail_pages=detail_pages, warning=warning)
    finally:
        doc.close()


def serialize_pdf(
    tree: dict[str, Any], *, mode: str = "outline", page_size: str = "A4",
    orientation: str = "portrait", single_page: bool = False,
    map_image_bytes: Optional[bytes] = None,
    font: str = "sans", background: str = "white", branch_color_mode: str = "keep",
    margins: str = "normal", content: Optional[dict[str, bool]] = None,
    geometry_manifest: Optional[dict[str, Any]] = None,
) -> bytes:
    """PR #70's own public contract, UNCHANGED: returns raw PDF bytes.
    Every existing caller keeps working exactly as before. Callers that
    need detail_pages/warning metadata (the worker) use
    serialize_pdf_with_result instead."""
    return _serialize_pdf_impl(
        tree, mode=mode, page_size=page_size, orientation=orientation, single_page=single_page,
        map_image_bytes=map_image_bytes, font=font, background=background, branch_color_mode=branch_color_mode,
        margins=margins, content=content, geometry_manifest=geometry_manifest,
    ).content


def serialize_pdf_with_result(
    tree: dict[str, Any], *, mode: str = "outline", page_size: str = "A4",
    orientation: str = "portrait", single_page: bool = False,
    map_image_bytes: Optional[bytes] = None,
    font: str = "sans", background: str = "white", branch_color_mode: str = "keep",
    margins: str = "normal", content: Optional[dict[str, bool]] = None,
    geometry_manifest: Optional[dict[str, Any]] = None,
) -> PdfSerializationResult:
    """Same rendering as serialize_pdf, but returns the full
    PdfSerializationResult (content/detail_pages/warning) -- used by the
    worker (app/application/mindmap_export.py) so a ceiling-exceeded
    warning can reach the job result."""
    return _serialize_pdf_impl(
        tree, mode=mode, page_size=page_size, orientation=orientation, single_page=single_page,
        map_image_bytes=map_image_bytes, font=font, background=background, branch_color_mode=branch_color_mode,
        margins=margins, content=content, geometry_manifest=geometry_manifest,
    )
