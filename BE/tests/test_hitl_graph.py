"""HITL: interrupt() trước Finalize + resume bằng Command(resume=...)."""

from __future__ import annotations

from langgraph.types import Command
import pytest

from tests._qg_build import base_env, build, init_state, run


def _interrupt_value(g, cfg):
    """langgraph 0.2.x: interrupt phát hiện qua get_state().tasks[].interrupts."""
    st = g.get_state(cfg)
    assert st.next, f"expected paused graph, next={st.next}"
    for task in st.tasks:
        if getattr(task, "interrupts", None):
            return task.interrupts[0].value
    raise AssertionError("no interrupt found in tasks")


def test_hitl_off_no_interrupt(monkeypatch):
    base_env(monkeypatch, HITL_ENABLED="0")
    g, _ = build()
    out = run(g, init_state("q"))
    assert "__interrupt__" not in out
    assert out["payload"]["answer"] == "generated answer"


def test_hitl_interrupts_then_approves(monkeypatch):
    base_env(monkeypatch, HITL_ENABLED="1")
    g, _ = build()
    cfg = {"configurable": {"thread_id": "hitl-1"}}
    g.invoke(init_state("q"), config=cfg)
    val = _interrupt_value(g, cfg)
    assert val["type"] == "review"
    assert val["answer"] == "generated answer"
    final = g.invoke(Command(resume={"action": "approve"}), config=cfg)
    assert final["payload"]["answer"] == "generated answer"
    assert final.get("awaiting_review") is False


def test_hitl_edit_overrides_answer(monkeypatch):
    base_env(monkeypatch, HITL_ENABLED="1")
    g, _ = build()
    cfg = {"configurable": {"thread_id": "hitl-2"}}
    g.invoke(init_state("q"), config=cfg)
    final = g.invoke(Command(resume={"action": "edit", "answer": "đã sửa"}), config=cfg)
    assert final["payload"]["answer"] == "đã sửa"


def test_hitl_reject_replaces_answer(monkeypatch):
    base_env(monkeypatch, HITL_ENABLED="1")
    g, _ = build()
    cfg = {"configurable": {"thread_id": "hitl-3"}}
    g.invoke(init_state("q"), config=cfg)
    final = g.invoke(Command(resume={"action": "reject"}), config=cfg)
    assert "từ chối" in final["payload"]["answer"].lower()


def test_hitl_reject_is_not_cached_and_identical_query_regenerates(monkeypatch):
    """query -> draft -> reject -> finalize -> same query is a cache miss."""
    base_env(monkeypatch, HITL_ENABLED="1")
    generated = {"count": 0}

    def summarize(*args, **kwargs):
        generated["count"] += 1
        return f"draft {generated['count']}"

    g, cache = build(summarize=summarize)
    first_cfg = {"configurable": {"thread_id": "hitl-reject-first"}}
    g.invoke(init_state("same query"), config=first_cfg)
    rejected = g.invoke(Command(resume={"action": "reject"}), config=first_cfg)
    assert rejected["cache_write_allowed"] is False
    assert cache == {}

    second_cfg = {"configurable": {"thread_id": "hitl-reject-second"}}
    g.invoke(init_state("same query", job_id="j2"), config=second_cfg)
    assert _interrupt_value(g, second_cfg)["answer"] == "draft 2"
    assert generated["count"] == 2


def test_hitl_reviews_cached_answer_before_finalize(monkeypatch):
    base_env(monkeypatch, HITL_ENABLED="1")
    g, cache = build()
    cache["ck::public::q"] = {"payload": {"answer": "cached answer"}, "status": 200}
    cfg = {"configurable": {"thread_id": "hitl-cache"}}
    g.invoke(init_state("q"), config=cfg)
    val = _interrupt_value(g, cfg)
    assert val["answer"] == "cached answer"
    final = g.invoke(Command(resume={"action": "approve"}), config=cfg)
    assert final["payload"]["answer"] == "cached answer"


def test_semantic_cache_preserves_resolvable_provenance(monkeypatch):
    base_env(monkeypatch, HITL_ENABLED="0")
    g, cache = build()
    first = run(g, init_state("provenance query"), thread_id="prov-first")
    key = first["cache_key"]
    assert cache[key]["evaluation_provenance"]["chunk_ids"] == [1]
    second = run(g, init_state("provenance query", job_id="j2"), thread_id="prov-second")
    assert second["runtime_path"] == "cache"
    assert second["evaluation_provenance"]["chunk_ids"] == [1]


def test_hitl_without_checkpointer_fails_closed(monkeypatch):
    base_env(monkeypatch, HITL_ENABLED="1")
    # Ép checkpointer dựng thất bại → graph không có ReviewGate.
    import app.graphs.query_graph as qg
    monkeypatch.setattr(qg, "sqlite_saver_from_path", lambda p: (_ for _ in ()).throw(RuntimeError("no ck")))
    with pytest.raises(RuntimeError, match="checkpointer"):
        build()
