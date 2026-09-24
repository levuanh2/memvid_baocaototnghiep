from services.mindmap.pipeline.structure_critic import compute_diagnostics, repair_duplicate_titles


def _leaf(id_, parent, title, refs=None):
    return {"id": id_, "parent": parent, "kind": "idea", "title": title,
            "chunk_refs": refs or [], "node_type": "concept"}


def _section(id_, parent, title):
    return {"id": id_, "parent": parent, "kind": "section", "title": title,
            "chunk_refs": [], "node_type": "concept"}


def _root(id_="r", title="Root"):
    return {"id": id_, "parent": None, "kind": "root", "title": title, "chunk_refs": []}


def test_summary_tree_smell_detected_when_every_branch_is_one_leaf():
    nodes = [_root()]
    for i in range(4):
        sid = f"s{i}"
        nodes.append(_section(sid, "r", f"Topic {i}"))
        nodes.append(_leaf(f"c{i}", sid, "Tóm tắt", ["x"]))
    diag = compute_diagnostics(nodes, [])
    assert diag["smells"]["summary_tree"] is True
    assert diag["summary_tree_smell"] is True


def test_summary_tree_smell_absent_when_branches_have_real_children():
    nodes = [_root()]
    nodes.append(_section("s0", "r", "JWT structure"))
    nodes.append(_leaf("c0", "s0", "Header", ["1"]))
    nodes.append(_leaf("c1", "s0", "Payload", ["2"]))
    nodes.append(_leaf("c2", "s0", "Signature", ["3"]))
    nodes.append(_section("s1", "r", "Token validation"))
    nodes.append(_leaf("c3", "s1", "Verify signature", ["4"]))
    nodes.append(_leaf("c4", "s1", "Validate expiration", ["5"]))
    diag = compute_diagnostics(nodes, [])
    assert diag["smells"]["summary_tree"] is False


def test_generic_label_smell_flags_known_generic_titles():
    nodes = [_root(), _section("s0", "r", "Tổng quan"), _leaf("c0", "s0", "x", ["1"])]
    diag = compute_diagnostics(nodes, [])
    assert diag["smells"]["generic_label"] is True


def test_lonely_branch_smell_flags_underdeveloped_evidence_rich_branch():
    nodes = [_root(), _section("s0", "r", "Retrieval")]
    nodes.append(_leaf("c0", "s0", "one child holding lots of evidence", ["1", "2", "3", "4", "5"]))
    diag = compute_diagnostics(nodes, [])
    assert diag["smells"]["lonely_branch"] is True


def test_excessive_depth_smell_flags_deep_unhelpful_chains():
    nodes = [_root()]
    prev = "r"
    for i in range(6):
        nid = f"n{i}"
        nodes.append({"id": nid, "parent": prev, "kind": "idea", "title": f"L{i}", "chunk_refs": ["x"]})
        prev = nid
    diag = compute_diagnostics(nodes, [])
    assert diag["smells"]["excessive_depth"] is True
    assert diag["max_depth"] > 4


def test_diagnostics_metrics_shape_on_empty_map():
    diag = compute_diagnostics([], [])
    assert diag["nodes_emitted"] == 0
    assert diag["summary_tree_smell"] is False


def test_evidence_coverage_pct_and_node_type_distribution():
    nodes = [_root(), _section("s0", "r", "A")]
    nodes[1]["node_type"] = "process"
    nodes.append(_leaf("c0", "s0", "with evidence", ["1"]))
    nodes.append(_leaf("c1", "s0", "without evidence", []))
    diag = compute_diagnostics(nodes, [])
    assert diag["evidence_coverage_pct"] == 33.3  # 1 of 3 non-root nodes (section has none) has refs
    assert diag["node_type_distribution"]["process"] == 1


def test_repair_duplicate_titles_merges_exact_sibling_duplicates_preserving_evidence():
    nodes = [_root(), _section("s0", "r", "A"),
            _leaf("c0", "s0", "Same title", ["1"]),
            _leaf("c1", "s0", "Same title", ["2"]),
            _leaf("c2", "s0", "Different", ["3"])]
    repaired, merged_count = repair_duplicate_titles(nodes)
    assert merged_count == 1
    titles = [n["title"] for n in repaired]
    assert titles.count("Same title") == 1
    survivor = next(n for n in repaired if n["title"] == "Same title")
    assert set(survivor["chunk_refs"]) == {"1", "2"}  # evidence from both merged into the survivor
    assert len(repaired) == 4  # one duplicate actually removed


def test_repair_duplicate_titles_no_op_when_no_duplicates():
    nodes = [_root(), _section("s0", "r", "A"), _leaf("c0", "s0", "X", ["1"])]
    repaired, merged_count = repair_duplicate_titles(nodes)
    assert merged_count == 0
    assert repaired == nodes
