"""PR B fail-before: exact-set semantics for export scope (ancestor context,
parent+child dedupe, multi-branch union, connector edges, counter), backend side.
Mirrors FE/src/utils/mindmapExportScope.v3.test.js's tree exactly:

    root
    |- A
    |  |- A1
    |  |  `- A1a
    |  `- A2
    `- B
"""
import pytest

from services.mindmap.export.scope import (
    ExportScopeError,
    NoSelectionError,
    UnknownNodeIdError,
    resolve_export_scope,
)


def _nodes():
    return [
        {"id": "root", "parent": None, "kind": "root", "title": "Root", "order": 0},
        {"id": "A", "parent": "root", "kind": "section", "title": "A", "order": 0},
        {"id": "A1", "parent": "A", "kind": "section", "title": "A1", "order": 0},
        {"id": "A1a", "parent": "A1", "kind": "idea", "title": "A1a", "order": 0},
        {"id": "A2", "parent": "A", "kind": "idea", "title": "A2", "order": 1},
        {"id": "B", "parent": "root", "kind": "section", "title": "B", "order": 1},
    ]


_RELATIONS = [
    {"source": "A1", "target": "B", "type": "relates_to"},   # dangling once B is excluded
    {"source": "A1", "target": "A1a", "type": "relates_to"},  # both ends included when A1 is selected
]


class TestCurrentBranchAncestorContext:
    def test_selecting_a_includes_root_as_context_excludes_b(self):
        res = resolve_export_scope(_nodes(), scope_type="current_branch", selected_node_id="A")
        assert res["root_ids"] == ["A"]
        assert sorted(res["included_ids"]) == ["A", "A1", "A1a", "A2"]
        assert "context_ids" in res
        assert list(res["context_ids"]) == ["root"]
        assert "B" not in (res["included_ids"] | res["context_ids"])

    def test_selecting_a1_includes_root_and_a_as_context_excludes_a2_and_b(self):
        res = resolve_export_scope(_nodes(), scope_type="current_branch", selected_node_id="A1")
        assert res["root_ids"] == ["A1"]
        assert sorted(res["included_ids"]) == ["A1", "A1a"]
        assert sorted(res["context_ids"]) == ["A", "root"]
        rendered = res["included_ids"] | res["context_ids"]
        assert "A2" not in rendered
        assert "B" not in rendered

    def test_selecting_leaf_a1a_gives_the_same_context_as_a1_plus_a1_itself(self):
        res = resolve_export_scope(_nodes(), scope_type="current_branch", selected_node_id="A1a")
        assert sorted(res["included_ids"]) == ["A1a"]
        assert sorted(res["context_ids"]) == ["A", "A1", "root"]


class TestSelectedBranchesUnionAndDedupe:
    def test_two_sibling_branches_union_without_pulling_in_b(self):
        res = resolve_export_scope(_nodes(), scope_type="selected_branches", selected_branch_root_ids=["A1", "A2"])
        assert sorted(res["root_ids"]) == ["A1", "A2"]
        assert sorted(res["included_ids"]) == ["A1", "A1a", "A2"]
        assert sorted(res["context_ids"]) == ["A", "root"]

    def test_parent_and_child_selection_dedupes_child_out_of_roots(self):
        res = resolve_export_scope(_nodes(), scope_type="selected_branches", selected_branch_root_ids=["A", "A1"])
        assert res["root_ids"] == ["A"]  # already correct today
        assert sorted(res["included_ids"]) == ["A", "A1", "A1a", "A2"]

    def test_branches_on_both_sides_union_root_is_shared_context_once(self):
        res = resolve_export_scope(_nodes(), scope_type="selected_branches", selected_branch_root_ids=["A1", "B"])
        assert sorted(res["root_ids"]) == ["A1", "B"]
        assert sorted(res["included_ids"]) == ["A1", "A1a", "B"]
        assert sorted(res["context_ids"]) == ["A", "root"]

    def test_duplicate_ids_collapse_to_one_root(self):
        res = resolve_export_scope(_nodes(), scope_type="selected_branches", selected_branch_root_ids=["A1", "A1", "A1"])
        assert res["root_ids"] == ["A1"]

    def test_missing_id_raises_instead_of_silently_falling_back(self):
        with pytest.raises(UnknownNodeIdError):
            resolve_export_scope(_nodes(), scope_type="selected_branches", selected_branch_root_ids=["does-not-exist"])

    def test_no_selection_raises_instead_of_silently_defaulting_to_full(self):
        with pytest.raises(NoSelectionError):
            resolve_export_scope(_nodes(), scope_type="selected_branches", selected_branch_root_ids=[])

    def test_connector_edges_only_both_ends_in_render_set_survive(self):
        res = resolve_export_scope(_nodes(), scope_type="selected_branches", selected_branch_root_ids=["A1"])
        render_set = res["included_ids"] | res["context_ids"]
        surviving = [r for r in _RELATIONS if r["source"] in render_set and r["target"] in render_set]
        assert surviving == [{"source": "A1", "target": "A1a", "type": "relates_to"}]


class TestFullScope:
    def test_full_scope_root_is_the_map_root_no_separate_context_layer(self):
        res = resolve_export_scope(_nodes(), scope_type="full")
        assert res["root_ids"] == ["root"]
        assert sorted(res["included_ids"]) == ["A", "A1", "A1a", "A2", "B", "root"]
