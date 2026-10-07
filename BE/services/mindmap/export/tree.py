"""Builds the canonical export tree (nested, document-ordered) that every
document serializer (docx/xlsx/pdf) consumes — the server-side analogue of
the FE's mindmapExportScope.js buildExportTree/flattenExportTree, built from
the SAME authoritative node/relation lists the scope resolver validated
against (never from client-supplied topic/note/citation text — see
scope.py's header comment)."""
from __future__ import annotations

from typing import Any, Optional


def build_export_tree(
    nodes: list[dict], relations: list[dict], root_ids: list[str], included_ids: set[str],
    *, map_id: str = "", title: str = "", context_ids: Optional[set[str]] = None,
) -> dict[str, Any]:
    """Builds ONE tree rooted at the map's TRUE root, pruned to
    `included_ids | context_ids` — never one tree per `root_ids` entry. An
    ancestor-context node naturally keeps only the child that leads to a
    selected branch (the prune IS the "minimal ancestor path" rule): a
    sibling branch, or a sibling's own subtree, is never in the render set,
    so it's pruned away during the same walk. `root_ids` is still accepted
    for API/metadata symmetry with `resolve_export_scope`'s return value, but
    no longer drives the tree shape directly. Each node carries `is_context`
    (true for an ancestor-only node) so a serializer can style it differently
    without a second pass."""
    context_ids = context_ids or set()
    render_set = included_ids | context_ids
    by_id = {n["id"]: n for n in nodes}
    parent_of = {n["id"]: n.get("parent") for n in nodes}
    children_of: dict[str, list[dict]] = {}
    for n in nodes:
        pid = n.get("parent")
        if pid is not None:
            children_of.setdefault(pid, []).append(n)
    for pid in children_of:
        children_of[pid].sort(key=lambda n: int(n.get("order") or 0))
    true_root = next((n for n in nodes if n.get("parent") is None or n.get("kind") == "root"), None)
    if true_root is None:
        raise ValueError("build_export_tree: no root node found")

    def to_node(node_id: str, depth: int) -> dict[str, Any]:
        n = by_id[node_id]
        children = [
            to_node(c["id"], depth + 1)
            for c in children_of.get(node_id, [])
            if c["id"] in render_set
        ]
        return {
            "node_id": node_id,
            "parent_id": parent_of.get(node_id),
            "topic": n.get("title") or "",
            "note": n.get("note") or "",
            "depth": depth,
            "is_context": node_id not in included_ids,
            "citations": list(n.get("chunk_refs") or []),
            "children": children,
        }

    roots = [to_node(true_root["id"], 0)]
    kept_relations = [
        {"source": r["source"], "target": r["target"], "type": r.get("type") or "relates_to", "label": r.get("label") or ""}
        for r in (relations or [])
        if r.get("source") in render_set and r.get("target") in render_set
    ]
    return {"map_id": map_id, "title": title, "roots": roots, "relations": kept_relations}


def flatten_export_tree(tree: dict[str, Any]) -> list[dict[str, Any]]:
    """One row per node, stable document order — what the XLSX Nodes sheet needs directly."""
    rows: list[dict[str, Any]] = []
    order = 0

    def walk(node: dict, branch_path: list[str]) -> None:
        nonlocal order
        path = branch_path + [node["topic"]]
        rows.append({
            "node_id": node["node_id"], "parent_id": node["parent_id"],
            "branch_path": " / ".join(path), "depth": node["depth"], "order": order,
            "topic": node["topic"], "note": node["note"], "citations": node["citations"],
            "is_context": node["is_context"],
        })
        order += 1
        for c in node["children"]:
            walk(c, path)

    for r in tree["roots"]:
        walk(r, [])
    return rows
