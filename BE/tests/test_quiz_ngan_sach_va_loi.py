"""Ngân sách cửa sổ ngữ cảnh của quiz, và phân loại lỗi AI cho người dùng (audit vòng 7).

Q3: ngữ liệu 18000 ký tự (~6500 token) từng được nhồi vào `num_ctx=4096` với
    `num_predict=8192` — Ollama cắt prompt trong im lặng, đề ra từ một phần tài liệu.
Q5: `LLM busy` và `LLM call timed out` từng tới người dùng dưới cùng một câu, dù một cái
    nghĩa là "chờ rồi thử lại" còn cái kia nghĩa là "máy không kham nổi".
"""

from __future__ import annotations

import json

import pytest


# ───────────────────────────────────────── Q3: ba con số phải khớp nhau ──

def test_ngu_lieu_cong_phan_sinh_ra_phai_lot_cua_so():
    """Đổi một trong ba con số mà quên hai cái kia thì test này đỏ.

    Đây mới là thứ đáng khoá: từng con số riêng lẻ không sai, cái sai là chúng không còn
    khớp nhau. ~2.7 ký tự/token là ước lượng cho tiếng Việt với tokenizer qwen/gemma —
    ước lượng THẤP (bi quan) để còn biên an toàn.
    """
    from app.domains.quiz import generator as g

    token_ngu_lieu = g.MAX_CONTEXT_CHARS / 2.7
    chi_dan = 400  # system prompt + khung câu hỏi, đo áng chừng và làm tròn LÊN
    tong = token_ngu_lieu + chi_dan + g.QUIZ_NUM_PREDICT
    assert tong < g.QUIZ_NUM_CTX, (
        f"ngữ liệu {g.MAX_CONTEXT_CHARS} ký tự (~{token_ngu_lieu:.0f} token) + chỉ dẫn "
        f"{chi_dan} + sinh ra {g.QUIZ_NUM_PREDICT} = {tong:.0f} token, vượt cửa sổ "
        f"{g.QUIZ_NUM_CTX}. Ollama sẽ cắt prompt trong im lặng."
    )


def test_num_predict_khong_duoc_lon_hon_num_ctx():
    """Cửa sổ chứa CẢ prompt lẫn phần sinh ra. `num_predict > num_ctx` là vô nghĩa —
    đó chính là mặc định cũ (8192 > 4096) mà không ai để ý."""
    from app.domains.quiz import generator as g

    assert g.QUIZ_NUM_PREDICT < g.QUIZ_NUM_CTX


def test_goi_model_co_truyen_num_ctx_va_num_predict():
    """Đặt hằng mà quên truyền xuống thì Ollama vẫn dùng `LLM_CTX_SIZE=4096` toàn cục."""
    from app.domains.quiz import generator as g

    da_nhan: dict = {}

    def ask_gia(prompt, **kw):
        da_nhan.update(kw)
        return json.dumps({"questions": []})

    g.generate_questions("ngữ liệu", {"question_count": 1}, ask=ask_gia)
    opts = da_nhan.get("options") or {}
    assert opts.get("num_ctx") == g.QUIZ_NUM_CTX
    assert opts.get("num_predict") == g.QUIZ_NUM_PREDICT
    assert opts.get("temperature") == 0.2, "nhiệt độ thấp cho ra đề vẫn phải giữ"


def test_cat_bot_ngu_lieu_thi_noi_ra(capsys):
    """Bỏ đoạn là đúng; bỏ trong im lặng thì không — đề ra từ 3/20 đoạn trông y hệt đề ra
    từ cả tài liệu."""
    from app.domains.quiz.generator import build_context

    chunks = [{"chunk_id": f"id{i}", "text": "x" * 500} for i in range(20)]
    ctx, ref_map = build_context(chunks, max_chars=1200)
    assert len(ref_map) < 20, "phải cắt bớt mới đúng ý test"
    assert "quiz_context_cat_bot" in capsys.readouterr().out


# ──────────────────────────── Q5: lỗi bận và lỗi quá hạn nói hai câu khác nhau ──

@pytest.mark.parametrize("goc, phai_co", [
    ("LLM busy (in-process): all 1 slots in use, waited 180.0s", "Thử lại sau"),
    ("LLM gateway busy: all 2 slots in use, waited 60s", "Thử lại sau"),
    ("TimeoutError: LLM call timed out after 180s", "giảm số câu"),
])
def test_loi_ai_duoc_dich_sang_viec_nguoi_dung_lam_duoc(goc, phai_co):
    import app.main as be

    ra = be._job_error_text(RuntimeError(goc))
    assert phai_co in ra
    assert goc in ra, "nguyên văn kỹ thuật phải còn lại để sửa lỗi"


def test_loi_la_thi_giu_nguyen_van():
    import app.main as be

    assert be._job_error_text(ValueError("section_ids không thuộc tài liệu")) == (
        "section_ids không thuộc tài liệu")


def test_loi_rong_van_khong_tra_chuoi_rong():
    """Hành vi cũ phải giữ: nhiều built-in có `str(exc) == ''`."""
    import app.main as be

    ra = be._job_error_text(TimeoutError())
    assert ra.startswith("TimeoutError:") and len(ra) > len("TimeoutError:")
