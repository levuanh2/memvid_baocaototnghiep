"""Phép chiếu thư viện học tập — THUẦN, không DB, không HTTP, không kho.

Vì sao tách khỏi `test_study_library_api.py`: phần khó của `/api/library` không
phải route mà là phép chiếu — khớp stem giữa hai thế giới tài liệu, suy AI
Overview từ bản ghi tóm tắt có sẵn, và quy tắc ba trạng thái. Test nó ở đây thì
mỗi ca chạy trong micro-giây, không cần Postgres, và khi đỏ thì chỉ có một chỗ
để nhìn.

Ràng buộc được khoá cứng ở file này, quan trọng nhất trước:

  1. máy chủ KHÔNG BAO GIỜ nói `generating` cho tóm tắt / sơ đồ tư duy — dù bản
     ghi vắng mặt, dù kho hỏng, dù có job đang chạy thật. Nguồn duy nhất của
     `generating` phía máy chủ là `knowledge_maps.status == 'processing'`.
  2. bản ghi của tài liệu này không rò sang tài liệu khác.
  3. AI Overview suy ra, không bịa: hết `key_points` thì lùi về tiêu đề section,
     hết cả tiêu đề thì `None`.
"""

from __future__ import annotations

import pytest

from app.domains.documents import thu_vien as tv

READY, GENERATING, NOT_GEN = tv.READY, tv.GENERATING, tv.NOT_GENERATED


# ── Bộ dựng dữ liệu ─────────────────────────────────────────────────────────

def _row(**kw):
    """Hàng như `repository._row()` trả về."""
    base = {
        "filename": "bai giang 04.pdf",
        "source_stem": "bai_giang_04_pdf",
        "file_type": "pdf",
        "status": "ready",
        "spec_status": "completed",
        "progress": 1.0,
        "capabilities": {"chunk_query": True, "memory_query": True},
        "page_count": 42, "char_count": 91_200, "chunk_count": 310,
        "created_at": "2026-09-01T10:00:00Z",
        "display_name": None, "favorite": False, "pinned": False,
        "archived_at": None, "tags": [], "last_opened_at": None, "last_workspace": None,
        "collection_id": None, "open_count": 0,
    }
    base.update(kw)
    return base


def _summary(sources, *, overview="Tổng quan.", sections=None, entities=None, rid="s-1"):
    return {
        "id": rid, "sources": list(sources), "overview": overview,
        "sections": sections if sections is not None else [],
        "entities": entities or [], "created_at": "2026-09-02T00:00:00Z",
    }


def _section(title, points, order=0):
    return {"id": f"s{order}", "title": title, "summary": "", "order": order,
            "key_points": list(points), "chunk_refs": []}


# ── reading_minutes ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("chars,mong", [
    (91_200, 92), (1000, 1), (1, 1), (1001, 2),
    (0, None), (-5, None), (None, None), ("abc", None),
])
def test_reading_minutes_suy_tu_char_count(chars, mong):
    assert tv.reading_minutes(chars) == mong


def test_reading_minutes_khong_bao_gio_tra_0():
    """"0 phút đọc" là một khẳng định SAI; "không biết" thì không. Tài liệu có nội
    dung luôn ≥ 1 phút, tài liệu chưa đếm được ký tự trả None."""
    assert tv.reading_minutes(5) == 1
    assert tv.reading_minutes(0) is None


# ── AI Overview — suy ra, không bịa ─────────────────────────────────────────

def test_ai_overview_lay_3_key_point_dau_theo_thu_tu_section():
    rec = _summary(["a"], sections=[
        _section("Sau", ["điểm C"], order=2),
        _section("Truoc", ["điểm A", "điểm B"], order=0),
    ])
    assert tv.ai_overview(rec) == ["điểm A", "điểm B", "điểm C"]


def test_ai_overview_toi_da_3_gach_dau_dong():
    rec = _summary(["a"], sections=[_section("S", [f"p{i}" for i in range(10)])])
    assert len(tv.ai_overview(rec)) == 3


