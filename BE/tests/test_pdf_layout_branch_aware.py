"""H3B — RED tests for branch-aware tiling (net-new additions to
services.mindmap.export.pdf_layout / pdf_serializer._branch_groups_from_tree).

Root cause this module exists to fix (see .playbook/known-issues.md): H2's
exact_grid_search slices the WHOLE image into one uniform rows x cols grid.
For a map whose branches are spread out with real empty space between them,
a uniform grid spends tile budget tiling that empty space at the same
resolution as the branches themselves. REAL_57NODE_MANIFEST below is a
real geometry manifest -- captured via an actual Chromium session (Playwright)
driving the app's own captureMapImageWithGeometry code path against a
synthetic, safe QA fixture map (placeholder cybersecurity-education topics,
no real user/content data; node ids are structural labels like "D1G2I3",
never real titles) -- reproducing the production-reported
`detail_pages_skipped_ceiling_exceeded` / `best_min_pt_found: 5.66`-class
failure with real numbers (`best_min_pt_found` here is 5.24), not a
hand-constructed one. Branch-aware tiling resolves it: every one of the 9
real top-level branches reaches 14.2-31.1pt (well above the 8/6pt target)
using only 9 of the 12-page ceiling.
"""
from __future__ import annotations

import json

from services.mindmap.export.pdf_layout import (
    NavigationBands,
    Rect,
    branch_aware_grid_search,
    exact_grid_search,
    exact_grid_search_verbose,
)
from services.mindmap.export.pdf_serializer import _branch_groups_from_tree

BANDS = NavigationBands(header_pt=24.0, legend_pt=20.0, margin_pt=40.0)

