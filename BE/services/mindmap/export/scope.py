"""Server-side export scope resolver — Python port of the FE's
mindmapExportScope.js (same contract, same dedupe/order rules), adapted for
the server's own node shape: a FLAT list of {id, parent, kind, title, note,
node_type, chunk_refs, order} (services/mindmap/pipeline/schema.py's
NodeV2), not mind-elixir's nested live nodeData tree the FE version reads.

Every scope type except "visible" is independent of any client-supplied
collapse/visibility state — a document export is a snapshot of the
AUTHORITATIVE node set (`mindmap_store.get_record`), never of whatever a
browser tab happened to have expanded.

For ``selected_branches``, ``include_descendants=False`` is the exact checkbox
contract: explicit ids are preserved and only the minimal path to their lowest
common ancestor is added as context. Explicit ``True`` keeps the historical
subtree-root behavior for stored and legacy requests.

"visible" (PR E) IS allowed to take a client-supplied node-id set — but
never client-supplied CONTENT: the set only selects WHICH authoritative
nodes to include, every title/note/citation still comes from `nodes`
(fetched fresh server-side) exactly like every other scope type. The set
itself is validated strictly against THIS map's own tree before it's
trusted for anything: every id must be a known id of this map (an id real
on a different map reads identically to a fabricated one — no existence
leak), the set must be ancestor-closed (ambiguous/broken snapshots are
REJECTED, never silently repaired), duplicates are rejected rather than
deduped, and `include_descendants` must be explicitly False (the set IS the
exact visible membership already, not a set of roots to expand from).
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Optional


class ExportScopeError(Exception):
    pass


class UnknownNodeIdError(ExportScopeError):
    pass


class NoSelectionError(ExportScopeError):
    pass


class InvalidVisibleScopeError(ExportScopeError):
    """Malformed visible_node_ids: wrong type, non-string/empty/over-length
    item, empty list, over the count ceiling, or include_descendants=True."""
    pass


class DuplicateNodeIdError(ExportScopeError):
    pass


class VisibleRootMissingError(ExportScopeError):
    pass


class AncestorNotClosedError(ExportScopeError):
    pass


SCOPE_TYPES = ("full", "current_branch", "selected_branches", "visible")

# Hard ceiling independent of map size (first line of defense, checked
# before any per-id work) — the effective bound actually enforced is
# min(MAX_VISIBLE_EXPORT_NODE_IDS, len(nodes)) once `nodes` is known.
MAX_VISIBLE_EXPORT_NODE_IDS = 5000
MAX_VISIBLE_NODE_ID_LENGTH = 512


def _validate_visible_ids_shape(ids: Any) -> None:
    if not isinstance(ids, list) or not ids:
        raise InvalidVisibleScopeError("visible_node_ids must be a non-empty array of strings")
    if len(ids) > MAX_VISIBLE_EXPORT_NODE_IDS:
        raise InvalidVisibleScopeError(f"visible_node_ids exceeds the {MAX_VISIBLE_EXPORT_NODE_IDS}-id limit")
    for node_id in ids:
        if not isinstance(node_id, str) or not node_id or len(node_id) > MAX_VISIBLE_NODE_ID_LENGTH:
            raise InvalidVisibleScopeError("visible_node_ids must contain only non-empty strings within the length limit")


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


def _order_unique_ids(ids: list[str], nodes: list[dict], children_of: dict[str, list[str]], root_id: str) -> list[str]:
    rank = {node_id: idx for idx, node_id in enumerate(_document_order(nodes, children_of, root_id))}
    return sorted(dict.fromkeys(ids), key=lambda node_id: rank.get(node_id, 0))


def _path_to_root(parent_of: dict[str, Optional[str]], node_id: str) -> list[str]:
    path: list[str] = []
    cur: Optional[str] = node_id
    while cur is not None:
        path.append(cur)
        cur = parent_of.get(cur)
    return path


def _lowest_common_ancestor(parent_of: dict[str, Optional[str]], ids: list[str]) -> str:
    first, *rest = ids
    other_paths = [set(_path_to_root(parent_of, node_id)) for node_id in rest]
    return next(candidate for candidate in _path_to_root(parent_of, first)
                if all(candidate in path for path in other_paths))


def resolve_export_scope(
    nodes: list[dict], *, scope_type: str,
    selected_node_id: Optional[str] = None,
    selected_branch_root_ids: Optional[list[str]] = None,
    include_descendants: bool = True,
    visible_node_ids: Optional[list[str]] = None,
    context_mode: str = "minimal",
    suppressed_context_ids: Optional[list[str]] = None,
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

    suppressed = set(suppressed_context_ids or [])
    for node_id in suppressed:
        assert_known(node_id)

    explicit_selected_ids: list[str] = []
    exact_selection = False
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
        explicit_selected_ids = _order_unique_ids(ids, nodes, children_of, root_id)
        exact_selection = include_descendants is False
        root_ids = (explicit_selected_ids if exact_selection else
                    _dedupe_and_order_roots(explicit_selected_ids, nodes, parent_of, children_of, root_id))
    elif scope_type == "visible":
        # include_descendants has no meaning for "visible": the caller-
        # supplied set already IS the exact membership, never a set of
        # roots to expand from. Must be explicitly opted out, not just
        # left at the (other scopes') True default.
        if include_descendants is not False:
            raise InvalidVisibleScopeError("visible scope requires include_descendants=False")
        _validate_visible_ids_shape(visible_node_ids)
        if len(visible_node_ids) > len(nodes):
            raise InvalidVisibleScopeError("visible_node_ids cannot exceed this map's own node count")
        if len(visible_node_ids) != len(set(visible_node_ids)):
            raise DuplicateNodeIdError("visible_node_ids contains a duplicate id")
        for node_id in visible_node_ids:
            assert_known(node_id)  # unknown/cross-map id -> same error, no existence leak
        visible_set = set(visible_node_ids)
        if root_id not in visible_set:
            raise VisibleRootMissingError("visible_node_ids must include the map's own root")
        for node_id in visible_set:
            cur = parent_of.get(node_id)
            while cur is not None:
                if cur not in visible_set:
                    raise AncestorNotClosedError(
                        f"ancestor '{cur}' of '{node_id}' is missing from visible_node_ids"
                    )
                cur = parent_of.get(cur)
        root_ids = [root_id]
    else:
        raise ExportScopeError(f"unknown scope_type: {scope_type}")

    if scope_type == "visible":
        included_ids = set(visible_node_ids)
    else:
        included_ids = set()

        def collect(node_id: str) -> None:
            included_ids.add(node_id)
            if not include_descendants:
                return
            for child_id in children_of.get(node_id, []):
                collect(child_id)

        for rid in root_ids:
            collect(rid)

    lca_id = (_lowest_common_ancestor(parent_of, explicit_selected_ids)
              if exact_selection else root_id)
    minimal_context_ids: set[str] = set()
    for rid in root_ids:
        if rid == lca_id:
            continue
        cur = parent_of.get(rid)
        while cur is not None:
            if cur not in included_ids:
                minimal_context_ids.add(cur)
            if cur == lca_id:
                break
            cur = parent_of.get(cur)

    context_ids = (set() if context_mode == "none" else
                   {node_id for node_id in minimal_context_ids if node_id not in suppressed})
    render_ids = included_ids | context_ids
    order = _document_order(nodes, children_of, root_id)
    rank = {node_id: idx for idx, node_id in enumerate(order)}
    presentation_root_ids = sorted(
        (node_id for node_id in render_ids if parent_of.get(node_id) not in render_ids),
        key=lambda node_id: rank.get(node_id, 0),
    )
    presentation_root_id = presentation_root_ids[0] if len(presentation_root_ids) == 1 else None
    return {
        "root_ids": root_ids,
        "explicit_selected_ids": explicit_selected_ids,
        "included_ids": included_ids,
        "context_ids": context_ids,
        "minimal_context_ids": minimal_context_ids,
        "suppressed_context_ids": suppressed,
        "presentation_root_id": presentation_root_id,
        "presentation_root_ids": presentation_root_ids,
        "render_ids": render_ids,
    }


def error_code_for(exc: ExportScopeError) -> str:
    """Single source of truth for the HTTP/job error_code a given
    ExportScopeError maps to — used by both the route (synchronous
    validation) and the worker (re-validation), so the two can never drift
    apart on what a given failure is CALLED, only on when it's detected."""
    if isinstance(exc, UnknownNodeIdError):
        return "unknown_node_id"
    if isinstance(exc, NoSelectionError):
        return "no_selection"
    if isinstance(exc, VisibleRootMissingError):
        return "visible_root_missing"
    if isinstance(exc, AncestorNotClosedError):
        return "ancestor_not_closed"
    if isinstance(exc, DuplicateNodeIdError):
        return "duplicate_node_id"
    if isinstance(exc, InvalidVisibleScopeError):
        return "invalid_visible_scope"
    return "invalid_scope"


