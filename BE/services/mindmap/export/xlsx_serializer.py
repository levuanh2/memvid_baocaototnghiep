"""Real XLSX serializer (openpyxl, already a dependency). Sheets: Summary
(always), Nodes (always — one row per node, document order), Citations
(only when any node has citations AND content.citations is true),
Relations (only when the tree has any AND content.relations is true) —
sheets appear only when requested/relevant, never as always-present-but-
empty placeholders.

Every option here is driven by format_capabilities.json's "xlsx" entry
(capabilities.py normalizes a request against it) — no background,
connector or page-orientation controls exist here on purpose (none of
those concepts apply to a workbook)."""
from __future__ import annotations

import io
from typing import Any, Optional

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

from .tree import flatten_export_tree

FONT_NAMES = {"sans": "Calibri", "serif": "Times New Roman"}
MONOCHROME_HEX = "2B2620"  # matches FE's mindmapExportAppearance.js MONOCHROME_COLOR (no leading #, openpyxl's own convention)
CUSTOM_PALETTE_HEX = ["126CF2", "8C4DFF", "16A085", "F2353A"]  # matches FE's CUSTOM_PALETTE


def _source_name(chunk_ref: str) -> str:
    return chunk_ref.split("#", 1)[0]


def _header_fill_and_font_color(header_style_mode: str) -> tuple[Optional[PatternFill], Optional[str]]:
    if header_style_mode == "monochrome":
        return PatternFill("solid", fgColor=MONOCHROME_HEX), "FFFFFF"
    if header_style_mode == "customPalette":
        return PatternFill("solid", fgColor=CUSTOM_PALETTE_HEX[0]), "FFFFFF"
    return None, None  # "keep" — openpyxl's own default header look


def _style_header_row(ws, font_name: str, header_style_mode: str) -> None:
    fill, font_color = _header_fill_and_font_color(header_style_mode)
    for cell in ws[1]:
        cell.font = Font(name=font_name, bold=True, color=font_color)
        if fill:
            cell.fill = fill


def _apply_body_font(ws, font_name: str) -> None:
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.font = Font(name=font_name)


def _autosize_columns(ws) -> None:
    for col_cells in ws.columns:
        length = max((len(str(c.value)) if c.value is not None else 0) for c in col_cells)
        letter = get_column_letter(col_cells[0].column)
        ws.column_dimensions[letter].width = min(max(length + 2, 10), 60)


def _finalize_sheet(ws, font_name: str, header_style_mode: str) -> None:
    """Freeze header row + enable filters + sensible column widths — always-on
    formatting improvements per this round's spec, not user-toggleable
    controls (there's no reasonable reason to want a frozen header off)."""
    _style_header_row(ws, font_name, header_style_mode)
    _apply_body_font(ws, font_name)
    ws.freeze_panes = "A2"
    if ws.max_row > 1:
        ws.auto_filter.ref = ws.dimensions
    _autosize_columns(ws)


def serialize_xlsx(
    tree: dict[str, Any], *, font: str = "sans", header_style_mode: str = "keep",
    content: Optional[dict[str, bool]] = None,
    include_citations: Optional[bool] = None,  # back-compat alias for content.citations
    include_relations: Optional[bool] = None,  # back-compat alias for content.relations
) -> bytes:
    content = dict(content or {})
    if include_citations is not None:
        content.setdefault("citations", include_citations)
    if include_relations is not None:
        content.setdefault("relations", include_relations)
    content.setdefault("citations", True)
    content.setdefault("relations", True)
    content.setdefault("notes", False)
    content.setdefault("sourceNames", False)

    font_name = FONT_NAMES.get(font, FONT_NAMES["sans"])
    rows = flatten_export_tree(tree)

    wb = Workbook()
    summary = wb.active
    summary.title = "Summary"
    summary.append(["Tiêu đề", tree.get("title") or ""])
    summary.append(["Map ID", tree.get("map_id") or ""])
    summary.append(["Số node", len(rows)])
    summary.append(["Số nhánh gốc", len(tree.get("roots") or [])])
    summary.append(["Số quan hệ", len(tree.get("relations") or [])])
    for row in summary.iter_rows():
        for cell in row:
            cell.font = Font(name=font_name)

    nodes_ws = wb.create_sheet("Nodes")
    # "is_context" is always present (never gated behind a content toggle): it's
    # structural metadata distinguishing an ancestor kept only for orientation
    # ("đã mô tả trong is_context" — see mindmapExportScope.js's header comment)
    # from a node the user actually selected, not optional document content.
    header = ["node_id", "parent_id", "branch_path", "depth", "order", "topic", "is_context"]
    if content["notes"]:
        header.append("note")
    if content["sourceNames"]:
        header.append("source_names")
    nodes_ws.append(header)
    for r in rows:
        row_values = [r["node_id"], r["parent_id"] or "", r["branch_path"], r["depth"], r["order"], r["topic"], r["is_context"]]
        if content["notes"]:
            row_values.append(r["note"])
        if content["sourceNames"]:
            row_values.append(", ".join(sorted({_source_name(c) for c in r["citations"]})))
        nodes_ws.append(row_values)
    _finalize_sheet(nodes_ws, font_name, header_style_mode)
    # Context rows get an italic topic cell so a reader can tell "shown for
    # orientation" apart from "this is what you selected" at a glance, without
    # a second pass over cells already styled by _finalize_sheet above.
    topic_col = header.index("topic") + 1
    for idx, r in enumerate(rows, start=2):
        if r["is_context"]:
            cell = nodes_ws.cell(row=idx, column=topic_col)
            cell.font = Font(name=font_name, italic=True)

    any_citations = any(r["citations"] for r in rows)
    if content["citations"] and any_citations:
        cit_ws = wb.create_sheet("Citations")
        cit_ws.append(["node_id", "topic", "citation"])
        for r in rows:
            for c in r["citations"]:
                cit_ws.append([r["node_id"], r["topic"], c])
        _finalize_sheet(cit_ws, font_name, header_style_mode)

    if content["relations"] and tree.get("relations"):
        by_id = {r["node_id"]: r["topic"] for r in rows}
        rel_ws = wb.create_sheet("Relations")
        rel_ws.append(["source_id", "source_topic", "target_id", "target_topic", "type", "label"])
        for rel in tree["relations"]:
            rel_ws.append([
                rel["source"], by_id.get(rel["source"], ""), rel["target"], by_id.get(rel["target"], ""),
                rel.get("type") or "", rel.get("label") or "",
            ])
        _finalize_sheet(rel_ws, font_name, header_style_mode)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