# Real captured manifest (see module docstring) -- 57 nodes, 9 top-level
# branches (D1/D2/D3/S1-S6), one true root. Captured 2026-10-15.
REAL_57NODE_MANIFEST = json.loads(
    '{"version":1,"image_width_px":4650,"image_height_px":1908,"nodes":['
    '{"id":"D1","x":951,"y":334,"width":743,"height":84,"font_size_px":32},'
    '{"id":"D1G1","x":631,"y":162,"width":270,"height":64,"font_size_px":32},'
    '{"id":"D1G1I1","x":206,"y":70,"width":365,"height":64,"font_size_px":32},'
    '{"id":"D1G1I2","x":109,"y":162,"width":463,"height":64,"font_size_px":32},'
    '{"id":"D1G1I3","x":112,"y":254,"width":460,"height":64,"font_size_px":32},'
    '{"id":"D1G2","x":619,"y":438,"width":282,"height":64,"font_size_px":32},'
    '{"id":"D1G2I1","x":262,"y":346,"width":297,"height":64,"font_size_px":32},'
    '{"id":"D1G2I2","x":346,"y":438,"width":213,"height":64,"font_size_px":32},'
    '{"id":"D1G2I3","x":101,"y":530,"width":458,"height":64,"font_size_px":32},'
    '{"id":"D1G3","x":600,"y":622,"width":301,"height":64,"font_size_px":32},'
    '{"id":"D1G3I1","x":64,"y":622,"width":476,"height":64,"font_size_px":32},'
    '{"id":"D3","x":1006,"y":990,"width":688,"height":84,"font_size_px":32},'
    '{"id":"D3G1","x":683,"y":818,"width":273,"height":64,"font_size_px":32},'
    '{"id":"D3G1I1","x":341,"y":726,"width":283,"height":64,"font_size_px":32},'
    '{"id":"D3G1I2","x":339,"y":818,"width":285,"height":64,"font_size_px":32},'
    '{"id":"D3G1I3","x":394,"y":910,"width":229,"height":64,"font_size_px":32},'
    '{"id":"D3G2","x":642,"y":1094,"width":314,"height":64,"font_size_px":32},'
    '{"id":"D3G2I1","x":281,"y":1002,"width":301,"height":64,"font_size_px":32},'
    '{"id":"D3G2I2","x":240,"y":1094,"width":342,"height":64,"font_size_px":32},'
    '{"id":"D3G2I3","x":127,"y":1186,"width":455,"height":64,"font_size_px":32},'
    '{"id":"D3G3","x":720,"y":1278,"width":237,"height":64,"font_size_px":32},'
    '{"id":"D3G3I1","x":358,"y":1278,"width":302,"height":64,"font_size_px":32},'
    '{"id":"S1","x":1303,"y":1416,"width":391,"height":84,"font_size_px":32},'
    '{"id":"S1I1","x":909,"y":1382,"width":344,"height":64,"font_size_px":32},'
    '{"id":"S1I2","x":963,"y":1474,"width":290,"height":64,"font_size_px":32},'
    '{"id":"S5","x":1193,"y":1658,"width":501,"height":84,"font_size_px":32},'
    '{"id":"S5I1","x":911,"y":1578,"width":232,"height":64,"font_size_px":32},'
    '{"id":"S5I2","x":1006,"y":1670,"width":137,"height":64,"font_size_px":32},'
    '{"id":"S5I3","x":770,"y":1762,"width":373,"height":64,"font_size_px":32},'
    '{"id":"root","x":1774,"y":885,"width":1063,"height":123,"font_size_px":50},'
    '{"id":"D2","x":2917,"y":328,"width":813,"height":84,"font_size_px":32},'
    '{"id":"D2G1","x":3780,"y":156,"width":339,"height":64,"font_size_px":32},'
    '{"id":"D2G1I1","x":4180,"y":64,"width":310,"height":64,"font_size_px":32},'
    '{"id":"D2G1I2","x":4180,"y":156,"width":300,"height":64,"font_size_px":32},'
    '{"id":"D2G1I3","x":4180,"y":248,"width":405,"height":64,"font_size_px":32},'
    '{"id":"D2G2","x":3780,"y":432,"width":310,"height":64,"font_size_px":32},'
    '{"id":"D2G2I1","x":4150,"y":340,"width":350,"height":64,"font_size_px":32},'
    '{"id":"D2G2I2","x":4150,"y":432,"width":332,"height":64,"font_size_px":32},'
    '{"id":"D2G2I3","x":4150,"y":524,"width":249,"height":64,"font_size_px":32},'
    '{"id":"D2G3","x":3780,"y":616,"width":334,"height":64,"font_size_px":32},'
    '{"id":"D2G3I1","x":4174,"y":616,"width":358,"height":64,"font_size_px":32},'
    '{"id":"S2","x":2917,"y":800,"width":402,"height":84,"font_size_px":32},'
    '{"id":"S2I1","x":3369,"y":720,"width":262,"height":64,"font_size_px":32},'
    '{"id":"S2I2","x":3369,"y":812,"width":283,"height":64,"font_size_px":32},'
    '{"id":"S2I3","x":3369,"y":904,"width":260,"height":64,"font_size_px":32},'
    '{"id":"S3","x":2917,"y":1088,"width":474,"height":84,"font_size_px":32},'
    '{"id":"S3I1","x":3441,"y":1008,"width":251,"height":64,"font_size_px":32},'
    '{"id":"S3I2","x":3441,"y":1100,"width":248,"height":64,"font_size_px":32},'
    '{"id":"S3I3","x":3441,"y":1192,"width":160,"height":64,"font_size_px":32},'
    '{"id":"S4","x":2917,"y":1376,"width":501,"height":84,"font_size_px":32},'
    '{"id":"S4I1","x":3468,"y":1296,"width":363,"height":64,"font_size_px":32},'
    '{"id":"S4I2","x":3468,"y":1388,"width":227,"height":64,"font_size_px":32},'
    '{"id":"S4I3","x":3468,"y":1480,"width":291,"height":64,"font_size_px":32},'
    '{"id":"S6","x":2917,"y":1664,"width":548,"height":84,"font_size_px":32},'
    '{"id":"S6I1","x":3515,"y":1584,"width":459,"height":64,"font_size_px":32},'
    '{"id":"S6I2","x":3515,"y":1676,"width":307,"height":64,"font_size_px":32},'
    '{"id":"S6I3","x":3515,"y":1768,"width":342,"height":64,"font_size_px":32}'
    '],"connectors":[]}'
)

REAL_TOP_LEVEL = ["D1", "D2", "D3", "S1", "S2", "S3", "S4", "S5", "S6"]


def _real_branch_groups():
    all_ids = {n["id"] for n in REAL_57NODE_MANIFEST["nodes"]}

    def subtree_ids(prefix):
        return {nid for nid in all_ids if nid == prefix or nid.startswith(prefix)}

    return [(b, subtree_ids(b)) for b in REAL_TOP_LEVEL]


