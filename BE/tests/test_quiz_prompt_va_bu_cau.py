"""Audit vòng 8 V8-2/V8-3 — prompt phải khớp cấu hình, và thiếu câu thì phải bù.

Bằng chứng gốc (log 2026-08-30 + bảng `ai_validation_logs`):

    quiz_job_done job_id=a16c1454 kept=2 rejected=8
      -> 7x FR-13.1 "question_type 'short_answer' không nằm trong dạng đã yêu cầu"

Người dùng chỉ chọn multiple_choice + true_false, nhưng system prompt là hằng số luôn
tả đủ ba dạng kèm định dạng riêng cho short_answer. Model 2B nghe system prompt.
"""

from app.domains.quiz import generator as gen


# ── V8-2: system prompt chỉ được tả dạng đang cho phép ──────────────────────
def test_system_prompt_khong_day_dang_khong_duoc_phep():
    s = gen.build_system(["multiple_choice", "true_false"])
    assert "short_answer" not in s
    assert "multiple_choice" in s and "true_false" in s


def test_chi_mot_dang_thi_chi_ta_mot_dang():
    s = gen.build_system(["true_false"])
    assert "multiple_choice" not in s and "short_answer" not in s


def test_dang_la_hoac_rong_thi_quay_ve_du_ba_dang():
    for dau_vao in ([], None, ["essay"]):
        s = gen.build_system(dau_vao)
        for t in ("multiple_choice", "true_false", "short_answer"):
            assert t in s, (dau_vao, t)


def test_generate_questions_truyen_dung_dang_xuong_system():
    thay = {}

    def _ask(prompt, **kw):
        thay["system"] = kw["system_prompt"]
        return '{"questions": []}'

    gen.generate_questions("ngữ liệu", {"question_types": ["true_false"]}, ask=_ask)
    assert "short_answer" not in thay["system"]


def test_luot_hai_van_giu_dung_dang_da_cho_phep():
    """Nhắc lại JSON không được kéo theo dạng câu hỏi đã bị tắt."""
    thay = []

    def _ask(prompt, **kw):
        thay.append(kw["system_prompt"])
        return "không phải json"

    gen.generate_questions("ngữ liệu", {"question_types": ["true_false"]}, ask=_ask)
    assert len(thay) == 2
    assert all("short_answer" not in s for s in thay)


# ── V8-3: prompt bù ─────────────────────────────────────────────────────────
def test_prompt_bu_noi_ro_con_thieu_may_cau_va_da_co_gi():
    p = gen.build_prompt("ngữ liệu", {"question_count": 4},
                         da_co=["Đạo hàm x^2?", "Đạo hàm hằng số?"])
    assert "Số câu: 4" in p, "phải xin đúng phần còn thiếu"
    assert "Đạo hàm x^2?" in p, "phải liệt kê câu đã có để model khỏi lặp"


def test_khong_co_da_co_thi_prompt_nhu_cu():
    p = gen.build_prompt("ngữ liệu", {"question_count": 4})
    assert "Số câu: 4" in p and "Đã có sẵn" not in p


def test_generate_questions_chuyen_da_co_xuong_prompt():
    thay = {}

    def _ask(prompt, **kw):
        thay["prompt"] = prompt
        return '{"questions": []}'

    gen.generate_questions("ngữ liệu", {"question_count": 2}, ask=_ask,
                           da_co=["Câu đã có?"])
    assert "Câu đã có?" in thay["prompt"]


# ── Lượt bù phải biết TẤT CẢ câu model đã viết, không chỉ câu được nhận ─────
def test_da_co_gom_ca_cau_bi_loai_khong_chi_cau_duoc_nhan():
    """Job e31ace34 (01/09): 2 câu được nhận, 12 câu bị loại vì TRÙNG.

    12 câu đó model đã viết ra ở lượt đầu rồi bị tầng luật loại — nhưng chúng không nằm
    trong `da_co`, nên lượt bù không biết mình vừa viết chúng và viết lại y hệt. Bảo
    model "đừng lặp" trong khi giấu 12/14 thứ nó vừa viết là thông tin thiếu.
    """
    from app.domains.quiz.generator import gom_da_co

    accepted = [{"question_text": "Câu tốt?"}]
    tho = [{"question_text": "Câu tốt?"}, {"question_text": "Câu bị loại?"},
           {"question_text": "Câu bị loại?"}]        # model tự lặp ngay trong lượt đầu
    ds = gom_da_co(accepted, tho)
    assert "Câu tốt?" in ds and "Câu bị loại?" in ds
    assert len(ds) == 2, "trùng nhau thì gộp, đừng nhồi cùng một câu hai lần vào prompt"


