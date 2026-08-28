"""Index FAISS lệch số chiều với model hiện tại phải KÊU, không được im rồi tụt về BM25.

Bối cảnh: `store._load_index()` đã kiểm dim ở đường GHI (lệch thì xoá index, build lại).
Đường ĐỌC thì không: `hybrid._load_faiss_index()` đọc file rồi `idx.search(qv, k)` thẳng.
Cửa sổ hở là đổi `EMBEDDING_MODEL_NAME` rồi truy vấn TRƯỚC khi ingest lại lần nào.

Đo thật trước khi sửa — search vector 1024 chiều vào index 384 chiều:

    AssertionError :          <- message RỖNG

Cả hai caller trong `hybrid.py` bắt rồi log `"legacy FAISS search failed: %s"`, nên dòng
log ra cụt ngủn và truy hồi âm thầm tụt về BM25-only. Đúng lớp "hỏng mà không kêu" đã làm
ba sự cố tuần này khó tìm.

`__meta__["embedding_dim"]` được GHI 6 lần trong `store.py` và ĐỌC 0 lần — metadata có
sẵn, chỉ là chưa ai dùng. Guard này dùng số chiều của chính vector truy vấn nên không phụ
thuộc metadata có đúng hay không.
"""

from __future__ import annotations

import json

import faiss
import numpy as np
import pytest

from app.domains.retrieval.hybrid import HybridRetriever


def _meta(tmp_path, n=3):
    meta = {str(i): {"text": f"chunk {i}", "video": "doc.mp4", "source_stem": "doc"}
            for i in range(n)}
    meta["__meta__"] = {"version": "1.1", "num_chunks": n}
    p = tmp_path / "index.json"
    p.write_text(json.dumps(meta), encoding="utf-8")
    return p


def _index(tmp_path, dim, n=3):
    base = faiss.IndexFlatL2(dim)
    idx = faiss.IndexIDMap(base)
    idx.add_with_ids(np.random.RandomState(0).rand(n, dim).astype("float32"),
                     np.arange(n, dtype="int64"))
    p = tmp_path / "index.faiss"
    faiss.write_index(idx, str(p))
    return p


@pytest.fixture()
def retriever(tmp_path):
    return HybridRetriever(index_path=_index(tmp_path, dim=384),
                           meta_path=_meta(tmp_path))


def test_lech_dim_thi_nem_kem_giai_thich(retriever):
    """Thông điệp phải đủ để hành động: hai con số và cách dựng lại."""
    with pytest.raises(ValueError) as e:
        retriever._load_faiss_index(expected_dim=1024)
    msg = str(e.value)
    assert "384" in msg and "1024" in msg, f"phải nêu CẢ HAI số chiều: {msg}"
    assert "rebuild_chunk_index" in msg or "ingest" in msg, f"phải nói cách sửa: {msg}"


def test_khop_dim_thi_tra_index_binh_thuong(retriever):
    idx = retriever._load_faiss_index(expected_dim=384)
    assert idx.d == 384


def test_khong_truyen_dim_thi_giu_nguyen_hanh_vi_cu(retriever):
    """Guard là tuỳ chọn — caller cũ không truyền gì thì không đổi gì."""
    assert retriever._load_faiss_index().d == 384


def test_van_dung_cache_khi_co_guard(retriever, monkeypatch):
    """Guard KHÔNG được phá cache: đọc đĩa một lần dù gọi nhiều lần.

    Nếu guard vô tình đặt trước nhánh cache thì mỗi query lại read_index từ đĩa —
    biến một bản vá đúng thành một hồi quy hiệu năng trên hot path.
    """
    import app.domains.retrieval.hybrid as hy

    dem = []
    that = faiss.read_index
    monkeypatch.setattr(hy.faiss, "read_index",
                        lambda p, *a, **k: (dem.append(p), that(p, *a, **k))[1])

    for _ in range(3):
        retriever._load_faiss_index(expected_dim=384)
    assert len(dem) == 1, f"đọc đĩa {len(dem)} lần, cache hỏng"


def test_faiss_that_su_nem_loi_rong_neu_khong_co_guard(tmp_path):
    """Khoá lại LÝ DO guard tồn tại. Bỏ guard đi là quay về đúng chỗ này."""
    idx = faiss.read_index(str(_index(tmp_path, dim=384)))
    with pytest.raises(AssertionError) as e:
        idx.search(np.random.rand(1, 1024).astype("float32"), 3)
    assert str(e.value).strip() == "", "faiss đổi hành vi — xem lại lời giải thích ở guard"
