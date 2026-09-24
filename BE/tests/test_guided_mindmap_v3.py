from app.domains.mindmap.guided import intent_hash, normalize_intent, suggest_topics
from services.mindmap.pipeline.schema import build_record, repair_v3_record, validate_v3_record
from services.mindmap.pipeline.guided_planner import plan_guided


def test_intent_hash_changes_when_layout_version_bumps(monkeypatch):
    """2026-09-24: a future schema/layout/profile bump must bust every
    existing cached content_hash, so a request that now expects the new
    shape can never be satisfied by an old-shape cached record. Before this,
    intent_hash only salted with the literal "guided-v3" -- constant across
    any schema/layout/profile change, so it could not have caught this."""
    import services.mindmap.pipeline.schema as schema_mod
    intent = {"preset": "overview", "detail_level": "balanced", "instruction": "",
              "selected_topic_ids": [], "selected_topics": [], "locale": "vi"}
    before = intent_hash("base-hash", intent)
    monkeypatch.setattr(schema_mod, "LAYOUT_VERSION", "side-balanced-v3")
    after = intent_hash("base-hash", intent)
    assert before != after


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


def test_schema_v3_repair_is_bounded_and_does_not_invent_evidence():
    record = {"nodes": [{"id": "r", "parent": None, "kind": "root", "title": "Root"},
                         {"id": "a", "parent": "missing", "kind": "idea", "title": "A", "chunk_refs": ["c1"]}],
              "relations": [{"source": "a", "target": "missing", "type": "related"}],
              "generation_config": {"available_chunk_refs": ["c1"]}}
    repaired, issues = repair_v3_record(record, max_attempts=2)
    assert "v3_orphan_node" in issues
    assert repaired["nodes"][1]["parent"] == "r"
    assert repaired["relations"] == []
    assert repaired["nodes"][1]["chunk_refs"] == ["c1"]


def _corpus():
    return {"chunks": [
        {"chunk_keys": ["1"], "source_stem": "a", "heading_path": "Deploy / Build", "text": "Build và kiểm thử quy trình."},
        {"chunk_keys": ["2"], "source_stem": "a", "heading_path": "Deploy / Release", "text": "Release theo từng bước."},
        {"chunk_keys": ["3"], "source_stem": "b", "heading_path": "Architecture / API", "text": "API và kiến trúc dịch vụ."},
        {"chunk_keys": ["4"], "source_stem": "b", "heading_path": "Architecture / Tradeoffs", "text": "So sánh tradeoff giữa hai hướng."},
    ]}


def test_guided_planner_changes_queries_and_budget_by_intent():
    process_nodes, _, process_plan, _ = plan_guided({**_corpus(), "generation_intent": {"preset": "process", "detail_level": "compact", "instruction": "Tập trung triển khai"}})
    compare_nodes, compare_relations, compare_plan, _ = plan_guided({**_corpus(), "generation_intent": {"preset": "comparison", "detail_level": "detailed", "instruction": "So sánh A và B"}})
    assert process_plan["retrieval_queries"] != compare_plan["retrieval_queries"]
    assert process_plan["node_budget"] < compare_plan["node_budget"]
    assert any(rel["type"] == "contrast" for rel in compare_relations) or len(compare_nodes) >= 2


def test_guided_planner_keeps_multiple_sources_and_evidence_on_nodes():
    nodes, _relations, plan, missing = plan_guided({**_corpus(), "generation_intent": {"preset": "overview", "detail_level": "balanced"}})
    assert not missing
    assert plan["max_depth"] == 3
    assert {ref for node in nodes for ref in node.get("chunk_refs", [])} >= {"1", "2", "3", "4"}
