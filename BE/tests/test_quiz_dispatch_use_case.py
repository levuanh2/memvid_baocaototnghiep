"""Phase 2G.2 — ranh giới của `app/application/quiz_dispatch.py`.

Hành vi qua HTTP đã có `test_generate_characterization.py` (26 ca) khoá và nó vẫn xanh
nguyên vẹn sau đợt chuyển mã. File này không lặp lại; nó khoá ba thứ chỉ nhìn thấy được
ở tầng dưới:

1. Tầng use case không biết HTTP, không import ngược lên `app.main`, và **không import
   `app.jobs`** — hàng đợi vào qua `day_job` được tiêm, đó là lý do tham số ấy tồn tại.
2. Mọi lớp lỗi đều có mã HTTP. Thiếu một lớp là `KeyError` trong route, tức 500 thay
   cho 400/404/409 — đúng loại hỏng khó thấy nhất.
3. Quiz và Practice thật sự dùng CHUNG một đường: cùng `cau_hinh_quiz`, cùng `day_job`,
   cùng `job_type`. Nếu ai đó tách chúng ra hai nhánh riêng, test này đỏ.
"""

from __future__ import annotations

import ast
import inspect
import pathlib

import pytest

from app.application import quiz_dispatch as quiz_uc

UC_PY = pathlib.Path(__file__).resolve().parents[1] / "app" / "application" / "quiz_dispatch.py"


def _import_goc(f: pathlib.Path) -> set[str]:
    ra: set[str] = set()
    for n in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
        if isinstance(n, ast.Import):
            ra |= {a.name for a in n.names}
        elif isinstance(n, ast.ImportFrom) and n.module and n.level == 0:
            ra.add(n.module)
    return ra


# ── Ranh giới tầng ─────────────────────────────────────────────────────────
def test_khong_import_flask_faiss_ollama_va_khong_nguoc_len_main():
    goc = _import_goc(UC_PY)
    xau = sorted(m for m in goc
                 if m.split(".")[0] in ("flask", "faiss", "ollama")
                 or m == "app.main" or m.startswith("app.main."))
    assert not xau, f"tầng use case chạm HTTP/hạ tầng cấm: {xau}"


def test_khong_import_hang_doi():
    """`day_job` được tiêm chính là để tầng này không phải biết `app.jobs.queue` —
    và để đường dẫn dotted của RQ ở lại `app.main`."""
    goc = _import_goc(UC_PY)
    xau = sorted(m for m in goc if m.startswith("app.jobs"))
    assert not xau, f"tầng use case chạm hàng đợi: {xau}"
    assert "enqueue_job" not in UC_PY.read_text(encoding="utf-8")


def test_khong_chua_ma_http():
    so = [n.value for n in ast.walk(ast.parse(UC_PY.read_text(encoding="utf-8")))
          if isinstance(n, ast.Constant) and isinstance(n.value, int)
          and n.value in (200, 201, 202, 400, 401, 403, 404, 409, 500)]
    assert not so, f"mã HTTP trong tầng use case: {so}"


def test_moi_loi_deu_co_ma_http(client):
    import app.main as be
    from app.application import attempts as attempts_uc

    con = {c for c in vars(quiz_uc).values()
           if isinstance(c, type) and issubclass(c, attempts_uc.AttemptError)
           and c is not attempts_uc.AttemptError}
    thieu = sorted(c.__name__ for c in con if c not in be._ATTEMPT_ERR_HTTP)
    assert not thieu, f"lỗi chưa có mã HTTP (route sẽ 500): {thieu}"


@pytest.mark.parametrize("lop,ma", [
    ("SoCauKhongPhaiSo", 400), ("SoCauNgoaiKhoang", 400), ("DoKhoSai", 400),
    ("LoaiCauKhongPhaiList", 400), ("LoaiCauKhongHopLe", 400),
    ("ScopeKhongPhaiObject", 400), ("SectionLac", 400),
    ("TaiLieuChuaIndex", 409), ("ReviewItemKhongTonTai", 404),
    ("ReviewItemKhongCoChunk", 409),
])
def test_ma_http_cua_tung_loi(client, lop, ma):
    import app.main as be

    assert be._ATTEMPT_ERR_HTTP[getattr(quiz_uc, lop)] == ma


