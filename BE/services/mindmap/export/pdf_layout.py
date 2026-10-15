"""Pure PDF layout helpers for PR H — contain-fit orientation/rect math and
real-font-metric text wrapping, each independently unit-testable without
opening a fitz.Document. Extracted from pdf_serializer.py because that
module's own job (deciding WHAT to draw from a tree + options) must not be
tangled with HOW MUCH SPACE a given piece of text actually needs on a real
page — that confusion (a fixed LINE_HEIGHT charged per logical item instead
of per rendered line) was this PR's root cause for the "chồng chữ" bug.

Root causes this module exists to fix (confirmed with real exported PDFs,
read with PyMuPDF, before any of this was written — see
.playbook/known-issues.md):
  1. The map page's orientation was a raw pass-through of the client's
     `orientation` option, never compared against the real image's own
     aspect ratio — a wide map forced into a portrait page used ~17% of
     the usable area; the same image in landscape used over 2x that.
  2. Outline text used `page.insert_text()`, which has no wrap parameter
     at all — a long topic with no embedded newline silently ran off the
     page's right edge, past even the page boundary itself.
  3. The outline cursor advanced by one fixed LINE_HEIGHT per logical
     line, but `insert_text()` draws every `\n` in a string as its own
     internal line — a multi-paragraph note rendered 2+ real lines while
     the caller only reserved vertical space for 1, so the next item
     overlapped the note's own tail.

Also confirmed (real, isolated repro, nothing to do with this codebase):
PyMuPDF 1.27.2.3's `Page.insert_image(rect, keep_proportion=True)`
distorts a perfectly square (1:1) source image to fill `rect` exactly,
while every OTHER aspect ratio tested (4:1, 2:1, 1.5:1, 0.8:1, 0.667:1,
0.5:1) was fit correctly. `centered_fit_rect` below computes the exact
destination rect itself and hands PyMuPDF an already-correct rect, so
that library quirk can never surface regardless of image shape.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import fitz

# How much of a wrapped line's available width the per-depth indent may
# consume at most -- a sufficiently deep outline branch must still keep
# real room for its own text, not be indented off the page.
MAX_INDENT_FRACTION_OF_WIDTH = 0.6


def contain_fit_scale(content_w: float, content_h: float, box_w: float, box_h: float) -> float:
    """The largest scale factor that fits content_w x content_h inside
    box_w x box_h without cropping either dimension. 0 for a degenerate
    (non-positive) content size or box."""
    if content_w <= 0 or content_h <= 0 or box_w <= 0 or box_h <= 0:
        return 0.0
    return min(box_w / content_w, box_h / content_h)


@dataclass(frozen=True)
class OrientationChoice:
    orientation: str  # "portrait" | "landscape"
    scale: float
    page_w: float
    page_h: float


def choose_map_orientation(image_w: float, image_h: float, portrait_page_pt: tuple[float, float], margin: float) -> OrientationChoice:
    """Compares the real image's contain-fit scale on an A4/A3 portrait
    page vs. the same page rotated to landscape, and returns whichever is
    larger -- PR H's approved contract for mode="map"/"map_and_outline"'s
    map page. A tie (including the degenerate 0-scale case) picks
    portrait, so the choice is always deterministic. `portrait_page_pt` is
    the page size's own (width, height) in PORTRAIT orientation, e.g.
    PAGE_SIZES_PT["A4"] -- never pre-rotated by the caller."""
    pw, ph = portrait_page_pt
    portrait_scale = contain_fit_scale(image_w, image_h, pw - 2 * margin, ph - 2 * margin)
    landscape_scale = contain_fit_scale(image_w, image_h, ph - 2 * margin, pw - 2 * margin)
    if landscape_scale > portrait_scale:
        return OrientationChoice("landscape", landscape_scale, ph, pw)
    return OrientationChoice("portrait", portrait_scale, pw, ph)


def centered_fit_rect(image_w: float, image_h: float, page_w: float, page_h: float, margin: float) -> "fitz.Rect":
    """The exact destination rect for a contain-fit, centered placement of
    image_w x image_h within page_w x page_h's margin-bounded area. Pass
    this rect straight to `insert_image` -- never rely on its own
    `keep_proportion` (see module docstring)."""
    box_w, box_h = page_w - 2 * margin, page_h - 2 * margin
    scale = contain_fit_scale(image_w, image_h, box_w, box_h)
    w, h = image_w * scale, image_h * scale
    x0 = (page_w - w) / 2
    y0 = (page_h - h) / 2
    return fitz.Rect(x0, y0, x0 + w, y0 + h)


# ---------------------------------------------------------------------------
# Text wrapping -- real font metrics, never a guessed character-count width.
# ---------------------------------------------------------------------------

def _hard_break_token(token: str, font: "fitz.Font", fontsize: float, max_width: float) -> list[str]:
    """Breaks a single whitespace-free token that's wider than max_width
    into pieces that each fit -- the "long unbroken token" case. Always
    makes progress (at least one character per piece), so it can never
    infinite-loop even for a max_width smaller than one character."""
    pieces: list[str] = []
    buf = ""
    for ch in token:
        candidate = buf + ch
        if not buf or font.text_length(candidate, fontsize=fontsize) <= max_width:
            buf = candidate
        else:
            pieces.append(buf)
            buf = ch
    if buf:
        pieces.append(buf)
    return pieces


def wrap_paragraph(text: str, *, font: "fitz.Font", fontsize: float, max_width: float) -> list[str]:
    """Word-wraps ONE paragraph (no embedded newline) to max_width using
    the font's own real glyph metrics. An empty string wraps to exactly
    one empty line (a blank paragraph must still occupy its own line, not
    vanish and silently shift everything else up)."""
    if not text:
        return [""]
    words = text.split(" ")
    lines: list[str] = []
    current = ""
    for word in words:
        if not word:
            continue
        candidate = f"{current} {word}" if current else word
        if font.text_length(candidate, fontsize=fontsize) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
            current = ""
        if font.text_length(word, fontsize=fontsize) <= max_width:
            current = word
        else:
            broken = _hard_break_token(word, font, fontsize, max_width)
            lines.extend(broken[:-1])
            current = broken[-1] if broken else ""
    if current or not lines:
        lines.append(current)
    return lines


def wrap_multiline(text: str, *, font: "fitz.Font", fontsize: float, max_width: float) -> list[str]:
    """Wraps `text`, preserving real paragraph breaks (`\\n`) -- each
    paragraph is wrapped independently against the same max_width. This is
    the fix for the multi-paragraph-note overlap bug: the caller now gets
    back the TRUE number of rendered lines up front, instead of assuming
    one."""
    out: list[str] = []
    for paragraph in text.split("\n"):
        out.extend(wrap_paragraph(paragraph, font=font, fontsize=fontsize, max_width=max_width))
    return out


def indent_for_depth(depth: float, available_width: float, indent_per_depth: float) -> float:
    """The actual indent to use for a given outline depth -- capped so a
    deep branch never eats so much width that its own text has nowhere
    left to wrap into."""
    raw = depth * indent_per_depth
    cap = available_width * MAX_INDENT_FRACTION_OF_WIDTH
    return min(raw, max(cap, 0.0))


@dataclass
class OutlineBlock:
    """One drawable unit on an outline page: already-wrapped physical
    lines sharing one x/fontsize/color. A single logical outline entry
    (a topic, a note, a citations line, ...) becomes exactly one block --
    multiple wrapped lines inside it all share the block's own height, so
    the page-break and cursor-advance logic downstream never has to care
    how many physical lines a logical entry turned into."""
    lines: list[str]
    x: float
    fontsize: float
    color: tuple[float, float, float]
    line_height: float

    @property
    def height(self) -> float:
        return len(self.lines) * self.line_height


def block_height(block: OutlineBlock) -> float:
    return block.height


def fits_on_page(cursor_y: float, block: OutlineBlock, page_h: float, margin: float) -> bool:
    """Whether `block` can be drawn starting at cursor_y without any of
    its lines crossing the bottom margin."""
    return cursor_y + block.height <= page_h - margin


# ---------------------------------------------------------------------------
# PR H2 — exact deterministic tiling for readable overview+detail pages.
# Construction-based coverage (Phase 1.5/2 closure audit): a grid tile set
# is built so the image/connector union coverage is TRUE BY CONSTRUCTION
# (an exact mathematical partition, overlap only ever grows tiles, clamped
# to image bounds) -- never "proven" by post-hoc pixel sampling. Connector
# bboxes are never a hard cut-avoidance obstacle (a flat/star-topology map's
# root-to-child connector bbox can span nearly the whole image -- avoiding
# every one is mathematically impossible); they are used only for the exact
# union-coverage check below (diagnostics/tests) and for
# tile_has_context_overlap (does a reader get enough visual continuity at a
# seam), never to reject or reroute a tile boundary.
# ---------------------------------------------------------------------------

A4_PORTRAIT_PT = (595.0, 842.0)


@dataclass(frozen=True)
class Rect:
    x: float
    y: float
    w: float
    h: float

    @property
    def right(self) -> float:
        return self.x + self.w

    @property
    def bottom(self) -> float:
        return self.y + self.h

    def intersects(self, other: "Rect") -> bool:
        return self.x < other.right and other.x < self.right and self.y < other.bottom and other.y < self.bottom


def build_core_partition(image_w: float, image_h: float, rows: int, cols: int) -> list[Rect]:
    """EXACT mathematical partition of [0,image_w]x[0,image_h] into
    rows*cols rectangles with boundaries at i*image_w/cols, j*image_h/rows
    -- adjacent tiles share an exact edge (floating-point equal, not
    approximate), so the union trivially covers the image by construction.
    Never verified by sampling; see module docstring."""
    tiles: list[Rect] = []
    for r in range(rows):
        y0 = image_h * r / rows
        y1 = image_h * (r + 1) / rows
        for c in range(cols):
            x0 = image_w * c / cols
            x1 = image_w * (c + 1) / cols
            tiles.append(Rect(x0, y0, x1 - x0, y1 - y0))
    return tiles


def add_overlap(tiles: list[Rect], overlap_px: float, image_w: float, image_h: float) -> list[Rect]:
    """Grows each core tile by overlap_px on every side, clamped to
    [0,image_w]x[0,image_h] -- can only ever GROW coverage from the core
    partition's already-exact union, never produce a gap, and never
    produces a rect outside the image."""
    grown = []
    for t in tiles:
        x0 = max(0.0, t.x - overlap_px)
        y0 = max(0.0, t.y - overlap_px)
        x1 = min(image_w, t.right + overlap_px)
        y1 = min(image_h, t.bottom + overlap_px)
        grown.append(Rect(x0, y0, x1 - x0, y1 - y0))
    return grown


def node_fully_covered(node: Rect, tiles: list[Rect], safe_pad: float = 0.0) -> bool:
    """True iff `node` (shrunk by safe_pad on each side) lies entirely
    inside at least ONE tile -- never satisfied by a union of several
    tiles. A node split across tiles is always a hard fail."""
    padded = Rect(node.x + safe_pad, node.y + safe_pad, max(0.0, node.w - 2 * safe_pad), max(0.0, node.h - 2 * safe_pad))
    return any(t.x <= padded.x and t.y <= padded.y and t.right >= padded.right and t.bottom >= padded.bottom for t in tiles)


def _rect_subtract(target: Rect, hole: Rect) -> list[Rect]:
    """Clips `target` by removing its overlap with `hole`, returning the
    0-4 rectangular pieces of `target` left uncovered. Exact, no sampling
    -- the standard axis-aligned rectangle-subtraction decomposition."""
    if not target.intersects(hole):
        return [target]
    pieces: list[Rect] = []
    if hole.y > target.y:
        pieces.append(Rect(target.x, target.y, target.w, hole.y - target.y))
    if hole.bottom < target.bottom:
        pieces.append(Rect(target.x, hole.bottom, target.w, target.bottom - hole.bottom))
    mid_y0, mid_y1 = max(target.y, hole.y), min(target.bottom, hole.bottom)
    if mid_y1 > mid_y0:
        if hole.x > target.x:
            pieces.append(Rect(target.x, mid_y0, hole.x - target.x, mid_y1 - mid_y0))
        if hole.right < target.right:
            pieces.append(Rect(hole.right, mid_y0, target.right - hole.right, mid_y1 - mid_y0))
    return [p for p in pieces if p.w > 1e-9 and p.h > 1e-9]


def _rect_union_covers(target: Rect, tiles: list[Rect]) -> bool:
    """Exact (never sampled) check: does the union of `tiles` fully cover
    `target`? Iteratively subtracts each tile from the remaining
    uncovered pieces of `target`; fully covered iff nothing remains."""
    remaining = [target]
    for tile in tiles:
        if not remaining:
            return True
        next_remaining: list[Rect] = []
        for piece in remaining:
            next_remaining.extend(_rect_subtract(piece, tile))
        remaining = next_remaining
    return not remaining


def image_fully_covered(image_w: float, image_h: float, tiles: list[Rect]) -> bool:
    """Exact (construction) coverage check for the whole image rect."""
    return _rect_union_covers(Rect(0.0, 0.0, image_w, image_h), tiles)


def connector_union_covered(connector: Rect, tiles: list[Rect]) -> bool:
    """A connector MAY legitimately cross a tile boundary -- this checks
    only that the UNION of tiles covers every pixel of its bbox, never
    that one single tile contains it whole."""
    return _rect_union_covers(connector, tiles)


def tile_has_context_overlap(tile_a: Rect, tile_b: Rect, min_overlap_px: float) -> bool:
    """True iff two tiles share enough overlap for a reader to recognize
    visual continuity across the seam. For tiles adjacent along one axis
    (the normal grid-neighbor case), the shared span along the OTHER axis
    is simply the tiles' full height/width and carries no overlap
    information by itself -- the real "how much do they actually overlap"
    signal is the SMALLER of the two intersection dimensions."""
    if not tile_a.intersects(tile_b):
        return False
    ix = max(0.0, min(tile_a.right, tile_b.right) - max(tile_a.x, tile_b.x))
    iy = max(0.0, min(tile_a.bottom, tile_b.bottom) - max(tile_a.y, tile_b.y))
    return min(ix, iy) >= min_overlap_px


@dataclass(frozen=True)
class NavigationBands:
    """Fixed space RESERVED in every page's own layout, subtracted from
    the usable rect BEFORE grid search ever runs -- never squeezed into
    "whatever space is left over". header_pt: detail-page title band.
    legend_pt: overview region-code legend band. margin_pt: ordinary page
    margin on all four sides."""
    header_pt: float = 24.0
    legend_pt: float = 20.0
    margin_pt: float = 40.0


def usable_rect_after_bands(page_w: float, page_h: float, bands: NavigationBands) -> Rect:
    """The margin-and-band-bounded usable rect for placing map/detail
    content -- grid search must use THIS, never the raw page rect, or a
    fixture can pass on paper but fail once the real header/legend bands
    are actually drawn (Section 4's exact bug class)."""
    w = page_w - 2 * bands.margin_pt
    h = page_h - 2 * bands.margin_pt - bands.header_pt - bands.legend_pt
    return Rect(bands.margin_pt, bands.margin_pt, max(0.0, w), max(0.0, h))


def _best_tile_rect_pt(tile_w_px: float, tile_h_px: float, bands: NavigationBands, page_size_pt: tuple[float, float] = A4_PORTRAIT_PT) -> tuple[str, float, float]:
    """Returns (orientation, rendered_rect_w_pt, scale) -- the larger of
    portrait/landscape contain-fit scale on the BANDED usable rect (never
    the raw page rect). Tie -> portrait, matching PR H's map-orientation
    contract."""
    pw, ph = page_size_pt
    portrait_usable = usable_rect_after_bands(pw, ph, bands)
    landscape_usable = usable_rect_after_bands(ph, pw, bands)
    portrait_scale = contain_fit_scale(tile_w_px, tile_h_px, portrait_usable.w, portrait_usable.h)
    landscape_scale = contain_fit_scale(tile_w_px, tile_h_px, landscape_usable.w, landscape_usable.h)
    if landscape_scale > portrait_scale:
        return "landscape", tile_w_px * landscape_scale, landscape_scale
    return "portrait", tile_w_px * portrait_scale, portrait_scale


@dataclass(frozen=True)
class TilePlacement:
    orientation: str
    page_w: float
    page_h: float
    image_rect: Rect  # where to place the (clipped) image within the page, in pt


def place_detail_tile(tile_w_px: float, tile_h_px: float, bands: NavigationBands, page_size_pt: tuple[float, float] = A4_PORTRAIT_PT) -> TilePlacement:
    """Full placement for one detail (or overview) page showing a
    tile_w_px x tile_h_px region: picks the better-fitting A4 orientation
    (banded usable rect, never raw), then centers the contain-fit image
    rect within that usable rect -- used identically by the overview page
    (whole image as one "tile") and every real detail tile."""
    pw, ph = page_size_pt
    orientation, _rect_w_pt, scale = _best_tile_rect_pt(tile_w_px, tile_h_px, bands, page_size_pt)
    page_w, page_h = (ph, pw) if orientation == "landscape" else (pw, ph)
    usable = usable_rect_after_bands(page_w, page_h, bands)
    w, h = tile_w_px * scale, tile_h_px * scale
    x0 = usable.x + (usable.w - w) / 2
    y0 = usable.y + bands.header_pt + (usable.h - bands.header_pt - h) / 2
    return TilePlacement(orientation=orientation, page_w=page_w, page_h=page_h, image_rect=Rect(x0, y0, w, h))


TARGET_MEDIAN_PT = 8.0
TARGET_MIN_PT = 6.0
MIN_CONTEXT_OVERLAP_PX = 24.0


@dataclass
class GridCandidate:
    rows: int
    cols: int
    overlap_px: float
    tiles: list[Rect]
    median_pt: float
    min_pt: float
    meets_target: bool
    node_coverage_ok: bool
    image_coverage_ok: bool
    connector_coverage_ok: bool
    total_overlap_area: float
    page_count: int


@dataclass
class GridResult(GridCandidate):
    all_candidates: list[GridCandidate] = None  # type: ignore[assignment]


def _manifest_rects(manifest: dict) -> tuple[list[tuple[str, Rect, float]], list[Rect], float, float]:
    image_w = float(manifest["image_width_px"])
    image_h = float(manifest["image_height_px"])
    nodes = [(n["id"], Rect(n["x"], n["y"], n["width"], n["height"]), float(n["font_size_px"])) for n in manifest.get("nodes") or []]
    connectors = [Rect(c["x"], c["y"], c["width"], c["height"]) for c in manifest.get("connectors") or []]
    return nodes, connectors, image_w, image_h


def exact_grid_search(
    manifest: dict, *, page_ceiling: int = 12, bands: NavigationBands = NavigationBands(),
    page_size_pt: tuple[float, float] = A4_PORTRAIT_PT, overlap_fraction: float = 0.08,
) -> GridResult | None:
    result, _all_candidates = exact_grid_search_verbose(
        manifest, page_ceiling=page_ceiling, bands=bands, page_size_pt=page_size_pt, overlap_fraction=overlap_fraction,
    )
    return result


def exact_grid_search_verbose(
    manifest: dict, *, page_ceiling: int = 12, bands: NavigationBands = NavigationBands(),
    page_size_pt: tuple[float, float] = A4_PORTRAIT_PT, overlap_fraction: float = 0.08,
) -> tuple[GridResult | None, list[GridCandidate]]:
    """Same search as exact_grid_search, but also returns every candidate
    tried (even when none meets the target) -- used by the ceiling-
    exceeded warning path to report `best_min_pt_found` for diagnostics."""
    """Exhaustive deterministic search over every rows*cols <= page_ceiling
    grid. For each candidate: build the exact core partition, add overlap
    (clamped to image bounds), verify EVERY node is fully covered by some
    single tile (a candidate that cuts a node is dropped entirely, never
    silently accepted), compute each tile's real contain-fit scale against
    the banded usable rect (trying both orientations), derive every node's
    effective font pt, and verify image/connector union coverage (exact,
    never sampled).

    Selection order (first match wins): (1) meets readability target
    (median >= 8pt AND every node's own effective pt >= 6pt), (2) fewest
    pages, (3) highest minimum effective pt, (4) smallest total overlap
    area, (5) deterministic tie-break on (rows, cols).
    """
    nodes, connectors, image_w, image_h = _manifest_rects(manifest)
    if not nodes:
        return None, []

    candidates: list[GridCandidate] = []
    for rows in range(1, page_ceiling + 1):
        for cols in range(1, page_ceiling + 1):
            if rows * cols > page_ceiling:
                continue
            overlap_px = overlap_fraction * min(image_w / cols, image_h / rows)
            core = build_core_partition(image_w, image_h, rows, cols)
            tiles = add_overlap(core, overlap_px, image_w, image_h)

            node_ok = all(node_fully_covered(rect, tiles) for (_id, rect, _fs) in nodes)
            if not node_ok:
                continue

            per_node_pts: list[float] = []
            for (_id, rect, font_size) in nodes:
                owning_tiles = [t for t in tiles if node_fully_covered(rect, [t])]
                if not owning_tiles:
                    continue
                tile = min(owning_tiles, key=lambda t: t.w * t.h)  # tightest-fitting tile for this node
                _orient, rect_w_pt, _scale = _best_tile_rect_pt(tile.w, tile.h, bands, page_size_pt)
                per_node_pts.append(font_size * rect_w_pt / tile.w)
            if not per_node_pts:
                continue
            per_node_pts.sort()
            median_pt = per_node_pts[len(per_node_pts) // 2]
            min_pt = per_node_pts[0]
            meets_target = median_pt >= TARGET_MEDIAN_PT and min_pt >= TARGET_MIN_PT

            image_ok = image_fully_covered(image_w, image_h, tiles) if meets_target else True
            connector_ok = all(connector_union_covered(c, tiles) for c in connectors) if meets_target else True

            total_overlap = 0.0
            for i in range(len(tiles)):
                for j in range(i + 1, len(tiles)):
                    a, b = tiles[i], tiles[j]
                    if a.intersects(b):
                        ix = max(0.0, min(a.right, b.right) - max(a.x, b.x))
                        iy = max(0.0, min(a.bottom, b.bottom) - max(a.y, b.y))
                        total_overlap += ix * iy

            candidates.append(GridCandidate(
                rows=rows, cols=cols, overlap_px=overlap_px, tiles=tiles,
                median_pt=median_pt, min_pt=min_pt, meets_target=meets_target,
                node_coverage_ok=node_ok, image_coverage_ok=image_ok, connector_coverage_ok=connector_ok,
                total_overlap_area=total_overlap, page_count=rows * cols,
            ))

    valid = [c for c in candidates if c.meets_target and c.node_coverage_ok and c.image_coverage_ok and c.connector_coverage_ok]
    if not valid:
        return None, candidates
    valid.sort(key=lambda c: (c.page_count, -c.min_pt, c.total_overlap_area, c.rows, c.cols))
    best = valid[0]
    result = GridResult(
        rows=best.rows, cols=best.cols, overlap_px=best.overlap_px, tiles=best.tiles,
        median_pt=best.median_pt, min_pt=best.min_pt, meets_target=best.meets_target,
        node_coverage_ok=best.node_coverage_ok, image_coverage_ok=best.image_coverage_ok,
        connector_coverage_ok=best.connector_coverage_ok, total_overlap_area=best.total_overlap_area,
        page_count=best.page_count, all_candidates=candidates,
    )
    return result, candidates


# ---------------------------------------------------------------------------
# H3B — branch-aware tiling. exact_grid_search above slices the WHOLE image
# into one uniform rows x cols grid; for a map whose branches are spread out
# with real empty space between them, a uniform grid spends tile budget
# tiling that empty space at the same resolution as the branches themselves.
# Confirmed on a real 57-node fixture captured via a real browser (Playwright
# + the app's own capture code, not a synthetic/guessed manifest): ~26% of
# the image's own width was pure inter-branch gap, and exact_grid_search's
# best candidate within page_ceiling=12 topped out at min_pt=5.24 (target is
# 6/8) -- overview-only, exactly the reported production failure. Tiling
# each top-level branch against its OWN bounding box instead reached
# min_pt=14.21-31.14 across every branch using only 9 of the same 12 tiles.
#
# Every coverage/scale/selection rule is the EXACT SAME construction-based
# math exact_grid_search_verbose already runs (never duplicated) -- this
# section only adds the branch-grouping, local-coordinate translation, and
# a per-branch tile-budget allocator around it.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class BranchPlan:
    """One top-level branch's own tiling result, translated back into
    WHOLE-IMAGE pixel coordinates -- `tiles` can be drawn by exactly the
    same overview-overlay/detail-page-crop code a plain GridResult.tiles
    already is, with zero changes there."""
    branch_id: str
    tiles: list[Rect]
    median_pt: float
    min_pt: float
    meets_target: bool


@dataclass(frozen=True)
class BranchAwareResult:
    plans: list[BranchPlan]  # one per branch with >=1 tiled node, in the same order branch_groups was given
    all_meet_target: bool
    worst_min_pt: float

    @property
    def tiles(self) -> list[Rect]:
        """Every branch's tiles concatenated, in branch order -- the flat
        sequence the overview overlay / detail-page loop already knows how
        to draw, same shape as GridResult.tiles."""
        out: list[Rect] = []
        for p in self.plans:
            out.extend(p.tiles)
        return out


def _branch_bbox(node_rects: list[Rect], image_w: float, image_h: float, padding_px: float) -> Rect:
    x0 = max(0.0, min(r.x for r in node_rects) - padding_px)
    y0 = max(0.0, min(r.y for r in node_rects) - padding_px)
    x1 = min(image_w, max(r.right for r in node_rects) + padding_px)
    y1 = min(image_h, max(r.bottom for r in node_rects) + padding_px)
    return Rect(x0, y0, max(0.0, x1 - x0), max(0.0, y1 - y0))


def _translate_manifest_to_branch(manifest: dict, node_ids: set[str], bbox: Rect) -> dict:
    """A manifest containing only `node_ids`' own nodes and any connector
    fully inside `bbox` -- a connector reaching OUTSIDE the branch (e.g.
    the stub linking the branch's own top node back to the map's true
    root, which is never part of any branch's own bbox) is excluded here
    rather than failing coverage for a segment this tile was never meant
    to contain -- with every x/y translated so bbox's own top-left becomes
    this local image's (0, 0)."""
    nodes = [n for n in (manifest.get("nodes") or []) if n["id"] in node_ids]
    local_nodes = [
        {"id": n["id"], "x": n["x"] - bbox.x, "y": n["y"] - bbox.y, "width": n["width"], "height": n["height"], "font_size_px": n["font_size_px"]}
        for n in nodes
    ]
    local_connectors = []
    for c in manifest.get("connectors") or []:
        if c["x"] >= bbox.x - 1e-6 and c["y"] >= bbox.y - 1e-6 and c["x"] + c["width"] <= bbox.right + 1e-6 and c["y"] + c["height"] <= bbox.bottom + 1e-6:
            local_connectors.append({"x": c["x"] - bbox.x, "y": c["y"] - bbox.y, "width": c["width"], "height": c["height"]})
    return {"version": 1, "image_width_px": bbox.w, "image_height_px": bbox.h, "nodes": local_nodes, "connectors": local_connectors}


def _translate_tiles_to_image(tiles: list[Rect], bbox: Rect) -> list[Rect]:
    return [Rect(t.x + bbox.x, t.y + bbox.y, t.w, t.h) for t in tiles]


def branch_aware_grid_search(
    manifest: dict, branch_groups: list[tuple[str, set[str]]], *, page_ceiling: int = 12,
    bands: NavigationBands = NavigationBands(), page_size_pt: tuple[float, float] = A4_PORTRAIT_PT,
    overlap_fraction: float = 0.08, branch_padding_px: float = 24.0, max_tiles_per_branch: int = 8,
) -> Optional[BranchAwareResult]:
    """Thin wrapper over branch_aware_grid_search_verbose for callers that
    only need the result, not the diagnostic. See that function's own
    docstring for the full contract."""
    result, _best_min_pt_attempted = branch_aware_grid_search_verbose(
        manifest, branch_groups, page_ceiling=page_ceiling, bands=bands, page_size_pt=page_size_pt,
        overlap_fraction=overlap_fraction, branch_padding_px=branch_padding_px, max_tiles_per_branch=max_tiles_per_branch,
    )
    return result


def branch_aware_grid_search_verbose(
    manifest: dict, branch_groups: list[tuple[str, set[str]]], *, page_ceiling: int = 12,
    bands: NavigationBands = NavigationBands(), page_size_pt: tuple[float, float] = A4_PORTRAIT_PT,
    overlap_fraction: float = 0.08, branch_padding_px: float = 24.0, max_tiles_per_branch: int = 8,
) -> tuple[Optional[BranchAwareResult], float]:
    """Tiles each top-level branch against its OWN bounding box instead of
    the whole image (see the module section comment above for the real
    measured win this produces over exact_grid_search). `branch_groups` is
    [(branch_id, {node_id, ...}), ...] in document order -- every id in
    each set must be a key the caller resolved from the export tree's own
    top-level children; this module stays tree-shape-agnostic and never
    reads parent/child structure itself.

    Allocation: each branch independently takes the SMALLEST tile budget
    (1..max_tiles_per_branch) for which its own local
    exact_grid_search_verbose finds a candidate that both covers every
    node AND meets the readability target -- that function never returns
    a non-None result otherwise, so there is nothing left to "grow toward"
    afterward; a branch either finds its own minimum target-meeting budget
    within the per-branch cap, or it doesn't. The total across all branches
    is checked against page_ceiling once, after every branch's own search.

    Returns (None, best_min_pt_attempted) when a branch can't find a
    target-meeting candidate at all within max_tiles_per_branch, or when
    the summed minimum budgets already exceed page_ceiling -- the caller
    falls back to the existing overview-only warning in either case. The
    second element is a REAL measurement (the best min_pt actually seen
    across every budget every branch tried, even a branch that never
    found a target-meeting one, and even across branches that DID
    succeed when the failure was only the total exceeding page_ceiling)
    -- 0.0 only when truly nothing was ever measured (e.g. no branch had
    any node at all), never a number implying a search that didn't run.
    `all_meet_target` on a non-None BranchAwareResult is always True
    today (kept as an explicit field, not inferred by the caller, so a
    future change to exact_grid_search_verbose's own "only return
    non-None when target is met" contract can't silently make this
    function violate it unnoticed).
    """
    nodes_by_id = {n["id"]: n for n in manifest.get("nodes") or []}
    image_w = float(manifest["image_width_px"])
    image_h = float(manifest["image_height_px"])

    bboxes: dict[str, Rect] = {}
    local_manifests: dict[str, dict] = {}
    for branch_id, node_ids in branch_groups:
        rects = [
            Rect(nodes_by_id[nid]["x"], nodes_by_id[nid]["y"], nodes_by_id[nid]["width"], nodes_by_id[nid]["height"])
            for nid in node_ids if nid in nodes_by_id
        ]
        if not rects:
            continue
        bbox = _branch_bbox(rects, image_w, image_h, branch_padding_px)
        bboxes[branch_id] = bbox
        local_manifests[branch_id] = _translate_manifest_to_branch(manifest, node_ids, bbox)

    if not local_manifests:
        return None, 0.0

    budgets: dict[str, int] = {}
    results: dict[str, GridResult] = {}
    best_min_pt_attempted = 0.0
    failed_branch = False
    for branch_id, local in local_manifests.items():
        found = None
        for budget in range(1, max_tiles_per_branch + 1):
            r, candidates = exact_grid_search_verbose(local, page_ceiling=budget, bands=bands, page_size_pt=page_size_pt, overlap_fraction=overlap_fraction)
            branch_best = max((c.min_pt for c in candidates), default=0.0)
            best_min_pt_attempted = max(best_min_pt_attempted, branch_best)
            if r is not None:
                found = (budget, r)
                break
        if found is None:
            failed_branch = True
            continue  # keep measuring the rest of the branches too -- the diagnostic should reflect every attempt, not stop at the first failure
        budgets[branch_id], results[branch_id] = found

    if failed_branch:
        return None, round(best_min_pt_attempted, 2)  # this branch alone can't be tiled at all within the per-branch cap

    total = sum(budgets.values())
    if total > page_ceiling:
        # Every branch individually succeeded (each result already meets
        # target), so their own min_pt values are a more informative
        # diagnostic than the per-candidate scan above -- the failure here
        # is page-COUNT, not readability.
        best_min_pt_attempted = max(best_min_pt_attempted, min((r.min_pt for r in results.values()), default=0.0))
        return None, round(best_min_pt_attempted, 2)

    plans = [
        BranchPlan(
            branch_id=branch_id, tiles=_translate_tiles_to_image(results[branch_id].tiles, bboxes[branch_id]),
            median_pt=results[branch_id].median_pt, min_pt=results[branch_id].min_pt, meets_target=results[branch_id].meets_target,
        )
        for branch_id, _ in branch_groups if branch_id in results
    ]
    result = BranchAwareResult(
        plans=plans,
        all_meet_target=all(p.meets_target for p in plans),
        worst_min_pt=min((p.min_pt for p in plans), default=0.0),
    )
    return result, round(result.worst_min_pt, 2)
