"""Trần song song của memory tree phải bám cổng LLM, không bám ước đoán.

Chỗ song song LLM THỨ BA cùng một khiếm khuyết (sau mindmap 2026-08-26 và summary
2026-08-27). Riêng chỗ này hậu quả nặng nhất: `executor.map` ném lại lỗi lúc duyệt kết
quả, `ingest_graph.BuildMemoryTree` bắt rồi đánh dấu CẢ tài liệu `memory_tree_failed` +
`memory_query: False`, và để lại cây dở dang `status="building"` trong `memory_trees.json`.
Summary chỉ mất một mục; đây mất cả cây.

Đo thật (hạ `LLM_QUEUE_WAIT_TIMEOUT_SECONDS` xuống 5s để lỗi nổ trong 40 giây thay vì
chờ 180s): 2/3 worker trả `LLM busy (in-process): all 1 slots in use, waited 5.0s`.
"""

import os

import pytest

from app.domains.memory.tree import so_worker_tom_tat


@pytest.fixture()
def cong():
    """Trả module cổng LLM, TRẢ LẠI env nguyên trạng khi xong.

    `configure_inproc_gate(max_calls=...)` ghi THẲNG vào `os.environ`, không đi qua
    monkeypatch. Không tự dọn thì giá trị rò sang test sau và làm nó nhấp nháy tuỳ thứ
    tự chạy — `pytest-randomly` đang bật.
    """
    from app.clients import llm_factory

    KHOA = ("MAX_CONCURRENT_LLM_CALLS", "LLM_QUEUE_WAIT_TIMEOUT_SECONDS",
            "LLM_INPROCESS_CAP_ENABLED", "MAX_SUMMARIZE_WORKERS")
    cu = {k: os.environ.get(k) for k in KHOA}
    try:
        yield llm_factory
    finally:
        for k, v in cu.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        llm_factory.configure_inproc_gate()


def test_bi_ken_theo_so_slot_LLM(cong, monkeypatch):
    monkeypatch.setenv("MAX_SUMMARIZE_WORKERS", "3")
    cong.configure_inproc_gate(max_calls=1)
    assert so_worker_tom_tat() == 1, "khong duoc day 3 worker vao cong 1 slot"


def test_giu_nguyen_khi_cong_du_rong(cong, monkeypatch):
    monkeypatch.setenv("MAX_SUMMARIZE_WORKERS", "3")
    cong.configure_inproc_gate(max_calls=4)
    assert so_worker_tom_tat() == 3, "cong rong thi phai ton trong y muon cua nguoi dung"


def test_van_giu_tran_cung_4(cong, monkeypatch):
    """Trần cứng 4 có từ trước bản vá này — cổng rộng cũng không được vượt."""
    monkeypatch.setenv("MAX_SUMMARIZE_WORKERS", "99")
    cong.configure_inproc_gate(max_calls=64)
    assert so_worker_tom_tat() == 4


def test_toi_thieu_la_1_du_env_rac(cong, monkeypatch):
    monkeypatch.setenv("MAX_SUMMARIZE_WORKERS", "0")
    cong.configure_inproc_gate(max_calls=4)
    assert so_worker_tom_tat() == 1, "0 worker = khong bao gio tom tat duoc section nao"
