# BE/app/graphs/mindmap_graph.py — 5 node skeleton-first (spec §4)
from __future__ import annotations

import time
import os
from pathlib import Path
from typing import Any, Callable

from langgraph.graph import END, StateGraph

from app.graphs.logger import _Timer, log_node_event
from app.graphs.sqlite_checkpointer import sqlite_saver_from_path
from app.graphs.state import MindmapState
from services.mindmap.pipeline import schema as mm_schema


def build_mindmap_graph(*, data_dir: Path, index_meta_path: Path,
                        jobs_update: Callable[..., None] | None,
                        collect_input: Callable[..., dict],
                        pipeline: Any,
                        persist_record: Callable[..., None]) -> Any:
    def _set_job(job_id: str, **kw: Any) -> None:
        if jobs_update is None:
            return
        try:
            jobs_update(job_id, **kw)
        except Exception as e:
            # Fail-open là ĐÚNG cho mốc tiến trình giữa chừng, nhưng KHÔNG được im.
            # Mọi trạng thái của graph này đi qua đây, kể cả `status="done"` kèm
            # result. Nuốt im lặng = job không bao giờ tới done, FE poll tới hết TTL
            # mà không ai biết vì sao (known-issues 2026-07-06).
            # ponytail: chỉ in ra, không ném — ném ở đây làm hỏng cả pipeline vì một
            # lần ghi SQLite bị khoá. Đổi sang ném khi có bằng chứng ghi hỏng thật.
            print(f"set_job_failed job_id={job_id} keys={sorted(kw)} err={e}", flush=True)

    def _cancelled(job_id: str) -> bool:
        try:
            from app.domains.jobs.jobs_store import is_cancel_requested
            return is_cancel_requested(job_id)
        except Exception:
            return False

    def _guard(node_name: str):
        """Decorator-ish: check cancel trước node; lỗi hệ thống → error state."""
        def wrap(fn):
            def inner(state: dict) -> dict:
                if _cancelled(state["job_id"]):
                    return {**state, "cancelled": True, "current_node": node_name}
                t = _Timer()
                try:
                    out = fn(state)
                    log_node_event(state["job_id"], node_name, "ok", t.ms())
                    return out
                except Exception as e:
                    log_node_event(state["job_id"], node_name, "error", t.ms(), {"error": str(e)})
                    return {**state, "error": str(e), "current_node": node_name}
            return inner
        return wrap

    @_guard("CollectInput")
    def collect_node(state: dict) -> dict:
        _set_job(state["job_id"], status="running", progress=5,
                 current_node="retrieving" if state.get("mm_input", {}).get("generation_intent") else "CollectInput")
        mm = state.get("mm_input") or collect_input(index_meta_path, state.get("source_names") or [])
        ch = state.get("content_hash") or mm_schema.content_hash(
            mm.get("sources") or [], [c["text"] for c in mm.get("chunks") or []],
            [c.get("heading_path", "") for c in mm.get("chunks") or []])
        if not mm.get("chunks"):
            raise ValueError("Không có chunk nào cho các nguồn đã chọn.")
        return {**state, "mm_input": mm, "content_hash": ch, "progress": 10,
                "current_node": "CollectInput", "_t0": time.time(), "error": None}

    @_guard("Skeleton")
    def skeleton_node(state: dict) -> dict:
        _set_job(state["job_id"], progress=15,
                 current_node="planning" if state.get("mm_input", {}).get("generation_intent") else "Skeleton")
        if state["mm_input"].get("generation_intent") and hasattr(pipeline, "guided_plan"):
            if os.getenv("SKIP_MODEL_LOAD") != "1":
                from app.clients.llm_factory import PROVIDERS
                if not PROVIDERS:
                    raise RuntimeError("guided_provider_not_configured")
            nodes, guided_relations, plan, guided_missing = pipeline.guided_plan(
                state["mm_input"], job_id=state["job_id"])
            state["mm_input"]["guided_plan"] = plan
            method = "guided_semantic_planner"
        else:
            nodes, method = pipeline.skeleton(state["mm_input"])
            guided_relations, guided_missing = [], []
        missing = list(state.get("degraded_missing") or [])
        missing.extend(code for code in guided_missing if code not in missing)
        if method == "single":
            # Cả deterministic lẫn LLM outline đều không dựng được khung —
            # record chỉ có root, phải báo degraded thay vì im lặng.
            missing.append("skeleton")
        # preview cho FE render ngay (spec §4.2.2)
        _set_job(state["job_id"], progress=20,
                 result={"partial": {"title": state["mm_input"]["title"], "nodes": nodes}})
        return {**state, "skeleton": nodes, "skeleton_method": method,
                "relations": guided_relations,
                "degraded_missing": missing, "progress": 20, "current_node": "Skeleton"}

    @_guard("Enrich")
    def enrich_node(state: dict) -> dict:
        _set_job(state["job_id"], progress=30,
                 current_node="generating" if state.get("mm_input", {}).get("generation_intent") else "Enrich")
        def _prog(p: int, msg: str) -> None:
            _set_job(state["job_id"], progress=p, current_node=msg)
        if state["mm_input"].get("generation_intent") and state.get("skeleton_method") == "guided_semantic_planner":
            if os.getenv("SKIP_MODEL_LOAD") == "1":
                nodes, degraded = state["skeleton"], True
            else:
                nodes, degraded = pipeline.enrich(state["mm_input"], state["skeleton"],
                                                  progress_cb=_prog,
                                                  cancel_cb=lambda: _cancelled(state["job_id"]),
                                                  job_id=state["job_id"])
        else:
            nodes, degraded = pipeline.enrich(state["mm_input"], state["skeleton"],
                                              progress_cb=_prog,
                                              cancel_cb=lambda: _cancelled(state["job_id"]),
                                              job_id=state["job_id"])
        missing = list(state.get("degraded_missing") or [])
        if degraded:
            missing.append("enrich")
        return {**state, "nodes": nodes, "degraded_missing": missing,
                "progress": 70, "current_node": "Enrich"}

    @_guard("Relations")
    def relations_node(state: dict) -> dict:
        _set_job(state["job_id"], progress=75,
                 current_node="generating_relations" if state.get("mm_input", {}).get("generation_intent") else "Relations")
        if state["mm_input"].get("generation_intent") and state.get("skeleton_method") == "guided_semantic_planner":
            if os.getenv("SKIP_MODEL_LOAD") == "1":
                rels, degraded = state.get("relations") or [], True
            else:
                model_relations, degraded = pipeline.relations(
                    state["nodes"], cancel_cb=lambda: _cancelled(state["job_id"]),
                    job_id=state["job_id"])
                rels = list(state.get("relations") or []) + list(model_relations or [])
        else:
            rels, degraded = pipeline.relations(state["nodes"],
                                                cancel_cb=lambda: _cancelled(state["job_id"]),
                                                job_id=state["job_id"])
        missing = list(state.get("degraded_missing") or [])
        if degraded:
            missing.append("relations")
        return {**state, "relations": rels, "degraded_missing": missing,
                "progress": 85, "current_node": "Relations"}

    @_guard("AssemblePersist")
    def assemble_node(state: dict) -> dict:
        from services.mindmap.pipeline.modelcfg import resolve_mindmap_model
        from services.mindmap.pipeline.v2_constraints import issue_codes, validate_hierarchy
        elapsed = time.time() - (state.get("_t0") or time.time())
        if state["mm_input"].get("generation_intent"):
            _set_job(state["job_id"], progress=88, current_node="validating")
        clean_nodes = mm_schema.sanitize_nodes(state["nodes"])
        from services.provenance import attach_node_source_stems
        clean_nodes = attach_node_source_stems(clean_nodes, state["mm_input"])
        missing = list(state.get("degraded_missing") or [])
        if state["mm_input"].get("generation_intent"):
            # Bounded, deterministic structure repair (Part 13) — merges
            # exact-duplicate-title siblings only, never invents/drops
            # evidence. Runs before build_record so the persisted node list
            # is already the repaired one, not a side-channel patch.
            from services.mindmap.pipeline.structure_critic import repair_duplicate_titles
            clean_nodes, merged = repair_duplicate_titles(clean_nodes)
            if merged:
                missing.append("repair:duplicate_title_merged")
        validation = validate_hierarchy(
            clean_nodes,
            require_rich_size=len(state["mm_input"].get("chunks") or []) >= 10,
        )
        for code in issue_codes(validation):
            if code not in missing:
                missing.append(code)
        record = mm_schema.build_record(
            title=state["mm_input"]["title"], sources=state["mm_input"]["sources"],
            nodes=clean_nodes,
            relations=mm_schema.validate_relations(state.get("relations") or [], clean_nodes),
            content_hash_value=state["content_hash"],
            model=resolve_mindmap_model(),
            elapsed_sec=elapsed, degraded_missing=missing,
            skeleton_method=state.get("skeleton_method") or "",
            generation_intent=state["mm_input"].get("generation_intent"),
            job_id=state["job_id"],
            generation_config=state["mm_input"].get("guided_plan"))
        if record.get("schema_version") == 3:
            for issue in mm_schema.validate_v3_record(record):
                if issue not in missing:
                    missing.append(issue)
            record, repair_issues = mm_schema.repair_v3_record(record)
            for issue in repair_issues:
                repair_code = f"repair:{issue}"
                if repair_code not in missing:
                    missing.append(repair_code)
            record["generator"]["missing"] = missing
            record["generator"]["degraded"] = bool(missing)
            # Part 19 — structural regression diagnostics, computed on the
            # FINAL post-repair node/relation list. Never a rejection
            # threshold: purely informational metadata on the record.
            from services.mindmap.pipeline.structure_critic import compute_diagnostics
            record["generator"]["diagnostics"] = compute_diagnostics(
                record.get("nodes") or [], record.get("relations") or [])
        # Phase D: bind the record owner (None when unprotected → today's behavior).
        _set_job(state["job_id"], progress=95, current_node="saving")
        persist_record(record, user_id=state.get("user_id"))
        _set_job(state["job_id"], status="done", progress=100,
                 current_node="AssemblePersist", result=record)
        return {**state, "result": record, "progress": 100, "current_node": "AssemblePersist"}

    def cancelled_node(state: dict) -> dict:
        _set_job(state["job_id"], status="cancelled", progress=0, current_node="Cancelled")
        return {**state, "cancelled": True, "current_node": "Cancelled"}

    def error_node(state: dict) -> dict:
        err = (str(state.get("error") or "").strip()) or "unknown error"
        _set_job(state["job_id"], status="error", progress=0,
                 current_node="ErrorHandler", error_text=err)
        return {**state, "current_node": "ErrorHandler"}

    def _route(s: dict) -> str:
        if s.get("cancelled"):
            return "Cancelled"
        if s.get("error"):
            return "ErrorHandler"
        return "Continue"

    g = StateGraph(MindmapState)
    g.add_node("CollectInput", collect_node)
    g.add_node("Skeleton", skeleton_node)
    g.add_node("Enrich", enrich_node)
    g.add_node("Relations", relations_node)
    g.add_node("AssemblePersist", assemble_node)
    g.add_node("Cancelled", cancelled_node)
    g.add_node("ErrorHandler", error_node)
    g.set_entry_point("CollectInput")
    routes = {"Cancelled": "Cancelled", "ErrorHandler": "ErrorHandler"}
    g.add_conditional_edges("CollectInput", _route, {**routes, "Continue": "Skeleton"})
    g.add_conditional_edges("Skeleton", _route, {**routes, "Continue": "Enrich"})
    g.add_conditional_edges("Enrich", _route, {**routes, "Continue": "Relations"})
    g.add_conditional_edges("Relations", _route, {**routes, "Continue": "AssemblePersist"})
    g.add_conditional_edges("AssemblePersist", _route, {**routes, "Continue": END})
    g.add_edge("Cancelled", END)
    g.add_edge("ErrorHandler", END)
    return g.compile(checkpointer=sqlite_saver_from_path(data_dir / "checkpoints.sqlite"))
