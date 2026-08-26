"""Bộ chấm câu trả lời — phần đọc điểm, không chạm mạng.

Ca đáng test nhất KHÔNG phải "đọc được JSON đẹp" mà là **những đầu ra hỏng của bộ
chấm phải nổ ra thay vì biến thành điểm trông hợp lệ**. Một `min(2, max(0, x))` đặt
nhầm chỗ sẽ biến điểm 7 thành 2 và không ai biết bộ chấm đang trả rác.
"""

from __future__ import annotations

import json

import pytest

from evaluation.judge import DIMENSIONS, JudgeError, build_prompt, parse_scores


def test_doc_diem_binh_thuong():
    d = parse_scores('{"answer_correctness": 2, "faithfulness": 1, "ly_do": "thieu mot y"}')
    assert d["answer_correctness"] == 2 and d["faithfulness"] == 1
    assert d["ly_do"] == "thieu mot y"


def test_doc_duoc_khi_model_boc_trong_rao_ma():
    d = parse_scores('```json\n{"answer_correctness": 0, "faithfulness": 0}\n```')
    assert d["answer_correctness"] == 0 and d["ly_do"] == ""


def test_diem_ngoai_thang_phai_NEM_chu_khong_kep_ve_bien():
    with pytest.raises(JudgeError, match="ngoài thang"):
        parse_scores('{"answer_correctness": 7, "faithfulness": 1}')
    with pytest.raises(JudgeError, match="ngoài thang"):
        parse_scores('{"answer_correctness": -1, "faithfulness": 1}')


def test_thieu_chieu_phai_nem():
    with pytest.raises(JudgeError, match="thiếu chiều"):
        parse_scores('{"answer_correctness": 2}')


def test_khong_phai_json_phai_nem():
    with pytest.raises(JudgeError, match="không phải JSON"):
        parse_scores("Câu trả lời này khá tốt, tôi cho 2 điểm.")


def test_json_khong_phai_object_phai_nem():
    with pytest.raises(JudgeError, match="không phải object"):
        parse_scores("[2, 1]")


def test_diem_dang_chuoi_van_doc_duoc():
    """Model hay trả `"2"` thay vì `2` — đó là định dạng, không phải điểm hỏng."""
    assert parse_scores('{"answer_correctness": "2", "faithfulness": "0"}')["answer_correctness"] == 2


def test_prompt_co_du_bon_phan_va_cat_nguoi_dai():
    p = build_prompt("Hỏi gì?", "Đáp án chuẩn.", "X" * 5000, "C" * 9000)
    for nhan in ("CÂU HỎI:", "ĐÁP ÁN CHUẨN:", "NGỮ CẢNH", "CÂU TRẢ LỜI CỦA HỆ THỐNG:"):
        assert nhan in p
    assert p.count("C") <= 6100 and p.count("X") <= 3100


def test_dimensions_khop_voi_rubric_da_khai():
    """`quality_metrics.QA_DIMENSIONS` là hợp đồng chung với phần chấm của người."""
    from evaluation.quality_metrics import QA_DIMENSIONS
    assert set(DIMENSIONS) <= set(QA_DIMENSIONS)