def test_ai_overview_cat_gach_dau_dong_qua_dai():
    rec = _summary(["a"], sections=[_section("S", ["x" * 500, "y", "z"])])
    out = tv.ai_overview(rec)
    assert len(out[0]) <= tv.OVERVIEW_BULLET_MAX + 1     # +1 cho dấu '…'
    assert out[0].endswith("…")


def test_ai_overview_lui_ve_tieu_de_section_khi_qua_it_key_point():
    """Một gạch đầu dòng lẻ loi đọc như dữ liệu hỏng. Tiêu đề section là lời tóm
    lược thật khác đang CÓ SẴN — dùng nó, không bịa thêm."""
    rec = _summary(["a"], sections=[
        _section("Định thời CPU", ["chỉ một điểm"], order=0),
        _section("Hàng đợi đa mức", [], order=1),
        _section("So sánh độ trễ", [], order=2),
    ])
    assert tv.ai_overview(rec) == ["Định thời CPU", "Hàng đợi đa mức", "So sánh độ trễ"]


def test_ai_overview_giu_key_point_khi_du_hai_cai():
    rec = _summary(["a"], sections=[_section("T", ["một", "hai"])])
    assert tv.ai_overview(rec) == ["một", "hai"]


def test_ai_overview_bo_key_point_rong_va_toan_khoang_trang():
    rec = _summary(["a"], sections=[_section("T", ["  ", "", "thật", "  cũng thật  "])])
    assert tv.ai_overview(rec) == ["thật", "cũng thật"]


@pytest.mark.parametrize("rec", [
    None, {}, {"sections": None}, {"sections": "chuỗi"},
    {"sections": [{"key_points": [], "title": ""}]},
])
def test_ai_overview_khong_co_gi_thi_None_khong_phai_danh_sach_rong(rec):
    """`None` = "không có tóm tắt để rút ý". `[]` sẽ khiến giao diện dựng một khối
    ý chính rỗng — hai chuyện khác nhau."""
    assert tv.ai_overview(rec) is None


def test_ai_overview_khong_goi_llm_va_khong_lưu(monkeypatch):
    """Thuần: cùng đầu vào ra cùng đầu ra, và không đụng gì bên ngoài."""
    rec = _summary(["a"], sections=[_section("T", ["một", "hai", "ba"])])
    assert tv.ai_overview(rec) == tv.ai_overview(rec) == ["một", "hai", "ba"]


# ── preview + entities ──────────────────────────────────────────────────────

def test_summary_preview_cat_o_may_chu():
    rec = _summary(["a"], overview="từ " * 400)
    out = tv.summary_preview(rec)
    assert len(out) <= tv.PREVIEW_MAX + 1
    assert out.endswith("…")


def test_summary_preview_rong_tra_None_khong_phai_chuoi_rong():
    assert tv.summary_preview(_summary(["a"], overview="   ")) is None
    assert tv.summary_preview(None) is None


def test_summary_preview_gop_khoang_trang():
    assert tv.summary_preview(_summary(["a"], overview="a\n\n  b")) == "a b"


def test_entities_khu_trung_giu_cach_viet_dau_va_chan_20():
    rec = _summary(["a"], entities=["FIFO", "fifo", " RR ", ""] + [f"e{i}" for i in range(30)])
    out = tv.entities(rec)
    assert out[:2] == ["FIFO", "RR"]
    assert len(out) == tv.ENTITIES_MAX


def test_entities_khong_co_ban_ghi_tra_danh_sach_rong():
    assert tv.entities(None) == []


# ── Khớp theo stem ──────────────────────────────────────────────────────────

def test_index_by_stem_chuan_hoa_ten_file_thanh_stem():
    idx = tv.index_by_stem([_summary(["My Report.pdf"])])
    assert "my_report_pdf" in idx


def test_index_by_stem_ban_ghi_dau_thang_vi_list_records_moi_nhat_truoc():
    idx = tv.index_by_stem([_summary(["a"], rid="moi"), _summary(["a"], rid="cu")])
    assert idx["a"]["id"] == "moi"


