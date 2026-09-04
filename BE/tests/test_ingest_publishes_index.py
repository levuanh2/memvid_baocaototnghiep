"""Ingest xong thì index BỀN phải chứa vector vừa thêm.

Lỗi đã đo trên production 2026-09-05: `append_to_index` đưa index runtime từ 3 lên 4
vector và gán `embedding_id='3'` cho chunk mới, nhưng không ai gọi publish — Supabase
vẫn giữ bản 3 vector. Container bị thay là vector mới mất, còn `document_chunks` vẫn
trỏ vào ô số 3 không tồn tại. Tài liệu vẫn được báo `completed`.

Ba khẳng định ở đây, theo đúng thứ tự quan trọng:
  1. đường ingest CÓ gọi xuất bản, trong cùng khoá với append
  2. xuất bản hỏng thì tài liệu KHÔNG được đi tiếp tới `completed`
  3. chưa bật persistence thì không đổi gì — máy dev và CI phải chạy như cũ
"""

from __future__ import annotations

import ast
import inspect
import threading

import pytest

from app.domains.vectorstore import persistence as ps


# ── 1. Ngữ nghĩa của hàm xuất bản sau ingest ──────────────────────────────
def test_chua_bat_thi_no_op_va_KHONG_nem(monkeypatch):
    """Máy dev và CI không có kho object; ở đó index cục bộ là bản duy nhất."""
    monkeypatch.delenv("INDEX_PERSISTENCE_ENABLED", raising=False)
    ra = ps.cong_bo_sau_ingest()
    assert ra["published"] is False and ra["bat_buoc"] is False


def test_bat_roi_ma_day_hong_thi_NEM(monkeypatch):
    """Khác `publish_sau_rebuild` — ở đó nuốt lỗi là đúng, ở đây là giấu mất dữ liệu."""
    monkeypatch.setenv("INDEX_PERSISTENCE_ENABLED", "1")
    monkeypatch.setattr(ps, "publish", lambda *a, **k: (_ for _ in ()).throw(
        RuntimeError("bucket 500")))
    with pytest.raises(ps.PublishFailed) as e:
        ps.cong_bo_sau_ingest()
    assert "RuntimeError" in str(e.value)


def test_bat_roi_ma_chua_cau_hinh_kho_cung_NEM(monkeypatch):
    """Bật persistence nhưng thiếu credential là CẤU HÌNH SAI, không phải chế độ chạy.
    Im lặng ở đây tạo ra đúng tình trạng production 2026-09-04: bật mà không lưu."""
    monkeypatch.setenv("INDEX_PERSISTENCE_ENABLED", "1")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    with pytest.raises(ps.PublishFailed):
        ps.cong_bo_sau_ingest()


def test_publish_sau_rebuild_VAN_nuot_loi(monkeypatch):
    """Đường rebuild giữ nguyên ngữ nghĩa cũ: index vừa dựng vẫn dùng được, một lần
    đứt mạng không được biến thành lượt rebuild thất bại."""
    monkeypatch.setenv("INDEX_PERSISTENCE_ENABLED", "1")
    monkeypatch.setattr(ps, "publish", lambda *a, **k: (_ for _ in ()).throw(
        RuntimeError("bucket 500")))
    ra = ps.publish_sau_rebuild()
    assert ra["published"] is False and "lỗi" in ra["ly_do"]


# ── 2. Đường ingest thật sự gọi xuất bản, trong cùng khoá với append ──────
def _than_node_embed() -> str:
    from app.graphs import ingest_graph as ig

    src = inspect.getsource(ig.build_ingest_graph)
    i = src.index("def embed_index_node")
    j = src.index("def memory_tree_node", i)
    return src[i:j]


def test_node_ingest_co_goi_xuat_ban():
    than = _than_node_embed()
    assert "cong_bo_sau_ingest()" in than, "đường ingest phải xuất bản index"


def test_xuat_ban_nam_TRONG_khoa_cung_voi_append():
    """Tách append khỏi publish là mở cửa cho hai lượt upload đè nhau. Khẳng định
    bằng AST: cả `append_to_index` lẫn `cong_bo_sau_ingest` phải nằm trong thân một
    `with` — không phải chỉ cùng xuất hiện trong hàm."""
    than = _than_node_embed()
    cay = ast.parse("def _x():\n" + "\n".join("    " + d for d in than.splitlines()[1:]))

    def _ten(n):
        f = n.func
        return f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", "")

    trong_with = set()
    for n in ast.walk(cay):
        if isinstance(n, ast.With):
            for c in ast.walk(n):
                if isinstance(c, ast.Call):
                    trong_with.add(_ten(c))
    assert "append_to_index" in trong_with, "append phải nằm trong khoá"
    assert "cong_bo_sau_ingest" in trong_with, "xuất bản phải nằm CÙNG khoá với append"


def test_khoa_index_la_khoa_that():
    from app.graphs import ingest_graph as ig

    assert isinstance(ig._KHOA_INDEX, type(threading.Lock()))


# ── 3. Xuất bản hỏng thì tài liệu KHÔNG được thành completed ─────────────
def test_publish_hong_thi_node_tra_error(monkeypatch, tmp_path):
    """Chạy THẬT node EmbedAndIndex với publish hỏng. Node phải trả `error`, và
    LangGraph định tuyến `error` sang ErrorHandler -> status `error` -> DB `failed`.
    Tức tài liệu KHÔNG bao giờ chạm `ready`/`completed`."""
    from app.graphs import ingest_graph as ig

    monkeypatch.setenv("INDEX_PERSISTENCE_ENABLED", "1")
    monkeypatch.setattr(ps, "publish", lambda *a, **k: (_ for _ in ()).throw(
        RuntimeError("bucket 500")))

    # Không dựng cả graph — chỉ chạy node, phụ thuộc thay bằng hàm giả qua closure.
    monkeypatch.setattr(ig, "log_node_event", lambda *a, **k: None)
    node = _lay_node(
        ig, "embed_index_node",
        append_to_index=lambda **k: [7],
        _persist_sections_and_chunks=lambda *a, **k: True,
        update_source_status=lambda *a, **k: None,
        _set_job=lambda *a, **k: None,
    )

    ra = node({"job_id": "j", "source_id": "d", "chunks": ["doan mot"],
               "headings": [""], "source_stem": "s", "filename": "a.txt"})
    assert ra.get("error"), "publish hỏng mà node không báo lỗi"
    assert "kho bền" in ra["error"], ra["error"]

    dinh_tuyen = _lay_node(ig, "_route_err_or_continue")
    assert dinh_tuyen(ra) == "ErrorHandler", "lỗi này phải đi tới ErrorHandler"


def _lay_node(ig, ten: str, **bien_dong):
    """Lấy node lồng trong `build_ingest_graph` ra để chạy THẬT mã production.

    Node đóng biến trên tham số của hàm bao (`append_to_index`, `update_source_status`…),
    nên phải dựng closure bằng tay. Tên nào không được truyền thì cấp một hàm no-op —
    an toàn vì test chỉ quan tâm nhánh xuất bản. Thiếu tên nào so với `co_freevars` thì
    `FunctionType` nổ ngay, chứ không âm thầm chạy một bản khác."""
    import types

    for c in ig.build_ingest_graph.__code__.co_consts:
        if getattr(c, "co_name", "") != ten:
            continue
        o: list = []
        for ten_bien in c.co_freevars:
            gt = bien_dong.get(ten_bien, lambda *a, **k: None)
            o.append(types.CellType(gt))
        return types.FunctionType(c, ig.__dict__, closure=tuple(o))
    pytest.skip(f"không tìm thấy {ten}")
