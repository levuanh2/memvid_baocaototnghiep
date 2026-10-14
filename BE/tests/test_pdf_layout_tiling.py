"""PR H2 Phase 2 — RED tests for the tiling/grid-search additions to
services.mindmap.export.pdf_layout (net-new functions; module itself
exists from PR H but these names don't yet -- ImportError red, same
reasoning as test_geometry_manifest.py).

Contract pinned (Phase 1.5 closure audit, approved):
  - build_core_partition(image_w, image_h, rows, cols) -> list[Rect]:
    EXACT mathematical partition (boundaries at i*image_w/cols,
    i*image_h/rows) -- union covers the image BY CONSTRUCTION, never
    verified by post-hoc pixel sampling.
  - add_overlap(tiles, overlap_px, image_w, image_h) -> list[Rect]:
    grows each core tile by overlap_px per side, clamped to image bounds
    (never produces a rect outside [0,image_w]x[0,image_h]).
  - node_fully_covered(node, tiles, safe_pad=0) -> bool
  - connector_union_covered(connector, tiles) -> bool -- union check only,
    never requires one tile to contain the whole connector (it may cross
    a tile boundary; see PHASE 1.5 Section 1).
  - tile_has_context_overlap(tile_a, tile_b, min_overlap_px) -> bool
  - NavigationBands(header_pt, legend_pt, margin_pt) -- fixed reserved
    space subtracted from the page BEFORE grid search computes usable rect.
  - exact_grid_search(manifest, page_ceiling=12, bands=NavigationBands(...))
    -> GridResult | None, reporting the full candidate list too.
"""
from __future__ import annotations

import pytest

from services.mindmap.export.pdf_layout import (
    NavigationBands,
    Rect,
    add_overlap,
    build_core_partition,
    connector_union_covered,
    exact_grid_search,
    node_fully_covered,
    tile_has_context_overlap,
    usable_rect_after_bands,
)


# ---- exact partition (construction, not sampling) --------------------------

def test_core_partition_tiles_sum_to_exact_image_area():
    tiles = build_core_partition(1000, 2000, rows=4, cols=2)
    assert len(tiles) == 8
    total_area = sum(t.w * t.h for t in tiles)
    assert total_area == pytest.approx(1000 * 2000, abs=1e-6)


def test_core_partition_has_no_gaps_between_adjacent_tiles():
    tiles = build_core_partition(900, 600, rows=3, cols=3)
    # adjacent tiles in the same row must share an EXACT boundary (col i's
    # right edge == col i+1's left edge), not an approximate one.
    by_row = {}
    for t in tiles:
        by_row.setdefault(round(t.y, 6), []).append(t)
    for row_tiles in by_row.values():
        row_tiles.sort(key=lambda t: t.x)
        for a, b in zip(row_tiles, row_tiles[1:]):
            assert a.x + a.w == pytest.approx(b.x, abs=1e-6)


def test_core_partition_covers_exact_image_bounds_at_edges():
    tiles = build_core_partition(777, 333, rows=2, cols=5)
    assert min(t.x for t in tiles) == pytest.approx(0.0, abs=1e-6)
    assert min(t.y for t in tiles) == pytest.approx(0.0, abs=1e-6)
    assert max(t.x + t.w for t in tiles) == pytest.approx(777.0, abs=1e-6)
    assert max(t.y + t.h for t in tiles) == pytest.approx(333.0, abs=1e-6)


def test_overlap_clamped_to_image_bounds_never_produces_negative_or_overflowing_rect():
    core = build_core_partition(500, 500, rows=2, cols=2)
    grown = add_overlap(core, overlap_px=200, image_w=500, image_h=500)  # huge overlap vs tile size
    for t in grown:
        assert t.x >= 0 and t.y >= 0
        assert t.x + t.w <= 500 + 1e-6
        assert t.y + t.h <= 500 + 1e-6


def test_overlap_grows_tile_strictly_for_interior_boundaries():
    core = build_core_partition(1000, 1000, rows=1, cols=2)
    grown = add_overlap(core, overlap_px=30, image_w=1000, image_h=1000)
    left, right = sorted(grown, key=lambda t: t.x)
    assert left.x + left.w > 500  # extends past the core midline into the right tile's territory
    assert right.x < 500


# ---- node / connector coverage ---------------------------------------------

def test_node_fully_covered_true_when_inside_one_tile():
    tile = Rect(0, 0, 500, 500)
    node = Rect(10, 10, 100, 50)
    assert node_fully_covered(node, [tile])


def test_node_fully_covered_false_when_split_across_tiles_even_with_union():
    tiles = [Rect(0, 0, 100, 500), Rect(100, 0, 100, 500)]
    node = Rect(80, 10, 40, 20)  # straddles x=100 boundary
    assert not node_fully_covered(node, tiles)


