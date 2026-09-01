"""Audit vòng 8 V8-1 — trắc nghiệm không được có hai lựa chọn giống nhau.

Người học thấy "C" và "D" y hệt nhau thì câu đó không chấm công bằng được, mà tầng luật
lâu nay không soi mảng `options` một dòng nào: `['A','B','C','C']` đi thẳng vào DB.
"""

from app.domains.ai_validation import rules

BASE = {
    "question_text": "Đạo hàm của x^2 là gì?",
    "question_type": "multiple_choice",
    "options": ["2x", "x", "x^2", "1"],
    "correct_answer": "2x",
    "explanation": "Quy tắc luỹ thừa.",
    "concept_tags": ["đạo hàm"],
    "chunk_refs": ["c0"],
}


def test_lua_chon_trung_bi_go_bot():
    ok, bad = rules.validate_questions(
        [{**BASE, "options": ["2x", "x", "x^2", "x^2"]}], allowed_chunk_refs=["c0"])
    assert not bad
    assert ok[0]["options"] == ["2x", "x", "x^2"], "lựa chọn trùng phải bị gộp"


def test_trung_chi_khac_dau_va_hoa_thuong_cung_la_trung():
    ok, _ = rules.validate_questions(
        [{**BASE, "options": ["2x", "X^2", "x^2", "1"]}], allowed_chunk_refs=["c0"])
    assert ok[0]["options"] == ["2x", "X^2", "1"], "giữ bản xuất hiện trước"


def test_go_trung_xong_con_mot_lua_chon_thi_loai_ca_cau():
    ok, bad = rules.validate_questions(
        [{**BASE, "options": ["2x", "2x", "2x", "2x"]}], allowed_chunk_refs=["c0"])
    assert not ok and bad[0]["rule_code"] == rules.RULE_JSON


def test_dap_an_dung_song_sot_sau_khi_go_trung():
    ok, _ = rules.validate_questions(
        [{**BASE, "options": ["x", "2x", "2x", "1"], "correct_answer": "2x"}],
        allowed_chunk_refs=["c0"])
    assert ok[0]["correct_answer"] in ok[0]["options"]


def test_lua_chon_khac_nhau_thi_giu_nguyen_thu_tu():
    ok, bad = rules.validate_questions([BASE], allowed_chunk_refs=["c0"])
    assert not bad and ok[0]["options"] == ["2x", "x", "x^2", "1"]


# ── Lý do loại phải ĐO được, không đoán ─────────────────────────────────────
def test_ly_do_loai_noi_dung_nguyen_nhan_nhieu_nhat():
    """Giao diện từng ghi "thường là do đoạn tài liệu quá ngắn" — một phỏng đoán.

    Log thật của job e4bfd2dd (2026-09-01): 9/12 câu bị loại vì FR-13.5 (thiếu
    chunk_refs), 2 vì trùng, 1 vì lựa chọn không phân biệt. KHÔNG câu nào vì đoạn ngắn.
    """
    bi_loai = (
        [{"rule_code": rules.RULE_CHUNK_REFS}] * 9
        + [{"rule_code": rules.RULE_DUPLICATE}] * 2
        + [{"rule_code": rules.RULE_JSON}]
    )
    dem, cau = rules.ly_do_loai(bi_loai)
    assert dem[rules.RULE_CHUNK_REFS] == 9
    assert "nguồn" in cau.lower(), cau
    assert "ngắn" not in cau.lower(), "đừng đoán nguyên nhân không đo được"


def test_ly_do_loai_rong_thi_khong_bia_cau_nao():
    dem, cau = rules.ly_do_loai([])
    assert dem == {} and cau == ""


def test_ly_do_loai_ma_la_van_noi_duoc_gi_do():
    dem, cau = rules.ly_do_loai([{"rule_code": "FR-99.9"}])
    assert dem == {"FR-99.9": 1}
    assert cau, "mã lạ vẫn phải có câu mô tả, đừng trả rỗng"


# ── Lựa chọn gần-trùng: đo trên dữ liệu THẬT, ngưỡng nằm trong khoảng trống ──
def test_loai_cau_co_lua_chon_chi_la_cach_dien_dat_khac(_=None):
    """Dữ liệu thật, attempt 01597551, câu "RAG là gì?" (max jaccard 0.905).

    Ba "đáp án nhiễu" chỉ khác nhau ở mấy từ cuối và ĐỀU là mô tả đúng về RAG. Người
    học chọn một câu đúng nhưng không phải chuỗi model chỉ định → chấm sai, và điểm số
    thu được không nói lên điều gì.
    """
    q = {**BASE, "options": [
        "Retrieval-Augmented Generation là một kỹ thuật kết hợp truy xuất thông tin từ kho dữ liệu",
        "RAG là một kỹ thuật sử dụng LLM để trả lời câu hỏi dựa trên dữ liệu nội bộ.",
        "RAG là một kỹ thuật sử dụng LLM để trả lời câu hỏi dựa trên dữ liệu từ internet.",
        "RAG là một kỹ thuật sử dụng LLM để trả lời câu hỏi dựa trên dữ liệu từ kho dữ liệu.",
    ], "correct_answer":
        "Retrieval-Augmented Generation là một kỹ thuật kết hợp truy xuất thông tin từ kho dữ liệu"}
    ok, bad = rules.validate_questions([q], allowed_chunk_refs=["c0"])
    assert not ok and bad[0]["rule_code"] == rules.RULE_JSON
    assert "gần như trùng" in bad[0]["message"].lower()


def test_giu_cau_co_khuc_dau_giong_nhung_duoi_khac_han():
    """Dữ liệu thật, cùng bài (max jaccard 0.722) — câu này DÙNG ĐƯỢC.

    Khúc đầu dài giống nhau, nhưng phần phân biệt ở đuôi khác hẳn về nghĩa. Ngưỡng phải
    tha câu này; loại nó là loại nhầm đề tốt.
    """
    q = {**BASE, "options": [
        "RAG có thể giúp giải quyết những vấn đề liên quan đến kiến thức chung, không cần citation.",
        "RAG có thể giúp giải quyết những vấn đề liên quan đến dữ liệu nội bộ, có tính chất thay đổi.",
        "RAG có thể giúp giải quyết những vấn đề liên quan đến các task creative writing, brainstorm.",
        "RAG có thể giúp giải quyết những vấn đề liên quan đến các task có yêu cầu citation.",
    ], "correct_answer":
        "RAG có thể giúp giải quyết những vấn đề liên quan đến dữ liệu nội bộ, có tính chất thay đổi."}
    ok, bad = rules.validate_questions([q], allowed_chunk_refs=["c0"])
    assert ok and not bad, "đề tốt bị loại nhầm"


def test_nguong_nam_trong_khoang_trong_do_duoc_tren_du_lieu_that():
    """Khoá ngưỡng vào SỐ ĐO, không phải một con số đẹp.

    Đo 8 câu multiple_choice trong DB (2026-09-02), max jaccard giữa các cặp lựa chọn:
        dùng được : 0.467 · 0.700 · 0.722
        hỏng      : 0.864 · 0.900 · 0.905 · 1.000 · 1.000
    Khoảng trống nằm giữa 0.722 và 0.864.
    """
    assert 0.722 < rules.NGUONG_LUA_CHON_GIONG < 0.864
