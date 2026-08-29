"""Bấm "Tạo quiz" nhiều lần không được tạo nhiều job (audit vòng 7, Q2).

Log thật 2026-08-30 00:24:40: năm `POST /api/quizzes/generate` trong hai giây -> năm job.
Máy có MỘT slot LLM, nên bốn job thừa xếp hàng, chờ quá `LLM_QUEUE_WAIT_TIMEOUT_SECONDS`
rồi chết với "LLM busy (in-process): all 1 slots in use". Người dùng thấy "Tạo quiz thất
bại" dù một quiz đã ra xong.
"""

from __future__ import annotations

import threading

import pytest


@pytest.fixture()
def be(monkeypatch):
    import app.main as m
    m._QUIZ_INFLIGHT.clear()
    return m


def _job(status: str):
    return {"job_id": "x", "status": status}


def test_yeu_cau_thu_hai_nhan_lai_job_dang_chay(be, monkeypatch):
    from app.domains.jobs import jobs_store
    monkeypatch.setattr(jobs_store, "get_job", lambda jid: _job("running"))

    key = be._quiz_job_key("u1", "doc-1", {"question_count": 10})
    assert be._quiz_job_giu_cho(key, "job-1") is None, "lần đầu phải giữ chỗ, không dedupe"
    assert be._quiz_job_giu_cho(key, "job-2") == "job-1"
    assert be._quiz_job_giu_cho(key, "job-3") == "job-1"


def test_job_cu_xong_roi_thi_cho_tao_job_moi(be, monkeypatch):
    from app.domains.jobs import jobs_store
    trang_thai = {"v": "running"}
    monkeypatch.setattr(jobs_store, "get_job", lambda jid: _job(trang_thai["v"]))

    key = be._quiz_job_key("u1", "doc-1", {"question_count": 10})
    assert be._quiz_job_giu_cho(key, "job-1") is None
    trang_thai["v"] = "done"
    assert be._quiz_job_giu_cho(key, "job-2") is None, (
        "job cũ đã xong -> yêu cầu mới là yêu cầu THẬT, không được nuốt"
    )


def test_job_bien_mat_khoi_store_thi_khong_khoa_vinh_vien(be, monkeypatch):
    """`get_job` trả None (job bị dọn) không được biến thành cửa khoá vĩnh viễn."""
    from app.domains.jobs import jobs_store
    monkeypatch.setattr(jobs_store, "get_job", lambda jid: None)

    key = be._quiz_job_key("u1", "doc-1", {})
    assert be._quiz_job_giu_cho(key, "job-1") is None
    assert be._quiz_job_giu_cho(key, "job-2") is None


def test_khac_nguoi_khac_tai_lieu_khac_cau_hinh_deu_la_yeu_cau_khac(be, monkeypatch):
    from app.domains.jobs import jobs_store
    monkeypatch.setattr(jobs_store, "get_job", lambda jid: _job("running"))

    goc = {"question_count": 10, "difficulty": "mixed"}
    assert be._quiz_job_giu_cho(be._quiz_job_key("u1", "doc-1", goc), "j1") is None
    for mo_ta, key in [
        ("người khác", be._quiz_job_key("u2", "doc-1", goc)),
        ("tài liệu khác", be._quiz_job_key("u1", "doc-2", goc)),
        ("số câu khác", be._quiz_job_key("u1", "doc-1", {**goc, "question_count": 5})),
    ]:
        assert be._quiz_job_giu_cho(key, "j-moi") is None, f"{mo_ta} phải được chạy"


def test_key_khong_phu_thuoc_thu_tu_khoa_trong_config(be):
    """`config` là dict dựng từ JSON — thứ tự khoá không được đổi kết quả dedupe."""
    a = be._quiz_job_key("u1", "d1", {"question_count": 10, "difficulty": "easy"})
    b = be._quiz_job_key("u1", "d1", {"difficulty": "easy", "question_count": 10})
    assert a == b


def test_hai_request_cung_luc_chi_mot_cai_giu_duoc_cho(be, monkeypatch):
    """Kiểm-rồi-giữ phải nằm trong MỘT lần khoá.

    Tách hai bước thì hai luồng cùng thấy trống và cả hai cùng tạo job — đúng lỗi mà hàm
    này sinh ra để chặn. `threading.Barrier` ép hai luồng vào cùng thời điểm.
    """
    from app.domains.jobs import jobs_store
    monkeypatch.setattr(jobs_store, "get_job", lambda jid: _job("running"))

    key = be._quiz_job_key("u1", "doc-1", {"question_count": 10})
    barrier = threading.Barrier(2)
    ket_qua: list = []

    def chay(job_id: str):
        barrier.wait()
        ket_qua.append(be._quiz_job_giu_cho(key, job_id))

    ts = [threading.Thread(target=chay, args=(f"job-{i}",)) for i in (1, 2)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()

    assert sorted(x is None for x in ket_qua) == [False, True], (
        f"đúng MỘT luồng được giữ chỗ, luồng kia phải nhận job cũ: {ket_qua}"
    )