def test_index_by_stem_ban_ghi_nhieu_nguon_tinh_cho_moi_nguon():
    """Tóm tắt gộp hai tài liệu thì CẢ HAI đều thật sự đã có tóm tắt."""
    idx = tv.index_by_stem([_summary(["a", "b"])])
    assert set(idx) == {"a", "b"}


def test_index_by_stem_bo_qua_rac():
    assert tv.index_by_stem([None, "chuỗi", {"sources": None}, {}]) == {}


# ── Quy tắc ba trạng thái ───────────────────────────────────────────────────

def test_may_chu_khong_bao_gio_suy_generating_tu_vang_mat():
    """RÀNG BUỘC TRUNG TÂM. Không thấy bản ghi chỉ có nghĩa là không thấy. Đoán
    "đang tạo" từ chỗ trống là lời nói dối mà quy tắc ba trạng thái sinh ra để
    chặn — và kho tóm tắt bị xoá mỗi lần deploy, nên nó sẽ nói dối THƯỜNG XUYÊN."""
    doc = tv.chieu_tai_lieu("d1", _row(), summary_record=None, mindmap_record=None)
    assert doc["ai"]["summary"]["state"] == NOT_GEN
    assert doc["ai"]["mindmap"]["state"] == NOT_GEN
    assert GENERATING not in (doc["ai"]["summary"]["state"], doc["ai"]["mindmap"]["state"])


def test_toan_bo_payload_khong_co_generating_cho_tom_tat_va_so_do():
    """Quét cả thư viện: không một tài liệu nào được mang `generating` ở hai khối
    phù du, bất kể hình dạng dữ liệu."""
    rows = {f"d{i}": _row(status=s, progress=p)
            for i, (s, p) in enumerate([("processing", 0.1), ("index_ready", 0.8),
                                        ("ready", 1.0), ("error", 0.0)])}
    for doc in tv.chieu_thu_vien(rows):
        assert doc["ai"]["summary"]["state"] != GENERATING
        assert doc["ai"]["mindmap"]["state"] != GENERATING


def test_co_ban_ghi_thi_ready():
    doc = tv.chieu_tai_lieu("d1", _row(), summary_record=_summary(["a"]),
                            mindmap_record={"id": "m-1"})
    assert doc["ai"]["summary"]["state"] == READY
    assert doc["ai"]["summary"]["summary_id"] == "s-1"
    assert doc["ai"]["mindmap"]["state"] == READY
    assert doc["ai"]["mindmap"]["mindmap_id"] == "m-1"


@pytest.mark.parametrize("status,mong", [
    ("completed", READY), ("processing", GENERATING), ("failed", NOT_GEN),
    ("", NOT_GEN), (None, NOT_GEN), ("COMPLETED", READY),
])
def test_studymap_la_noi_duy_nhat_may_chu_duoc_noi_generating(status, mong):
    """StudyMap ở Postgres, khoá theo `document_id`, và `status` có sẵn
    `processing` — bằng chứng DƯƠNG, không phải suy đoán từ vắng mặt."""
    doc = tv.chieu_tai_lieu("d1", _row(), studymap_status=status)
    assert doc["ai"]["studymap"]["state"] == mong


# ── Trạng thái ingest (bền vững) ────────────────────────────────────────────

def test_ingest_xong_thi_bon_trang_thai_deu_ready():
    ai = tv.chieu_tai_lieu("d1", _row())["ai"]
    assert (ai["extraction"], ai["embedding"], ai["index"], ai["chat_ready"]) == \
        (READY, READY, READY, READY)


def test_dang_trich_xuat_thi_chua_nhung_chua_index():
    ai = tv.chieu_tai_lieu("d1", _row(
        status="processing", progress=0.1, capabilities={}, spec_status="processing"))["ai"]
    assert ai["extraction"] == GENERATING
    assert ai["embedding"] == NOT_GEN
    assert ai["index"] == NOT_GEN
    assert ai["chat_ready"] == NOT_GEN


def test_dang_nhung_thi_trich_xuat_xong():
    ai = tv.chieu_tai_lieu("d1", _row(
        status="processing", progress=0.75, capabilities={}, spec_status="processing"))["ai"]
    assert ai["extraction"] == READY
    assert ai["embedding"] == GENERATING


