# BE/tests/test_mindmap_graph.py — graph THẬT, pipeline stub (bài học conftest-mock)
import json
from pathlib import Path
import pytest


def _build(tmp_path, pipeline=None, persist=None, jobs_updates=None):
    from app.graphs.mindmap_graph import build_mindmap_graph
    meta_path = tmp_path / "index.json"
    meta_path.write_text(json.dumps({"0": {"source_stem": "a_docx", "heading_path": "1. Mở đầu"}}), encoding="utf-8")

    def collect_input(index_meta_path, source_names):
        return {"title": "Doc", "sources": ["a_docx"],
                "chunks": [{"key": "0", "text": "t", "heading_path": "1. Mở đầu", "chunk_keys": ["0"]}],
                "tree_sections": []}

    class StubPipeline:
        def skeleton(self, mm):
            return ([{"id": "n0", "parent": None, "kind": "root", "title": "Doc"},
                     {"id": "n1", "parent": "n0", "kind": "section", "title": "1. Mở đầu", "chunk_refs": ["0"]}],
                    "headings")
        def enrich(self, mm, skeleton, progress_cb=None, cancel_cb=None, job_id=""):
            return skeleton, False
        def relations(self, nodes, cancel_cb=None, job_id=""):
            return [], False

    def _jobs_update(job_id, **kw):
        (jobs_updates if jobs_updates is not None else []).append(kw)

    _persist = persist or (lambda r: None)
    return build_mindmap_graph(
        data_dir=tmp_path, index_meta_path=meta_path,
        jobs_update=_jobs_update, collect_input=collect_input,
        pipeline=pipeline or StubPipeline(),
        # Phase D: persist_record now takes a user_id kwarg; absorb it for the stub.
        persist_record=lambda r, **_k: _persist(r),
    )

def test_real_graph_compiles_and_produces_v2_record(tmp_path):
    saved = []
    g = _build(tmp_path, persist=saved.append)
    out = g.invoke({"job_id": "j1", "source_names": ["a_docx"], "progress": 0,
                    "current_node": "", "error": None},
                   config={"configurable": {"thread_id": "j1"}})
    assert out.get("error") is None
    rec = out["result"]
    assert rec["schema_version"] == 2 and rec["nodes"] and "relations" in rec
    assert saved and saved[0]["id"] == rec["id"]

def test_assemble_persist_sets_result_map_id_on_job_row(tmp_path):
    """2026-09-24: assemble_node's final _set_job(status="done", ...) passed
    result=record but never result_map_id, so the durable job row's own
    result_map_id column stayed NULL after every fresh (non-cache-hit)
    completion -- found while tracing a real QA browser job that showed
    status=done, result_map_id=None despite a successfully-persisted map."""
    saved = []
    updates = []
    g = _build(tmp_path, persist=saved.append, jobs_updates=updates)
    out = g.invoke({"job_id": "j3", "source_names": ["a_docx"], "progress": 0,
                    "current_node": "", "error": None},
                   config={"configurable": {"thread_id": "j3"}})
    assert out.get("error") is None
    rec = out["result"]
    done_updates = [u for u in updates if u.get("status") == "done"]
    assert done_updates, "no status=done job update recorded"
    assert done_updates[-1].get("result_map_id") == rec["id"]


def test_cancel_before_enrich_stops_without_persist(tmp_path, monkeypatch):
    from app.domains.jobs import jobs_store as js
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    js.create_job("j2", job_type="mindmap")
    js.request_cancel("j2")
    saved = []
    g = _build(tmp_path, persist=saved.append)
    out = g.invoke({"job_id": "j2", "source_names": ["a_docx"], "progress": 0,
                    "current_node": "", "error": None},
                   config={"configurable": {"thread_id": "j2"}})
    assert out.get("cancelled") is True
    assert saved == []

def test_degraded_stage_flows_to_result(tmp_path):
    class DegradedPipeline:
        def skeleton(self, mm):
            return ([{"id": "n0", "parent": None, "kind": "root", "title": "Doc"},
                     {"id": "n1", "parent": "n0", "kind": "section", "title": "S"}], "headings")
        def enrich(self, mm, sk, progress_cb=None, cancel_cb=None, job_id=""):
            return sk, True
        def relations(self, nodes, cancel_cb=None, job_id=""):
            return [], True
    g = _build(tmp_path, pipeline=DegradedPipeline())
    out = g.invoke({"job_id": "j3", "source_names": ["a_docx"], "progress": 0,
                    "current_node": "", "error": None},
                   config={"configurable": {"thread_id": "j3"}})
    assert out["result"]["generator"]["degraded"] is True
    # This fixture exercises a newly generated V2 record; its one-branch tree is
    # intentionally incomplete, so the structural V2 diagnostics are expected.
    assert set(out["result"]["generator"]["missing"]) == {
        "enrich", "relations", "V2_TOP_LEVEL_BRANCHES:1",
        "V2_CHILDREN_CARDINALITY:n0:1",
    }


def test_guided_end_to_end_carries_diagnostics_and_dedup_repair(tmp_path, monkeypatch):
    """Real graph, guided intent, stub pipeline standing in for a global-plan-
    aware guided_plan — proves AssemblePersist actually wires up (a) the
    bounded duplicate-title repair and (b) Part 19 structural diagnostics on
    a real end-to-end guided run, not just at the unit level."""
    monkeypatch.setenv("SKIP_MODEL_LOAD", "1")  # stub never calls a real provider anyway

    class GuidedStubPipeline:
        def guided_plan(self, mm, job_id=""):
            nodes = [
                {"id": "n0", "parent": None, "kind": "root", "title": "Doc", "chunk_refs": [], "order": 0},
                {"id": "n1", "parent": "n0", "kind": "section", "title": "A", "chunk_refs": ["0"], "order": 0},
                {"id": "n2", "parent": "n1", "kind": "idea", "title": "Dup", "chunk_refs": ["0"], "order": 0},
                {"id": "n3", "parent": "n1", "kind": "idea", "title": "Dup", "chunk_refs": ["0"], "order": 1},
            ]
            config = {"node_budget": 24, "max_depth": 3, "global_plan_used": True, "central_subject": "Doc"}
            return nodes, [], config, []

        def enrich(self, mm, skeleton, progress_cb=None, cancel_cb=None, job_id=""):
            return skeleton, False

        def relations(self, nodes, cancel_cb=None, job_id=""):
            return [], False

    g = _build(tmp_path, pipeline=GuidedStubPipeline())
    out = g.invoke({"job_id": "j4", "source_names": ["a_docx"], "progress": 0,
                    "current_node": "", "error": None,
                    "mm_input": {"title": "Doc", "sources": ["a_docx"],
                                "chunks": [{"chunk_keys": ["0"], "text": "t", "heading_path": "1"}],
                                "generation_intent": {"preset": "overview", "detail_level": "balanced"}}},
                   config={"configurable": {"thread_id": "j4"}})
    rec = out["result"]
    assert rec["schema_version"] == 3
    # bounded dedup repair actually ran: the two "Dup" siblings became one,
    # with both chunk_refs preserved on the survivor.
    dup_titles = [n for n in rec["nodes"] if n["title"] == "Dup"]
    assert len(dup_titles) == 1
    assert set(dup_titles[0]["chunk_refs"]) == {"0"}
    assert "repair:duplicate_title_merged" in rec["generator"]["missing"]
    # Part 19 diagnostics landed on the real persisted record.
    diag = rec["generator"]["diagnostics"]
    assert diag["nodes_emitted"] == len(rec["nodes"])
    assert "summary_tree_smell" in diag
