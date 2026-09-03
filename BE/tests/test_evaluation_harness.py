from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.domains.retrieval.hybrid import RetrievedChunk
from evaluation.adapters import EvaluationPipeline, ProductionEvaluationAdapter
from evaluation.dataset import validate_dataset
from evaluation.metrics import bootstrap_ci, paired_bootstrap, retrieval_metrics
from evaluation.provenance import ChunkResolver, export_answer_path
from evaluation.trace import QueryTrace, append_jsonl


class FakeRetriever:
    chunks = [RetrievedChunk(1, "alpha fact", "a", bm25_score=3.0, vector_score=0.1),
              RetrievedChunk(2, "beta fact", "b", bm25_score=1.0, vector_score=0.2)]

    def retrieve_bm25_only(self, *a, **k):
        return self.chunks

    def retrieve_faiss_only(self, *a, **k):
        return list(reversed(self.chunks))


def _adapter(tmp_path):
    obj = ProductionEvaluationAdapter.__new__(ProductionEvaluationAdapter)
    obj.index_dir = tmp_path
    obj.retriever = FakeRetriever()
    return obj


def _trace(name="smoke"):
    return QueryTrace(name, "run", "q", "alpha")


def test_smoke_dataset_qrels_load_and_split_guard():
    root = Path(__file__).parents[2] / "reports" / "evaluation" / "datasets" / "smoke_v1"
    # `reports/` nằm trong .gitignore — bộ dữ liệu thực nghiệm thuộc dự án báo cáo
    # riêng, không theo git. Bản clone sạch (CI) không có nó — skip thay vì gãy, giống
    # `test_evaluation_review.py`. Guard ở MỨC TEST vì 6 test còn lại trong file
    # không đọc dataset.
    if not root.exists():
        pytest.skip("Thiếu reports/evaluation/datasets/smoke_v1 — dữ liệu thực nghiệm "
                    "không theo git")
    out = validate_dataset(root)
    assert out["counts"]["queries.jsonl"] == 2
    assert out["splits"] == ["development", "test"]


def test_smoke_bm25_only_and_faiss_only_execution(tmp_path):
    a = _adapter(tmp_path)
    t0 = _trace("E0")
    out0 = a.capture_retrieval("alpha", selected_sources=[], candidate_k=20, fusion_top_k=2, mode="bm25", trace=t0)
    assert [x.chunk_id for x in out0] == [1, 2] and not t0.faiss_candidates
    t1 = _trace("E1")
    out1 = a.capture_retrieval("alpha", selected_sources=[], candidate_k=20, fusion_top_k=2, mode="faiss", trace=t1)
    assert [x.chunk_id for x in out1] == [2, 1] and not t1.bm25_candidates


def test_smoke_hybrid_preserves_channels(monkeypatch, tmp_path):
    import app.domains.retrieval.ensemble_retriever as ensemble
    monkeypatch.setattr(ensemble, "hybrid_retrieve_with_ensemble", lambda *a, **k: FakeRetriever.chunks)
    trace = _trace("E2")
    out = _adapter(tmp_path).capture_retrieval("alpha", selected_sources=[], candidate_k=20, fusion_top_k=2, mode="hybrid", trace=trace)
    assert out and trace.bm25_candidates and trace.faiss_candidates and trace.fusion_candidates


def test_smoke_rerank_and_nli_trace(monkeypatch, tmp_path):
    import app.domains.retrieval.rerank as rerank
    import app.domains.retrieval.nli as nli
    monkeypatch.setattr(rerank, "rerank_texts", lambda *a, **k: [(1, 2.0), (0, 1.0)])

    class Engine:
        def predict(self, pairs):
            return [{"contradiction": 0.8}, {"contradiction": 0.7}]
    monkeypatch.setattr(nli, "get_nli", lambda: Engine())
    trace = _trace("E4")
    ranked = _adapter(tmp_path).rerank("alpha", FakeRetriever.chunks, top_n=2, source_tags=True, trace=trace)
    kept = _adapter(tmp_path).nli_filter(ranked, threshold=0.6, max_pairs=3, source_tags=True, trace=trace)
    assert [x.chunk_id for x in ranked] == [2, 1]
    assert [x.chunk_id for x in kept] == [2]
    assert trace.nli["pairs"][0]["directions"][0]["contradiction_probability"] == 0.8


