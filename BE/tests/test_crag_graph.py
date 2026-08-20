"""CRAG wiring trong query graph: grade → route (correct/ambiguous/wrong) → rewrite/fallback."""

from __future__ import annotations

import app.domains.retrieval.grading as grading
import app.domains.retrieval.nli as nli
import app.domains.retrieval.query_rewrite as query_rewrite
import app.domains.retrieval.rerank as rerank
from tests._qg_build import base_env, build, init_state, run


def _no_llm_rewrite(monkeypatch):
    # Tránh gọi LLM thật trong rewrite_query.
    monkeypatch.setattr(query_rewrite, "rewrite_query", lambda q, **k: q + " (rewritten)")


def test_crag_off_passthrough(monkeypatch):
    base_env(monkeypatch, CRAG_ENABLED="0")
    called = {"n": 0}
    monkeypatch.setattr(grading, "grade_documents", lambda *a, **k: called.__setitem__("n", called["n"] + 1) or "wrong")
    g, _ = build()
    out = run(g, init_state("hello"))
    assert called["n"] == 0  # grader không bao giờ chạy khi tắt
    assert out["payload"]["answer"] == "generated answer"


def test_crag_correct_generates(monkeypatch):
    base_env(monkeypatch, CRAG_ENABLED="1")
    _no_llm_rewrite(monkeypatch)
    monkeypatch.setattr(grading, "grade_documents", lambda *a, **k: "correct")
    g, _ = build()
    out = run(g, init_state("q"))
    assert out["payload"]["answer"] == "generated answer"
    assert int(out.get("rewrite_count") or 0) == 0


def test_crag_ambiguous_then_correct_one_rewrite(monkeypatch):
    base_env(monkeypatch, CRAG_ENABLED="1", CRAG_REWRITE_MAX="2")
    _no_llm_rewrite(monkeypatch)
    seq = iter(["ambiguous", "correct"])
    monkeypatch.setattr(grading, "grade_documents", lambda *a, **k: next(seq))
    g, _ = build()
    out = run(g, init_state("q"))
    assert out["payload"]["answer"] == "generated answer"
    assert int(out["rewrite_count"]) == 1


def test_crag_wrong_falls_back(monkeypatch):
    base_env(monkeypatch, CRAG_ENABLED="1", CRAG_REWRITE_MAX="1")
    _no_llm_rewrite(monkeypatch)
    monkeypatch.setattr(grading, "grade_documents", lambda *a, **k: "wrong")
    g, cache = build()
    out = run(g, init_state("q"))
    assert "không tìm thấy" in out["payload"]["answer"].lower()
    assert out["status_code"] == 200
    assert out.get("crag_fallback") is True
    assert cache == {}  # KHÔNG cache câu trả lời fallback


def test_crag_ambiguous_bounded(monkeypatch):
    base_env(monkeypatch, CRAG_ENABLED="1", CRAG_REWRITE_MAX="2")
    _no_llm_rewrite(monkeypatch)
    calls = {"n": 0}

    def _grade(*a, **k):
        calls["n"] += 1
        return "ambiguous"

    monkeypatch.setattr(grading, "grade_documents", _grade)
    g, _ = build()
    out = run(g, init_state("q"))
    # ambiguous hết budget → generate best-effort; grade gọi tối đa max+1 lần (3), rewrite_count==2.
    assert int(out["rewrite_count"]) == 2
    assert calls["n"] <= 3
    assert out["payload"]["answer"] == "generated answer"


def test_crag_rewrite_llm_failure_bounded(monkeypatch):
    base_env(monkeypatch, CRAG_ENABLED="1", CRAG_REWRITE_MAX="1")
    monkeypatch.setattr(grading, "grade_documents", lambda *a, **k: "wrong")

    def _boom(q, **k):
        raise RuntimeError("LLM down")

    monkeypatch.setattr(query_rewrite, "rewrite_query", _boom)
    g, _ = build()
    out = run(g, init_state("q"))
    # LLM rewrite lỗi vẫn không vòng lặp vô hạn → vẫn tới fallback.
    assert out.get("crag_fallback") is True
    assert int(out["rewrite_count"]) == 1


