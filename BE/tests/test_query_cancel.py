"""Huỷ truy vấn phải tới được graph, không chỉ tới trình duyệt.

FE#12 (audit vòng 8): nút "Huỷ" trong chat chỉ `abort()` request phía trình duyệt. BE
không có đường huỷ cho job `query` — `_CANCELLABLE_JOB_TYPES` không có `"query"`, và
`query_graph` không gọi `is_cancel_requested` ở đâu cả. Job chạy tới xong và vẫn giữ slot
LLM duy nhất; câu hỏi tiếp theo phải chờ nó.

Trần vật lý: huỷ chỉ tới được ở RANH GIỚI node. Node đang chạy là một request HTTP tới
Ollama, Python không cắt ngang được. Worst case = thời lượng node đó (`AI_TIMEOUT_SEC`).
"""

import pytest

from tests import _qg_build as H


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    H.base_env(monkeypatch)


def test_graph_dung_lai_khi_da_huy():
    """Cờ bật ngay từ đầu -> node đầu tiên đã dừng, không chạy gì thêm."""
    g, _ = H.build(da_huy=lambda _jid: True)
    out = H.run(g, H.init_state("câu hỏi"))
    assert out.get("cancelled") is True
    assert out.get("done") is True


def test_huy_giua_chung_van_dung_o_ranh_gioi_node_ke_tiep():
    goi = []

    def _da_huy(job_id):
        goi.append(job_id)
        return len(goi) >= 2          # node đầu chạy xong, node sau bị chặn

    g, _ = H.build(da_huy=_da_huy)
    out = H.run(g, H.init_state("câu hỏi"))
    assert out.get("cancelled") is True
    assert len(goi) >= 2, "cờ phải được đọc ở nhiều ranh giới node, không chỉ một lần"


def test_khong_huy_thi_chay_binh_thuong():
    g, _ = H.build(da_huy=lambda _jid: False)
    out = H.run(g, H.init_state("câu hỏi"))
    assert not out.get("cancelled")
    assert out.get("payload")


def test_khong_truyen_da_huy_thi_hanh_vi_y_nhu_cu():
    """Tham số tuỳ chọn: không truyền thì graph không đổi gì."""
    g, _ = H.build()
    out = H.run(g, H.init_state("câu hỏi"))
    assert not out.get("cancelled")
    assert out.get("payload")


def test_da_huy_nem_loi_thi_khong_giet_job_dang_chay_tot():
    """Đọc cờ hỏng (sqlite khoá) không được biến thành huỷ."""
    def _no(_jid):
        raise RuntimeError("sqlite locked")

    g, _ = H.build(da_huy=_no)
    out = H.run(g, H.init_state("câu hỏi"))
    assert not out.get("cancelled")
    assert out.get("payload")


def test_khong_co_job_id_thi_khong_hoi_co():
    """State không mang job_id thì không có gì để tra — đừng gọi callable."""
    goi = []
    g, _ = H.build(da_huy=lambda jid: goi.append(jid) or True)
    out = H.run(g, H.init_state("câu hỏi", job_id=""))
    assert not goi, "không có job_id mà vẫn tra cờ"
    assert not out.get("cancelled")


# ── Job runner: huỷ phải ghi `cancelled`, KHÔNG phải `error` ────────────────
def test_finalize_ghi_cancelled_khong_phai_error(monkeypatch):
    """Đúng bẫy đã gặp ở quiz vòng 8: "Đã huỷ" đi vào nhánh lỗi thì màn hình đổ lỗi cho
    hệ thống về một việc chính người dùng bấm dừng."""
    import app.main as be

    ghi = {}
    monkeypatch.setattr(be, "_jobs_update_job",
                        lambda jid, **kw: ghi.update(kw), raising=False)
    be.query_jobs["jcancel"] = {"status": "running", "result": None, "error": None}
    try:
        be._finalize_query_job("jcancel", "", "câu hỏi",
                               {"cancelled": True, "done": True, "status_code": 499,
                                "payload": {"answer": None, "cancelled": True}})
        assert ghi.get("status") == "cancelled", ghi
        assert not ghi.get("error_text")
        assert be.query_jobs["jcancel"]["status"] == "cancelled"
        assert not be.query_jobs["jcancel"].get("error")
    finally:
        be.query_jobs.pop("jcancel", None)


def test_finalize_binh_thuong_van_ghi_done(monkeypatch):
    import app.main as be

    ghi = {}
    monkeypatch.setattr(be, "_jobs_update_job",
                        lambda jid, **kw: ghi.update(kw), raising=False)
    be.query_jobs["jok"] = {"status": "running", "result": None, "error": None}
    try:
        be._finalize_query_job("jok", "", "câu hỏi",
                               {"payload": {"answer": "xong"}, "status_code": 200})
        assert ghi.get("status") == "done"
    finally:
        be.query_jobs.pop("jok", None)


def test_khong_luu_lich_su_hoi_thoai_cho_luot_bi_huy(monkeypatch):
    """Lượt bị huỷ không có câu trả lời — đừng ghi nó vào lịch sử như một lượt thật."""
    import app.main as be
    import app.domains.jobs.sessions_store as ss

    goi = []
    monkeypatch.setattr(ss, "append_messages",
                        lambda *a, **k: goi.append(a), raising=False)
    monkeypatch.setattr(be, "_jobs_update_job", lambda jid, **kw: None, raising=False)
    be.query_jobs["jc2"] = {"status": "running", "result": None, "error": None}
    try:
        be._finalize_query_job("jc2", "sess", "câu hỏi",
                               {"cancelled": True, "done": True,
                                "payload": {"answer": None, "cancelled": True}})
        assert not goi
    finally:
        be.query_jobs.pop("jc2", None)


# ── Cổng huỷ: chỉ mở SAU khi executor thật sự đọc cờ (main.py:3509) ─────────
def test_query_nam_trong_danh_sach_huy_duoc():
    import app.main as be

    assert "query" in be._CANCELLABLE_JOB_TYPES, (
        "graph đã đọc cờ huỷ ở mọi ranh giới node, cổng phải mở theo")


def test_loai_job_chua_doc_co_van_bi_tu_choi():
    """Đừng mở cổng cho loại job không ai đọc cờ — đó là lỗi 'Đang huỷ… mãi' 2026-07-17."""
    import app.main as be

    assert "ingest" not in be._CANCELLABLE_JOB_TYPES
    assert "short_answer_grading" not in be._CANCELLABLE_JOB_TYPES
