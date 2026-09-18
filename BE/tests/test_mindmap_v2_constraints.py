from services.mindmap.pipeline.v2_constraints import validate_hierarchy


def node(node_id, parent, order=0, title=None):
    return {
        "id": node_id,
        "parent": parent,
        "kind": "root" if parent is None else "idea",
        "title": title or node_id,
        "order": order,
        "chunk_refs": [f"chunk-{node_id}"],
        "note": f"full note for {node_id}",
    }


def valid_tree(branches=5):
    nodes = [node("root", None)]
    for branch_index in range(branches):
        branch_id = f"b{branch_index}"
        nodes.append(node(branch_id, "root", branch_index))
        for child_index in range(2):
            nodes.append(node(f"{branch_id}-c{child_index}", branch_id, child_index))
    return nodes


def test_exactly_five_and_eight_top_level_branches_are_valid():
    assert validate_hierarchy(valid_tree(5))["valid"]
    assert validate_hierarchy(valid_tree(8))["valid"]


def test_fewer_than_five_branches_is_incomplete():
    report = validate_hierarchy(valid_tree(4))
    assert not report["valid"]
    assert "V2_TOP_LEVEL_BRANCHES:4" in report["issues"]


def test_more_than_eight_branches_is_incomplete_without_silent_truncation():
    report = validate_hierarchy(valid_tree(9))
    assert not report["valid"]
    assert report["top_level_branches"] == 9


def test_depth_over_three_is_incomplete():
    nodes = valid_tree()
    nodes.extend([node("deep1", "b0-c0"), node("deep2", "deep1")])
    report = validate_hierarchy(nodes)
    assert not report["valid"]
    assert any(issue.startswith("V2_MAX_DEPTH:") for issue in report["issues"])


def test_one_child_non_leaf_is_incomplete():
    nodes = valid_tree()
    nodes = [item for item in nodes if item["id"] != "b0-c1"]
    report = validate_hierarchy(nodes)
    assert not report["valid"]
    assert any(issue.startswith("V2_CHILDREN_CARDINALITY:") for issue in report["issues"])


def test_six_children_non_leaf_is_incomplete():
    nodes = valid_tree()
    for index in range(4):
        nodes.append(node(f"extra-{index}", "b0", 2 + index))
    report = validate_hierarchy(nodes)
    assert not report["valid"]
    assert "b0:6" in next(issue for issue in report["issues"] if issue.startswith("V2_CHILDREN_CARDINALITY:"))


def test_zero_child_leaf_is_valid():
    report = validate_hierarchy(valid_tree())
    assert report["cardinality"]["b0-c0"] == 0
    assert report["valid"]


def test_rich_source_requires_fifteen_real_nodes():
    report = validate_hierarchy(valid_tree(), require_rich_size=True)
    assert report["valid"]
    assert "V2_RICH_MAP_TOO_SMALL:16" not in report["issues"]  # 1 + 5 * 3 = 16


def test_topic_length_is_checked_without_dropping_note_or_citation_fields():
    nodes = valid_tree()
    nodes[0]["title"] = "x" * 101
    nodes[0]["note"] = "complete explanation"
    nodes[0]["chunk_refs"] = ["citation-1"]
    report = validate_hierarchy(nodes)
    assert "V2_TOPIC_TOO_LONG:root" in report["issues"]
    assert nodes[0]["note"] == "complete explanation"
    assert nodes[0]["chunk_refs"] == ["citation-1"]


def test_stable_ids_and_semantic_branch_order_are_reported_unchanged():
    nodes = valid_tree()
    first = validate_hierarchy(nodes)
    second = validate_hierarchy(nodes)
    assert first["branch_ids"] == ["b0", "b1", "b2", "b3", "b4"]
    assert first["branch_ids"] == second["branch_ids"]