def test_node_fully_covered_respects_safe_pad():
    tile = Rect(0, 0, 100, 100)
    node = Rect(95, 10, 10, 10)  # right edge at 105, overflows tile by 5
    assert not node_fully_covered(node, [tile], safe_pad=0)


def test_connector_union_covered_true_even_when_crossing_tile_boundary():
    tiles = [Rect(0, 0, 100, 500), Rect(100, 0, 100, 500)]
    connector = Rect(80, 10, 40, 20)  # crosses the seam -- MUST be fine (not a hard obstacle)
    assert connector_union_covered(connector, tiles)


def test_connector_union_covered_false_when_a_gap_exists_between_tiles():
    tiles = [Rect(0, 0, 90, 500), Rect(110, 0, 90, 500)]  # 20px gap, NOT a valid partition
    connector = Rect(95, 10, 10, 20)  # falls entirely in the gap
    assert not connector_union_covered(connector, tiles)


def test_tile_has_context_overlap_true_for_adjacent_tiles_with_enough_shared_width():
    a = Rect(0, 0, 520, 500)
    b = Rect(480, 0, 520, 500)  # 40px overlap
    assert tile_has_context_overlap(a, b, min_overlap_px=30)


def test_tile_has_context_overlap_false_for_insufficient_overlap():
    a = Rect(0, 0, 505, 500)
    b = Rect(500, 0, 505, 500)  # 5px overlap only
    assert not tile_has_context_overlap(a, b, min_overlap_px=30)


# ---- navigation bands reserve fixed space BEFORE grid search ---------------

def test_usable_rect_after_bands_subtracts_header_legend_and_margin():
    bands = NavigationBands(header_pt=24.0, legend_pt=20.0, margin_pt=40.0)
    usable = usable_rect_after_bands(page_w=595.0, page_h=842.0, bands=bands)
    assert usable.w == pytest.approx(595.0 - 2 * 40.0)
    assert usable.h == pytest.approx(842.0 - 2 * 40.0 - 24.0 - 20.0)


def test_grid_search_uses_post_band_usable_rect_not_raw_page_rect():
    """A fixture whose effective_pt would pass on the RAW page rect (margin
    only, no header/legend bands) but fail once header+legend bands are
    reserved must be correctly rejected as a 1-tile solution -- this is
    the exact bug class Section 4 calls out ("không tái dùng số cũ nếu
    usable rect đã đổi"). Verified by hand against the real
    usable_rect_after_bands/contain_fit_scale math (a TALL 600x1200 image
    is height-bound in portrait, the orientation bands actually squeeze):
    single-tile portrait scale = 0.598 WITH the 24pt header + 20pt legend
    band vs 0.635 with margin alone -- at font_size_px=13 that is 7.78pt
    (below target) vs 8.26pt (would pass) respectively."""
    bands = NavigationBands(header_pt=24.0, legend_pt=20.0, margin_pt=40.0)
    manifest = {
        "image_width_px": 600, "image_height_px": 1200,
        "nodes": [{"id": "c0", "x": 25, "y": 25, "width": 550, "height": 1150, "font_size_px": 13}],
        "connectors": [],
    }
    result = exact_grid_search(manifest, page_ceiling=12, bands=bands)
    if result is not None:
        assert result.page_count > 1, "band-naive search reused the pre-band usable rect"


# ---- backward-compatible small-map path ------------------------------------

def test_small_map_readable_overview_needs_no_tiling():
    manifest = {
        "image_width_px": 800, "image_height_px": 400,
        "nodes": [{"id": "c0", "x": 50, "y": 50, "width": 300, "height": 100, "font_size_px": 60}],
        "connectors": [],
    }
    bands = NavigationBands(header_pt=24.0, legend_pt=20.0, margin_pt=40.0)
    result = exact_grid_search(manifest, page_ceiling=12, bands=bands)
    assert result is not None
    assert result.page_count == 1


# ---- deterministic tie-break / selection order ------------------------------

def test_selection_prefers_fewer_pages_over_higher_min_pt():
    # two valid candidates differ in page count -- MUST pick the smaller one
    # even if the larger one has a higher minimum effective pt.
    manifest = {
        "image_width_px": 1200, "image_height_px": 2400,
        "nodes": [
            {"id": "c0", "x": 50, "y": 50, "width": 400, "height": 150, "font_size_px": 30},
            {"id": "c1", "x": 50, "y": 1250, "width": 400, "height": 150, "font_size_px": 30},
        ],
        "connectors": [],
    }
    bands = NavigationBands(header_pt=24.0, legend_pt=20.0, margin_pt=40.0)
    result = exact_grid_search(manifest, page_ceiling=12, bands=bands)
    assert result is not None
    all_valid_page_counts = [c.page_count for c in result.all_candidates if c.meets_target]
    assert result.page_count == min(all_valid_page_counts)
