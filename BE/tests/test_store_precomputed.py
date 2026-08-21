"""Late chunking: store.py phải nhận embedding ĐÃ TÍNH SẴN (precomputed) thay vì
tự encode lại — vì vector late-chunk được mean-pool ở chunk_node, không thể tái tạo
từ text chunk (đã enrich/sub-split). Test đường raw-FAISS (không cần model)."""
import json

import numpy as np
import pytest


def _patch_paths(vs, tmp_path):
    vs.META_PATH = str(tmp_path / "index.json")
    vs.INDEX_PATH = str(tmp_path / "index.faiss")
    vs.INDEX_DIR = tmp_path


def test_append_to_index_stores_precomputed_embeddings(tmp_path, monkeypatch):
    monkeypatch.setenv("SKIP_MODEL_LOAD", "1")          # không tải model
    monkeypatch.delenv("USE_LC_VECTOR_STORE", raising=False)  # đường raw faiss
    import app.domains.vectorstore.store as vs

    _patch_paths(vs, tmp_path)

    chunks = ["alpha chunk", "beta chunk", "gamma chunk"]
    dim = 8
    embs = np.random.RandomState(0).rand(3, dim).astype("float32")

    vs.append_to_index(
        chunks=chunks,
        source_name="doc",
        embeddings=embs,
        custom_metadata=[{"source_stem": "doc"}] * 3,
    )

    import faiss

    idx = faiss.read_index(vs.INDEX_PATH)
    assert idx.ntotal == 3, "phải add đủ 3 vector dù SKIP_MODEL_LOAD (vì có embeddings)"
    assert idx.d == dim, "dùng đúng dim của embeddings precomputed"

    meta = json.load(open(vs.META_PATH, encoding="utf-8"))
    assert meta["__meta__"]["pooling"] == "mean_late", "đánh dấu scheme để phát hiện index cũ"
    assert meta["__meta__"]["embedding_dim"] == dim
    texts = [v["text"] for k, v in meta.items() if k.isdigit()]
    assert set(texts) == set(chunks)


def test_lc_path_precomputed_no_get_embeddings_shadow(tmp_path, monkeypatch):
    """Đường LangChain FAISS với embeddings precomputed phải chạy được (regression:
    `from ... import get_embeddings` trong hàm từng shadow biến module-level →
    UnboundLocalError ở `emb = get_embeddings()`)."""
    monkeypatch.setenv("SKIP_MODEL_LOAD", "1")          # get_embeddings -> FakeEmbeddings(384)
    monkeypatch.setenv("USE_LC_VECTOR_STORE", "1")      # ép đường LangChain
    import app.domains.vectorstore.store as vs

    _patch_paths(vs, tmp_path)
    embs = np.random.RandomState(1).rand(2, 384).astype("float32")
    vs.append_to_index(
        chunks=["a", "b"],
        source_name="d",
        embeddings=embs,
        custom_metadata=[{"source_stem": "d"}] * 2,
    )
    meta = json.load(open(vs.META_PATH, encoding="utf-8"))
    assert meta["__meta__"]["pooling"] == "mean_late"
    assert meta["__meta__"]["vector_backend"] == "langchain_faiss"
    assert meta["__meta__"]["embedding_dim"] == 384


def test_append_to_index_rejects_mismatched_embedding_count(tmp_path, monkeypatch):
    monkeypatch.setenv("SKIP_MODEL_LOAD", "1")
    monkeypatch.delenv("USE_LC_VECTOR_STORE", raising=False)
    import app.domains.vectorstore.store as vs

    _patch_paths(vs, tmp_path)
    with pytest.raises(Exception):
        vs.append_to_index(
            chunks=["a", "b", "c"],
            embeddings=np.zeros((2, 8), dtype="float32"),  # lệch số lượng
        )


def test_append_writes_sqlite_and_inline_text(tmp_path, monkeypatch):
    monkeypatch.setenv("SKIP_MODEL_LOAD", "1")
    monkeypatch.delenv("USE_LC_VECTOR_STORE", raising=False)
    import app.domains.vectorstore.store as vs
    import app.domains.vectorstore.chunk_text_store as cts
    _patch_paths(vs, tmp_path)
    cts.reset_cache()
    import numpy as np
    vs.append_to_index(
        chunks=["alpha", "beta"], source_name="doc",
        embeddings=np.zeros((2, 8), dtype="float32"),
        custom_metadata=[{"chunk_index": 0}, {"chunk_index": 1}],
    )
    meta = json.load(open(vs.META_PATH, encoding="utf-8"))
    # QR/video đã gỡ: sqlite là nguồn runtime, index.json giữ bản sao inline.
    assert meta["0"]["text"] == "alpha", "index.json giữ inline text"
    assert meta["0"]["source_stem"] == "doc"
    assert cts.get_text(0) == "alpha", "text nằm ở sqlite"


def test_append_keeps_inline_text(tmp_path, monkeypatch):
    monkeypatch.setenv("SKIP_MODEL_LOAD", "1")
    monkeypatch.delenv("USE_LC_VECTOR_STORE", raising=False)
    import app.domains.vectorstore.store as vs
    import app.domains.vectorstore.chunk_text_store as cts
    _patch_paths(vs, tmp_path)
    cts.reset_cache()
    import numpy as np
    vs.append_to_index(chunks=["x"], source_name="", embeddings=np.zeros((1, 8), dtype="float32"))
    meta = json.load(open(vs.META_PATH, encoding="utf-8"))
    assert meta["0"].get("text") == "x", "index.json luôn giữ inline text"


def test_search_index_text_from_sqlite(tmp_path, monkeypatch):
    monkeypatch.setenv("SKIP_MODEL_LOAD", "1")
    import app.domains.vectorstore.store as vs
    import app.domains.vectorstore.chunk_text_store as cts
    vs.INDEX_DIR = tmp_path
    vs.META_PATH = str(tmp_path / "index.json")
    vs.INDEX_PATH = str(tmp_path / "index.faiss")
    cts.reset_cache()
    import json
    json.dump({"0": {"source_stem": "d"}}, open(vs.META_PATH, "w", encoding="utf-8"))
    cts.put_many([(0, "hello world")])
    assert cts.get_text(0) == "hello world"


