"""Ba lỗ hổng của pipeline upload, tìm ra khi trace đường đi của một file (audit vòng 6).

P1. `DELETE /sources/<id>` — đường FE dùng MẶC ĐỊNH (`SidebarLeft.jsx:126`) — làm 6 bước
    dọn mà không có bước nào xoá object trên Supabase Storage, dù docstring của chính
    route đó hứa "File gốc trong input_docs/ VÀ object trên Supabase Storage". Route cũ
    `POST /delete-source` thì có. Người dùng bấm xoá, giao diện sạch, bản gốc nằm lại
    vĩnh viễn trong bucket private.

P2. `ingest_graph._persist_sections_and_chunks` fail-open (đúng cho chat) nhưng HOÀN TOÀN
    im: FAISS có chunk nên hỏi đáp chạy, `document_chunks` rỗng nên quiz/study-map/
    review/gap-analysis mất nguồn, mà tài liệu vẫn `ready`.

P3. Chế độ mở: `soft_delete` chỉ đổi `documents.status`; FAISS giữ nguyên chunk. Với
    `AUTH_PROTECT_APP_APIS=true` thì `owned_stems()` lọc đúng. Test này KHOÁ hành vi đó
    lại để lần sau đổi có người biết.
"""

from __future__ import annotations

import pytest


# ───────────────────────────────────────────────────────── P1: xoá Storage ──

def test_xoa_source_thi_xoa_luon_ban_goc_tren_storage(monkeypatch):
    """Guard `obj != input_path` phải cho qua khi hai đường dẫn KHÁC nhau."""
    import app.main as be

    da_xoa: list[str] = []
    from app.domains.documents import storage as _storage
    monkeypatch.setattr(_storage, "is_configured", lambda: True)
    monkeypatch.setattr(_storage, "delete", lambda p: (da_xoa.append(p), True)[1])

    ket_qua = be._delete_storage_object({
        "file_path": "user-1/doc-1/tai_lieu.pdf",
        "input_path": "/tmp/input_docs/tai lieu.pdf",
    })
    assert ket_qua is True
    assert da_xoa == ["user-1/doc-1/tai_lieu.pdf"]


def test_khong_goi_storage_khi_ban_goc_chinh_la_file_local(monkeypatch):
    """Storage lỗi/chưa cấu hình -> `file_path` CHÍNH LÀ đường local. Gọi
    `storage.delete` với một đường dẫn đĩa là vô nghĩa; bước xoá file local đã lo.
    Cùng guard với `_don_file_tam`."""
    import app.main as be

    from app.domains.documents import storage as _storage
    monkeypatch.setattr(_storage, "is_configured", lambda: True)
    monkeypatch.setattr(_storage, "delete", lambda p: pytest.fail(f"không được gọi: {p}"))

    duong_local = "/tmp/input_docs/a.pdf"
    assert be._delete_storage_object({"file_path": duong_local,
                                      "input_path": duong_local}) is None


def test_khong_goi_storage_khi_chua_cau_hinh(monkeypatch):
    import app.main as be

    from app.domains.documents import storage as _storage
    monkeypatch.setattr(_storage, "is_configured", lambda: False)
    monkeypatch.setattr(_storage, "delete", lambda p: pytest.fail("không được gọi"))
    assert be._delete_storage_object({"file_path": "u/d/a.pdf",
                                      "input_path": "/tmp/a.pdf"}) is None


def test_storage_xoa_that_bai_thi_bao_False_chu_khong_nem(monkeypatch):
    """Best-effort nhưng KHÔNG nuốt im — đây là rác tồn kho có tính tiền."""
    import app.main as be

    from app.domains.documents import storage as _storage
    monkeypatch.setattr(_storage, "is_configured", lambda: True)
    monkeypatch.setattr(_storage, "delete", lambda p: False)
    assert be._delete_storage_object({"file_path": "u/d/a.pdf",
                                      "input_path": "/tmp/a.pdf"}) is False


def test_route_v2_co_goi_buoc_xoa_storage():
    """Khoá lại chính lỗ hổng: route v2 phải gọi `_delete_storage_object`.

    Khẳng định CẤU TRÚC vì chạy cả route cần Postgres + FAISS + registry thật.
    Thứ cần khoá là "bước này có mặt trong danh sách dọn", đọc được từ mã nguồn.
    """
    import inspect

    import app.main as be

    src = inspect.getsource(be.delete_source_v2)
    assert "_delete_storage_object" in src, (
        "route DELETE /sources/<id> lại thiếu bước xoá Storage — bản gốc sẽ nằm lại "
        "trong bucket private vĩnh viễn, đúng lỗ hổng P1 của audit vòng 6."
    )


# ─────────────────────────────────────────── P2: ghi chunk hỏng phải nói ra ──

