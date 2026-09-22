"""P2 fix: live eval found the model repeatably (3/3 runs) emitting a generic
relation between root and a branch that duplicates the parent-child edge
already implied by the tree. Deterministic filter, not prompt-only."""
from services.mindmap.pipeline.schema import is_redundant_with_hierarchy, validate_relations

NODES = [
    {"id": "n0", "parent": None, "kind": "root", "title": "Root"},
    {"id": "n1", "parent": "n0", "kind": "section", "title": "A"},
    {"id": "n2", "parent": "n0", "kind": "section", "title": "B"},
    {"id": "n3", "parent": "n1", "kind": "idea", "title": "A-child"},
]


def test_redundant_parent_child_duplicate_removed():
    rel = {"source": "n1", "target": "n3", "type": "part_of", "label": "thuộc về"}
    assert is_redundant_with_hierarchy(rel, NODES) is True
    assert validate_relations([rel], NODES) == []


def test_meaningful_causal_relation_between_adjacent_nodes_preserved():
    rel = {"source": "n3", "target": "n1", "type": "cause_effect", "label": "ảnh hưởng tới"}
    assert is_redundant_with_hierarchy(rel, NODES) is False
    out = validate_relations([rel], NODES)
    assert len(out) == 1 and out[0]["type"] == "cause_effect"


def test_meaningful_sibling_contrast_relation_preserved():
    rel = {"source": "n1", "target": "n2", "type": "contrast", "label": "đối lập"}
    assert is_redundant_with_hierarchy(rel, NODES) is False
    out = validate_relations([rel], NODES)
    assert len(out) == 1 and out[0]["type"] == "contrast"


def test_root_generic_relation_removed_even_when_not_a_direct_edge():
    """Root's relationship to any descendant is already fully implied by the
    tree, at any depth — not just its immediate children."""
    rel = {"source": "n0", "target": "n3", "type": "relates_to", "label": "liên quan"}
    assert is_redundant_with_hierarchy(rel, NODES) is True
    assert validate_relations([rel], NODES) == []


def test_root_meaningful_relation_type_survives():
    """The root-specific rule targets generic types only — a genuinely
    independent semantic claim from root is not banned outright."""
    rel = {"source": "n0", "target": "n2", "type": "prerequisite", "label": "cần trước"}
    assert is_redundant_with_hierarchy(rel, NODES) is False


def test_exact_tree_edge_with_generic_type_still_removed():
    rel = {"source": "n0", "target": "n1", "type": "relates_to", "label": "liên quan"}
    assert validate_relations([rel], NODES) == []


def test_exact_tree_edge_with_meaningful_type_now_survives():
    """Correction to a pre-existing bug found while implementing this fix: the
    old check blindly stripped ANY parent-child relation regardless of type,
    which contradicted the spec's own example (a child "improves" its parent
    must survive). Only generic-typed hierarchy-restating relations are
    redundant — a real semantic claim between adjacent nodes is not."""
    rel = {"source": "n1", "target": "n0", "type": "leads_to", "label": "dẫn tới"}
    out = validate_relations([rel], NODES)
    assert len(out) == 1 and out[0]["type"] == "leads_to"
