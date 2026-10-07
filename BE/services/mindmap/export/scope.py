"""Server-side export scope resolver — Python port of the FE's
mindmapExportScope.js (same contract, same dedupe/order rules), adapted for
the server's own node shape: a FLAT list of {id, parent, kind, title, note,
node_type, chunk_refs, order} (services/mindmap/pipeline/schema.py's
NodeV2), not mind-elixir's nested live nodeData tree the FE version reads.

Deliberately independent of any client-supplied collapse/visibility state —
there is none server-side, and there must not be: a document export is a
snapshot of the AUTHORITATIVE node set (`mindmap_store.get_record`), never
of whatever a browser tab happened to have expanded. `visible_only` from the
FE contract has no server-side analogue for this reason and is not ported.
"""
from __future__ import annotations

from typing import Any, Optional


class ExportScopeError(Exception):
    pass


class UnknownNodeIdError(ExportScopeError):
    pass


class NoSelectionError(ExportScopeError):
    pass


SCOPE_TYPES = ("full", "current_branch", "selected_branches")


def _index(nodes: list[dict]) -> tuple[dict[str, dict], dict[str, Optional[str]], dict[str, list[str]]]:
    by_id = {n["id"]: n for n in nodes}
    parent_of = {n["id"]: n.get("parent") for n in nodes}
    children_of: dict[str, list[str]] = {}
    for n in nodes:
        pid = n.get("parent")
        if pid is not None:
            children_of.setdefault(pid, []).append(n["id"])
    return by_id, parent_of, children_of


def _is_ancestor_of(parent_of: dict[str, Optional[str]], maybe_ancestor_id: str, node_id: str) -> bool:
    cur = parent_of.get(node_id)
    while cur is not None:
        if cur == maybe_ancestor_id:
            return True
        cur = parent_of.get(cur)
    return False


def _document_order(nodes: list[dict], children_of: dict[str, list[str]], root_id: str) -> list[str]:
    order: list[str] = []

    def walk(node_id: str) -> None:
        order.append(node_id)
        for child_id in sorted(children_of.get(node_id, []), key=lambda cid: (_order_of(nodes, cid))):
            walk(child_id)

    walk(root_id)
    return order


def _order_of(nodes: list[dict], node_id: str) -> int:
    for n in nodes:
        if n["id"] == node_id:
            return int(n.get("order") or 0)
    return 0


def _dedupe_and_order_roots(ids: list[str], nodes: list[dict], parent_of: dict, children_of: dict, root_id: str) -> list[str]:
    kept = [i for i in ids if not any(other != i and _is_ancestor_of(parent_of, other, i) for other in ids)]
    order = _document_order(nodes, children_of, root_id)
    rank = {node_id: idx for idx, node_id in enumerate(order)}
    deduped = list(dict.fromkeys(kept))  # de-dupe while preserving first-seen order, like Set does
    deduped.sort(key=lambda i: rank.get(i, 0))
    return deduped


def resolve_export_scope(
    nodes: list[dict], *, scope_type: str,
    selected_node_id: Optional[str] = None,
    selected_branch_root_ids: Optional[list[str]] = None,
    include_descendants: bool = True,
) -> dict[str, Any]:
    """Returns {"root_ids": [...], "included_ids": set[...]}."""
    if not nodes:
        raise ExportScopeError("resolve_export_scope: nodes is required")
    by_id, parent_of, children_of = _index(nodes)
    root = next((n for n in nodes if n.get("parent") is None or n.get("kind") == "root"), None)
    if root is None:
        raise ExportScopeError("resolve_export_scope: no root node found")
    root_id = root["id"]

    def assert_known(node_id: str) -> None:
        if node_id not in by_id:
            raise UnknownNodeIdError(f"node_id not in this map: {node_id}")

    if scope_type == "full":
        root_ids = [root_id]
    elif scope_type == "current_branch":
        if not selected_node_id:
            raise NoSelectionError("current_branch scope requires a selected node")
        assert_known(selected_node_id)
        root_ids = [selected_node_id]
    elif scope_type == "selected_branches":
        ids = selected_branch_root_ids or []
        if not ids:
            raise NoSelectionError("selected_branches scope requires at least one selected root")
        for i in ids:
            assert_known(i)
        root_ids = _dedupe_and_order_roots(ids, nodes, parent_of, children_of, root_id)
    else:
        raise ExportScopeError(f"unknown scope_type: {scope_type}")

    included_ids: set[str] = set()

    def collect(node_id: str) -> None:
        included_ids.add(node_id)
        if not include_descendants:
            return
        for child_id in children_of.get(node_id, []):
            collect(child_id)

    for rid in root_ids:
        collect(rid)

    # contextNodes = union(ancestors(root) for root in root_ids) - effectiveNodes. Only the
    # direct path up to the map root — never a sibling, never a sibling's own subtree.
    context_ids: set[str] = set()
    for rid in root_ids:
        cur = parent_of.get(rid)
        while cur is not None:
            if cur not in included_ids:
                context_ids.add(cur)
            cur = parent_of.get(cur)

    return {"root_ids": root_ids, "included_ids": included_ids, "context_ids": context_ids}
