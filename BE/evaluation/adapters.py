from __future__ import annotations

import math
import time
from pathlib import Path
from typing import Callable

from evaluation.trace import QueryTrace


def _ranked(chunks, score_name: str | None = None) -> list[dict]:
    out = []
    for rank, chunk in enumerate(chunks, 1):
        row = {"chunk_id": int(chunk.chunk_id), "source_id": chunk.video_stem, "rank": rank}
        if score_name:
            row["score"] = getattr(chunk, score_name, None)
        out.append(row)
    return out


class ProductionEvaluationAdapter:
    """Thin observer over production components; it does not implement retrieval policy."""

    def __init__(self, index_dir: Path):
        from app.domains.retrieval.hybrid import HybridRetriever
        self.index_dir = Path(index_dir)
        self.retriever = HybridRetriever(index_path=self.index_dir / "index.faiss", meta_path=self.index_dir / "index.json")

    def capture_retrieval(self, query: str, *, selected_sources: list[str], candidate_k: int, fusion_top_k: int,
                          mode: str, trace: QueryTrace):
        from app.domains.retrieval.ensemble_retriever import hybrid_retrieve_with_ensemble
        bm25, faiss = [], []
        if mode in ("bm25", "hybrid"):
            started = time.perf_counter()
            bm25 = self.retriever.retrieve_bm25_only(query, selected_sources=selected_sources, top_k=candidate_k)
            trace.timing_ms["bm25"] = (time.perf_counter() - started) * 1000
        if mode in ("faiss", "hybrid"):
            started = time.perf_counter()
            faiss = self.retriever.retrieve_faiss_only(query, selected_sources=selected_sources, top_k=candidate_k)
            trace.timing_ms["faiss"] = (time.perf_counter() - started) * 1000
        trace.bm25_candidates = _ranked(bm25, "bm25_score")
        trace.faiss_candidates = _ranked(faiss, "vector_score")

        started = time.perf_counter()
        if mode == "bm25":
            fused = bm25[:fusion_top_k]
        elif mode == "faiss":
            fused = faiss[:fusion_top_k]
        elif mode == "hybrid":
            fused = hybrid_retrieve_with_ensemble(self.retriever, query, selected_sources=selected_sources, top_k=fusion_top_k)
        else:
            raise ValueError(f"unsupported retrieval mode: {mode}")
        trace.timing_ms["fusion"] = (time.perf_counter() - started) * 1000
        trace.fusion_candidates = _ranked(fused)
        return fused

    def rerank(self, query: str, chunks, *, top_n: int, source_tags: bool, trace: QueryTrace):
        from app.domains.retrieval import rerank
        texts = [self._model_text(c, source_tags) for c in chunks]
        started = time.perf_counter()
        ranked = rerank.rerank_texts(query, texts, top_n=top_n)
        trace.timing_ms["rerank"] = (time.perf_counter() - started) * 1000
        kept = []
        for rank, (idx, raw_score) in enumerate(ranked, 1):
            if 0 <= idx < len(chunks):
                kept.append(chunks[idx])
                trace.reranked_candidates.append({"chunk_id": chunks[idx].chunk_id, "rank": rank, "raw_score": float(raw_score),
                                                    "normalized_score": 1 / (1 + math.exp(-float(raw_score)))})
        return kept

    @staticmethod
    def _model_text(chunk, source_tags: bool) -> str:
        if source_tags:
            return f"[Nguồn: {chunk.video_stem}, đoạn {chunk.chunk_id}]\n{chunk.text}"
        return chunk.text

    def nli_filter(self, chunks, *, threshold: float, max_pairs: int, source_tags: bool, trace: QueryTrace):
        """Run the production NLI engine and the unchanged bounded/lower-rank-removal policy."""
        from app.domains.retrieval import nli
        texts = [self._model_text(c, source_tags) for c in chunks]
        cand = nli._candidate_pairs(len(texts), max_pairs)
        directed = []
        for i, j in cand:
            directed.extend([(texts[i], texts[j]), (texts[j], texts[i])])
        started = time.perf_counter()
        scored = nli.get_nli().predict(directed) if directed else []
        trace.timing_ms["nli"] = (time.perf_counter() - started) * 1000
        conflicts = []
        for pos, (i, j) in enumerate(cand):
            pair_scores = scored[2 * pos:2 * pos + 2]
            probs = [float(s.get("contradiction", 0.0)) for s in pair_scores]
            best = max(probs, default=0.0)
            decision = "remove_lower_ranked" if best >= threshold else "retain_both"
            trace.nli["pairs"].append({
                "pair_id": f"{chunks[i].chunk_id}:{chunks[j].chunk_id}", "text_ids": [chunks[i].chunk_id, chunks[j].chunk_id],
                "directions": [
                    {"premise_id": chunks[i].chunk_id, "hypothesis_id": chunks[j].chunk_id, "contradiction_probability": probs[0] if probs else None},
                    {"premise_id": chunks[j].chunk_id, "hypothesis_id": chunks[i].chunk_id, "contradiction_probability": probs[1] if len(probs) > 1 else None},
                ], "threshold": threshold, "decision": decision, "original_ranks": [i + 1, j + 1],
                "removed_id": chunks[j].chunk_id if decision == "remove_lower_ranked" else None,
                "retained_id": chunks[i].chunk_id if decision == "remove_lower_ranked" else None,
            })
            if decision == "remove_lower_ranked":
                conflicts.append({"i": i, "j": j, "score": best})
        keep = nli.resolve_conflicts(len(chunks), conflicts)
        kept = [chunks[i] for i in keep]
        trace.nli["removed_ids"] = [c.chunk_id for i, c in enumerate(chunks) if i not in keep]
        trace.nli["retained_ids"] = [c.chunk_id for c in kept]
        trace.nli["pairs_checked"] = len(cand)
        return kept

    def grade(self, query: str, chunks, *, threshold: float, wrong_floor: float, trace: QueryTrace, round_no: int) -> str:
        from app.domains.retrieval.grading import grade_documents, _relevance
        started = time.perf_counter()
        grade = grade_documents(query, list(chunks), relevance_threshold=threshold, wrong_floor=wrong_floor)
        trace.timing_ms[f"crag_grade_round_{round_no}"] = (time.perf_counter() - started) * 1000
        relevance = [_relevance(query, c) for c in chunks]
        trace.crag["rounds"].append({"round": round_no, "query": query, "evidence_ids": [c.chunk_id for c in chunks],
                                     "grade": grade, "best_score": max(relevance, default=0.0),
                                     "grade_signals": {"per_evidence_relevance": relevance, "threshold_correct": threshold, "threshold_wrong": wrong_floor}})
        return grade


