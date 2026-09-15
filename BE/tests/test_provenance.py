from services.provenance import (
    attach_node_source_stems,
    attach_section_source_stems,
    build_chunk_source_index,
    source_stems_for_refs,
    source_stems_for_single_document,
)
from app.domains.studymap.generator import build_graph


def _mm():
    return {"chunks": [
        {"key": "a", "source_stem": "Doc A.md", "chunk_keys": ["a"]},
        {"key": "b", "source_stem": "Doc B.md", "chunk_keys": ["b"]},
        {"key": "shared", "source_stem": "Doc A.md", "chunk_keys": ["shared"]},
        {"key": "shared-2", "source_stem": "Doc B.md", "chunk_keys": ["shared"]},
    ]}


def test_index_and_single_source_are_canonical_and_sorted():
    index = build_chunk_source_index(_mm())
    assert source_stems_for_refs(["a"], index) == ["doc_a_md"]
    assert source_stems_for_refs(["shared"], index) == ["doc_a_md", "doc_b_md"]
    assert source_stems_for_refs(["shared", "shared"], index) == ["doc_a_md", "doc_b_md"]
    assert source_stems_for_single_document("Doc A.md") == ["doc_a_md"]


def test_unresolved_or_empty_refs_are_absent_not_empty():
    index = build_chunk_source_index(_mm())
    assert source_stems_for_refs([], index) is None
    assert source_stems_for_refs(["missing"], index) is None
    assert attach_node_source_stems([{"id": "n", "chunk_refs": ["missing"]}], _mm()) == [
        {"id": "n", "chunk_refs": ["missing"]}
    ]


def test_attach_preserves_input_and_adds_shared_provenance():
    nodes = [{"id": "n", "chunk_refs": ["shared"]}, {"id": "empty", "chunk_refs": []}]
    out = attach_node_source_stems(nodes, _mm())
    assert "source_stems" not in nodes[0]
    assert out[0]["source_stems"] == ["doc_a_md", "doc_b_md"]
    assert "source_stems" not in out[1]


def test_attach_sections_uses_same_resolver():
    sections = [{"id": "s", "chunk_refs": ["a", "b"]}]
    assert attach_section_source_stems(sections, _mm())[0]["source_stems"] == ["doc_a_md", "doc_b_md"]


def test_single_document_study_map_provenance_is_additive_and_ref_bound():
    rows, _ = build_graph(
        [{"id": "root", "kind": "root", "title": "Root"},
         {"id": "concept", "parent": "root", "kind": "idea", "title": "Concept",
          "chunk_refs": ["1"]}],
        [], {"1": {"chunk_id": "uuid-1", "section_id": "section-1"}},
        source_stems=["Doc A.md"],
    )
    assert "source_stems" not in rows[0]
    assert rows[1]["source_stems"] == ["doc_a_md"]


def test_study_map_provenance_omits_unresolved_chunk_refs():
    rows, _ = build_graph(
        [{"id": "root", "kind": "root", "title": "Root"},
         {"id": "concept", "parent": "root", "kind": "idea", "title": "Concept",
          "chunk_refs": ["missing"]}],
        [], {}, source_stems=["Doc A.md"],
    )
    assert "source_stems" not in rows[1]
