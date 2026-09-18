from services.mindmap.pipeline.v2_constraints import validate_hierarchy


def make_tree(branches=5, children=2):
    nodes = [{"id": "root", "parent": None, "kind": "root", "title": "Root", "order": 0}]
    for branch in range(branches):
        branch_id = f"b{branch}"
        nodes.append({
            "id": branch_id, "parent": "root", "kind": "section",
            "title": f"Branch {branch}", "order": branch,
        })
        for child in range(children):
            nodes.append({
                "id": f"{branch_id}-c{child}", "parent": branch_id,
                "kind": "idea", "title": f"Child {child}", "order": child,
            })
    return nodes


def test_exactly_five_and_eight_top_level_branches_are_valid():
    assert validate_hierarchy(make_tree(5))["valid"]
    assert validate_hierarchy(make_tree(8))["valid"]


def test_fewer_than_five_top_level_branches_is_incomplete():
    report = validate_hierarchy(make_tree(4))
    assert not report["valid"]
    assert "V2_TOP_LEVEL_BRANCHES:4" in report["issues"]


def test_more_than_eight_top_level_branches_is_incomplete():
    report = validate_hierarchy(make_tree(9))
    assert not report["valid"]
    assert "V2_TOP_LEVEL_BRANCHES:9" in report["issues"]


def test_depth_over_three_is_incomplete():
    nodes = make_tree(5)
    nodes.append({"id": "deep", "parent": "b0-c0", "kind": "detail", "title": "Too deep"})
    nodes.append({"id": "deeper", "parent": "deep", "kind": "detail", "title": "Too deep"})
    report = validate_hierarchy(nodes)
    assert not report["valid"]
    assert any(issue.startswith("V2_MAX_DEPTH:") for issue in report["issues"])


def test_non_leaf_child_cardinality_is_checked_but_leaf_zero_is_valid():
    one_child = make_tree(5)
    one_child.append({"id": "extra", "parent": "b0", "kind": "idea", "title": "Only one"})
    one_child = [
        node for node in one_child
        if node["id"] not in {"b0-c0", "b0-c1"}
    ]
    report = validate_hierarchy(one_child)
    assert "V2_CHILDREN_CARDINALITY:b0:1" in report["issues"]

    six_children = make_tree(5)
    for child in range(2, 6):
        six_children.append({
            "id": f"b0-c{child}", "parent": "b0", "kind": "idea",
            "title": f"Child {child}", "order": child,
        })
    report = validate_hierarchy(six_children)
    assert "V2_CHILDREN_CARDINALITY:b0:6" in report["issues"]

    leaf = make_tree(5)
    leaf.append({"id": "empty", "parent": "b0", "kind": "idea", "title": "Leaf"})
    assert validate_hierarchy(leaf)["valid"]


def test_rich_map_minimum_and_topic_length_are_explicit():
    report = validate_hierarchy(make_tree(5), require_rich_size=True)
    assert "V2_RICH_MAP_TOO_SMALL:16" not in report["issues"]

    nodes = make_tree(5)
    nodes[1]["title"] = "x" * 101
    report = validate_hierarchy(nodes)
    assert any(issue.startswith("V2_TOPIC_TOO_LONG:b0") for issue in report["issues"])


def test_order_and_ids_are_stable_and_citations_are_not_touched():
    nodes = make_tree(5)
    nodes[1]["chunk_refs"] = ["chunk-a", "chunk-b"]
    first = validate_hierarchy(nodes)
    second = validate_hierarchy(list(reversed(nodes)))
    assert first["branch_ids"] == second["branch_ids"]
    assert first["depths"] == second["depths"]
    assert nodes[1]["chunk_refs"] == ["chunk-a", "chunk-b"]
