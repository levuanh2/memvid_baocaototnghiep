"""Job chấm tự luận phải kêu TRƯỚC mỗi lời gọi LLM, không phải sau.

Trước 2026-08-28 job `short_answer_grading` đặt 20% rồi đứng im tới 100% suốt cả lượt
chấm — một lời gọi LLM mỗi câu tự luận. Khác `ingest` (chạy nền, không ai nhìn), ở đây
người học đang NGỒI CHỜ màn hình điểm.

Test đo **số lần progress đã kêu tại thời điểm lời gọi LLM đầu tiên bắt đầu**, không đếm
tổng lúc xong: tổng vẫn đúng ngay cả khi dồn hết về cuối. Cùng mẫu với
`test_summary_summarize.py::test_bao_progress_TRUOC_khi_muc_dau_chay_xong`.
"""

from __future__ import annotations

from typing import Any, Dict, List

import pytest

from app.domains.attempts import service as grading_service


def _quiz_rows(n_tu_luan: int, n_trac_nghiem: int) -> List[Dict[str, Any]]:
    rows = []
    for i in range(n_trac_nghiem):
        rows.append({"question_id": f"tn{i}", "question_text": f"TN {i}",
                     "question_type": "multiple_choice", "correct_answer": "A",
                     "explanation": "vi vay", "section_id": None,
                     "knowledge_node_id": None, "concept_tags": [], "source_context": ""})
    for i in range(n_tu_luan):
        rows.append({"question_id": f"tl{i}", "question_text": f"TL {i}",
                     "question_type": "short_answer", "correct_answer": "dap an",
                     "explanation": "", "section_id": None,
                     "knowledge_node_id": None, "concept_tags": [], "source_context": "ngu lieu"})
    return rows


@pytest.fixture()
def cham(monkeypatch):
    """Chấm giả lập trên DB giả — không đụng Postgres, không gọi LLM thật."""

    def dung(*, n_tu_luan=3, n_trac_nghiem=2):
        rows = _quiz_rows(n_tu_luan, n_trac_nghiem)
        moc: List[tuple] = []
        luc_llm_dau_tien: List[int] = []

        monkeypatch.setattr(grading_service.repository, "get_attempt", lambda a: {
            "quiz_id": "q1", "total_questions": len(rows),
            "answers": [{"question_id": r["question_id"], "user_answer": "tra loi"}
                        for r in rows],
        })
        monkeypatch.setattr(grading_service.repository, "questions_for_grading",
                            lambda q: rows)
        monkeypatch.setattr(grading_service.repository, "save_grades",
                            lambda *a, **k: True)

        def cham_tu_luan(**kw):
            # Ghi lại số mốc progress ĐÃ kêu ngay khi lời gọi LLM bắt đầu.
            luc_llm_dau_tien.append(len(moc))
            return {"verdict": "correct", "score": 1.0, "feedback": "ok",
                    "missing_points": []}

        monkeypatch.setattr(grading_service.grading, "grade_short_answer", cham_tu_luan)
        # Phân tích lỗ hổng chạy sau khi ghi điểm — không liên quan, chặn lại.
        monkeypatch.setattr(grading_service, "_analyze_gaps_quietly", lambda *a, **k: None,
                            raising=False)

        grading_service.grade_attempt(
            "att1", progress_cb=lambda p, msg: moc.append((p, msg)))
        return moc, luc_llm_dau_tien

    return dung


def test_kêu_truoc_khi_cau_dau_tien_cham_xong(cham):
    moc, luc_llm = cham(n_tu_luan=3)
    assert luc_llm, "grade_short_answer khong duoc goi"
    assert luc_llm[0] == 1, (
        "phai co dung 1 moc progress TRUOC khi lời gọi LLM dau tien bat dau; "
        f"thuc te {luc_llm[0]}")


def test_moi_cau_tu_luan_mot_moc(cham):
    moc, _ = cham(n_tu_luan=4, n_trac_nghiem=3)
    assert len(moc) == 4, f"4 cau tu luan -> 4 moc, thuc te {len(moc)}: {moc}"


def test_mau_so_chi_dem_cau_tu_luan(cham):
    """Trắc nghiệm chấm bằng so chuỗi, xong tức thì. Đưa vào mẫu số thì thanh nhảy
    vọt rồi đứng im — mô tả sai chỗ thời gian thật sự trôi."""
    moc, _ = cham(n_tu_luan=2, n_trac_nghiem=8)
    assert all("/2" in msg for _, msg in moc), moc


def test_phan_tram_tang_dan_va_nam_trong_khoang_job(cham):
    moc, _ = cham(n_tu_luan=5)
    phan_tram = [p for p, _ in moc]
    assert phan_tram == sorted(phan_tram), phan_tram
    assert phan_tram[0] >= 20, "job da o 20% truoc khi vao day, khong duoc tut lui"
    assert max(phan_tram) < 100, "100% danh cho luc ghi xong diem"


def test_khong_truyen_cb_thi_khong_no(cham, monkeypatch):
    """`progress_cb` là tuỳ chọn — đường gọi cũ (test, script) không được vỡ."""
    rows = _quiz_rows(2, 1)
    monkeypatch.setattr(grading_service.repository, "get_attempt", lambda a: {
        "quiz_id": "q1", "total_questions": len(rows),
        "answers": [{"question_id": r["question_id"], "user_answer": "x"} for r in rows]})
    monkeypatch.setattr(grading_service.repository, "questions_for_grading", lambda q: rows)
    monkeypatch.setattr(grading_service.repository, "save_grades", lambda *a, **k: True)
    monkeypatch.setattr(grading_service.grading, "grade_short_answer",
                        lambda **kw: {"verdict": "correct", "score": 1.0,
                                      "feedback": "", "missing_points": []})
    assert grading_service.grade_attempt("att1") is not None
