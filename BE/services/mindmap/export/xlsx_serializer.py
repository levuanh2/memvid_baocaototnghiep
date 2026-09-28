"""Real XLSX serializer (openpyxl, already a dependency). Sheets: Summary
(always), Nodes (always — one row per node, document order, id/parent/
branch-path/depth/order/topic/note), Citations (only when any node has
citations AND include_citations is true), Relations (only when the tree
has any, AND include_relations is true) — matching "sheets appear only
when requested/relevant", not always-present-but-empty placeholders."""
from __future__ import annotations

import io
from typing import Any

from openpyxl import Workbook

from .tree import flatten_export_tree


def serialize_xlsx(tree: dict[str, Any], *, include_citations: bool = True, include_relations: bool = True) -> bytes:
    rows = flatten_export_tree(tree)

    wb = Workbook()
    summary = wb.active
    summary.title = "Summary"
    summary.append(["Tiêu đề", tree.get("title") or ""])
    summary.append(["Map ID", tree.get("map_id") or ""])
    summary.append(["Số node", len(rows)])
    summary.append(["Số nhánh gốc", len(tree.get("roots") or [])])
    summary.append(["Số quan hệ", len(tree.get("relations") or [])])

    nodes_ws = wb.create_sheet("Nodes")
    nodes_ws.append(["node_id", "parent_id", "branch_path", "depth", "order", "topic", "note"])
    for r in rows:
        nodes_ws.append([r["node_id"], r["parent_id"] or "", r["branch_path"], r["depth"], r["order"], r["topic"], r["note"]])

    any_citations = any(r["citations"] for r in rows)
    if include_citations and any_citations:
        cit_ws = wb.create_sheet("Citations")
        cit_ws.append(["node_id", "topic", "citation"])
        for r in rows:
            for c in r["citations"]:
                cit_ws.append([r["node_id"], r["topic"], c])

    if include_relations and tree.get("relations"):
        by_id = {r["node_id"]: r["topic"] for r in rows}
        rel_ws = wb.create_sheet("Relations")
        rel_ws.append(["source_id", "source_topic", "target_id", "target_topic", "type", "label"])
        for rel in tree["relations"]:
            rel_ws.append([
                rel["source"], by_id.get(rel["source"], ""), rel["target"], by_id.get(rel["target"], ""),
                rel.get("type") or "", rel.get("label") or "",
            ])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
