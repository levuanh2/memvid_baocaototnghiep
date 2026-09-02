"""Phase 2A — retriever phải được TIÊM, không được graph tự dựng.

`build_query_graph` trước đây nhận `retriever=None` rồi tự `HybridRetriever(...)`. Hệ quả
không nằm ở chỗ nó chạy sai — nó chạy đúng — mà ở chỗ tầng graph phải import lớp cụ thể và
tự biết cách ghép đường dẫn index từ `index_meta_path`. Hai thứ đó thuộc về composition
root (`main.py`), nơi đã có sẵn `INDEX_FAISS_PATH` / `INDEX_META_JSON_PATH`.

Ba thứ khoá ở đây, và không thứ nào khác:
1. graph KHÔNG import / KHÔNG dựng `HybridRetriever` nữa;
2. `retriever` là tham số BẮT BUỘC — quên truyền thì gãy ngay lúc dựng graph, không âm
   thầm rơi về một retriever tự dựng trỏ vào index khác;
3. retriever được tiêm là retriever thật sự được node truy hồi gọi.

Chất lượng xếp hạng (RRF/BM25/FAISS) không thuộc phạm vi file này — `test_retrieval_*`
đã khoá.
"""

from __future__ import annotations

import ast
import inspect
import pathlib

QUERY_GRAPH_PY = pathlib.Path(__file__).resolve().parents[1] / "app" / "graphs" / "query_graph.py"


def _import_goc(f: pathlib.Path) -> set[str]:
    """Module được import, kể cả import lười trong thân hàm (AST, không phải grep)."""
    ra: set[str] = set()
    for n in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
        if isinstance(n, ast.Import):
            ra |= {a.name for a in n.names}
        elif isinstance(n, ast.ImportFrom) and n.module and n.level == 0:
            ra.add(n.module)
    return ra


def test_query_graph_khong_import_lop_cu_the():
    assert "app.domains.retrieval.hybrid" not in _import_goc(QUERY_GRAPH_PY), (
        "query_graph import lại HybridRetriever — composition root mới là nơi biết "
        "implementation cụ thể")


def test_query_graph_khong_dung_HybridRetriever():
    """Kể cả khi ai đó import nó dưới tên khác, một lời gọi `HybridRetriever(...)` vẫn lộ."""
    goi = [
        n for n in ast.walk(ast.parse(QUERY_GRAPH_PY.read_text(encoding="utf-8")))
        if isinstance(n, ast.Call) and getattr(n.func, "id", "") == "HybridRetriever"
    ]
    assert not goi, f"query_graph tự dựng HybridRetriever ở {len(goi)} chỗ"


def test_retriever_la_tham_so_bat_buoc():
    """Có giá trị mặc định = quên truyền thì im lặng dùng retriever khác."""
    from app.graphs.query_graph import build_query_graph

    p = inspect.signature(build_query_graph).parameters["retriever"]
    assert p.default is inspect.Parameter.empty, "retriever còn default — injection không bắt buộc"


def test_wiring_bat_buoc_truyen_retriever():
    from app.wiring import build_graphs

    p = inspect.signature(build_graphs).parameters["retriever"]
    assert p.default is inspect.Parameter.empty, "wiring còn cho phép bỏ qua retriever"


def test_retriever_duoc_tiem_la_retriever_duoc_goi(monkeypatch):
    """Khoá đường đi thật: object truyền vào chính là object node truy hồi gọi."""
    from tests._qg_build import StubChunk, base_env, build, init_state, run

    base_env(monkeypatch)
    goi: list[str] = []

    class RetrieverGhiLai:
        def retrieve(self, q, **kw):
            goi.append(q)
            return [StubChunk("bang chung lien quan")]

    g, _ = build(retriever=RetrieverGhiLai())
    run(g, init_state("cau hoi cua nguoi dung"))

    assert goi == ["cau hoi cua nguoi dung"], f"retriever được tiêm không được gọi: {goi}"


def test_composition_root_dung_dung_cap_duong_dan_index(client):
    """`main.RETRIEVER` phải trỏ vào đúng cặp file mà `query_graph` từng tự suy ra
    (`INDEX_DIR/index.faiss` + `INDEX_DIR/index.json`). Lệch một cái là truy hồi đọc
    index rỗng mà không có gì kêu."""
    import app.main as be

    assert be.RETRIEVER.index_path == be.INDEX_FAISS_PATH
    assert be.RETRIEVER.meta_path == be.INDEX_META_JSON_PATH
    assert be.RETRIEVER.index_path == be.INDEX_META_JSON_PATH.with_name("index.faiss")