def test_gom_da_co_chiu_duoc_du_lieu_rac():
    from app.domains.quiz.generator import gom_da_co

    assert gom_da_co([], []) == []
    assert gom_da_co(None, None) == []
    assert gom_da_co([{"question_text": ""}], ["khong phai dict", None, 5]) == []


def test_gom_da_co_giu_thu_tu_cau_duoc_nhan_truoc():
    """Câu được nhận là ví dụ TỐT cho model; đặt trước để nó đọc thấy trước."""
    from app.domains.quiz.generator import gom_da_co

    ds = gom_da_co([{"question_text": "Đã nhận?"}], [{"question_text": "Bị loại?"}])
    assert ds[0] == "Đã nhận?"


# ── Cứu câu hoàn chỉnh trong một mảng JSON hỏng ─────────────────────────────
def test_vot_cau_hoan_chinh_tu_json_bi_cat():
    """Đo 01/09: xin 5 câu -> model trả 2485 ký tự -> `json.loads` hỏng -> nhận 0 câu.

    Toàn bộ output bị ném đi vì `repair_json_text` đòi một khối {...} CÂN BẰNG. Nhưng
    trong đống đó có những object câu hỏi hoàn chỉnh, đóng ngoặc đàng hoàng — vứt chúng
    là vứt công sức một phút CPU và bắt người dùng nhận 0 câu.
    """
    hong = ('```json\n{"questions": [\n'
            '{"question_text": "Câu một?", "question_type": "true_false", '
            '"correct_answer": "true", "explanation": "vì vậy", '
            '"concept_tags": ["a"], "chunk_refs": ["c0"]},\n'
            '{"question_text": "Câu hai?", "question_type": "true_false", '
            '"correct_answer": "false", "explanation": "vì kia", '
            '"concept_tags": ["b"], "chunk_refs": ["c1"]},\n'
            '{"question_text": "Câu ba bị cắt giữa chừ')      # cụt ở đây
    ds = gen.vot_cau_hoan_chinh(hong)
    assert [q["question_text"] for q in ds] == ["Câu một?", "Câu hai?"]


def test_vot_khong_bia_them_gi_khi_khong_co_cau_nao_tron_ven():
    assert gen.vot_cau_hoan_chinh('{"questions": [{"question_text": "cut ngay') == []
    assert gen.vot_cau_hoan_chinh("") == []
    assert gen.vot_cau_hoan_chinh(None) == []


def test_vot_bo_qua_object_khong_phai_cau_hoi():
    """Chỉ nhặt object CÓ `question_text` — đừng nhặt nhầm object lồng bên trong."""
    raw = ('{"meta": {"model": "x"}, "questions": ['
           '{"question_text": "Thật?", "concept_tags": ["a"]}, {"khong": "phai cau"}]')
    ds = gen.vot_cau_hoan_chinh(raw)
    assert [q["question_text"] for q in ds] == ["Thật?"]


def test_generate_questions_dung_duong_vot_khi_json_hong_ca_hai_luot():
    """Hỏng cả hai lượt mà vẫn vớt được câu thì trả câu, đừng trả lỗi."""
    hong = ('{"questions": [{"question_text": "Con lai duoc?", '
            '"question_type": "true_false", "correct_answer": "true", '
            '"explanation": "e", "concept_tags": ["t"], "chunk_refs": ["c0"]}, {"cut')
    qs, err, _ = gen.generate_questions("ngữ liệu", {}, ask=lambda *a, **k: hong)
    assert err is None, err
    assert [q["question_text"] for q in qs] == ["Con lai duoc?"]
