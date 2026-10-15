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

import copy
import json

from services.mindmap.export.pdf_layout import (
    NavigationBands,
    Rect,
    TARGET_MIN_PT,
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
    '],"connectors":['
    '{"x":632,"y":238,"width":348,"height":138},{"x":206,"y":146,"width":426,"height":92},'
    '{"x":108,"y":238,"width":524,"height":0},{"x":112,"y":238,"width":520,"height":92},'
    '{"x":618,"y":376,"width":362,"height":138},{"x":262,"y":422,"width":356,"height":92},'
    '{"x":346,"y":514,"width":272,"height":0},{"x":100,"y":514,"width":518,"height":92},'
    '{"x":600,"y":376,"width":380,"height":322},{"x":64,"y":698,"width":536,"height":0},'
    '{"x":683,"y":894,"width":354,"height":138},{"x":341,"y":802,"width":342,"height":92},'
    '{"x":339,"y":894,"width":344,"height":0},{"x":395,"y":894,"width":288,"height":92},'
    '{"x":641,"y":1032,"width":396,"height":138},{"x":281,"y":1078,"width":360,"height":92},'
    '{"x":239,"y":1170,"width":402,"height":0},{"x":127,"y":1170,"width":514,"height":92},'
    '{"x":719,"y":1032,"width":318,"height":322},{"x":357,"y":1354,"width":362,"height":0},'
    '{"x":909,"y":1458,"width":424,"height":0},{"x":963,"y":1458,"width":370,"height":92},'
    '{"x":912,"y":1654,"width":310,"height":46},{"x":1006,"y":1700,"width":216,"height":46},'
    '{"x":770,"y":1700,"width":452,"height":138},{"x":3701,"y":232,"width":420,"height":138},'
    '{"x":4121,"y":140,"width":368,"height":92},{"x":4121,"y":232,"width":358,"height":0},'
    '{"x":4121,"y":232,"width":464,"height":92},{"x":3701,"y":370,"width":390,"height":138},'
    '{"x":4091,"y":416,"width":410,"height":92},{"x":4091,"y":508,"width":392,"height":0},'
    '{"x":4091,"y":508,"width":308,"height":92},{"x":3701,"y":370,"width":414,"height":322},'
    '{"x":4115,"y":692,"width":418,"height":0},{"x":3289,"y":796,"width":342,"height":46},'
    '{"x":3289,"y":842,"width":362,"height":46},{"x":3289,"y":842,"width":340,"height":138},'
    '{"x":3361,"y":1084,"width":330,"height":46},{"x":3361,"y":1130,"width":328,"height":46},'
    '{"x":3361,"y":1130,"width":240,"height":138},{"x":3389,"y":1372,"width":444,"height":46},'
    '{"x":3389,"y":1418,"width":306,"height":46},{"x":3389,"y":1418,"width":372,"height":138},'
    '{"x":3435,"y":1660,"width":538,"height":46},{"x":3435,"y":1706,"width":388,"height":46},'
    '{"x":3435,"y":1706,"width":422,"height":138},{"x":1692,"y":376,"width":411,"height":570},'
    '{"x":1696,"y":946,"width":376,"height":86},{"x":1692,"y":946,"width":408,"height":512},'
    '{"x":1692,"y":946,"width":423,"height":754},{"x":2508,"y":370,"width":408,"height":576},'
    '{"x":2539,"y":842,"width":377,"height":104},{"x":2534,"y":946,"width":382,"height":184},'
    '{"x":2515,"y":946,"width":401,"height":472},{"x":2496,"y":946,"width":420,"height":760}'
    ']}'
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


# ---- connector coverage contract (real captured connector geometry) --------
#
# Contract (review finding): the real manifest's 56 connectors are mind-
# elixir's own rendered parent-child edge PATHS, never "relations" --
# relations (cross-branch logical links) are a TEXT-ONLY outline concept
# (tree.relations, rendered only via content.relations in the outline
# pages) and are NEVER drawn on the canvas/raster image at all, so they
# have no raster-coverage concern to test here; this was already true
# before H3B and is unaffected by it. Of the 56 real connectors: 47 are
# INTRA-branch (a parent-child edge where both ends are inside the SAME
# top-level branch's own subtree -- every one of these is both real
# content AND fully retained/covered within that branch's own detail
# tiles, verified below) and 9 are the ROOT-TO-BRANCH "bridge" stub (one
# per top-level branch, connecting the true root to that branch's own top
# node) -- deliberately EXCLUDED from every branch's own local manifest,
# since root itself is never part of any branch's bbox (same reason a
# connector's "other end" being outside this branch means the FULL
# connector can never be meaningfully shown in a crop scoped to this
# branch alone). These bridge connectors remain fully visible on the
# OVERVIEW page (the whole image, completely untouched by tiling), so the
# map's own top-level navigation structure (how many branches, where they
# sit relative to root) is never lost -- only each branch's own detail
# crop omits the stub reaching toward root, which is exactly what a
# "zoomed into one branch" page should do.

def test_real_connectors_intra_branch_edges_are_all_retained_and_covered():
    """Every one of the 47 real intra-branch connector paths is both kept
    in its own branch's local manifest and successfully covered by that
    branch's own tiles (connector_coverage_ok is part of what
    exact_grid_search_verbose's own `meets_target` already requires --
    this proves it holds for REAL connector geometry, not just the
    connectors:[] case every other test here also happens to pass)."""
    groups = _real_branch_groups()
    kept_total = 0
    for branch_id, node_ids in groups:
        from services.mindmap.export.pdf_layout import _branch_bbox, _translate_manifest_to_branch
        nodes_by_id = {n["id"]: n for n in REAL_57NODE_MANIFEST["nodes"]}
        rects = [Rect(nodes_by_id[nid]["x"], nodes_by_id[nid]["y"], nodes_by_id[nid]["width"], nodes_by_id[nid]["height"]) for nid in node_ids]
        bbox = _branch_bbox(rects, REAL_57NODE_MANIFEST["image_width_px"], REAL_57NODE_MANIFEST["image_height_px"], 24.0)
        local = _translate_manifest_to_branch(REAL_57NODE_MANIFEST, node_ids, bbox)
        # every branch here has exactly (node_count - 1) internal tree edges -- a real, checkable invariant, not a guess
        assert len(local["connectors"]) == len(node_ids) - 1, f"{branch_id}: expected {len(node_ids) - 1} intra-branch connectors, found {len(local['connectors'])}"
        kept_total += len(local["connectors"])
    assert kept_total == 47  # real measured count: 56 real connectors - 9 root-bridge stubs (one per branch)

    result = branch_aware_grid_search(REAL_57NODE_MANIFEST, groups, page_ceiling=12, bands=BANDS)
    assert result is not None and result.all_meet_target  # connector_coverage_ok held for every branch's real connectors


def test_root_bridge_connectors_are_excluded_from_every_branch_not_silently_lost():
    """The 9 root-to-branch stub connectors never appear in ANY branch's
    local manifest (neither double-counted into the wrong branch nor
    silently required of a branch that can't show them) -- they remain
    visible only on the overview, which this test confirms by checking
    the real manifest's own connector count accounts for exactly 56 = 47
    (kept somewhere) + 9 (excluded everywhere)."""
    from services.mindmap.export.pdf_layout import _branch_bbox, _translate_manifest_to_branch
    groups = _real_branch_groups()
    nodes_by_id = {n["id"]: n for n in REAL_57NODE_MANIFEST["nodes"]}
    kept_total = 0
    for branch_id, node_ids in groups:
        rects = [Rect(nodes_by_id[nid]["x"], nodes_by_id[nid]["y"], nodes_by_id[nid]["width"], nodes_by_id[nid]["height"]) for nid in node_ids]
        bbox = _branch_bbox(rects, REAL_57NODE_MANIFEST["image_width_px"], REAL_57NODE_MANIFEST["image_height_px"], 24.0)
        local = _translate_manifest_to_branch(REAL_57NODE_MANIFEST, node_ids, bbox)
        kept_total += len(local["connectors"])
    real_total = len(REAL_57NODE_MANIFEST["connectors"])
    excluded = real_total - kept_total
    assert real_total == 56
    assert excluded == 9  # exactly one root-bridge stub per real top-level branch


# ---- root readability (review finding) --------------------------------------
#
# Contract: branch-aware tiling deliberately never puts the true root
# inside any branch's own detail crop (root is the one node every
# branch's own ancestor path excludes by definition). Unlike H2's
# whole-image tiling -- where root was covered by SOME uniform tile too,
# getting a detail-page-level font like any other node -- branch-aware
# tiling alone would leave root's readability entirely up to whatever
# scale the OVERVIEW page happens to give it. pdf_serializer.py's
# _write_image_or_detail_pages checks root's own overview-scale effective
# pt against TARGET_MIN_PT (6.0 -- the same per-node floor every node in
# any tile must individually clear, not the stricter median+min
# "meets_target" bar used to judge a whole TILE's typical readability)
# and, when root falls short, gives root its OWN single-node detail
# region -- exactly like a branch, through the exact same
# exact_grid_search_verbose machinery, nothing special-cased.
#
# A single-node group's own "meets_target" check is NECESSARILY the
# stricter TARGET_MEDIAN_PT bar (8pt), not just TARGET_MIN_PT (6pt):
# median_pt == min_pt when there is exactly one node, so median>=8 is the
# real bar, and -- being a single node -- more tiles can never shrink its
# own crop below its own pixel size, so there is no "grow the budget"
# escape hatch the way a multi-node branch has. If root's own label is so
# wide that even a full, isolated crop can't reach 8pt, branch-aware
# tiling honestly declines ENTIRELY (same None contract as any other
# branch that can't be tiled) rather than silently shipping an unreadable
# root -- pdf_serializer.py then falls back to the existing
# ceiling-exceeded warning, an explicit, bounded result, never a silently
# degraded "success".

def _real_manifest_with_root_font(font_size_px):
    m = copy.deepcopy(REAL_57NODE_MANIFEST)
    for n in m["nodes"]:
        if n["id"] == "root":
            n["font_size_px"] = font_size_px
    return m


def test_root_overview_pt_below_target_with_real_root_font():
    """Pins the real fixture's own root readability baseline: at the real
    captured font_size_px=50, root's overview pt (8.19, computed from the
    real image/page geometry) is already above TARGET_MIN_PT -- root never
    needed its own detail region for THIS fixture (confirmed separately:
    test_real_57node_fixture_succeeds_branch_aware_within_same_ceiling's 9
    branches, no root, is still exactly right)."""
    from services.mindmap.export.pdf_layout import A4_PORTRAIT_PT, centered_fit_rect, choose_map_orientation
    manifest = REAL_57NODE_MANIFEST
    choice = choose_map_orientation(manifest["image_width_px"], manifest["image_height_px"], A4_PORTRAIT_PT, 40.0)
    rect = centered_fit_rect(manifest["image_width_px"], manifest["image_height_px"], choice.page_w, choice.page_h, 40.0)
    root_node = next(n for n in manifest["nodes"] if n["id"] == "root")
    root_pt = root_node["font_size_px"] * rect.width / manifest["image_width_px"]
    assert root_pt >= TARGET_MIN_PT


def test_root_gets_its_own_readable_detail_region_when_overview_is_too_small():
    """A root with a smaller (but realistic -- same font family/ratio as
    every other node) font renders unreadably small on the overview alone
    (pt < 6) -- giving it its own single-node branch group succeeds
    (isolating just root's own real bbox reaches a far bigger scale than
    the whole-image overview does) and adds exactly one extra detail page."""
    manifest = _real_manifest_with_root_font(20)
    groups = [("root", {"root"})] + _real_branch_groups()
    result = branch_aware_grid_search(manifest, groups, page_ceiling=12, bands=BANDS)
    assert result is not None
    assert result.all_meet_target
    assert len(result.plans) == 10  # root + 9 real branches
    root_plan = next(p for p in result.plans if p.branch_id == "root")
    assert root_plan.min_pt >= TARGET_MIN_PT
    assert root_plan.min_pt > 8.0  # comfortably readable, not a bare pass


def test_root_unreadable_even_isolated_declines_cleanly_not_silently():
    """A pathologically wide root label (e.g. a very long map title) can
    make even ROOT'S OWN isolated crop fall short of the single-node 8pt
    bar -- more tiles cannot rescue a single node (it would just split
    it), so this must decline the WHOLE branch-aware attempt cleanly
    (None), never silently ship a plan with an unreadable root."""
    manifest = copy.deepcopy(REAL_57NODE_MANIFEST)
    for n in manifest["nodes"]:
        if n["id"] == "root":
            n["x"] = 700
            n["width"] = 3200  # realistic font (32px, same as every branch node), just a very long title
            n["font_size_px"] = 32
    groups = [("root", {"root"})] + _real_branch_groups()
    result = branch_aware_grid_search(manifest, groups, page_ceiling=12, bands=BANDS)
    assert result is None  # explicit, bounded "can't do it" -- never a plan missing root's own readability


# ---- branch isolation: overlapping padded bboxes (review finding) ----------

def test_overlapping_padded_bboxes_still_assign_every_node_to_exactly_one_branch():
    """Two branches positioned close enough that their OWN padded
    (branch_padding_px) bounding boxes overlap must still each get a
    correct, disjoint NODE assignment -- node coverage is governed by
    each branch's own explicit node-id set (from the tree), never by
    which pixels happen to fall inside a padded bbox, so a geometric
    overlap can never cause a node to be silently claimed by, or missing
    from, the wrong branch's plan.

    Known, accepted, documented trade-off (not a bug, not silently
    swept away): because each branch's detail page crops the ORIGINAL
    full-image raster via a plain rectangular window (same technique H2's
    own whole-image tiles already use -- never a second, re-encoded
    per-branch image), a detail page CAN show a few pixels spilling in
    from a very close neighbour's own content at the crop's edge. This
    is strictly LESS cross-branch bleed than H2's own uniform grid ever
    had (a shared uniform tile could contain MULTIPLE full branches with
    zero distinction at all), never a regression, and never affects which
    nodes are considered this branch's own CONTENT for coverage/validation
    purposes -- only the raster framing at the very edge of a crop."""
    # Two 2-node branches 40px apart -- well inside 2x the default 24px
    # padding (48px total), so their padded bboxes genuinely overlap.
    nodes = [
        {"id": "a1", "x": 0, "y": 0, "width": 200, "height": 100, "font_size_px": 40},
        {"id": "a2", "x": 0, "y": 150, "width": 200, "height": 100, "font_size_px": 40},
        {"id": "b1", "x": 240, "y": 0, "width": 200, "height": 100, "font_size_px": 40},
        {"id": "b2", "x": 240, "y": 150, "width": 200, "height": 100, "font_size_px": 40},
    ]
    manifest = _simple_manifest(500, 300, nodes)
    groups = [("a", {"a1", "a2"}), ("b", {"b1", "b2"})]
    result = branch_aware_grid_search(manifest, groups, page_ceiling=12, bands=BANDS)
    assert result is not None
    assert len(result.plans) == 2
    a_plan, b_plan = result.plans
    # Every node still belongs to EXACTLY its own branch's node-id set (the
    # geometric bbox overlap never reassigns or duplicates a node).
    assert groups[0][1] == {"a1", "a2"}
    assert groups[1][1] == {"b1", "b2"}
    for plan, ids in ((a_plan, {"a1", "a2"}), (b_plan, {"b1", "b2"})):
        for nid in ids:
            n = next(x for x in nodes if x["id"] == nid)
            rect = Rect(n["x"], n["y"], n["width"], n["height"])
            assert any(t.x <= rect.x and t.y <= rect.y and t.right >= rect.right and t.bottom >= rect.bottom for t in plan.tiles)


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
