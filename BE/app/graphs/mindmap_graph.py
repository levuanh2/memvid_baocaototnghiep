# BE/app/graphs/mindmap_graph.py — 5 node skeleton-first (spec §4)
from __future__ import annotations

import time
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
        _set_job(state["job_id"], status="running", progress=5, current_node="CollectInput")
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
        _set_job(state["job_id"], progress=15, current_node="Skeleton")
        t0 = time.time()
        nodes, method = pipeline.skeleton(state["mm_input"])
        skeleton_elapsed_ms = (time.time() - t0) * 1000
        missing = list(state.get("degraded_missing") or [])
        if method == "single":
            # Cả deterministic lẫn LLM outline đều không dựng được khung —
            # record chỉ có root, phải báo degraded thay vì im lặng.
            missing.append("skeleton")
        # preview cho FE render ngay (spec §4.2.2)
        _set_job(state["job_id"], progress=20,
                 result={"partial": {"title": state["mm_input"]["title"], "nodes": nodes}})
        return {**state, "skeleton": nodes, "skeleton_method": method,
                "skeleton_elapsed_ms": skeleton_elapsed_ms,
                "degraded_missing": missing, "progress": 20, "current_node": "Skeleton"}

    @_guard("Enrich")
    def enrich_node(state: dict) -> dict:
        _set_job(state["job_id"], progress=30, current_node="Enrich")
        def _prog(p: int, msg: str) -> None:
            _set_job(state["job_id"], progress=p, current_node=msg)
        # Phase 1 (Task 4): `reasons` là optional/additive — pipeline nào chưa hỗ
        # trợ (vd GrpcMindmapPipeline hiện tại, hay stub trong test) vẫn nhận
        # tham số này qua **kw và bỏ qua, không vỡ gì. `degraded` (bool) giữ
        # nguyên ý nghĩa cũ, không đổi kiểu.
        reasons: list[str] = []
        skeleton_before = state["skeleton"]
        t0 = time.time()
        nodes, degraded = pipeline.enrich(state["mm_input"], skeleton_before,
                                          progress_cb=_prog,
                                          cancel_cb=lambda: _cancelled(state["job_id"]),
                                          reasons=reasons)
        enrich_elapsed_ms = (time.time() - t0) * 1000
        # Phase 2B (Task 8/9 — docs/MINDMAP_V2_PHASE2B.md): log the structural
        # guarantee + enrichment quality metrics every run, not just in tests.
        # Never fatal — a metrics/validation failure must not fail the job.
        try:
            from services.mindmap.pipeline.enrichment_metrics import compute_enrichment_metrics
            m = compute_enrichment_metrics(skeleton_before, nodes)
            print(f"[mindmap] enrichment metrics job={state['job_id']} "
                 f"node_preservation={m['node_preservation_pct']}% "
                 f"hierarchy_preservation={m['hierarchy_preservation_pct']}% "
                 f"items={m['total_enrichment_items']} ok={m['ok_items']} "
                 f"prompt_failures={m['prompt_failures']} json_failures={m['json_failures']} "
                 f"skipped={m['skipped_nodes']} avg_latency_ms={m['avg_enrichment_latency_ms']}")
        except Exception as e:
            print(f"[mindmap] enrichment metrics failed to compute (non-fatal): {e}")
        missing = list(state.get("degraded_missing") or [])
        if degraded:
            missing.append("enrich")
        missing.extend(r for r in reasons if r not in missing)
        return {**state, "nodes": nodes, "degraded_missing": missing,
                "enrich_elapsed_ms": enrich_elapsed_ms,
                "progress": 70, "current_node": "Enrich"}

    @_guard("Relations")
    def relations_node(state: dict) -> dict:
        _set_job(state["job_id"], progress=75, current_node="Relations")
        rels, degraded = pipeline.relations(state["nodes"],
                                            cancel_cb=lambda: _cancelled(state["job_id"]))
        missing = list(state.get("degraded_missing") or [])
        if degraded:
            missing.append("relations")
        return {**state, "relations": rels, "degraded_missing": missing,
                "progress": 85, "current_node": "Relations"}

    @_guard("AssemblePersist")
    def assemble_node(state: dict) -> dict:
        from services.mindmap.pipeline.modelcfg import resolve_mindmap_model
        elapsed = time.time() - (state.get("_t0") or time.time())
        missing = list(state.get("degraded_missing") or [])
        # Phase 1 (Task 4 — docs/MINDMAP_V2_AUDIT.md §3 H10, §13 P0 #2): trước đây
        # MAX_NODES cắt bớt node TRONG IM LẶNG ở chính bước lưu cuối cùng này —
        # không ai biết record đã bị cắt. `on_truncate` chỉ GHI SỐ vào biến cục
        # bộ ở đây (không append `missing` ngay) — Sprint C.5's self-healing
        # bên dưới có thể phục hồi TOÀN BỘ số bị cắt đó, và một bản đồ đã được
        # tự phục hồi xong không còn gì để báo degraded về việc này nữa.
        truncated_count = 0
        def _on_truncate(n):
            nonlocal truncated_count
            truncated_count = n
        # Sprint E.5 (Adaptive Node Allocation) — the deterministic path
        # (`skeleton_method == "headings"`) no longer applies ONE flat
        # document-wide slice; it allocates a per-heading budget first (see
        # `node_allocator.py`'s own docstring for why) and only falls back to
        # the old flat `sanitize_nodes` cap for the non-heading skeleton
        # methods, where there is no heading tree to allocate against.
        allocation_report = None
        if state.get("skeleton_method") == "headings":
            try:
                from services.mindmap.pipeline.heading_tree import build_heading_tree
                from services.mindmap.pipeline.node_allocator import (
                    allocate_node_budgets, apply_node_allocation,
                )
                chunks = state["mm_input"].get("chunks") or []
                chunks_by_key = {c["key"]: c for c in chunks if c.get("key")}
                heading_nodes = build_heading_tree(chunks)
                allocation = allocate_node_budgets(heading_nodes, state["nodes"], chunks_by_key)
                allocated_nodes, allocation_report = apply_node_allocation(state["nodes"], allocation)
                truncated_count = allocation_report["total_dropped"]
                if truncated_count:
                    print(f"[mindmap] node allocation dropped {truncated_count} node(s) "
                         f"job={state['job_id']} total_budget={allocation['total_budget']}")
                # Uncapped cleanup pass ONLY (dedupe id, invalid kind, orphan
                # reparent) — the real cap already happened above, per heading.
                clean_nodes = mm_schema.sanitize_nodes(allocated_nodes, max_nodes=10**9)
            except Exception as e:
                print(f"[mindmap] node allocation failed, falling back to flat cap (non-fatal): {e}")
                clean_nodes = mm_schema.sanitize_nodes(state["nodes"], on_truncate=_on_truncate)
        else:
            clean_nodes = mm_schema.sanitize_nodes(state["nodes"], on_truncate=_on_truncate)
        # Sprint C.5 (Quality V3.5) — Self-Healing: recover deterministic losses
        # BEFORE building the record, so the PERSISTED mindmap is already
        # healed, not just diagnosed. Only ever acts on MISSING_BY_CAP (see
        # `recovery.py`'s own docstring for why that's the one provably-safe
        # case) — never calls the LLM, never invents, never reparents. A
        # successful recovery does NOT append to `missing` (the map is now
        # complete, not degraded); only genuinely unresolved NUMBERING/
        # VALIDATION losses do, since those are real problems worth a user's
        # attention, unlike ordinary reference-section/empty-chunk cases.
        # Only meaningful when the skeleton actually came from the heading
        # tree — see quality_report.py's own docstring on `heading_based` for
        # why comparing ids across a different skeleton method would be
        # actively wrong (a spurious 100%-missing report), not just imprecise.
        recovered_count = 0
        if state.get("skeleton_method") == "headings":
            try:
                from services.mindmap.pipeline.heading_tree import build_heading_tree
                from services.mindmap.pipeline.loss_classifier import LossReason, classify_losses
                from services.mindmap.pipeline.recovery import recover_deterministic_losses
                chunks = state["mm_input"].get("chunks") or []
                chunks_by_key = {c["key"]: c for c in chunks if c.get("key")}
                heading_nodes = build_heading_tree(chunks)
                losses = classify_losses(heading_nodes, chunks_by_key, state.get("skeleton"), clean_nodes, [])
                recovered_nodes, recovery_log = recover_deterministic_losses(state.get("skeleton"), clean_nodes, losses)
                if recovered_nodes:
                    clean_nodes = clean_nodes + recovered_nodes
                    recovered_count = len(recovered_nodes)
                    print(f"[mindmap] self-healing recovered {recovered_count} node(s) "
                         f"job={state['job_id']} ids={[e['node_id'] for e in recovery_log]}")
                recovered_ids = {e["node_id"] for e in recovery_log}
                still_bad = [l for l in losses
                            if l["reason"] in (LossReason.MISSING_BY_NUMBERING.value, LossReason.MISSING_BY_VALIDATION.value)
                            and l["heading_id"] not in recovered_ids]
                for l in still_bad:
                    label = f"missing_concept:{l['chunk_key']}@{l.get('heading_title', '')}"
                    if label not in missing:
                        missing.append(label)
            except Exception as e:
                print(f"[mindmap] self-healing recovery failed (non-fatal): {e}")
        remaining_truncated = truncated_count - recovered_count
        if remaining_truncated > 0:
            missing.append(f"nodes_truncated:{remaining_truncated}")
        # Learning-map-v2 is a contract, not a visual hint. Validate the
        # persisted hierarchy after all existing cleanup/recovery steps; do
        # not invent siblings or silently discard meaningful overflow here.
        from services.mindmap.pipeline.v2_constraints import issue_codes, validate_hierarchy
        v2_report = validate_hierarchy(
            clean_nodes,
            require_rich_size=len(state["mm_input"].get("chunks") or []) >= 10,
        )
        for issue in issue_codes(v2_report):
            if issue not in missing:
                missing.append(issue)
        from services.provenance import attach_node_source_stems
        clean_nodes = attach_node_source_stems(clean_nodes, state["mm_input"])
        record = mm_schema.build_record(
            title=state["mm_input"]["title"], sources=state["mm_input"]["sources"],
            nodes=clean_nodes,
            relations=mm_schema.validate_relations(state.get("relations") or [], clean_nodes),
            content_hash_value=state["content_hash"],
            model=resolve_mindmap_model(),
            elapsed_sec=elapsed, degraded_missing=missing,
            skeleton_method=state.get("skeleton_method") or "")
        # Phase D: bind the record owner (None when unprotected → today's behavior).
        persist_record(record, user_id=state.get("user_id"))
        _set_job(state["job_id"], status="done", progress=100,
                 current_node="AssemblePersist", result=record)
        # Quality V3 (Task 5/6/7/9): metrics ONLY — logged, never merged into
        # `record`/`generator` (that would expose it to the frontend, out of
        # scope for this sprint). Never fatal: a report failure must not
        # touch the record that was already persisted above.
        try:
            from services.mindmap.pipeline.quality_report import build_quality_report
            q = build_quality_report(
                state["mm_input"], clean_nodes, skeleton_before=state.get("skeleton"),
                skeleton_method=state.get("skeleton_method") or "headings",
                skeleton_elapsed_ms=state.get("skeleton_elapsed_ms"),
                enrich_elapsed_ms=state.get("enrich_elapsed_ms"))
            print(f"[mindmap] quality report job={state['job_id']} "
                 f"coverage={q['coverage']['overall']['coverage_pct']}% "
                 f"missing_concepts={len(q['missing_concepts'])} "
                 f"hierarchy_violations={len(q['hierarchy_violations'])} "
                 f"sibling_merge_violations={len(q['sibling_merge_violations'])} "
                 f"avg_depth={q['avg_depth']} avg_branching={q['avg_branching_factor']} "
                 f"collapsed_nodes={q['collapsed_nodes']} "
                 f"timings_ms={q['timings_ms']}")
            # Pipeline Intelligence (Sprint C.75, Task 1) — a read-only
            # snapshot of THIS run, appended to an analytics-only JSONL file.
            # Own try/except: a store-write failure must not even suppress
            # the quality-report print above, let alone the persisted record.
            try:
                from services.mindmap.analytics.generation_report import build_generation_report
                from services.mindmap.analytics.store import append_report
                gen_report = build_generation_report(
                    document_id=state["content_hash"], sources=state["mm_input"].get("sources") or [],
                    node_count=len(clean_nodes), quality_report=q, generation_time_sec=elapsed)
                append_report(gen_report, data_dir)
            except Exception as e:
                print(f"[mindmap] generation report append failed (non-fatal): {e}")
        except Exception as e:
            print(f"[mindmap] quality report failed to compute (non-fatal): {e}")
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