def test_ghi_chunk_hong_thi_capabilities_bao_structured_query_False(monkeypatch, tmp_path):
    """Fail-open giữ nguyên (chat vẫn chạy), nhưng trạng thái phải nói đúng."""
    from pathlib import Path

    from app.graphs.ingest_graph import build_ingest_graph

    monkeypatch.setenv("SKIP_MODEL_LOAD", "1")
    monkeypatch.setenv("MEMVID_DISABLE_LC_DEFAULTS", "1")
    monkeypatch.setenv("USE_LC_INGEST", "0")
    import shared.config as sc
    sc.reload()

    from app.domains.documents import repository as docs_repo
    monkeypatch.setattr(docs_repo, "replace_sections", lambda *a, **k: {})
    monkeypatch.setattr(docs_repo, "replace_chunks",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("Postgres down")))
    dem_set_counts: list = []
    monkeypatch.setattr(docs_repo, "set_counts",
                        lambda doc, **kw: dem_set_counts.append(kw))

    ghi_nhan: list[dict] = []
    f = tmp_path / "a.txt"
    f.write_text("Doan mot.\n\nDoan hai.\n", encoding="utf-8")

    graph = build_ingest_graph(
        # `status` được truyền VỊ TRÍ ở vài chỗ (`update_source_status(sid, "processing",
        # progress=...)`) nên phải nhận nó, nếu không graph chết ngay ExtractText.
        update_source_status=lambda sid, status=None, **kw: ghi_nhan.append({**kw, "status": kw.get("status", status)}),
        data_dir=tmp_path,
        extract_text=lambda p: Path(p).read_text(encoding="utf-8"),
        split_text=lambda t: [x for x in t.split("\n\n") if x.strip()],
        append_to_index=lambda **kw: [1, 2],
        build_memory_tree_for_sources=lambda stems: None,
        jobs_update=None,
    )
    graph.invoke(
        {"job_id": "p2", "source_id": "src-p2", "file_path": str(f), "filename": "a.txt"},
        config={"configurable": {"thread_id": "p2"}},
    )

    caps = [kw["capabilities"] for kw in ghi_nhan if kw.get("capabilities")]
    assert caps, f"không có lần ghi capabilities nào: {ghi_nhan}"
    assert all(c.get("structured_query") is False for c in caps), (
        f"ghi chunk hỏng mà vẫn báo dùng được quiz/study-map: {caps}"
    )
    assert all(c.get("chunk_query") is True for c in caps), (
        "fail-open cho chat phải GIỮ NGUYÊN — chỉ sửa phần báo cáo trạng thái"
    )
    assert {"chunk_count": 0} in dem_set_counts, (
        f"phải đặt chunk_count=0 (đã đo, rỗng) chứ không để None (chưa đo): {dem_set_counts}"
    )


def test_ghi_chunk_ok_thi_structured_query_True(monkeypatch, tmp_path):
    from pathlib import Path

    from app.graphs.ingest_graph import build_ingest_graph

    monkeypatch.setenv("SKIP_MODEL_LOAD", "1")
    monkeypatch.setenv("MEMVID_DISABLE_LC_DEFAULTS", "1")
    monkeypatch.setenv("USE_LC_INGEST", "0")
    import shared.config as sc
    sc.reload()

    from app.domains.documents import repository as docs_repo
    monkeypatch.setattr(docs_repo, "replace_sections", lambda *a, **k: {})
    monkeypatch.setattr(docs_repo, "replace_chunks", lambda doc, rows: len(rows))
    monkeypatch.setattr(docs_repo, "set_counts", lambda *a, **k: None)

    ghi_nhan: list[dict] = []
    f = tmp_path / "b.txt"
    f.write_text("Doan mot.\n\nDoan hai.\n", encoding="utf-8")

    graph = build_ingest_graph(
        # `status` được truyền VỊ TRÍ ở vài chỗ (`update_source_status(sid, "processing",
        # progress=...)`) nên phải nhận nó, nếu không graph chết ngay ExtractText.
        update_source_status=lambda sid, status=None, **kw: ghi_nhan.append({**kw, "status": kw.get("status", status)}),
        data_dir=tmp_path,
        extract_text=lambda p: Path(p).read_text(encoding="utf-8"),
        split_text=lambda t: [x for x in t.split("\n\n") if x.strip()],
        append_to_index=lambda **kw: [1, 2],
        build_memory_tree_for_sources=lambda stems: None,
        jobs_update=None,
    )
    graph.invoke(
        {"job_id": "p2ok", "source_id": "src-p2ok", "file_path": str(f), "filename": "b.txt"},
        config={"configurable": {"thread_id": "p2ok"}},
    )
    caps = [kw["capabilities"] for kw in ghi_nhan if kw.get("capabilities")]
    assert caps and all(c.get("structured_query") is True for c in caps), caps


def test_co_bi_LangGraph_loai_giua_hai_node_khong():
    """`structured_query` PHẢI có trong `IngestState`.

    Comment sẵn có ở `state.py` cảnh báo: LangGraph merge state chỉ giữ field khai
    trong TypedDict. Thiếu dòng khai báo thì cờ bị loại giữa EmbedAndIndex và
    BuildMemoryTree, và bước sau ghi đè capabilities bằng giá trị mặc định.
    """
    from app.graphs.state import IngestState

    assert "structured_query" in IngestState.__annotations__