# ---- the real failure, reproduced ------------------------------------------

def test_real_57node_fixture_fails_whole_image_search_within_ceiling():
    """Pins the exact real baseline this PR fixes: H2's own
    exact_grid_search_verbose cannot find a valid tiling for the real
    captured manifest within page_ceiling=12 -- the production-reported
    overview-only/detail_pages_skipped_ceiling_exceeded failure, with real
    numbers (not assumed)."""
    result, candidates = exact_grid_search_verbose(REAL_57NODE_MANIFEST, page_ceiling=12, bands=BANDS)
    assert result is None
    best_min_pt = max((c.min_pt for c in candidates), default=0.0)
    assert best_min_pt < 6.0  # below TARGET_MIN_PT -- confirms the real failure, not a tautology


def test_real_57node_fixture_succeeds_branch_aware_within_same_ceiling():
    """The fix: the SAME real manifest, tiled branch-aware instead of
    whole-image, fits every one of the 9 real branches within the SAME
    page_ceiling=12, each far above target (real measured values: every
    branch's min_pt lands between 14 and 31, well over TARGET_MIN_PT=6)."""
    groups = _real_branch_groups()
    result = branch_aware_grid_search(REAL_57NODE_MANIFEST, groups, page_ceiling=12, bands=BANDS)
    assert result is not None
    assert result.all_meet_target
    assert len(result.plans) == 9
    total_tiles = sum(len(p.tiles) for p in result.plans)
    assert total_tiles <= 12
    assert result.worst_min_pt >= 6.0
    # every branch landed WELL above target on the real data, not just barely
    assert all(p.min_pt >= 10.0 for p in result.plans)


def test_real_57node_fixture_branch_tiles_are_whole_image_coordinates():
    """Every tile must be translated back into the SAME coordinate space
    exact_grid_search's own tiles already use -- the overview overlay and
    detail-page crop code reads tile.x/y as whole-image pixel offsets
    regardless of which search produced the tile."""
    groups = _real_branch_groups()
    result = branch_aware_grid_search(REAL_57NODE_MANIFEST, groups, page_ceiling=12, bands=BANDS)
    assert result is not None
    img_w, img_h = REAL_57NODE_MANIFEST["image_width_px"], REAL_57NODE_MANIFEST["image_height_px"]
    for plan in result.plans:
        for tile in plan.tiles:
            assert 0.0 <= tile.x <= img_w
            assert 0.0 <= tile.y <= img_h
            assert tile.right <= img_w + 1.0
            assert tile.bottom <= img_h + 1.0


def test_real_57node_fixture_no_node_lost_across_branch_plans():
    """Every real node id must be fully covered by exactly the tiles of
    its OWN branch -- no node silently dropped, no node double-claimed."""
    groups = _real_branch_groups()
    result = branch_aware_grid_search(REAL_57NODE_MANIFEST, groups, page_ceiling=12, bands=BANDS)
    assert result is not None
    nodes_by_id = {n["id"]: n for n in REAL_57NODE_MANIFEST["nodes"]}
    covered = set()
    for (branch_id, node_ids), plan in zip(groups, result.plans):
        for nid in node_ids:
            n = nodes_by_id[nid]
            rect = Rect(n["x"], n["y"], n["width"], n["height"])
            assert any(
                t.x <= rect.x and t.y <= rect.y and t.right >= rect.right and t.bottom >= rect.bottom
                for t in plan.tiles
            ), f"{nid} not fully covered by its own branch's tiles"
            covered.add(nid)
    all_branch_ids = {nid for _, ids in groups for nid in ids}
    assert covered == all_branch_ids


# ---- small synthetic edge cases ---------------------------------------------

def _simple_manifest(image_w, image_h, nodes):
    return {"version": 1, "image_width_px": image_w, "image_height_px": image_h, "nodes": nodes, "connectors": []}


