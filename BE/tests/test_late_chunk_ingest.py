"""Integration: vector late-chunk tính ở chunk_node phải chảy xuống EmbedAndIndex,
aligned 1:1 với chunks (QR sub-split đã gỡ nên entry == chunk)."""
from pathlib import Path

import numpy as np


def _md_state(tmp_path):
    f = tmp_path / "doc.md"
    f.write_text(
        "# Tiêu đề\n\n## Mục A\n\nNội dung mục A đủ dài để tạo chunk.\n\n## Mục B\n\nNội dung mục B.\n",
        encoding="utf-8",
    )
    return {
        "job_id": "j1", "source_id": "s1", "file_path": str(f), "filename": "doc.md",
        "progress": 0, "current_node": "", "artifacts": {}, "error": None,
    }


def _markdown_env(monkeypatch, tmp_path):
    monkeypatch.setenv("USE_MARKDOWN_INGEST", "1")
    monkeypatch.setenv("CHUNK_STRATEGY", "markdown_header")
    monkeypatch.setenv("CONTEXTUAL_EMBEDDINGS", "0")
    monkeypatch.setenv("HYPO_QA", "0")
    monkeypatch.setenv("MD_DIR", str(tmp_path / "md"))
    import shared.config as cfg
    cfg.reload()
    return cfg


def test_late_embeddings_flow_to_append(tmp_path, monkeypatch):
    monkeypatch.setenv("SKIP_MODEL_LOAD", "0")  # cho phép nhánh late chunking chạy
    cfg = _markdown_env(monkeypatch, tmp_path)

    # Fake encoder: vector của span i = [i,i,i,i] → dễ kiểm tra mapping.
    class FakeEnc:
        def warmup(self):
            pass

        def embed_document(self, text, spans):
            return np.array([[float(i)] * 4 for i in range(len(spans))], dtype="float32")

        def embed_query(self, t):
            return np.array([[-1.0, -1.0, -1.0, -1.0]], dtype="float32")

    import app.domains.ingest.late_chunk as lc
    monkeypatch.setattr(lc, "get_late_chunk_encoder", lambda *a, **k: FakeEnc())

    captured = {}

    def fake_append(chunks, source_name, custom_metadata=None, batch_size=32, embeddings=None):
        captured["chunks"] = chunks
        captured["source_name"] = source_name
        captured["embeddings"] = embeddings
        captured["custom_metadata"] = custom_metadata

    from app.graphs.ingest_graph import build_ingest_graph

    g = build_ingest_graph(
        update_source_status=lambda *a, **k: None,
        data_dir=tmp_path,
        extract_text=lambda p: Path(p).read_text(encoding="utf-8"),
        split_text=lambda t: [t],
        append_to_index=fake_append,
        build_memory_tree_for_sources=lambda srcs: None,
        jobs_update=None,
    )

    out = g.invoke(_md_state(tmp_path), config={"configurable": {"thread_id": "j1"}})

    assert out.get("error") is None, out.get("error")
    embs = captured.get("embeddings")
    assert embs is not None, "embed_index phải truyền embeddings precomputed (late chunking)"
    cm = captured["custom_metadata"]
    chunks = captured["chunks"]
    assert embs.shape == (len(chunks), 4)
    assert len(cm) == len(chunks), "1 metadata / 1 chunk"
    # vector của chunk i = span i (fake encoder) → mapping giữ đúng thứ tự
    for i in range(len(chunks)):
        assert np.allclose(embs[i], np.full(4, float(i))), f"chunk {i} lệch vector"

    assert [m["chunk_index"] for m in cm] == list(range(len(chunks)))
    assert all(m.get("source_stem") for m in cm)
    assert all("video" not in m and "frame_index" not in m for m in cm)

    cfg.reload()


def test_late_chunking_config_flag_disables_even_when_model_load_allowed(tmp_path, monkeypatch):
    """2026-09-23 fix: LATE_CHUNKING=0 was never actually read at the ingest_graph
    call site -- only SKIP_MODEL_LOAD gated it, so this config knob (the documented
    emergency kill-switch for BAAI/bge-m3's ~2GB in-process load) was silently a
    no-op. This locks that LATE_CHUNKING=0 alone is now sufficient to skip it,
    independent of SKIP_MODEL_LOAD."""
    monkeypatch.setenv("SKIP_MODEL_LOAD", "0")  # model load otherwise allowed
    monkeypatch.setenv("LATE_CHUNKING", "0")    # but explicitly disabled
    cfg = _markdown_env(monkeypatch, tmp_path)

    called = []

    class ExplodingEnc:
        def warmup(self):
            called.append(True)
            raise AssertionError("late-chunk encoder must not load when LATE_CHUNKING=0")

    import app.domains.ingest.late_chunk as lc
    monkeypatch.setattr(lc, "get_late_chunk_encoder", lambda *a, **k: ExplodingEnc())

    captured = {}

    def fake_append(chunks, source_name, custom_metadata=None, batch_size=32, embeddings=None):
        captured["embeddings"] = embeddings

    from app.graphs.ingest_graph import build_ingest_graph

    g = build_ingest_graph(
        update_source_status=lambda *a, **k: None,
        data_dir=tmp_path,
        extract_text=lambda p: Path(p).read_text(encoding="utf-8"),
        split_text=lambda t: [t],
        append_to_index=fake_append,
        build_memory_tree_for_sources=lambda srcs: None,
        jobs_update=None,
    )

    out = g.invoke(_md_state(tmp_path), config={"configurable": {"thread_id": "j1"}})

    assert out.get("error") is None, out.get("error")
    assert called == [], "late-chunk encoder was invoked despite LATE_CHUNKING=0"
    assert captured.get("embeddings") is None

    cfg.reload()


def test_heading_path_aligned_with_chunks(tmp_path, monkeypatch):
    """heading_path đi kèm đúng chunk — chunk_headings aligned 1:1 với chunks."""
    monkeypatch.setenv("SKIP_MODEL_LOAD", "1")  # không cần vector cho test này
    cfg = _markdown_env(monkeypatch, tmp_path)

    captured = {}

    def fake_append(chunks, source_name, custom_metadata=None, batch_size=32, embeddings=None):
        captured["custom_metadata"] = custom_metadata
        captured["chunks"] = chunks

    from app.graphs.ingest_graph import build_ingest_graph

    g = build_ingest_graph(
        update_source_status=lambda *a, **k: None,
        data_dir=tmp_path,
        extract_text=lambda p: Path(p).read_text(encoding="utf-8"),
        split_text=lambda t: [t],
        append_to_index=fake_append,
        build_memory_tree_for_sources=lambda srcs: None,
        jobs_update=None,
    )

    out = g.invoke(_md_state(tmp_path), config={"configurable": {"thread_id": "j1"}})

    assert out.get("error") is None, out.get("error")
    cm = captured["custom_metadata"]
    assert len(cm) == len(captured["chunks"])
    headings = [(m.get("heading_path") or "") for m in cm]
    assert any("Mục A" in h for h in headings), headings
    assert any("Mục B" in h for h in headings), headings

    cfg.reload()
