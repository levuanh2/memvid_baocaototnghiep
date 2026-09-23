"""Stage 0 diagnostics — observability only, added 2026-09-23 after production
showed `degraded: true` with zero explanation (the "model responded but every
group got filtered" branch never logged anything). These tests prove the new
`log_node_event` calls fire with the right reason/counters for each exit path,
and that no source text / API key ever lands in a logged metadata dict.
"""
import json

import services.mindmap.pipeline.knowledge_planner as kp


def _chunks():
    return [{"chunk_keys": ["0"], "text": "a", "heading_path": "H0"},
            {"chunk_keys": ["1"], "text": "b", "heading_path": "H1"}]


def _capture(monkeypatch):
    events = []
    monkeypatch.setattr(kp, "log_node_event",
                         lambda job_id, node, status, dur, md: events.append(
                             {"job_id": job_id, "node": node, "status": status, "md": md}))
    return events


def _names(events):
    return [e["md"].get("event") for e in events]


# Case A — success
def test_success_emits_full_lifecycle_and_success_event(monkeypatch):
    monkeypatch.delenv("SKIP_MODEL_LOAD", raising=False)
    events = _capture(monkeypatch)
    payload = {"central_subject": "x", "groups": [
        {"name": "A", "chunk_ids": ["0"]}, {"name": "B", "chunk_ids": ["1"]},
    ], "relations": []}
    monkeypatch.setattr(kp, "ask_ai", lambda *a, **k: json.dumps(payload))

    plan, degraded = kp.plan_global(_chunks(), {}, model="m", job_id="job-a")

    assert degraded is False
    assert all(e["job_id"] == "job-a" and e["node"] == "Stage0" for e in events)
    names = _names(events)
    assert "guided_stage0_start" in names
    assert "guided_stage0_model_response" in names
    assert "guided_stage0_parse_result" in names
    assert "guided_stage0_success" in names
    success = next(e for e in events if e["md"].get("event") == "guided_stage0_success")
    assert success["md"]["accepted_groups"] == 2
    assert success["md"]["degraded"] is False


# Case B — all groups filtered (the exact silent production bug)
def test_all_groups_filtered_emits_filter_result_with_counters(monkeypatch):
    monkeypatch.delenv("SKIP_MODEL_LOAD", raising=False)
    events = _capture(monkeypatch)
    payload = {"central_subject": "x", "groups": [
        {"name": "Bogus", "chunk_ids": ["99"]},  # unknown ref, only ref in group
    ], "relations": []}
    monkeypatch.setattr(kp, "ask_ai", lambda *a, **k: json.dumps(payload))

    plan, degraded = kp.plan_global(_chunks(), {}, model="m", job_id="job-b")

    assert plan is None and degraded is True
    filter_result = next(e for e in events if e["md"].get("event") == "guided_stage0_filter_result")
    assert filter_result["md"]["raw_groups"] == 1
    assert filter_result["md"]["accepted_groups"] == 0
    assert filter_result["md"]["rejection_reasons"]["unknown_chunk_ids"] == 1
    assert filter_result["md"]["unknown_refs_sample"] == ["99"]
    degrade_event = next(e for e in events if e["md"].get("event") == "guided_stage0_degraded")
    assert degrade_event["md"]["reason"] == "no_valid_groups"


# Case C — parse failure
def test_json_parse_failure_emits_parse_failure_reason(monkeypatch):
    monkeypatch.delenv("SKIP_MODEL_LOAD", raising=False)
    events = _capture(monkeypatch)
    monkeypatch.setattr(kp, "ask_ai", lambda *a, **k: "not json at all {{{")

    plan, degraded = kp.plan_global(_chunks(), {}, model="m", job_id="job-c")

    assert plan is None and degraded is True
    degrade_event = next(e for e in events if e["md"].get("event") == "guided_stage0_degraded")
    assert degrade_event["md"]["reason"] == "json_parse_failure"
    assert "parse_error_class" in degrade_event["md"]


# Case D — provider failure
def test_provider_exception_emits_provider_exception_reason(monkeypatch):
    monkeypatch.delenv("SKIP_MODEL_LOAD", raising=False)
    events = _capture(monkeypatch)

    def boom(*a, **k):
        raise RuntimeError("provider down")
    monkeypatch.setattr(kp, "ask_ai", boom)

    plan, degraded = kp.plan_global(_chunks(), {}, model="m", job_id="job-d")

    assert plan is None and degraded is True
    degrade_event = next(e for e in events if e["md"].get("event") == "guided_stage0_degraded")
    assert degrade_event["md"]["reason"] == "provider_exception"
    assert degrade_event["md"]["error_class"] == "RuntimeError"


# Case E — no private content in any emitted diagnostic field
def test_diagnostics_never_include_source_text_or_secrets(monkeypatch):
    monkeypatch.delenv("SKIP_MODEL_LOAD", raising=False)
    events = _capture(monkeypatch)
    secret_text = "CONFIDENTIAL DOCUMENT BODY sk-should-never-appear-anywhere"
    payload = {"central_subject": "x", "groups": [{"name": "A", "chunk_ids": ["0"]}], "relations": []}
    monkeypatch.setattr(kp, "ask_ai", lambda *a, **k: json.dumps(payload))

    chunks = [{"chunk_keys": ["0"], "text": secret_text, "heading_path": "H0"}]
    kp.plan_global(chunks, {}, model="m", job_id="job-e")

    blob = json.dumps([e["md"] for e in events], ensure_ascii=False)
    assert secret_text not in blob
    assert "sk-should-never-appear-anywhere" not in blob


def test_job_id_absent_never_logs(monkeypatch):
    events = _capture(monkeypatch)
    payload = {"central_subject": "x", "groups": [{"name": "A", "chunk_ids": ["0"]}], "relations": []}
    monkeypatch.setattr(kp, "ask_ai", lambda *a, **k: json.dumps(payload))
    monkeypatch.delenv("SKIP_MODEL_LOAD", raising=False)

    kp.plan_global(_chunks(), {}, model="m")  # no job_id passed — default ""

    assert events == []