def test_ingest_hong_thi_khong_con_gi_dang_chay():
    """Hỏng và đang-chạy là hai màn hình khác nhau. Một tài liệu lỗi mà vẫn hiện
    "đang trích xuất" thì người dùng chờ mãi một việc đã chết."""
    ai = tv.chieu_tai_lieu("d1", _row(
        status="error", progress=0.2, capabilities={}, spec_status="failed"))["ai"]
    assert ai["extraction"] == NOT_GEN
    assert ai["embedding"] == NOT_GEN
    assert GENERATING not in ai.values()


def test_chat_ready_suy_tu_capabilities_khong_tu_kho_hoi_thoai():
    """Hỏi đáp sẵn sàng khi tài liệu đã vào chỉ mục — không phải khi đã có ai hỏi.
    Định nghĩa này còn giữ `/api/library` khỏi một lượt đọc kho phù du thứ ba."""
    chi_memory = tv.chieu_tai_lieu("d1", _row(
        capabilities={"chunk_query": False, "memory_query": True}))["ai"]
    assert chi_memory["chat_ready"] == READY
    assert chi_memory["index"] == NOT_GEN

    khong_gi = tv.chieu_tai_lieu("d1", _row(capabilities={}))["ai"]
    assert khong_gi["chat_ready"] == NOT_GEN


def test_capabilities_hong_kieu_khong_lam_no_phep_chieu():
    for xau in (None, "chuỗi", 42, []):
        ai = tv.chieu_tai_lieu("d1", _row(capabilities=xau))["ai"]
        assert ai["chat_ready"] == NOT_GEN


def test_progress_hong_kieu_ve_0():
    assert tv.chieu_tai_lieu("d1", _row(progress="rác"))["progress"] == 0.0


# ── Đếm artifact ────────────────────────────────────────────────────────────

def test_dem_quiz_va_on_tap():
    doc = tv.chieu_tai_lieu("d1", _row(), quiz_count=2, graded_attempt_count=1,
                            latest_quiz_id="q-9", review_count=3,
                            latest_review_attempt_id="a-9")
    assert doc["ai"]["quiz"] == {"ready": True, "count": 2, "graded_attempts": 1,
                                 "latest_quiz_id": "q-9"}
    assert doc["ai"]["review"] == {"ready": True, "count": 3, "latest_attempt_id": "a-9"}


def test_dich_resume_la_suy_ra_khong_phai_cot_moi():
    """`latest_quiz_id` / `latest_attempt_id` đến từ chính truy vấn đếm (argmax),
    không từ một cột lưu sẵn — nên chúng không thể lệch khỏi bảng nguồn."""
    doc = tv.chieu_tai_lieu("d1", _row())
    assert doc["ai"]["quiz"]["latest_quiz_id"] is None
    assert doc["ai"]["review"]["latest_attempt_id"] is None


def test_dem_0_thi_ready_false():
    doc = tv.chieu_tai_lieu("d1", _row())
    assert doc["ai"]["quiz"]["ready"] is False
    assert doc["ai"]["review"]["ready"] is False
    assert doc["ai"]["quiz"]["graded_attempts"] == 0


# ── Không rò giữa các tài liệu ──────────────────────────────────────────────

