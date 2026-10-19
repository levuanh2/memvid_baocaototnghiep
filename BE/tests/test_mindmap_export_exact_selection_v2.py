from services.mindmap.export.scope import resolve_export_scope
from services.mindmap.export.tree import build_export_tree


def _nodes():
    return [
        {"id": "root", "parent": None, "kind": "root", "title": "Root", "order": 0},
        {"id": "left", "parent": "root", "title": "Left", "order": 0},
        {"id": "p", "parent": "left", "title": "P", "order": 0},
        {"id": "a", "parent": "p", "title": "A", "order": 0},
        {"id": "b", "parent": "p", "title": "B", "order": 1},
        {"id": "c", "parent": "p", "title": "C", "order": 2},
        {"id": "c1", "parent": "c", "title": "C1", "order": 0},
        {"id": "left-unused", "parent": "left", "title": "Left unused", "order": 1},
        {"id": "right", "parent": "root", "title": "Right", "order": 1},
        {"id": "r1", "parent": "right", "title": "R1", "order": 0},
    ]


def _exact(*ids):
    return resolve_export_scope(
        _nodes(), scope_type="selected_branches",
        selected_branch_root_ids=list(ids), include_descendants=False,
    )


def test_siblings_use_parent_lca_without_global_root_or_unchecked_sibling():
    scope = _exact("a", "b")
    assert scope["explicit_selected_ids"] == ["a", "b"]
    assert scope["included_ids"] == {"a", "b"}
    assert scope["context_ids"] == {"p"}
    assert scope["presentation_root_id"] == "p"
    assert scope["render_ids"] == {"p", "a", "b"}


def test_parent_and_child_remain_explicit_without_subtree_absorption():
    scope = _exact("p", "a")
    assert scope["explicit_selected_ids"] == ["p", "a"]
    assert scope["included_ids"] == {"p", "a"}
    assert scope["context_ids"] == set()
    assert scope["presentation_root_id"] == "p"


def test_single_node_has_no_automatic_ancestors_or_descendants():
    scope = _exact("a")
    assert scope["render_ids"] == {"a"}
    assert scope["presentation_root_id"] == "a"


def test_cross_side_selection_requires_global_root_context():
    scope = _exact("a", "r1")
    assert scope["presentation_root_id"] == "root"
    assert scope["context_ids"] == {"root", "left", "p", "right"}


def test_deep_selection_uses_lowest_shared_ancestor_and_only_needed_intermediates():
    scope = _exact("a", "c1")
    assert scope["presentation_root_id"] == "p"
    assert scope["included_ids"] == {"a", "c1"}
    assert scope["context_ids"] == {"p", "c"}
    assert scope["render_ids"] == {"p", "a", "c", "c1"}


def test_export_tree_is_rerooted_at_presentation_root_and_filters_relations():
    scope = _exact("a", "b")
    tree = build_export_tree(
        _nodes(),
        [
            {"source": "a", "target": "b", "label": "kept"},
            {"source": "a", "target": "c", "label": "dropped"},
        ],
        scope["root_ids"], scope["included_ids"],
        context_ids=scope["context_ids"],
        presentation_root_id=scope["presentation_root_id"],
    )
    assert [node["node_id"] for node in tree["roots"]] == ["p"]
    assert [node["node_id"] for node in tree["roots"][0]["children"]] == ["a", "b"]
    assert tree["relations"] == [{"source": "a", "target": "b", "type": "relates_to", "label": "kept"}]


def test_explicit_legacy_descendant_mode_is_unchanged():
    scope = resolve_export_scope(
        _nodes(), scope_type="selected_branches",
        selected_branch_root_ids=["p", "a"], include_descendants=True,
    )
    assert scope["root_ids"] == ["p"]
    assert scope["included_ids"] == {"p", "a", "b", "c", "c1"}
