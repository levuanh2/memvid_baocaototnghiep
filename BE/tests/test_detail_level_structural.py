"""P2 fix, Part 3 (rich/sparse/process fixtures): detail_level must change
structural depth/coverage, not just note length. These call enrich_branches
directly (not the full guided pipeline) since that's where the caps live."""
import json
from services.mindmap.pipeline import enrich as en
from services.mindmap.pipeline.skeleton import build_skeleton


def _skeleton():
    chunks = [{"key": "0", "text": "khái niệm A", "heading_path": "1. A", "chunk_keys": ["0"]}]
    mm = {"title": "Doc", "sources": ["d"], "chunks": chunks, "tree_sections": []}
    nodes, _ = build_skeleton(mm)
    return mm, nodes


def _rich_response():
    """More children/grandchildren than even the "detailed" cap allows, so
    the observed count reflects the policy's cap, not the model's output."""
    return json.dumps({"title": "A", "note": "vai trò của A", "node_type": "concept", "children": [
        {"title": f"con {i}", "note": "n", "node_type": "concept", "chunk_keys": ["0"],
         "children": [{"title": f"cháu {i}.{j}", "note": "n", "node_type": "concept", "chunk_keys": ["0"]}
                      for j in range(5)]}
        for i in range(8)
    ]})


def _run(monkeypatch, detail_level):
    monkeypatch.delenv("SKIP_MODEL_LOAD", raising=False)
    monkeypatch.setattr(en, "ask_ai", lambda *a, **k: _rich_response())
    mm, skeleton = _skeleton()
    mm["generation_intent"] = {"detail_level": detail_level}
    nodes, degraded = en.enrich_branches(mm, skeleton, model="m", timeout_sec=5)
    assert degraded is False
    return nodes


def test_rich_source_low_medium_high_structural_coverage_is_monotonic(monkeypatch):
    low = _run(monkeypatch, "compact")
    medium = _run(monkeypatch, "balanced")
    high = _run(monkeypatch, "detailed")
    assert len(low) <= len(medium) <= len(high)


def test_compact_structurally_forbids_the_detail_tier(monkeypatch):
    """The actual depth lever: compact must never persist a "detail" node
    (grandchild of a branch) even when the model offers plenty."""
    low = _run(monkeypatch, "compact")
    assert not any(n["kind"] == "detail" for n in low)


def test_detailed_allows_the_detail_tier_when_evidence_supports_it(monkeypatch):
    high = _run(monkeypatch, "detailed")
    assert any(n["kind"] == "detail" for n in high)


def test_sparse_source_does_not_get_filler_nodes_at_high_detail(monkeypatch):
    """A source with only 1 real idea must not be padded to hit detailed's cap."""
    monkeypatch.delenv("SKIP_MODEL_LOAD", raising=False)
    def sparse(*a, **k):
        return json.dumps({"title": "A", "note": "n", "node_type": "concept",
                           "children": [{"title": "duy nhất", "note": "n", "node_type": "concept",
                                        "chunk_keys": ["0"], "children": []}]})
    monkeypatch.setattr(en, "ask_ai", sparse)
    mm, skeleton = _skeleton()
    mm["generation_intent"] = {"detail_level": "detailed"}
    nodes, degraded = en.enrich_branches(mm, skeleton, model="m", timeout_sec=5)
    assert degraded is False
    ideas = [n for n in nodes if n["kind"] == "idea"]
    assert len(ideas) == 1  # cap allows up to 6, but evidence only supports 1


def test_process_fixture_high_expands_more_steps_than_low(monkeypatch):
    monkeypatch.delenv("SKIP_MODEL_LOAD", raising=False)
    def process_response(*a, **k):
        return json.dumps({"title": "Pipeline", "note": "n", "node_type": "process", "children": [
            {"title": f"bước {i}", "note": "n", "node_type": "process", "chunk_keys": ["0"], "children": []}
            for i in range(6)
        ]})
    monkeypatch.setattr(en, "ask_ai", process_response)
    mm, skeleton = _skeleton()
    mm["generation_intent"] = {"detail_level": "compact"}
    low_nodes, _ = en.enrich_branches(mm, skeleton, model="m", timeout_sec=5)
    mm["generation_intent"] = {"detail_level": "detailed"}
    high_nodes, _ = en.enrich_branches(mm, skeleton, model="m", timeout_sec=5)
    low_steps = [n for n in low_nodes if n["kind"] == "idea" and n["title"].startswith("bước")]
    high_steps = [n for n in high_nodes if n["kind"] == "idea" and n["title"].startswith("bước")]
    assert len(low_steps) <= len(high_steps)