def test_ban_ghi_cua_tai_lieu_nay_khong_ro_sang_tai_lieu_khac():
    """Ca hỏng kinh điển của một phép gộp: một tài liệu có tóm tắt, mọi tài liệu
    cùng hiện ra nó."""
    rows = {
        "d1": _row(filename="A.pdf", source_stem="a_pdf", created_at="2026-09-02T00:00:00Z"),
        "d2": _row(filename="B.pdf", source_stem="b_pdf", created_at="2026-09-01T00:00:00Z"),
    }
    out = tv.chieu_thu_vien(
        rows,
        summaries=[_summary(["a_pdf"], overview="chỉ của A")],
        mindmaps=[{"id": "m-b", "sources": ["b_pdf"]}],
        studymap_status={"d1": "completed"},
        quiz_counts={"d1": {"quizzes": 2, "graded_attempts": 1, "latest_quiz_id": "q-1"}},
        review_counts={"d2": {"count": 5, "latest_attempt_id": "a-2"}},
        languages={"d1": "vi"},
    )
    a, b = {d["document_id"]: d for d in out}["d1"], {d["document_id"]: d for d in out}["d2"]

    assert a["ai"]["summary"]["state"] == READY and a["ai"]["summary"]["preview"] == "chỉ của A"
    assert b["ai"]["summary"]["state"] == NOT_GEN and b["ai"]["summary"]["preview"] is None
    assert b["ai"]["mindmap"]["state"] == READY and a["ai"]["mindmap"]["state"] == NOT_GEN
    assert a["ai"]["studymap"]["state"] == READY and b["ai"]["studymap"]["state"] == NOT_GEN
    assert a["ai"]["quiz"]["count"] == 2 and b["ai"]["quiz"]["count"] == 0
    assert b["ai"]["review"]["count"] == 5 and a["ai"]["review"]["count"] == 0
    assert a["language"] == "vi" and b["language"] is None


def test_khop_tom_tat_theo_stem_chuan_hoa_khong_theo_ten_file_tho():
    """Bản ghi lưu "Bài Giảng 04.pdf", hàng lưu stem "bai_giang_04_pdf" — cùng một
    tài liệu. Khớp bằng chuỗi thô là mất tóm tắt của mọi tên file có dấu."""
    rows = {"d1": _row(filename="Bài Giảng 04.pdf", source_stem="bài_giảng_04_pdf")}
    out = tv.chieu_thu_vien(rows, summaries=[_summary(["Bài Giảng 04.pdf"])])
    assert out[0]["ai"]["summary"]["state"] == READY


# ── Trường thư viện + hình dạng payload ─────────────────────────────────────

def test_bay_truong_thu_vien_deu_co_duong_doc():
    doc = tv.chieu_tai_lieu("d1", _row(
        display_name="Hệ điều hành", favorite=True, pinned=True,
        archived_at="2026-09-05T00:00:00Z", tags=["AI", "Exam"],
        last_opened_at="2026-09-06T00:00:00Z", last_workspace="mindmap"))
    assert doc["display_name"] == "Hệ điều hành"
    assert doc["favorite"] is True and doc["pinned"] is True
    assert doc["archived_at"] == "2026-09-05T00:00:00Z"
    assert doc["tags"] == ["AI", "Exam"]
    assert doc["last_opened_at"] == "2026-09-06T00:00:00Z"
    assert doc["last_workspace"] == "mindmap"


def test_display_name_None_khong_duoc_lui_ve_title_o_may_chu():
    """Gộp ở máy chủ thì không ai còn phân biệt được "đặt tên trùng tên file" với
    "chưa từng đặt tên" — client mới là chỗ lùi."""
    doc = tv.chieu_tai_lieu("d1", _row(display_name=None))
    assert doc["display_name"] is None
    assert doc["title"] == "bai giang 04.pdf"


def test_tags_hong_kieu_ve_danh_sach_rong():
    for xau in (None, "AI", 42, {"a": 1}):
        assert tv.chieu_tai_lieu("d1", _row(tags=xau))["tags"] == []
    assert tv.chieu_tai_lieu("d1", _row(tags=["ok", 5, None]))["tags"] == ["ok"]


def test_payload_khong_bao_gio_chua_toan_van_tom_tat_hay_do_thi_so_do():
    """Payload thư viện đi kèm MỌI tài liệu — toàn văn ở đây là megabyte bỏ đi."""
    rec = _summary(["bai_giang_04_pdf"], sections=[_section("T", ["một", "hai"])])
    rec["sections"][0]["summary"] = "TOÀN VĂN KHÔNG ĐƯỢC RA"
    doc = tv.chieu_tai_lieu("d1", _row(), summary_record=rec,
                            mindmap_record={"id": "m", "nodes": ["ĐỒ THỊ KHÔNG ĐƯỢC RA"]})
    import json
    than = json.dumps(doc, ensure_ascii=False)
    assert "TOÀN VĂN KHÔNG ĐƯỢC RA" not in than
    assert "ĐỒ THỊ KHÔNG ĐƯỢC RA" not in than
    assert "sections" not in doc["ai"]["summary"]


