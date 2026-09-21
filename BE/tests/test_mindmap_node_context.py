from app.domains.mindmap.context import build_node_context


def _record():
    return {
        "id": "map-1",
        "schema_version": 2,
        "nodes": [
            {"id": "n1", "title": "Topic", "kind": "idea", "note": "Persisted note", "chunk_refs": ["7"]},
            {"id": "n2", "title": "Other", "kind": "detail", "chunk_refs": []},
        ],
        "relations": [{"source": "n1", "target": "n2", "type": "supports", "label": "supports"}],
        "generator": {"degraded": False, "missing": []},
    }


def test_maps_persisted_citation_and_relation_without_generation():
    calls = []
    result = build_node_context(
        _record(), "n1",
        chunk_meta=lambda ref: {"source_stem": "doc-a", "heading_path": "Part 1"},
        chunk_text=lambda ref: calls.append(ref) or "verified excerpt",
        source_info=lambda stem: {"id": "source-1", "filename": "doc-a.pdf"},
        source_allowed=lambda stem: True,
    )
    assert result["topic"] == "Topic"
    assert result["explanation"] == "Persisted note"
    assert result["citations"] == [{
        "source_id": "source-1", "source_name": "doc-a.pdf", "chunk_id": "7",
        "excerpt": "verified excerpt", "location": {"heading_path": "Part 1"},
    }]
    assert result["relations"] == [{"target_node_id": "n2", "type": "supports", "label": "supports", "evidence_refs": []}]
    assert calls == ["7"]


def test_missing_foreign_or_unreadable_chunk_is_degraded_and_not_cited():
    result = build_node_context(
        _record(), "n1",
        chunk_meta=lambda ref: {"source_stem": "foreign"},
        chunk_text=lambda ref: "should not be called",
        source_info=lambda stem: {"id": "foreign"},
        source_allowed=lambda stem: False,
    )
    assert result["citations"] == []
    assert result["degraded"] is True
    assert "chunk:7" in result["missing"]


def test_invalid_node_returns_no_context():
    assert build_node_context(
        _record(), "missing", chunk_meta=lambda ref: {}, chunk_text=lambda ref: None,
        source_info=lambda stem: {}, source_allowed=lambda stem: True,
    ) is None


def test_v2_node_without_refs_is_honest_empty_state():
    result = build_node_context(
        _record(), "n2", chunk_meta=lambda ref: {}, chunk_text=lambda ref: None,
        source_info=lambda stem: {}, source_allowed=lambda stem: True,
    )
    assert result["citations"] == []
    assert result["missing"] == ["citations"]
    assert result["degraded"] is True

