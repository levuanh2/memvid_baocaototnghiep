"""Deterministic post-hoc diagnostics for guided mind maps — no LLM call.

Runs once, on the final node/relation list in AssemblePersist, after
schema.validate_v3_record/repair_v3_record (which only check *shape*: one
root, no orphans, no cycles, label length, valid relation ids/types). This
module checks *cognitive structure* instead — the smells a shape-only
validator cannot see, e.g. every branch reduced to "topic -> one summary
child" even though shape-wise it's a perfectly valid tree.

This is a structural regression signal, not a measure of human learning
quality (see docs/GUIDED_MINDMAP_GENERATION_V3_REPORT.md). Findings are
diagnostics attached to the record, not hard failures — the repair pass
below only ever does bounded, deterministic, evidence-preserving fixes
(merge exact-duplicate-title siblings). It never invents content, and it
never calls a model.
"""
from __future__ import annotations

from collections import Counter, defaultdict

GENERIC_TITLES = {
    "tổng quan", "overview", "general information", "other content", "details",
    "chi tiết", "thông tin chung", "khác", "additional information", "nội dung chính",
}


def _children_map(nodes: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = defaultdict(list)
    for n in nodes:
        parent = n.get("parent")
        if parent is not None:
            out[parent].append(n)
    return out


def _depths(nodes: list[dict]) -> dict[str, int]:
    by_id = {n.get("id"): n for n in nodes}
    depths: dict[str, int] = {}

    def depth(node_id: str, _seen: frozenset = frozenset()) -> int:
        if node_id in depths:
            return depths[node_id]
        if node_id in _seen:
            return 0  # cycle — schema.validate_v3_record already flags this separately
        node = by_id.get(node_id)
        parent = node.get("parent") if node else None
        d = 0 if not parent else 1 + depth(parent, _seen | {node_id})
        depths[node_id] = d
        return d

    for n in nodes:
        depth(n.get("id"))
    return depths


def compute_diagnostics(nodes: list[dict], relations: list[dict]) -> dict:
    """Part 19 structural metrics + the smell detectors from Part 13.

    Pure function of the final node/relation list — safe to call on any
    record shape (V2 or V3), including a degenerate/empty one.
    """
    if not nodes:
        return {
            "nodes_emitted": 0, "node_type_distribution": {}, "max_depth": 0,
            "avg_children_per_internal_node": 0.0, "typed_cross_relations": 0,
            "evidence_coverage_pct": 0.0, "duplicate_title_count": 0,
            "generic_title_count": 0, "single_child_internal_count": 0,
            "smells": {}, "summary_tree_smell": False,
        }
    children = _children_map(nodes)
    depths = _depths(nodes)
    internal_ids = [n.get("id") for n in nodes if children.get(n.get("id"))]
    non_root = [n for n in nodes if n.get("kind") != "root"]
    titles = [str(n.get("title") or "").strip().casefold() for n in non_root]
    title_counts = Counter(titles)
    with_evidence = sum(1 for n in non_root if n.get("chunk_refs"))
    smells = _detect_smells(nodes, children, depths, internal_ids, title_counts)
    return {
        "nodes_emitted": len(nodes),
        "node_type_distribution": dict(Counter(n.get("node_type") or "concept" for n in nodes)),
        "max_depth": max(depths.values(), default=0),
        "avg_children_per_internal_node": (
            round(sum(len(children[i]) for i in internal_ids) / len(internal_ids), 2)
            if internal_ids else 0.0
        ),
        "typed_cross_relations": len(relations),
        "evidence_coverage_pct": round(100 * with_evidence / len(non_root), 1) if non_root else 0.0,
        "duplicate_title_count": sum(c - 1 for c in title_counts.values() if c > 1),
        "generic_title_count": sum(1 for t in titles if t in GENERIC_TITLES),
        "single_child_internal_count": sum(1 for i in internal_ids if len(children[i]) == 1),
        "smells": smells,
        "summary_tree_smell": smells.get("summary_tree", False),
    }


def _detect_smells(nodes: list[dict], children: dict[str, list[dict]], depths: dict[str, int],
                   internal_ids: list[str], title_counts: Counter) -> dict[str, bool]:
    root = next((n for n in nodes if n.get("kind") == "root"), None)
    branches = children.get(root.get("id"), []) if root else []
    max_depth = max(depths.values(), default=0)

    # summary-tree: most branches are "one leaf child with a long note", i.e.
    # the shape prose-summary generation actually produces — depth caps at 2
    # and almost every branch has exactly one, childless child.
    single_leaf_branches = sum(
        1 for b in branches
        if len(children.get(b.get("id"), [])) == 1
        and not children.get(children[b.get("id")][0].get("id"))
    )
    summary_tree = bool(branches) and max_depth <= 2 and (single_leaf_branches / len(branches)) > 0.6

    # repeated-structure: every branch has the same shallow 1-2-child shape
    # regardless of how much evidence it actually has — a fixed template, not
    # a reasoned structure.
    branch_child_counts = {len(children.get(b.get("id"), [])) for b in branches}
    repeated_structure = bool(branches) and max_depth <= 2 and branch_child_counts <= {1, 2}

    generic_label = any(
        str(n.get("title") or "").strip().casefold() in GENERIC_TITLES
        for n in nodes if n.get("kind") in ("root", "section")
    )

    # lonely-branch: a top-level branch with substantial evidence (many
    # descendant chunk_refs) but only one child — the content clearly
    # supports more structure than was generated.
    def descendant_ref_count(node_id: str) -> int:
        total = len(next((n for n in nodes if n.get("id") == node_id), {}).get("chunk_refs") or [])
        for c in children.get(node_id, []):
            total += descendant_ref_count(c.get("id"))
        return total

    lonely_branch = any(
        len(children.get(b.get("id"), [])) == 1 and descendant_ref_count(b.get("id")) >= 4
        for b in branches
    )

    excessive_flatness = len(branches) > 10 and all(
        len(children.get(b.get("id"), [])) <= 1 for b in branches
    )
    excessive_depth = max_depth > 4

    return {
        "summary_tree": summary_tree,
        "repeated_structure": repeated_structure,
        "generic_label": generic_label,
        "lonely_branch": lonely_branch,
        "excessive_flatness": excessive_flatness,
        "excessive_depth": excessive_depth,
    }


def repair_duplicate_titles(nodes: list[dict]) -> tuple[list[dict], int]:
    """Merge exact-duplicate-title SIBLINGS (same parent), union their
    evidence, drop the extras. Bounded (single pass), deterministic, never
    invents or drops evidence — only removes a redundant node whose entire
    evidence set survives on the sibling it merges into.
    """
    by_parent: dict[str, list[dict]] = defaultdict(list)
    for n in nodes:
        by_parent[n.get("parent")].append(n)
    drop_ids: set[str] = set()
    keep_refs: dict[str, list[str]] = {}
    for siblings in by_parent.values():
        seen: dict[str, dict] = {}
        for n in siblings:
            key = str(n.get("title") or "").strip().casefold()
            if not key:
                continue
            if key in seen:
                primary = seen[key]
                merged = list(dict.fromkeys((keep_refs.get(primary["id"], primary.get("chunk_refs") or []))
                                            + (n.get("chunk_refs") or [])))
                keep_refs[primary["id"]] = merged
                drop_ids.add(n["id"])
            else:
                seen[key] = n
    if not drop_ids:
        return nodes, 0
    out = []
    for n in nodes:
        if n["id"] in drop_ids:
            continue
        if n["id"] in keep_refs:
            n = {**n, "chunk_refs": keep_refs[n["id"]]}
        out.append(n)
    # Reparent any node whose parent was just dropped is impossible here —
    # dropped nodes are always leaves relative to this pass's own additions,
    # but guard anyway: never leave an orphan pointing at a dropped id.
    remaining_ids = {n["id"] for n in out}
    for n in out:
        if n.get("parent") is not None and n["parent"] not in remaining_ids:
            root = next((r for r in out if r.get("kind") == "root"), None)
            if root:
                n["parent"] = root["id"]
    return out, len(drop_ids)
