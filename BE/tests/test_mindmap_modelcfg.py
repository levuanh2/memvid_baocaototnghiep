from services.mindmap.pipeline.modelcfg import resolve_mindmap_model
from shared.config import DEFAULT_LOCAL_MODEL


def test_mindmap_model_env_wins(monkeypatch):
    monkeypatch.setenv("MINDMAP_MODEL", "custom-model")
    monkeypatch.setenv("SLM_MODEL", "other-model")
    assert resolve_mindmap_model() == "custom-model"


def test_mindmap_model_falls_back_to_slm_model(monkeypatch):
    monkeypatch.delenv("MINDMAP_MODEL", raising=False)
    monkeypatch.setenv("SLM_MODEL", "qwen3.5:9b")
    assert resolve_mindmap_model() == "qwen3.5:9b"


def test_mindmap_model_falls_back_to_default(monkeypatch):
    monkeypatch.delenv("MINDMAP_MODEL", raising=False)
    monkeypatch.delenv("SLM_MODEL", raising=False)
    # So với HẰNG, không với chuỗi cứng: default từng bị viết cứng ở 12 chỗ và
    # quay lại 2 lần. Test khoá chuỗi cứng là test giúp nó quay lại lần thứ ba.
    assert resolve_mindmap_model() == DEFAULT_LOCAL_MODEL


# --- Trần song song của enrich phải bám cổng LLM, không bám ước đoán ---
#
# Đo thật trên máy 6 GiB: MINDMAP_ENRICH_PARALLEL=2 (mặc định) đụng
# MAX_CONCURRENT_LLM_CALLS=1 → nhánh thứ hai xếp hàng, chờ quá 180s rồi ném
# "LLM busy (in-process)". Cả 3 nhánh + bước quan hệ chết cùng kiểu, sơ đồ ra
# 4 node khung xương sau 544 giây mà job vẫn báo "done".

import pytest


@pytest.fixture()
def factory():
    """Trả pipeline + module cổng, và TRẢ LẠI env nguyên trạng khi xong.

    `configure_inproc_gate(max_calls=...)` ghi THẲNG vào `os.environ` — không đi qua
    monkeypatch. Không tự dọn thì giá trị rò sang test sau và làm nó nhấp nháy tuỳ
    thứ tự chạy (đã xảy ra: cùng một test đỏ khi chạy chung với `llm_factory`, xanh
    khi chạy riêng).
    """
    import os
    from app.clients import llm_factory
    from app.clients.mindmap_factory import LocalMindmapPipeline

    KHOA = ("MAX_CONCURRENT_LLM_CALLS", "LLM_QUEUE_WAIT_TIMEOUT_SECONDS",
            "LLM_INPROCESS_CAP_ENABLED", "MINDMAP_ENRICH_PARALLEL")
    cu_env = {k: os.environ.get(k) for k in KHOA}
    try:
        yield LocalMindmapPipeline(), llm_factory
    finally:
        for k, v in cu_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        llm_factory.configure_inproc_gate()   # dựng lại cổng theo env đã khôi phục


def test_enrich_song_song_bi_ken_theo_so_slot_LLM(factory, monkeypatch):
    p, llm_factory = factory
    monkeypatch.setenv("MINDMAP_ENRICH_PARALLEL", "8")
    llm_factory.configure_inproc_gate(max_calls=1)
    assert p._enrich_parallel() == 1, "khong duoc day 8 nhanh vao cong 1 slot"


def test_enrich_song_song_giu_nguyen_khi_cong_du_rong(factory, monkeypatch):
    p, llm_factory = factory
    monkeypatch.setenv("MINDMAP_ENRICH_PARALLEL", "2")
    llm_factory.configure_inproc_gate(max_calls=4)
    assert p._enrich_parallel() == 2, "cong rong thi phai ton trong y muon cua nguoi dung"


def test_tat_cong_thi_khong_ken(factory, monkeypatch):
    p, llm_factory = factory
    monkeypatch.setenv("MINDMAP_ENRICH_PARALLEL", "3")
    monkeypatch.setenv("LLM_INPROCESS_CAP_ENABLED", "0")
    llm_factory.configure_inproc_gate(max_calls=1)
    assert p._enrich_parallel() == 3


def test_luon_it_nhat_mot_nhanh(factory, monkeypatch):
    p, llm_factory = factory
    monkeypatch.setenv("MINDMAP_ENRICH_PARALLEL", "0")
    llm_factory.configure_inproc_gate(max_calls=1)
    assert p._enrich_parallel() == 1
