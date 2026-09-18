# BE/tests/test_mindmap_graph.py — graph THẬT, pipeline stub (bài học conftest-mock)
import json
from pathlib import Path
import pytest


def _build(tmp_path, pipeline=None, persist=None, jobs_updates=None, collect_input=None):
    from app.graphs.mindmap_graph import build_mindmap_graph
    meta_path = tmp_path / "index.json"
    meta_path.write_text(json.dumps({"0": {"source_stem": "a_docx", "heading_path": "1. Mở đầu"}}), encoding="utf-8")

    def _default_collect_input(index_meta_path, source_names):
        return {"title": "Doc", "sources": ["a_docx"],
                "chunks": [{"key": "0", "text": "t", "heading_path": "1. Mở đầu", "chunk_keys": ["0"]}],
                "tree_sections": []}
    collect_input = collect_input or _default_collect_input

    class StubPipeline:
        def skeleton(self, mm):
            return ([{"id": "n0", "parent": None, "kind": "root", "title": "Doc"},
                     {"id": "n1", "parent": "n0", "kind": "section", "title": "1. Mở đầu", "chunk_refs": ["0"]}],
                    "headings")
        def enrich(self, mm, skeleton, progress_cb=None, cancel_cb=None, reasons=None):
            return skeleton, False
        def relations(self, nodes, cancel_cb=None):
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
        def enrich(self, mm, sk, progress_cb=None, cancel_cb=None, reasons=None):
            return sk, True
        def relations(self, nodes, cancel_cb=None):
            return [], True
    g = _build(tmp_path, pipeline=DegradedPipeline())
    out = g.invoke({"job_id": "j3", "source_names": ["a_docx"], "progress": 0,
                    "current_node": "", "error": None},
                   config={"configurable": {"thread_id": "j3"}})
    assert out["result"]["generator"]["degraded"] is True
    # This fixture exercises the V2 build_record path. Its one top-level
    # branch is intentionally structurally incomplete, so the validator must
    # preserve the stage failures and add the explicit V2 contract failures.
    expected_stage_failures = {"enrich", "relations"}
    expected_v2_failures = {"V2_TOP_LEVEL_BRANCHES:1", "V2_CHILDREN_CARDINALITY:n0:1"}
    assert set(out["result"]["generator"]["missing"]) == (
        expected_stage_failures | expected_v2_failures
    )


def test_self_healing_recovers_a_node_dropped_by_cap_end_to_end(tmp_path, monkeypatch):
    # Sprint C.5 (Quality V3.5) — a REAL `build_skeleton()` call (not
    # hand-crafted node ids) so the recovered node's id genuinely matches
    # what `build_heading_tree` would produce from the same chunks; this is
    # the actual "self-healing" claim exercised end-to-end through the graph,
    # not just the isolated helper-module unit tests.
    from services.mindmap.pipeline import schema as mm_schema
    monkeypatch.setattr(mm_schema, "MAX_NODES", 2)  # root + exactly ONE section survives sanitize_nodes

    def collect_input(index_meta_path, source_names):
        return {"title": "Doc", "sources": ["a_docx"], "tree_sections": [],
                "chunks": [
                    {"key": "0", "text": "nội dung mở đầu", "heading_path": "1. Mở đầu", "chunk_keys": ["0"]},
                    {"key": "1", "text": "nội dung kết luận", "heading_path": "2. Kết luận", "chunk_keys": ["1"]},
                ]}

    class RealSkeletonPipeline:
        def skeleton(self, mm):
            from services.mindmap.pipeline.skeleton import build_skeleton
            return build_skeleton(mm)
        def enrich(self, mm, skeleton, progress_cb=None, cancel_cb=None, reasons=None):
            return skeleton, False
        def relations(self, nodes, cancel_cb=None):
            return [], False

    saved = []
    g = _build(tmp_path, pipeline=RealSkeletonPipeline(), persist=saved.append, collect_input=collect_input)
    out = g.invoke({"job_id": "jheal", "source_names": ["a_docx"], "progress": 0,
                    "current_node": "", "error": None},
                   config={"configurable": {"thread_id": "jheal"}})
    assert out.get("error") is None
    rec = out["result"]
    # heading_tree.py keeps the numbering prefix IN the title by design
    # (module docstring: "title is always the FULL original heading text").
    titles = {n["title"] for n in rec["nodes"]}
    # Sprint E.5 (Adaptive Node Allocation): headings themselves are now a
    # GUARANTEED reserve — `node_allocator.py` never drops a heading node to
    # make room for content, unlike the old flat `sanitize_nodes` slice this
    # test originally forced (kind-priority sort could drop a WHOLE section
    # under a tight cap). Both headings survive by construction now; nothing
    # heading-level is left for `deterministic_recovery` to restore.
    assert "1. Mở đầu" in titles
    assert "2. Kết luận" in titles, "node_allocator must never drop a heading node"

    recovered = [n for n in rec["nodes"] if n.get("created_by") == "deterministic_recovery"]
    assert recovered == [], (
        "no heading was dropped, so there is nothing structural for Sprint C.5 recovery to restore"
    )
    # The pool (MAX_NODES=2) reserves exactly one slot per heading and has
    # nothing left for either heading's own deterministic-concept leaf — both
    # get allocated 0 and are dropped. `loss_classifier.classify_losses` is
    # chunk-level (a heading's OWN chunk_refs read as "present" once the
    # heading itself survives, regardless of whether its child leaf did) —
    # a documented gap (see branch_report.py's module docstring), so this
    # concept-leaf loss is NOT chunk-recoverable and stays honestly degraded.
    assert rec["generator"]["degraded"]
    assert "nodes_truncated:2" in rec["generator"]["missing"]
    assert not any(n.get("deterministic_concept") for n in rec["nodes"])
    root = next(n for n in rec["nodes"] if n["kind"] == "root")
    assert root["concept_completeness"]["generated"] == 2  # pre-enrichment snapshot


def test_pipeline_intelligence_generation_report_is_deterministic_across_10_runs(tmp_path):
    # Sprint C.75, Task 7 — running the SAME document through the real graph
    # 10 times must append 10 IDENTICAL GenerationReports (excluding the two
    # genuinely wall-clock fields, `generation_time_sec`/`created_at`, which
    # are expected to vary run-to-run and are not part of the determinism
    # claim — see health_report.py's own `_determinism_score` for the same
    # exclusion applied at the aggregate level).
    from services.mindmap.analytics.store import load_reports

    for i in range(10):
        saved = []
        g = _build(tmp_path, persist=saved.append)
        out = g.invoke({"job_id": f"jrep{i}", "source_names": ["a_docx"], "progress": 0,
                        "current_node": "", "error": None},
                       config={"configurable": {"thread_id": f"jrep{i}"}})
        assert out.get("error") is None

    reports = load_reports(tmp_path)
    assert len(reports) == 10

    volatile = {"generation_time_sec", "created_at"}
    stripped = [{k: v for k, v in r.items() if k not in volatile} for r in reports]
    first = stripped[0]
    assert all(s == first for s in stripped[1:]), "GenerationReport drifted across identical runs"
    # and every run agreed on WHICH document this was.
    assert len({r["document_id"] for r in reports}) == 1