def visible_snapshot_fingerprint(nodes: list[dict], relations: list[dict], included_ids: set[str]) -> str:
    """Deterministic hash of exactly the CONTENT a "visible" snapshot's
    outline/map render would use — never anything the client sent, never
    anything outside `included_ids`. Computed identically at request time
    (route) and at run time (worker, against a second, independent record
    fetch); a mismatch means the included nodes' own content changed
    underneath the snapshot (edit/delete/re-parent), not that the map
    changed at all elsewhere — see this module's own docstring for why an
    unrelated addition/edit outside `included_ids` must NOT trip this.
    """
    by_id = {n["id"]: n for n in nodes}
    node_rows = [
        {
            "id": node_id,
            "parent": (by_id.get(node_id) or {}).get("parent"),
            # build_export_tree sorts each node's children by `order` to
            # decide the sequence branches appear in the outline/map — a
            # reorder with no other content change must still count as
            # stale, or the rendered PDF could silently diverge from what
            # was on screen at export time.
            "order": int((by_id.get(node_id) or {}).get("order") or 0),
            "topic": (by_id.get(node_id) or {}).get("title") or "",
            "note": (by_id.get(node_id) or {}).get("note") or "",
            "citations": sorted((by_id.get(node_id) or {}).get("chunk_refs") or []),
        }
        for node_id in sorted(included_ids)
    ]
    relation_rows = sorted(
        (
            {"source": r.get("source"), "target": r.get("target"), "type": r.get("type") or "relates_to", "label": r.get("label") or ""}
            for r in (relations or [])
            if r.get("source") in included_ids and r.get("target") in included_ids
        ),
        key=lambda r: (r["source"] or "", r["target"] or "", r["type"] or ""),
    )
    payload = {"nodes": node_rows, "relations": relation_rows}
    return hashlib.sha256(json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")).hexdigest()
