"""Trần song song của summary phải bám cổng LLM, không bám ước đoán.

Đo thật trên máy 6 GiB: `SUMMARY_PARALLEL` mặc định 2 đụng `MAX_CONCURRENT_LLM_CALLS=1`
→ mục thứ hai không chạy song song mà XẾP HÀNG sau mục đầu. Chờ quá
`LLM_QUEUE_WAIT_TIMEOUT_SECONDS` (180s) thì ném "LLM busy (in-process)", mục đó rơi vào
`missing` và bản tóm tắt ra degraded — trong khi job vẫn báo "done".

Trên tài liệu 18 chunk lỗi này KHÔNG nổ (mục đầu chỉ mất 82s < 180s), nên nó là bom hẹn
giờ theo kích thước tài liệu chứ không phải lỗi thấy ngay. Đúng lý do phải chặn bằng test.
"""
import os

import pytest


@pytest.fixture()
def factory():
    """Trả pipeline + module cổng, và TRẢ LẠI env nguyên trạng khi xong.

    `configure_inproc_gate(max_calls=...)` ghi THẲNG vào `os.environ` — không đi qua
    monkeypatch. Không tự dọn thì giá trị rò sang test sau và làm nó nhấp nháy tuỳ thứ
    tự chạy (bài học từ bộ test mindmap tương ứng).
    """
    from app.clients import llm_factory
    from app.clients.summary_factory import LocalSummaryPipeline

    KHOA = ("MAX_CONCURRENT_LLM_CALLS", "LLM_QUEUE_WAIT_TIMEOUT_SECONDS",
            "LLM_INPROCESS_CAP_ENABLED", "SUMMARY_PARALLEL")
    cu_env = {k: os.environ.get(k) for k in KHOA}
    try:
        yield LocalSummaryPipeline(), llm_factory
    finally:
        for k, v in cu_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        llm_factory.configure_inproc_gate()   # dựng lại cổng theo env đã khôi phục


def test_song_song_bi_ken_theo_so_slot_LLM(factory, monkeypatch):
    p, llm_factory = factory
    monkeypatch.setenv("SUMMARY_PARALLEL", "8")
    llm_factory.configure_inproc_gate(max_calls=1)
    assert p._parallel() == 1, "khong duoc day 8 muc vao cong 1 slot"


def test_song_song_giu_nguyen_khi_cong_du_rong(factory, monkeypatch):
    p, llm_factory = factory
    monkeypatch.setenv("SUMMARY_PARALLEL", "2")
    llm_factory.configure_inproc_gate(max_calls=4)
    assert p._parallel() == 2, "cong rong thi phai ton trong y muon cua nguoi dung"


def test_song_song_toi_thieu_la_1_du_env_rac(factory, monkeypatch):
    p, llm_factory = factory
    monkeypatch.setenv("SUMMARY_PARALLEL", "0")
    llm_factory.configure_inproc_gate(max_calls=4)
    assert p._parallel() == 1, "0 worker = khong bao gio tom tat duoc muc nao"
