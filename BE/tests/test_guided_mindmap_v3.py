from app.domains.mindmap.guided import normalize_intent, suggest_topics
from services.mindmap.pipeline.schema import build_record, validate_v3_record


def test_guided_intent_preserves_instruction_and_defaults():
    intent = normalize_intent({"instruction": "Tập trung vào quy trình", "preset": "process"})
    assert intent["instruction"] == "Tập trung vào quy trình"
    assert intent["preset"] == "process"
    assert intent["detail_level"] == "balanced"


def test_suggestions_are_grounded_in_selected_chunks():
    suggestions = suggest_topics({"chunks": [
        {"chunk_id": 7, "heading_path": "Triển khai / Kiểm thử", "text": "x"},
        {"chunk_id": 8, "heading_path": "Triển khai / Phát hành", "text": "y"},
    ]})
    assert suggestions
    assert all(item["evidence_refs"] for item in suggestions)
    assert all(ref["chunk_id"] in {"7", "8"} for item in suggestions for ref in item["evidence_refs"])


def test_schema_v3_carries_guided_intent_and_validator():
    record = build_record(title="Tài liệu", sources=["doc"], nodes=[
        {"id": "root", "parent": None, "kind": "root", "title": "Tài liệu"},
        {"id": "a", "parent": "root", "kind": "section", "title": "Quy trình"},
    ], relations=[], content_hash_value="h", model="test", elapsed_sec=0,
    degraded_missing=[], generation_intent={"preset": "process"}, job_id="job-1")
    assert record["schema_version"] == 3
    assert record["generation_profile"] == "guided-learning-map-v3"
    assert record["generator"]["generation_intent"]["preset"] == "process"
    assert validate_v3_record(record) == []


def test_schema_v3_validator_flags_duplicate_siblings_and_bad_relation():
    record = {"nodes": [{"id": "r", "parent": None, "title": "R"},
                        {"id": "a", "parent": "r", "title": "Same"},
                        {"id": "b", "parent": "r", "title": "Same"}],
              "relations": [{"source": "a", "target": "missing"}]}
    assert "v3_duplicate_sibling" in validate_v3_record(record)
    assert "v3_relation_endpoint" in validate_v3_record(record)
