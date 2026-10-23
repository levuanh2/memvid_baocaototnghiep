import pytest

from services.mindmap.export.scope import (
    resolve_export_scope, UnknownNodeIdError, NoSelectionError,
)


def _nodes():
    # r
    #  c1 (order 0) -> c1a, c1b
    #  c2 (order 1) -> c2a
    #  c3 (order 2) -> c3a
    return [
        {"id": "r", "parent": None, "kind": "root", "title": "Root", "order": 0},
        {"id": "c1", "parent": "r", "kind": "section", "title": "C1", "order": 0},
        {"id": "c1a", "parent": "c1", "kind": "idea", "title": "C1a", "order": 0},
        {"id": "c1b", "parent": "c1", "kind": "idea", "title": "C1b", "order": 1},
        {"id": "c2", "parent": "r", "kind": "section", "title": "C2", "order": 1},
        {"id": "c2a", "parent": "c2", "kind": "idea", "title": "C2a", "order": 0},
        {"id": "c3", "parent": "r", "kind": "section", "title": "C3", "order": 2},
        {"id": "c3a", "parent": "c3", "kind": "idea", "title": "C3a", "order": 0},
    ]


def test_full_scope_includes_every_node():
    result = resolve_export_scope(_nodes(), scope_type="full")
    assert result["root_ids"] == ["r"]
    assert result["included_ids"] == {"r", "c1", "c1a", "c1b", "c2", "c2a", "c3", "c3a"}


def test_current_branch_scope_includes_only_that_subtree():
    result = resolve_export_scope(_nodes(), scope_type="current_branch", selected_node_id="c1")
    assert result["root_ids"] == ["c1"]
    assert result["included_ids"] == {"c1", "c1a", "c1b"}


def test_current_branch_without_selection_raises():
    with pytest.raises(NoSelectionError):
        resolve_export_scope(_nodes(), scope_type="current_branch")


def test_selected_branches_two_siblings():
    result = resolve_export_scope(_nodes(), scope_type="selected_branches", selected_branch_root_ids=["c1", "c2"])
    assert result["root_ids"] == ["c1", "c2"]
    assert result["included_ids"] == {"c1", "c1a", "c1b", "c2", "c2a"}


def test_selected_branches_parent_child_dedupe():
    result = resolve_export_scope(_nodes(), scope_type="selected_branches", selected_branch_root_ids=["c1a", "c1"])
    assert result["root_ids"] == ["c1"]  # descendant dropped, only ancestor kept


def test_selected_branches_order_independent_of_click_order():
    result = resolve_export_scope(_nodes(), scope_type="selected_branches", selected_branch_root_ids=["c3", "c1"])
    assert result["root_ids"] == ["c1", "c3"]  # re-sorted to document order


def test_selected_branches_three_roots():
    result = resolve_export_scope(_nodes(), scope_type="selected_branches", selected_branch_root_ids=["c1", "c2", "c3"])
    assert result["root_ids"] == ["c1", "c2", "c3"]


def test_unknown_node_id_raises():
    with pytest.raises(UnknownNodeIdError):
        resolve_export_scope(_nodes(), scope_type="current_branch", selected_node_id="does-not-exist")


def test_no_selection_for_selected_branches_raises():
    with pytest.raises(NoSelectionError):
        resolve_export_scope(_nodes(), scope_type="selected_branches", selected_branch_root_ids=[])


def test_include_descendants_false_excludes_children():
    result = resolve_export_scope(_nodes(), scope_type="current_branch", selected_node_id="c1", include_descendants=False)
    assert result["included_ids"] == {"c1"}


def test_exact_selection_can_disable_automatic_parent_context():
    result = resolve_export_scope(
        _nodes(), scope_type="selected_branches",
        selected_branch_root_ids=["c1a", "c2a"], include_descendants=False,
        context_mode="none",
    )
    assert result["explicit_selected_ids"] == ["c1a", "c2a"]
    assert result["context_ids"] == set()
    assert result["render_ids"] == {"c1a", "c2a"}
    assert result["presentation_root_ids"] == ["c1a", "c2a"]


@pytest.mark.parametrize(("explicit", "context", "rendered"), [
    (["c1a"], set(), {"c1a"}),
    (["c1a", "c1b"], {"c1"}, {"c1", "c1a", "c1b"}),
    (["c1", "c2"], {"r"}, {"r", "c1", "c2"}),
    (["c1a", "c2"], {"r", "c1"}, {"r", "c1", "c1a", "c2"}),
])
def test_exact_selection_adds_only_recursive_minimal_parent_context(explicit, context, rendered):
    result = resolve_export_scope(
        _nodes(), scope_type="selected_branches",
        selected_branch_root_ids=explicit, include_descendants=False,
    )
    assert result["explicit_selected_ids"] == explicit
    assert result["context_ids"] == context
    assert result["render_ids"] == rendered


def test_exact_selection_keeps_suppressed_context_separate():
    result = resolve_export_scope(
        _nodes(), scope_type="selected_branches",
        selected_branch_root_ids=["c1a", "c2"], include_descendants=False,
        suppressed_context_ids=["c1"],
    )
    assert result["explicit_selected_ids"] == ["c1a", "c2"]
    assert result["minimal_context_ids"] == {"r", "c1"}
    assert result["context_ids"] == {"r"}
    assert result["suppressed_context_ids"] == {"c1"}
    assert result["render_ids"] == {"r", "c1a", "c2"}
    assert result["presentation_root_ids"] == ["r", "c1a"]


def test_exact_selection_rejects_unknown_suppressed_context_id():
    with pytest.raises(UnknownNodeIdError):
        resolve_export_scope(
            _nodes(), scope_type="selected_branches",
            selected_branch_root_ids=["c1a", "c2"], include_descendants=False,
            suppressed_context_ids=["from-another-map"],
        )
