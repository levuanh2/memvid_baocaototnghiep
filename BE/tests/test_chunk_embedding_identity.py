"""Danh tính embedding ghi xuống `document_chunks` phải là danh tính THẬT.

Ngày 2026-09-04, tài liệu production đầu tiên được embed bằng FPT `Vietnamese_Embedding`
trong khi `document_chunks.embedding_model` ghi `sentence-transformers/all-MiniLM-L6-v2`.
Không ai nói dối: `ingest_graph` lấy nhãn từ `shared.config.embedding_model_name`, tức
biến `EMBEDDING_MODEL_NAME` — thứ NGƯỜI TA ĐẶT — thay vì hỏi đối tượng embedding mà
`get_embeddings()` thật sự trả về. Biến đó chưa ai đặt nên rơi về mặc định.

Một cột nói sai model còn tệ hơn một cột trống: cột trống thì người đọc đi tìm, cột sai
thì người đọc tin.

KHÔNG test `embedding_id` ở đây. Trường đó là id hàng FAISS, dùng làm khoá tra ngược ở
`retrieval/search.py` — nó KHÔNG phải và không được biến thành trường danh tính.
"""

from __future__ import annotations

import inspect

import pytest

from app.clients import llm_factory as lf
from app.domains.vectorstore import allowlist as al
from app.domains.vectorstore import store as vs


def _rows(monkeypatch, **env):
    """Chạy THẬT node PersistDocument, bắt lấy các hàng nó định ghi xuống Postgres."""
    from app.domains.documents import repository as docs_repo
    from app.graphs import ingest_graph as ig

    for k, v in env.items():
        if v is None:
            monkeypatch.delenv(k, raising=False)
        else:
            monkeypatch.setenv(k, v)
    ghi: dict = {}
    monkeypatch.setattr(docs_repo, "replace_sections", lambda *a, **k: {})
    monkeypatch.setattr(docs_repo, "set_counts", lambda *a, **k: None)

    def replace_chunks_gia(document_id, chunks):
        ghi["rows"] = list(chunks)
        return len(ghi["rows"])

    monkeypatch.setattr(docs_repo, "replace_chunks", replace_chunks_gia)
    monkeypatch.setattr(ig, "log_node_event", lambda *a, **k: None)

    class Dong:
        def ms(self): return 0

    ham = _node_persist(ig)
    ok = ham({"source_id": "d-1", "job_id": "j-1"},
             ["đoạn một", "đoạn hai"], ["Tiêu đề", ""], [7, 8], Dong())
    assert ok is True, "node phải chạy xong; nó fail-open nên lỗi bị nuốt"
    return ghi["rows"]


def _node_persist(ig):
    """Lấy `_persist_sections_and_chunks` — hàm lồng trong `build_ingest_graph` — ra khỏi
    code object của hàm dựng, để test chạy ĐÚNG mã production chứ không chép lại logic.

    Dựng được vì hàm này không có freevar: nó chỉ dùng tham số của chính nó và tên ở
    mức module. Nếu ngày nào đó nó bắt đầu đóng biến từ hàm bao, `FunctionType` sẽ nổ
    ngay ở đây thay vì test âm thầm chạy một bản sao."""
    import types

    for c in ig.build_ingest_graph.__code__.co_consts:
        if getattr(c, "co_name", "") == "_persist_sections_and_chunks":
            assert not c.co_freevars, f"hàm đã đóng biến: {c.co_freevars}"
            return types.FunctionType(c, ig.__dict__)
    pytest.skip("không lấy được _persist_sections_and_chunks")


# ── 1 & 2: danh tính đi theo provider thật ────────────────────────────────
def test_fpt_thi_chunk_mang_danh_tinh_fpt(monkeypatch):
    rows = _rows(monkeypatch, FPT_AI_API_KEY="khoa-gia-cho-test",
                 FPT_AI_EMBEDDING_MODEL="Vietnamese_Embedding")
    for r in rows:
        assert r["embedding_model"] == "Vietnamese_Embedding"
        assert r["metadata_json"]["embedding_identity"] == {
            "embedding_provider": "fpt",
            "embedding_model_name": "Vietnamese_Embedding",
            "embedding_strategy": "api_pooled",
        }


def test_khong_co_fpt_thi_chunk_mang_danh_tinh_cuc_bo(monkeypatch):
    rows = _rows(monkeypatch, FPT_AI_API_KEY=None, FPT_AI_EMBEDDING_MODEL=None,
                 SKIP_MODEL_LOAD=None, LATE_CHUNKING="1",
                 EMBEDDING_MODEL_NAME="BAAI/bge-m3")
    dt = rows[0]["metadata_json"]["embedding_identity"]
    assert dt["embedding_provider"] == "local"
    assert dt["embedding_model_name"] == "BAAI/bge-m3"
    assert rows[0]["embedding_model"] == dt["embedding_model_name"]