def test_smoke_crag_rewrite_loop_and_repeatability(tmp_path):
    class Adapter:
        calls = 0
        def capture_retrieval(self, query, **kwargs):
            self.calls += 1
            return [RetrievedChunk(1, "alpha", "a")]
        def rerank(self, q, chunks, **kwargs): return chunks
        def nli_filter(self, chunks, **kwargs): return chunks
        def grade(self, q, chunks, *, trace, round_no, **kwargs):
            grade = "wrong" if round_no == 0 else "correct"
            trace.crag["rounds"].append({"round": round_no, "query": q, "evidence_ids": [1], "grade": grade})
            return grade
    cfg = {"retrieval": {"candidate_k": 2, "top_k": 1, "mode": "hybrid"}, "rerank": {"enabled": False},
           "nli": {"enabled": False}, "crag": {"enabled": True, "rewrite_max": 2, "correct_threshold": .25, "wrong_floor": .1},
           "memory_tree": {"enabled": False}, "hitl": {"enabled": False}, "source_tags": True}
    def execute():
        a = Adapter()
        t = EvaluationPipeline(a, generator=lambda q, c: "answer", rewriter=lambda q: q + " clarified").run(
            {"query": "alpha", "relevant_doc_ids": []}, cfg, _trace("E5"))
        return t
    first, second = execute(), execute()
    assert first.rewritten_queries == ["alpha clarified"] and first.crag["final_action"] == "correct"
    assert first.final_evidence_ids == second.final_evidence_ids


def test_smoke_memory_tree_provenance_resolution(monkeypatch, tmp_path):
    import app.domains.memory.tree as tree
    (tmp_path / "index.json").write_text(json.dumps({"1": {"source_stem": "a", "text": "alpha evidence"}}), encoding="utf-8")
    monkeypatch.setattr(tree, "query_with_memory_tree", lambda *a, **k: {"answer": "alpha", "evidence_chunk_ids": [1], "query_type": "fact", "memory_nodes": [{"id": "n1", "type": "section"}]})
    cfg = {"memory_tree": {"enabled": True}, "hitl": {"enabled": False}}
    trace = EvaluationPipeline(_adapter(tmp_path), generator=lambda q, c: "unused").run(
        {"query": "alpha", "relevant_doc_ids": []}, cfg, _trace("E6"))
    assert trace.runtime_path == "memory_tree" and trace.memory_tree["provenance_complete"]
    assert trace.memory_tree["evidence"][0]["text"] == "alpha evidence"


def test_smoke_metrics_statistics_and_output_serialization(tmp_path):
    assert retrieval_metrics([2, 1], {1}, 2) == {"recall@2": 1.0, "precision@2": 0.5, "mrr": 0.5,
                                                 "ndcg@2": pytest.approx(1 / 1.584962500721156), "n_relevant": 1}
    # Không có nhãn vàng: điểm 0 nhưng `n_relevant` = 0 để tầng gộp LOẠI câu này,
    # thay vì tính nó là một lần truy hồi trượt (xem docstring retrieval_metrics).
    assert retrieval_metrics([2, 1], set(), 2)["n_relevant"] == 0
    assert bootstrap_ci([1, 1, 1], samples=50) == (1.0, 1.0)
    assert paired_bootstrap([2, 3], [1, 2], samples=50)["mean_difference"] == 1.0
    path = tmp_path / "per_query.jsonl"
    append_jsonl(path, _trace().as_dict())
    assert json.loads(path.read_text(encoding="utf-8"))["schema_version"] == "memvid-evaluation-trace-v1"