# ──────────────────────────────────── P3: tài liệu xoá mềm không được lọt ──

def test_owned_stems_khong_tra_tai_lieu_da_xoa_mem(monkeypatch):
    """`all_rows()` lọc `status != deleted`, nên `owned_stems` sạch. Khoá lại."""
    import app.main as be

    monkeypatch.setenv("AUTH_PROTECT_APP_APIS", "true")
    monkeypatch.setattr(be, "_load_source_registry", lambda: {
        "d1": {"source_stem": "con_song", "user_id": "u1"},
        # tài liệu đã xoá mềm KHÔNG bao giờ xuất hiện ở đây — all_rows() đã lọc.
    })
    assert be.owned_stems("u1") == {"con_song"}
    assert be.owned_stems("u2") == set(), "không được trả stem của user khác"
    assert be.owned_stems(None) == set(), "uid None ở chế độ bảo vệ phải fail-closed"


# ────────────────────────────── P4: hai upload trùng tên chọn cùng đường dẫn ──

def test_hai_upload_trung_ten_cung_luc_khong_duoc_chon_cung_duong_dan(tmp_path, monkeypatch):
    """`_safe_save_path` phải GIÀNH được tên, không chỉ kiểm rồi trả chuỗi.

    Bản cũ là `while os.path.exists(...)` rồi trả về mà KHÔNG tạo gì; file chỉ ra đời ở
    `file.save(save_path)` sau đó. Nên khe không hẹp: hai luồng gọi cùng lúc luôn nhận
    cùng một đường dẫn, bản lưu sau đè bản trước. Gunicorn nhiều worker dùng chung
    `input_docs/` nên đây là nhiều tiến trình, không chỉ nhiều luồng.
    """
    import threading

    import app.main as be

    monkeypatch.setattr(be, "INPUT_DIR", str(tmp_path))
    barrier = threading.Barrier(2)
    ket_qua: list[str] = []

    def chay():
        barrier.wait()
        ket_qua.append(be._safe_save_path("bao_cao.pdf"))

    ts = [threading.Thread(target=chay) for _ in range(2)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()

    assert len(set(ket_qua)) == 2, f"hai luồng chọn cùng một đường dẫn: {ket_qua}"


def test_che_do_mo_khong_tra_ve_kho_toan_cuc_khi_khong_chon_nguon(monkeypatch):
    """Chế độ mở + `sources` rỗng: phải liệt kê stem trong registry, không trả [].

    `soft_delete` chỉ đổi `documents.status`; chunk trong FAISS nằm nguyên (đúng đặc tả
    8.10 "giữ dữ liệu con"). `[]` xuống tầng truy hồi nghĩa là quét TOÀN KHO, nên tài
    liệu đã xoá mềm vẫn trả lời được. `all_rows()` đã lọc `deleted` nên chỉ cần liệt kê
    ra là đủ — không thêm tầng lọc nào mới.
    """
    import app.main as be

    monkeypatch.setattr(be, "_auth_protect_enabled", lambda: False)
    monkeypatch.setattr(be, "_load_source_registry", lambda: {
        "d1": {"source_stem": "con_song", "user_id": "u1"},
        "d2": {"source_stem": "nui_cao", "user_id": None},
        # tài liệu xoá mềm KHÔNG có ở đây: all_rows() lọc `status != deleted`.
    })
    resolved, err = be._resolve_owned_query_sources([], None)
    assert err is None
    assert resolved == ["con_song", "nui_cao"], (
        "chế độ mở vẫn thấy mọi tài liệu CÒN SỐNG (không lọc theo chủ sở hữu), "
        "chỉ khác là tài liệu đã xoá mềm không còn lọt vào"
    )


def test_che_do_mo_registry_rong_van_giu_hanh_vi_cu(monkeypatch):
    """Registry rỗng -> `[]` (= toàn kho) như trước.

    Đây là mặt trái đã cân nhắc của bản vá P3: index có stem mà registry không có
    (index nhập từ ngoài, registry mất) sẽ không được tìm ở chế độ mở nữa. Nhưng khi
    registry RỖNG hẳn thì trả `[]` — cài mới hoặc kho chưa đăng ký không được biến
    thành "không tìm gì cả".
    """
    import app.main as be

    monkeypatch.setattr(be, "_auth_protect_enabled", lambda: False)
    monkeypatch.setattr(be, "_load_source_registry", lambda: {})
    assert be._resolve_owned_query_sources([], None) == ([], None)


def test_che_do_mo_van_ton_trong_danh_sach_nguon_do_nguoi_dung_chon(monkeypatch):
    """Có chọn nguồn -> giữ nguyên, không canonical hoá, không lọc. Không đổi."""
    import app.main as be

    monkeypatch.setattr(be, "_auth_protect_enabled", lambda: False)
    monkeypatch.setattr(be, "_load_source_registry", lambda: {
        "d1": {"source_stem": "con_song", "user_id": "u1"},
    })
    assert be._resolve_owned_query_sources(["nui_cao"], None) == (["nui_cao"], None)