# ── Quiz và Practice dùng chung một đường ──────────────────────────────────
def test_hai_use_case_dung_chung_cau_hinh_va_day_job():
    """Bằng chứng cụ thể cho 'chung pipeline', không phải khẳng định suông."""
    for ten in ("sinh_quiz", "sinh_practice"):
        nguon = inspect.getsource(getattr(quiz_uc, ten))
        assert "cau_hinh_quiz(data)" in nguon, f"{ten} không dùng chung cấu hình"
        assert "day_job(" in nguon, f"{ten} không đi qua seam dispatch"
        assert 'job_type="quiz_generation"' in nguon, f"{ten} đổi job_type"
    assert "day_job" in inspect.signature(quiz_uc.sinh_quiz).parameters
    assert "day_job" in inspect.signature(quiz_uc.sinh_practice).parameters


def test_chi_sinh_quiz_co_dedupe():
    """Bất đối xứng có thật, khoá ở cả hai phía: chỉ `sinh_quiz` nhận seam dedupe."""
    q = inspect.signature(quiz_uc.sinh_quiz).parameters
    p = inspect.signature(quiz_uc.sinh_practice).parameters
    assert "giu_cho" in q and "nha_cho" in q
    assert "giu_cho" not in p and "nha_cho" not in p


def test_khoa_trung_giong_het_ham_cu_o_main(client):
    """`main._quiz_job_key` giờ uỷ quyền — hai đường phải cho CÙNG một chuỗi, nếu không
    mọi khoá dedupe đang sống trong tiến trình sẽ lệch sau khi deploy."""
    import app.main as be

    cfg = {"question_count": 10, "difficulty": "easy", "scope": {"section_ids": []}}
    assert be._quiz_job_key("u1", "d1", cfg) == quiz_uc.khoa_trung("u1", "d1", cfg)
    # Thứ tự khoá trong dict không được đổi kết quả (config dựng từ JSON của client).
    assert (quiz_uc.khoa_trung("u1", "d1", {"a": 1, "b": 2})
            == quiz_uc.khoa_trung("u1", "d1", {"b": 2, "a": 1}))


# ── `cau_hinh_quiz` ở mức hàm ──────────────────────────────────────────────
def test_cau_hinh_mac_dinh():
    out = quiz_uc.cau_hinh_quiz({})
    assert out == {"question_count": 10, "difficulty": "mixed",
                   "question_types": out["question_types"],
                   "scope": {"type": "full_document", "section_ids": []}}
    assert out["question_types"], "mặc định phải là toàn bộ loại câu hợp lệ"


def test_cau_hinh_co_section_thi_doi_scope_type():
    out = quiz_uc.cau_hinh_quiz({"scope": {"section_ids": ["s1", " ", "s2"]}})
    assert out["scope"] == {"type": "sections", "section_ids": ["s1", "s2"]}, (
        "phần tử rỗng bị loại, và có section thì scope là 'sections'")


@pytest.mark.parametrize("data,lop", [
    ({"question_count": "nhieu"}, "SoCauKhongPhaiSo"),
    ({"question_count": 0}, "SoCauNgoaiKhoang"),
    ({"question_count": 999}, "SoCauNgoaiKhoang"),
    ({"difficulty": "kho-lam"}, "DoKhoSai"),
    ({"question_types": "multiple_choice"}, "LoaiCauKhongPhaiList"),
    ({"question_types": ["bia-dat"]}, "LoaiCauKhongHopLe"),
    ({"question_types": []}, None),          # rỗng -> rơi về mặc định, KHÔNG lỗi
    ({"scope": "toan-bo"}, "ScopeKhongPhaiObject"),
])
def test_cau_hinh_nem_dung_lop_loi(data, lop):
    if lop is None:
        quiz_uc.cau_hinh_quiz(data)          # không được ném
        return
    with pytest.raises(getattr(quiz_uc, lop)):
        quiz_uc.cau_hinh_quiz(data)
