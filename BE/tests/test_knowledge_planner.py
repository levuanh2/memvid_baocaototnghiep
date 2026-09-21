import json

import services.mindmap.pipeline.knowledge_planner as kp


def _chunks():
    return [{"chunk_keys": ["0"], "text": "a", "heading_path": ""},
            {"chunk_keys": ["1"], "text": "b", "heading_path": ""}]


def test_plan_global_degrades_when_skip_model_load(monkeypatch):
    monkeypatch.setenv("SKIP_MODEL_LOAD", "1")
    plan, degraded = kp.plan_global(_chunks(), {}, model="m")
    assert plan is None and degraded is True


def test_plan_global_degrades_on_empty_chunks(monkeypatch):
    monkeypatch.delenv("SKIP_MODEL_LOAD", raising=False)
    plan, degraded = kp.plan_global([], {}, model="m")
    assert plan is None and degraded is True


def test_plan_global_degrades_on_malformed_json(monkeypatch):
    monkeypatch.delenv("SKIP_MODEL_LOAD", raising=False)
    monkeypatch.setattr(kp, "ask_ai", lambda *a, **k: "not json at all {{{")
    plan, degraded = kp.plan_global(_chunks(), {}, model="m")
    assert plan is None and degraded is True


def test_plan_global_degrades_when_model_raises(monkeypatch):
    monkeypatch.delenv("SKIP_MODEL_LOAD", raising=False)
    def boom(*a, **k):
        raise RuntimeError("provider down")
    monkeypatch.setattr(kp, "ask_ai", boom)
    plan, degraded = kp.plan_global(_chunks(), {}, model="m")
    assert plan is None and degraded is True


def test_plan_global_drops_groups_referencing_unknown_chunk_ids(monkeypatch):
    monkeypatch.delenv("SKIP_MODEL_LOAD", raising=False)
    payload = {"central_subject": "x", "groups": [
        {"name": "Real", "chunk_ids": ["0"]},
        {"name": "Bogus", "chunk_ids": ["99"]},  # no such chunk — must be dropped, not crash
    ], "relations": []}
    monkeypatch.setattr(kp, "ask_ai", lambda *a, **k: json.dumps(payload))
    plan, degraded = kp.plan_global(_chunks(), {}, model="m")
    assert degraded is False
    assert [g["name"] for g in plan["groups"]] == ["Real"]


def test_plan_global_drops_relations_with_unknown_group_or_invalid_type(monkeypatch):
    monkeypatch.delenv("SKIP_MODEL_LOAD", raising=False)
    payload = {"central_subject": "x", "groups": [
        {"name": "A", "chunk_ids": ["0"]}, {"name": "B", "chunk_ids": ["1"]},
    ], "relations": [
        {"source_group": "A", "target_group": "B", "type": "cause_effect", "label": "ok"},
        {"source_group": "A", "target_group": "Nonexistent", "type": "cause_effect", "label": "drop me"},
        {"source_group": "A", "target_group": "B", "type": "not_a_real_type", "label": "drop me too"},
        {"source_group": "A", "target_group": "A", "type": "cause_effect", "label": "self edge, drop"},
    ]}
    monkeypatch.setattr(kp, "ask_ai", lambda *a, **k: json.dumps(payload))
    plan, degraded = kp.plan_global(_chunks(), {}, model="m")
    assert degraded is False
    assert len(plan["relations"]) == 1
    assert plan["relations"][0]["label"] == "ok"


def test_plan_global_degrades_when_response_has_no_usable_groups(monkeypatch):
    monkeypatch.delenv("SKIP_MODEL_LOAD", raising=False)
    payload = {"central_subject": "x", "groups": [], "relations": []}
    monkeypatch.setattr(kp, "ask_ai", lambda *a, **k: json.dumps(payload))
    plan, degraded = kp.plan_global(_chunks(), {}, model="m")
    assert plan is None and degraded is True