class EvaluationPipeline:
    def __init__(self, adapter: ProductionEvaluationAdapter, *, generator: Callable[[str, list[str]], str] | None = None,
                 rewriter: Callable[[str], str] | None = None):
        self.adapter = adapter
        if generator is None:
            from app.clients.llm_factory import summarize_results
            generator = summarize_results
        if rewriter is None:
            from app.domains.retrieval.query_rewrite import rewrite_query
            rewriter = rewrite_query
        self.generator, self.rewriter = generator, rewriter

    def run(self, query: dict, cfg: dict, trace: QueryTrace) -> QueryTrace:
        started_all = time.perf_counter()
        effective = query["query"]
        trace.effective_query = effective
        # selected_sources is an experimental input. relevant_doc_ids is a qrel and
        # must never constrain retrieval (that would leak gold labels into the method).
        sources = query.get("selected_sources") or []
        trace.selected_sources = list(sources)
        if cfg.get("memory_tree", {}).get("enabled"):
            from app.domains.memory.tree import query_with_memory_tree
            from evaluation.provenance import ChunkResolver, export_answer_path
            mt_started = time.perf_counter()
            trace.memory_tree = {"attempted": True, "hit": False}
            result = query_with_memory_tree(effective, selected_sources=sources)
            trace.timing_ms["memory_tree"] = (time.perf_counter() - mt_started) * 1000
            if isinstance(result, dict) and str(result.get("answer") or "").strip():
                exported = export_answer_path(path="memory_tree", answer_payload=result,
                                              resolver=ChunkResolver(self.adapter.index_dir / "index.json"))
                trace.runtime_path = "memory_tree"
                trace.memory_tree.update({
                    "hit": True, "direct_answer": True, "query_type": result.get("query_type"),
                    "nodes": result.get("memory_nodes") or [], "fallback_to_full_retrieval": False,
                    "evidence": exported["evidence"], "provenance_complete": exported["provenance_complete"],
                })
                trace.final_evidence_ids = exported["chunk_ids"]
                trace.context_ids = list(trace.final_evidence_ids)
                trace.source_ids = exported["source_ids"]
                trace.system_answer = exported["answer"] or ""
                trace.timing_ms["total"] = (time.perf_counter() - started_all) * 1000
                if cfg.get("hitl", {}).get("enabled"):
                    trace.hitl = {"state": "awaiting_real_human_review", "reviewer_action": None}
                return trace
            trace.memory_tree["fallback_to_full_retrieval"] = True
        max_rounds = int(cfg.get("crag", {}).get("rewrite_max", 0)) if cfg.get("crag", {}).get("enabled") else 0
        final_chunks = []
        for round_no in range(max_rounds + 1):
            final_chunks = self.adapter.capture_retrieval(
                effective, selected_sources=sources, candidate_k=int(cfg["retrieval"]["candidate_k"]),
                fusion_top_k=int(cfg["retrieval"]["top_k"]), mode=cfg["retrieval"]["mode"], trace=trace)
            if cfg.get("rerank", {}).get("enabled"):
                final_chunks = self.adapter.rerank(effective, final_chunks, top_n=int(cfg["rerank"]["top_n"]),
                                                   source_tags=bool(cfg.get("source_tags", True)), trace=trace)
            if cfg.get("nli", {}).get("enabled"):
                final_chunks = self.adapter.nli_filter(final_chunks, threshold=float(cfg["nli"]["threshold"]),
                                                       max_pairs=int(cfg["nli"]["max_pairs"]), source_tags=bool(cfg.get("source_tags", True)), trace=trace)
            if not cfg.get("crag", {}).get("enabled"):
                break
            grade = self.adapter.grade(effective, final_chunks, threshold=float(cfg["crag"]["correct_threshold"]),
                                       wrong_floor=float(cfg["crag"]["wrong_floor"]), trace=trace, round_no=round_no)
            if grade == "correct":
                trace.crag["final_action"] = "correct"
                break
            if round_no >= max_rounds:
                trace.crag["final_action"] = "wrong-refusal" if grade == "wrong" else "ambiguous-generate"
                break
            rewrite_started = time.perf_counter()
            effective = self.rewriter(effective)
            trace.timing_ms[f"rewrite_round_{round_no + 1}"] = (time.perf_counter() - rewrite_started) * 1000
            trace.rewritten_queries.append(effective)
            trace.llm_calls.append({"stage": "query_rewrite", "round": round_no + 1, "model": cfg.get("generator_model"), "tokens": {"input": None, "output": None}})
            trace.effective_query = effective

        trace.final_evidence_ids = [c.chunk_id for c in final_chunks]
        context_started = time.perf_counter()
        trace.context_ids = list(trace.final_evidence_ids)
        context_texts = [c.text for c in final_chunks]
        trace.timing_ms["context_building"] = (time.perf_counter() - context_started) * 1000
        if trace.crag.get("final_action") != "wrong-refusal":
            generation_started = time.perf_counter()
            trace.system_answer = self.generator(query["query"], context_texts)
            trace.timing_ms["generation"] = (time.perf_counter() - generation_started) * 1000
            trace.llm_calls.append({"stage": "generation", "model": cfg.get("generator_model"), "tokens": trace.tokens})
        trace.source_ids = sorted({c.video_stem for c in final_chunks if c.video_stem})
        import re
        trace.citations = [
            {"source_id": source.strip(), "chunk_id": int(cid)}
            for source, cid in re.findall(r"\(Nguồn:\s*([^,]+),\s*đoạn\s*(\d+)\)", trace.system_answer, flags=re.IGNORECASE)
        ]
        if cfg.get("hitl", {}).get("enabled"):
            trace.hitl = {"state": "awaiting_real_human_review", "reviewer_action": None}
        trace.timing_ms["total"] = (time.perf_counter() - started_all) * 1000
        return trace