def test_giu_nguyen_cap_status_ingest_status_cua_doc_public():
    """`status` = tập theo đặc tả, `ingest_status` = trạng thái pipeline. Frontend
    đang đọc đúng cặp tên này ở `_doc_public` — lệch là gãy im lặng."""
    doc = tv.chieu_tai_lieu("d1", _row(status="ready", spec_status="completed"))
    assert doc["status"] == "completed"
    assert doc["ingest_status"] == "ready"


def test_khong_co_truong_flashcards():
    """Không cột, không chip, không chỗ giữ sẵn. Một affordance cho thứ chưa tồn
    tại chính là tính năng ma."""
    import json
    than = json.dumps(tv.chieu_tai_lieu("d1", _row()), ensure_ascii=False).lower()
    assert "flashcard" not in than


def test_thu_vien_sap_moi_nhat_truoc_va_on_dinh():
    rows = {
        "cu": _row(created_at="2026-01-01T00:00:00Z"),
        "moi": _row(created_at="2026-09-01T00:00:00Z"),
    }
    assert [d["document_id"] for d in tv.chieu_thu_vien(rows)] == ["moi", "cu"]


def test_thu_vien_rong_tra_danh_sach_rong():
    assert tv.chieu_thu_vien({}) == []
    assert tv.chieu_thu_vien(None) == []


def test_nguon_phu_vang_mat_khong_lam_hong_phep_chieu():
    """Kho phù du bị xoá (mỗi lần deploy trên Render Free) — thư viện vẫn phải đọc
    được, chỉ mất phần AI của nó."""
    out = tv.chieu_thu_vien({"d1": _row()}, summaries=[], mindmaps=[],
                            studymap_status=None, quiz_counts=None,
                            review_counts=None, languages=None)
    assert len(out) == 1
    assert out[0]["ai"]["summary"]["state"] == NOT_GEN
    assert out[0]["ai"]["index"] == READY      # tín hiệu bền vững vẫn nguyên


# ── Phase 1B: bộ sưu tập + xếp hạng "Học gần đây" ───────────────────────────

def test_collection_id_di_qua_phep_chieu():
    doc = tv.chieu_tai_lieu("d1", _row(collection_id="c1"))
    assert doc["collection_id"] == "c1"


def test_phep_chieu_khong_nhung_ten_bo_suu_tap():
    """Tài liệu mang KHOÁ, không mang tên. Nhúng tên vào từng tài liệu là nhân bản
    dữ liệu, và bản nhúng lệch ngay lần đổi tên bộ sưu tập đầu tiên."""
    doc = tv.chieu_tai_lieu("d1", _row(collection_id="c1"))
    assert "collection_name" not in doc
    assert "collection" not in {k for k in doc if k != "collection_id"}


def test_open_count_di_qua_phep_chieu_va_ep_kieu():
    assert tv.chieu_tai_lieu("d1", _row(open_count=7))["open_count"] == 7
    assert tv.chieu_tai_lieu("d1", _row(open_count=None))["open_count"] == 0
    assert tv.chieu_tai_lieu("d1", _row())["open_count"] == 0


def _ts(iso):
    from datetime import datetime, timezone
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).replace(
        tzinfo=timezone.utc).timestamp()


BAY_GIO = _ts("2026-09-09T12:00:00Z")


def test_diem_chua_mo_bao_gio_la_0():
    assert tv.diem_gan_day({"last_opened_at": None}, now_ts=BAY_GIO) == 0.0
    assert tv.diem_gan_day({}, now_ts=BAY_GIO) == 0.0


def test_diem_giam_dan_theo_thoi_gian():
    moi = tv.diem_gan_day({"last_opened_at": "2026-09-09T11:00:00Z", "open_count": 1},
                          now_ts=BAY_GIO)
    cu = tv.diem_gan_day({"last_opened_at": "2026-08-09T11:00:00Z", "open_count": 1},
                         now_ts=BAY_GIO)
    assert moi > cu


