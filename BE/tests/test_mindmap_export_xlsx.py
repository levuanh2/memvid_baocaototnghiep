import io

from openpyxl import load_workbook

from services.mindmap.export.scope import resolve_export_scope
from services.mindmap.export.tree import build_export_tree
from services.mindmap.export.xlsx_serializer import serialize_xlsx


def _nodes():
    return [
        {"id": "r", "parent": None, "kind": "root", "title": "Bản đồ tư duy", "order": 0},
        {"id": "c1", "parent": "r", "kind": "section", "title": "Kiến trúc hệ thống", "order": 0, "chunk_refs": ["doc1#p3"]},
        {"id": "c1a", "parent": "c1", "kind": "idea", "title": "Chi tiết A", "order": 0},
        {"id": "c2", "parent": "r", "kind": "section", "title": "Bảo mật", "order": 1},
    ]


def _tree(nodes=None, relations=None):
    nodes = nodes or _nodes()
    scope = resolve_export_scope(nodes, scope_type="full")
    return build_export_tree(nodes, relations or [], scope["root_ids"], scope["included_ids"], map_id="m1", title="Bản đồ tư duy")


def test_xlsx_has_summary_and_nodes_sheets_with_correct_row_count():
    wb = load_workbook(io.BytesIO(serialize_xlsx(_tree())))
    assert "Summary" in wb.sheetnames
    assert "Nodes" in wb.sheetnames
    nodes_ws = wb["Nodes"]
    header = [c.value for c in nodes_ws[1]]
    assert header == ["node_id", "parent_id", "branch_path", "depth", "order", "topic", "note"]
    # header + 4 nodes (r, c1, c1a, c2)
    assert nodes_ws.max_row == 5


def test_xlsx_node_ids_parent_relationships_branch_path_depth_order_and_vietnamese_text():
    wb = load_workbook(io.BytesIO(serialize_xlsx(_tree())))
    rows = {row[0].value: row for row in wb["Nodes"].iter_rows(min_row=2)}
    c1a = rows["c1a"]
    assert c1a[1].value == "c1"  # parent_id
    assert c1a[2].value == "Bản đồ tư duy / Kiến trúc hệ thống / Chi tiết A"  # branch_path
    assert c1a[3].value == 2  # depth
    assert isinstance(c1a[4].value, int)  # order
    assert c1a[5].value == "Chi tiết A"  # topic (Vietnamese diacritics intact)


def test_xlsx_citations_sheet_only_appears_when_requested_and_present():
    with_cit = load_workbook(io.BytesIO(serialize_xlsx(_tree(), include_citations=True)))
    assert "Citations" in with_cit.sheetnames
    rows = list(with_cit["Citations"].iter_rows(min_row=2, values_only=True))
    assert rows == [("c1", "Kiến trúc hệ thống", "doc1#p3")]

    without_cit = load_workbook(io.BytesIO(serialize_xlsx(_tree(), include_citations=False)))
    assert "Citations" not in without_cit.sheetnames

    no_citations_tree = _tree([{**n, "chunk_refs": []} for n in _nodes()])
    no_sheet = load_workbook(io.BytesIO(serialize_xlsx(no_citations_tree, include_citations=True)))
    assert "Citations" not in no_sheet.sheetnames  # nothing to show -> sheet omitted, not empty


def test_xlsx_relations_sheet_only_appears_when_requested_and_present():
    relations = [{"source": "c1a", "target": "c2", "type": "relates_to", "label": "liên quan"}]
    tree_with_rel = _tree(relations=relations)
    wb = load_workbook(io.BytesIO(serialize_xlsx(tree_with_rel, include_relations=True)))
    assert "Relations" in wb.sheetnames
    row = list(wb["Relations"].iter_rows(min_row=2, values_only=True))[0]
    assert row == ("c1a", "Chi tiết A", "c2", "Bảo mật", "relates_to", "liên quan")

    wb_excluded = load_workbook(io.BytesIO(serialize_xlsx(tree_with_rel, include_relations=False)))
    assert "Relations" not in wb_excluded.sheetnames

    no_rel_tree = _tree()
    wb_none = load_workbook(io.BytesIO(serialize_xlsx(no_rel_tree, include_relations=True)))
    assert "Relations" not in wb_none.sheetnames


def test_xlsx_excludes_scope_outside_selection():
    nodes = _nodes()
    scope = resolve_export_scope(nodes, scope_type="current_branch", selected_node_id="c1")
    tree = build_export_tree(nodes, [], scope["root_ids"], scope["included_ids"], title="T")
    wb = load_workbook(io.BytesIO(serialize_xlsx(tree)))
    topics = [row[0] for row in wb["Nodes"].iter_rows(min_row=2, min_col=6, max_col=6, values_only=True)]
    assert "Bảo mật" not in topics
    assert "Chi tiết A" in topics
