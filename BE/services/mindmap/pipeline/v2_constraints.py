"""Deterministic validation for the learning-map-v2 hierarchy contract."""
from __future__ import annotations

from collections import defaultdict

MAX_DEPTH = 3
MIN_TOP_LEVEL_BRANCHES = 5
MAX_TOP_LEVEL_BRANCHES = 8
MIN_CHILDREN = 2
MAX_CHILDREN = 5
MIN_RICH_MAP_NODES = 15


def _children(nodes: list[dict]) -> dict[str, list[dict]]:
    result: dict[str, list[dict]] = defaultdict(list)
    for node in nodes or []:
        parent = node.get("parent")
        if parent is not None:
            result[str(parent)].append(node)
    for values in result.values():
        values.sort(key=lambda item: (item.get("order", 0), str(item.get("id", ""))))
    return result


def validate_hierarchy(nodes: list[dict], *, require_rich_size: bool = False) -> dict:
    nodes = [node for node in (nodes or []) if isinstance(node, dict)]
    children = _children(nodes)
    roots = [node for node in nodes if node.get("parent") is None]
    root = next((node for node in roots if node.get("kind") == "root"), roots[0] if roots else None)
    root_id = str(root.get("id")) if root else None
    by_id = {str(node.get("id")): node for node in nodes}
    depths: dict[str, int] = {}
    visiting: set[str] = set()

    def depth_of(node: dict, fallback: int = MAX_DEPTH + 1) -> int:
        node_id = str(node.get("id"))
        if node_id in depths:
            return depths[node_id]
        if node_id in visiting:
            return fallback
        visiting.add(node_id)
        parent_id = node.get("parent")
        parent = by_id.get(str(parent_id)) if parent_id is not None else None
        depth = 0 if parent_id is None else (depth_of(parent, fallback) + 1 if parent else fallback)
        visiting.remove(node_id)
        depths[node_id] = depth
        return depth

    for node in nodes:
        depth_of(node)

    branches = children.get(root_id, []) if root_id is not None else []
    issues: list[str] = []
    if root is None:
        issues.append("V2_MISSING_ROOT")
    if not MIN_TOP_LEVEL_BRANCHES <= len(branches) <= MAX_TOP_LEVEL_BRANCHES:
        issues.append(f"V2_TOP_LEVEL_BRANCHES:{len(branches)}")
    if require_rich_size and len(nodes) < MIN_RICH_MAP_NODES:
        issues.append(f"V2_RICH_MAP_TOO_SMALL:{len(nodes)}")
    deep = sorted({depth for depth in depths.values() if depth > MAX_DEPTH})
    if deep:
        issues.append(f"V2_MAX_DEPTH:{max(deep)}")
    cardinality: list[str] = []
    for node in nodes:
        node_id = str(node.get("id"))
        count = len(children.get(node_id, []))
        root_ok = node_id == root_id and MIN_TOP_LEVEL_BRANCHES <= count <= MAX_TOP_LEVEL_BRANCHES
        if count and not (root_ok or MIN_CHILDREN <= count <= MAX_CHILDREN):
            cardinality.append(f"{node_id}:{count}")
    if cardinality:
        issues.append("V2_CHILDREN_CARDINALITY:" + ",".join(cardinality))
    long_topics = sorted(
        str(node.get("id")) for node in nodes
        if len(" ".join(str(node.get("title") or "").split())) > 100
    )
    if long_topics:
        issues.append("V2_TOPIC_TOO_LONG:" + ",".join(long_topics))
    return {
        "valid": not issues,
        "issues": issues,
        "node_count": len(nodes),
        "top_level_branches": len(branches),
        "max_depth": max(depths.values(), default=0),
        "depths": depths,
        "branch_ids": [str(node.get("id")) for node in branches],
        "cardinality": {str(node.get("id")): len(children.get(str(node.get("id")), [])) for node in nodes},
    }


def issue_codes(report: dict) -> list[str]:
    return list(report.get("issues") or [])