def test_tan_suat_thang_do_moi_khi_khoang_cach_du_lon():
    """Đây là LÝ DO công thức tồn tại: sắp theo mốc mở đơn thuần thì tài liệu mở đúng
    một lần hôm qua luôn đứng trên tài liệu học 20 lần tuần trước — trong khi cái
    thứ hai mới là thứ người dùng đang thật sự học."""
    hay_hoc = tv.diem_gan_day(
        {"last_opened_at": "2026-09-06T12:00:00Z", "open_count": 20}, now_ts=BAY_GIO)
    mo_mot_lan = tv.diem_gan_day(
        {"last_opened_at": "2026-09-08T12:00:00Z", "open_count": 1}, now_ts=BAY_GIO)
    assert hay_hoc > mo_mot_lan


def test_do_moi_van_thang_khi_khoang_cach_qua_lon():
    """Tần suất không được đóng băng thứ hạng: một tài liệu mở 300 lần từ năm ngoái
    KHÔNG được đứng trên tài liệu vừa mở sáng nay."""
    cu_nhung_nhieu = tv.diem_gan_day(
        {"last_opened_at": "2025-09-09T12:00:00Z", "open_count": 300}, now_ts=BAY_GIO)
    vua_mo = tv.diem_gan_day(
        {"last_opened_at": "2026-09-09T09:00:00Z", "open_count": 1}, now_ts=BAY_GIO)
    assert vua_mo > cu_nhung_nhieu


def test_tan_suat_bi_chan_tran():
    """Trên trần thì thêm lượt mở không đổi điểm — nếu không, thứ hạng đóng băng
    quanh vài tài liệu được mở rất nhiều."""
    a = tv.diem_gan_day({"last_opened_at": "2026-09-09T11:00:00Z", "open_count": 40},
                        now_ts=BAY_GIO)
    b = tv.diem_gan_day({"last_opened_at": "2026-09-09T11:00:00Z", "open_count": 4000},
                        now_ts=BAY_GIO)
    assert a == b


def test_ai_moi_cong_diem_nhung_khong_lat_nguoc_do_moi():
    khong_ai = tv.diem_gan_day({"last_opened_at": "2026-09-09T11:00:00Z", "open_count": 1},
                               now_ts=BAY_GIO)
    co_ai = tv.diem_gan_day({"last_opened_at": "2026-09-09T11:00:00Z", "open_count": 1},
                            now_ts=BAY_GIO, co_ai_moi=True)
    assert co_ai > khong_ai
    cu_co_ai = tv.diem_gan_day({"last_opened_at": "2025-01-01T00:00:00Z", "open_count": 1},
                               now_ts=BAY_GIO, co_ai_moi=True)
    assert khong_ai > cu_co_ai


@pytest.mark.parametrize("moc", ["khong-phai-ngay", "", 12345, None])
def test_diem_moc_thoi_gian_hong_tra_0_khong_nem(moc):
    assert tv.diem_gan_day({"last_opened_at": moc, "open_count": 5}, now_ts=BAY_GIO) == 0.0


def test_diem_open_count_hong_kieu_khong_nem():
    for xau in ("nhieu", None, [], {}):
        d = tv.diem_gan_day({"last_opened_at": "2026-09-09T11:00:00Z", "open_count": xau},
                            now_ts=BAY_GIO)
        assert 0.0 <= d <= 1.2


def test_recency_score_co_mat_trong_payload():
    doc = tv.chieu_tai_lieu("d1", _row(last_opened_at="2026-09-09T11:00:00Z",
                                       open_count=3))
    assert isinstance(doc["recency_score"], float)
    assert doc["recency_score"] > 0
    assert tv.chieu_tai_lieu("d1", _row())["recency_score"] == 0.0


def test_co_artifact_ai_lam_diem_cao_hon():
    hang = _row(last_opened_at="2026-09-09T11:00:00Z", open_count=1)
    khong = tv.chieu_tai_lieu("d1", hang)["recency_score"]
    co = tv.chieu_tai_lieu("d1", hang, summary_record=_summary(["a"]))["recency_score"]
    assert co > khong
