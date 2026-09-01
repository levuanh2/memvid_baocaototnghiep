"""Audit vòng 8 — BE#10, #11.

BE#10 `_numeric_score` / `vector_score` / `bm25_score` trong `grading.py`: 0 caller
      production, 0 test đặt hai field đó. Không hại ai HÔM NAY, nhưng là bẫy: `hybrid`
      lấy `vector_score=dist` từ `IndexFlatL2` — đó là KHOẢNG CÁCH (nhỏ = tốt) — còn
      `_relevance` gộp bằng `max(...)` (lớn = tốt). Ai nối lại thì mọi chunk đều
      "correct", vì `min(1.0, ...)` kẹp mọi khoảng cách > 1 thành liên quan tuyệt đối.
BE#11 (a) docstring `auth/service.py` khẳng định app API còn mở và `@require_auth` chưa
      áp vào route nào — sai, route giờ gác bằng `_require_app_user`.
      (b) `conversations.deleted_at` ghi ở đúng 1 chỗ, đọc ở 0 chỗ: xoá lịch sử chat
      xong vẫn nhận tin nhắn mới, và lượt cũ vẫn chảy vào ngữ cảnh.
"""

import time
import uuid

import pytest


# ── BE#10: gỡ bẫy điểm số đảo ngược ─────────────────────────────────────────
def test_grading_khong_con_nhanh_diem_so_chet():
    from app.domains.retrieval import grading

    assert not hasattr(grading, "_numeric_score"), (
        "hàm 0 caller mà đọc `vector_score` như similarity trong khi nó là khoảng cách "
        "— gỡ hẳn, đừng để ai nối lại")


def test_chunk_lac_de_mang_vector_score_lon_khong_thanh_correct():
    """`vector_score` từ IndexFlatL2 là khoảng cách: lớn = XA = lạc đề."""
    from app.domains.retrieval.grading import grade_documents
    from app.domains.retrieval.hybrid import RetrievedChunk

    chunk = RetrievedChunk(chunk_id=1, text="astronomy telescope nebula",
                           video_stem="doc1", vector_score=42.0, bm25_score=9.9)
    assert grade_documents("python testing", [chunk]) == "wrong"


def test_chunk_lien_quan_van_correct_du_khong_co_diem_so():
    from app.domains.retrieval.grading import grade_documents
    from app.domains.retrieval.hybrid import RetrievedChunk

    chunk = RetrievedChunk(chunk_id=1,
                           text="Python unit testing uses fixtures to isolate state.",
                           video_stem="doc1")
    assert grade_documents("python unit testing fixtures", [chunk]) == "correct"


# ── BE#11a: tài liệu không được nói ngược với mã ────────────────────────────
def test_docstring_auth_khong_con_noi_app_api_dang_mo():
    from app.domains.auth import service

    doc = (service.__doc__ or "").lower()
    assert "app apis stay open" not in doc, "docstring nói ngược với `_require_app_user`"


# ── BE#11b: xoá hội thoại phải có nghĩa ─────────────────────────────────────
@pytest.fixture()
def conv_store(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from app.domains.conversation import store
    return store


def test_hoi_thoai_da_xoa_van_nhan_tin_nhan_thi_phai_song_lai_dung_cach(conv_store):
    cid = str(uuid.uuid4())
    conv_store.ensure_conversation(cid)
    conv_store.append_message(cid, "user", "câu cũ")
    time.sleep(0.01)
    conv_store.soft_delete(cid)

    # Người dùng gõ tiếp trong cùng phiên: hàng phải sống lại, KHÔNG để nguyên cờ xoá.
    time.sleep(0.01)
    conv_store.ensure_conversation(cid)
    conv = conv_store.get_conversation(cid)
    assert conv["deleted_at"] is None, "còn cờ xoá trên một hàng đang nhận tin nhắn mới"
    assert conv["context_reset_at"] is not None, (
        "sống lại phải kèm mốc chặn: xoá lịch sử xong mà lượt cũ vẫn quay lại là "
        "không xoá gì cả")


def test_moc_chan_lay_cai_muon_hon_giua_xoa_ngu_canh_va_xoa_lich_su():
    """`deleted_at` phải được đọc y như `context_reset_at` — trước đây nó ghi ở đúng
    một chỗ và đọc ở không chỗ nào."""
    from app.domains.conversation.context_builder import moc_chan

    assert moc_chan(None) is None
    assert moc_chan({}) is None
    assert moc_chan({"context_reset_at": 100.0, "deleted_at": None}) == 100.0
    assert moc_chan({"context_reset_at": None, "deleted_at": 200.0}) == 200.0
    assert moc_chan({"context_reset_at": 100.0, "deleted_at": 200.0}) == 200.0
    assert moc_chan({"context_reset_at": 300.0, "deleted_at": 200.0}) == 300.0


def test_duong_doc_ngu_canh_chan_theo_moc_xoa(conv_store, monkeypatch):
    """Hàng bị xoá rồi để yên (chưa ai gọi lại ensure_conversation) vẫn phải sạch.

    Bắt tham số `after_ts` thay vì đọc mã nguồn: `inspect.getsource` đỏ giả khi file
    dịch dòng giữa lúc suite chạy (xem known-issues 2026-09-01).
    """
    from app.domains.conversation import context_builder
    from app.domains.conversation import store as _conv

    cid = str(uuid.uuid4())
    conv_store.ensure_conversation(cid)
    conv_store.append_message(cid, "user", "bí mật cũ")
    time.sleep(0.01)
    conv_store.soft_delete(cid)
    moc_xoa = conv_store.get_conversation(cid)["deleted_at"]

    bat = {}
    that = _conv.get_messages

    def _ghi_lai(conversation_id, *a, **kw):
        bat["after_ts"] = kw.get("after_ts")
        return that(conversation_id, *a, **kw)

    monkeypatch.setattr(_conv, "get_messages", _ghi_lai)
    context_builder.build_recent_conversation_context(cid, selected_sources=[])

    assert bat["after_ts"] == moc_xoa, "đường đọc phải chặn từ mốc xoá lịch sử"