def test_branch_aware_returns_none_when_a_branch_cannot_fit_even_standalone():
    """A single node far too large for ANY usable rect at ANY per-branch
    budget (max_tiles_per_branch) must make the whole search fail cleanly
    -- never silently drop that branch's content."""
    manifest = _simple_manifest(5000, 5000, [
        {"id": "huge", "x": 0, "y": 0, "width": 4999, "height": 4999, "font_size_px": 1},
    ])
    groups = [("huge", {"huge"})]
    result = branch_aware_grid_search(manifest, groups, page_ceiling=12, bands=BANDS, max_tiles_per_branch=4)
    assert result is None


def test_branch_aware_returns_none_when_minimum_allocation_exceeds_ceiling():
    """13 branches each needing at least 1 tile can never fit a 12-tile
    ceiling -- must fail cleanly (None), not silently drop one branch."""
    nodes = []
    groups = []
    for i in range(13):
        nid = f"b{i}"
        nodes.append({"id": nid, "x": i * 200, "y": 0, "width": 150, "height": 150, "font_size_px": 1})
        groups.append((nid, {nid}))
    manifest = _simple_manifest(13 * 200, 200, nodes)
    result = branch_aware_grid_search(manifest, groups, page_ceiling=12, bands=BANDS)
    assert result is None


def test_branch_aware_returns_none_rather_than_a_partial_result_when_a_branch_never_meets_target():
    """A branch whose font is too tiny to EVER meet target within
    max_tiles_per_branch (exact_grid_search_verbose only ever returns a
    non-None result once node-coverage AND readability both pass) must
    fail the whole search cleanly -- never a silently-degraded "success"
    that skips this branch's own readability."""
    nodes = [
        {"id": "a", "x": 0, "y": 0, "width": 2000, "height": 2000, "font_size_px": 2},
        {"id": "b", "x": 5000, "y": 0, "width": 2000, "height": 2000, "font_size_px": 40},
    ]
    manifest = _simple_manifest(7000, 2000, nodes)
    groups = [("a", {"a"}), ("b", {"b"})]
    result = branch_aware_grid_search(manifest, groups, page_ceiling=12, bands=BANDS, max_tiles_per_branch=4)
    assert result is None


def test_branch_aware_result_always_meets_target_when_non_none():
    """Every branch's own search only ever contributes a target-meeting
    candidate (see exact_grid_search_verbose's own "valid" filter) -- a
    non-None branch-aware result can never silently carry a branch below
    target."""
    groups = _real_branch_groups()
    result = branch_aware_grid_search(REAL_57NODE_MANIFEST, groups, page_ceiling=12, bands=BANDS)
    assert result is not None
    assert result.all_meet_target is True
    assert all(p.meets_target for p in result.plans)


# ---- _branch_groups_from_tree (pdf_serializer.py) ---------------------------

def _node(node_id, children=None):
    return {"node_id": node_id, "parent_id": None, "topic": node_id, "note": "", "depth": 0, "is_context": False, "citations": [], "children": children or []}


def test_branch_groups_from_tree_one_entry_per_true_root_child():
    tree = {"roots": [_node("root", children=[
        _node("a", children=[_node("a1"), _node("a2", children=[_node("a2x")])]),
        _node("b"),
    ])]}
    groups = _branch_groups_from_tree(tree)
    assert [b for b, _ in groups] == ["a", "b"]
    by_id = dict(groups)
    assert by_id["a"] == {"a", "a1", "a2", "a2x"}
    assert by_id["b"] == {"b"}


def test_branch_groups_from_tree_empty_when_root_has_no_children():
    tree = {"roots": [_node("root", children=[])]}
    assert _branch_groups_from_tree(tree) == []


def test_branch_groups_from_tree_never_includes_true_root_id_itself():
    tree = {"roots": [_node("root", children=[_node("a")])]}
    groups = _branch_groups_from_tree(tree)
    all_ids = {nid for _, ids in groups for nid in ids}
    assert "root" not in all_ids


# ---- whole-image path still wins when it already works (no regression) -----

def test_whole_image_search_unaffected_when_it_already_succeeds():
    """A map that already passes under H2's own exact_grid_search must get
    the EXACT same candidate it always did -- branch-aware is a FALLBACK,
    never a replacement, for the common case."""
    manifest = _simple_manifest(800, 400, [
        {"id": "c0", "x": 50, "y": 50, "width": 300, "height": 100, "font_size_px": 60},
    ])
    result = exact_grid_search(manifest, page_ceiling=12, bands=BANDS)
    assert result is not None
    assert result.page_count == 1