# ── 3: nhãn cấu hình KHÔNG đánh tráo được đối tượng thật ──────────────────
def test_nhan_cau_hinh_KHONG_de_len_duoc_provider_that(monkeypatch):
    """Đây là chính xác lỗi 2026-09-04, viết ngược lại thành khẳng định.

    `EMBEDDING_MODEL_NAME` đặt một đằng, provider thật một nẻo — cột phải theo provider.
    """
    rows = _rows(monkeypatch,
                 EMBEDDING_MODEL_NAME="sentence-transformers/all-MiniLM-L6-v2",
                 FPT_AI_API_KEY="khoa-gia-cho-test",
                 FPT_AI_EMBEDDING_MODEL="Vietnamese_Embedding")
    for r in rows:
        assert r["embedding_model"] != "sentence-transformers/all-MiniLM-L6-v2"
        assert r["embedding_model"] == "Vietnamese_Embedding"


def test_ingest_graph_KHONG_doc_nhan_model_tu_cau_hinh():
    """Cấu trúc: nếu node persist còn đọc `embedding_model_name` từ settings thì lỗi cũ
    quay lại được. Khẳng định trên MÃ NGUỒN của đúng hàm đó, không phải cả file."""
    from app.graphs import ingest_graph as ig

    src = inspect.getsource(ig.build_ingest_graph)
    i = src.index("_persist_sections_and_chunks")
    than = src[i:src.index("def _finalize", i) if "def _finalize" in src[i:] else len(src)]
    assert "embedding_model_name" not in than.replace('danh_tinh.get("embedding_model_name")', "")
    assert "embedding_identity()" in than


# ── 4: client không chèn được danh tính ───────────────────────────────────
def test_node_persist_KHONG_nhan_danh_tinh_lam_tham_so():
    """Không có tham số thì không có đường cho một route chuyền giá trị từ request vào —
    cùng lý lẽ với `ingest_origin` (xem test_ingest_provenance.py)."""
    from app.graphs import ingest_graph as ig

    for c in ig.build_ingest_graph.__code__.co_consts:
        if getattr(c, "co_name", "") == "_persist_sections_and_chunks":
            ten = c.co_varnames[:c.co_argcount]
            assert not [t for t in ten if "identity" in t.lower() or "danh_tinh" in t.lower()]
            assert not [t for t in ten if "model" in t.lower()]
            return
    pytest.skip("không tìm thấy hàm")


def test_state_mang_danh_tinh_gia_thi_bi_bo_qua(monkeypatch):
    """`state` là thứ chảy qua graph và có nhánh bắt nguồn từ payload người dùng. Bơm
    một danh tính giả vào đó phải không có tác dụng gì."""
    from app.domains.documents import repository as docs_repo
    from app.graphs import ingest_graph as ig

    monkeypatch.setenv("FPT_AI_API_KEY", "khoa-gia-cho-test")
    monkeypatch.setenv("FPT_AI_EMBEDDING_MODEL", "Vietnamese_Embedding")
    ghi: dict = {}
    monkeypatch.setattr(docs_repo, "replace_sections", lambda *a, **k: {})
    monkeypatch.setattr(docs_repo, "set_counts", lambda *a, **k: None)
    monkeypatch.setattr(docs_repo, "replace_chunks",
                        lambda did, chunks: ghi.setdefault("rows", list(chunks)) and 0 or len(chunks))
    monkeypatch.setattr(ig, "log_node_event", lambda *a, **k: None)

    class Dong:
        def ms(self): return 0

    ham = _node_persist(ig)
    ham({"source_id": "d-1", "job_id": "j-1",
         "embedding_identity": {"embedding_provider": "gia-mao"},
         "embedding_model": "gia-mao", "metadata_json": {"embedding_identity": "gia-mao"}},
        ["đoạn"], [""], [1], Dong())
    dt = ghi["rows"][0]["metadata_json"]["embedding_identity"]
    assert dt["embedding_provider"] == "fpt"
    assert "gia-mao" not in str(ghi["rows"][0])


# ── 5 & 6: dữ liệu đang có không được đụng ────────────────────────────────
def test_danh_tinh_chunk_dung_dung_ba_khoa_nhu_index():
    """Chunk và `index.json` phải nói cùng một ngôn ngữ, nếu không thì không so được.
    Số chiều CỐ Ý không nằm trong bộ khoá — bge-m3 và Vietnamese_Embedding đều 1024."""
    assert set(lf.embedding_identity()) == set(vs.INDEX_IDENTITY_KEYS)
    assert "embedding_dim" not in vs.INDEX_IDENTITY_KEYS


def test_allowlist_van_dung_mot_tai_lieu_ba_chunk():
    """Phase này KHÔNG được đụng allowlist. 189 chunk cũ vẫn bị chặn, tài liệu
    production vẫn là mục duy nhất được duyệt."""
    ds = al.tai()
    assert len(ds) == 13
    duyet = [d for d in ds if al.duoc_index(d, ds, ingest_origin="production")]
    assert duyet == ["f01ac8c1-830e-45e1-a802-7713c20982c3"]
    assert ds[duyet[0]]["chunk_count"] == 3