def test_crag_rewrite_is_used_for_retrieval_but_original_question_is_answered(monkeypatch):
    base_env(monkeypatch, CRAG_ENABLED="1", CRAG_REWRITE_MAX="2")
    calls = {"retrieve": [], "generate": []}

    class RecordingRetriever:
        def retrieve(self, q, **kwargs):
            calls["retrieve"].append(q)
            from tests._qg_build import StubChunk
            return [StubChunk("relevant evidence")]

    seq = iter(["ambiguous", "correct"])
    monkeypatch.setattr(grading, "grade_documents", lambda *a, **k: next(seq))
    monkeypatch.setattr(query_rewrite, "rewrite_query", lambda q, **k: "corrected retrieval query")

    def generate(q, chunks, **kwargs):
        calls["generate"].append(q)
        return "generated answer"

    g, _ = build(retriever=RecordingRetriever(), summarize=generate)
    out = run(g, init_state(
        "original user question",
        original_question="original user question",
        standalone_question="original user question",
    ))

    assert calls["retrieve"] == ["original user question", "corrected retrieval query"]
    assert calls["generate"] == ["original user question"]
    assert out["q"] == "original user question"
    assert out["rewritten_query"] == "corrected retrieval query"


def test_crag_grader_failure_falls_through_to_grounded_generation(monkeypatch):
    base_env(monkeypatch, CRAG_ENABLED="1")
    monkeypatch.setattr(grading, "grade_documents", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("grader down")))
    g, _ = build()
    out = run(g, init_state("q"))
    assert out["payload"]["answer"] == "generated answer"
    assert out["crag_status"] == "fallback"


def test_full_corrective_pipeline_executes_in_order_and_is_bounded(monkeypatch):
    base_env(
        monkeypatch,
        CRAG_ENABLED="1",
        CRAG_REWRITE_MAX="2",
        RERANK_ENABLED="1",
        RERANK_TOP_N="2",
        NLI_ENABLED="1",
        HITL_ENABLED="0",
        INCLUDE_CHUNK_SOURCE_TAGS="1",
    )
    events = []

    class RecordingRetriever:
        def retrieve(self, q, **kwargs):
            events.append(("retrieve", q))
            from tests._qg_build import StubChunk
            return [StubChunk("evidence one", cid=1), StubChunk("evidence two", cid=2)]

    monkeypatch.setattr(rerank, "rerank_texts", lambda q, texts, top_n=None: events.append(("rerank", q)) or [(0, 2.0), (1, 1.0)])
    monkeypatch.setattr(nli, "detect_conflicts", lambda texts, **kwargs: events.append(("nli", len(texts))) or [])
    grades = iter(["ambiguous", "correct"])
    monkeypatch.setattr(grading, "grade_documents", lambda q, *a, **k: events.append(("grade", q)) or next(grades))
    monkeypatch.setattr(query_rewrite, "rewrite_query", lambda q, **k: events.append(("rewrite", q)) or "corrected q")

    def generate(q, chunks, **kwargs):
        events.append(("generate", q))
        return "generated answer"

    g, _ = build(retriever=RecordingRetriever(), summarize=generate)
    out = run(g, init_state("original q", original_question="original q", standalone_question="original q"))

    assert [name for name, _ in events] == [
        "retrieve", "rerank", "nli", "grade", "rewrite",
        "retrieve", "rerank", "nli", "grade", "generate",
    ]
    assert out["rewrite_count"] == 1
    assert out["payload"]["answer"] == "generated answer"
    assert all(str(c).startswith("[Nguồn: doc, đoạn ") for c in out["retrieved_chunks"])
