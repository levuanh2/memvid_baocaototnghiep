"""Phase 1 — khoá đường resolve của RQ và ranh giới tầng Application.

Hai thứ test này giữ, và không test nào khác giữ:

1. **RQ resolve được cả đường CŨ lẫn đường MỚI.** RQ không lưu đối tượng hàm; nó lưu
   `f"{fn.__module__}.{fn.__qualname__}"` rồi ở worker `import_module` + `getattr`. Sau
   Phase 1, job đã nằm trong hàng đợi mang đường dẫn `app.main.run_*`, còn job mới sẽ
   mang đường dẫn nào tuỳ chỗ enqueue tham chiếu. Cả hai phải resolve.
   Test mô phỏng đúng cơ chế đó, KHÔNG cần Redis.

2. **Tầng Application không được biết HTTP hay hạ tầng cụ thể.** `flask` / `faiss` /
   `ollama` xuất hiện trong `app/application/` là hỏng hướng phụ thuộc — và nó hỏng âm
   thầm, vì mã vẫn chạy.
"""

import ast
import importlib
import pathlib

import pytest

TEN_JOB = [
    "run_study_map_job",
    "run_quiz_generation_job",
    "run_short_answer_grading_job",
    "run_memory_tree_job",
    "run_summary_job",
    "run_mindmap_job",
]

DUONG_MOI = {
    "run_study_map_job": "app.application.study_map_generation",
    "run_quiz_generation_job": "app.application.quiz_generation",
    "run_short_answer_grading_job": "app.application.short_answer_grading",
    "run_memory_tree_job": "app.application.memory_tree",
    "run_summary_job": "app.application.summary_generation",
    "run_mindmap_job": "app.application.mindmap_generation",
}

THU_MUC_APP = pathlib.Path(__file__).resolve().parents[1] / "app" / "application"

# Những thứ tầng Application không được chạm. `sqlalchemy` KHÔNG nằm đây: repository của
# dự án vẫn ở `domains/`, và cấm nó bây giờ là mở scope ra ngoài Phase 1.
CAM = ("flask", "faiss", "ollama")


def _resolve_kieu_rq(duong_dan: str):
    """Đúng cách RQ khôi phục hàm: tách module/qualname, import, rồi getattr từng bậc."""
    mod_ten, _, qual = duong_dan.rpartition(".")
    mod = importlib.import_module(mod_ten)
    doi_tuong = mod
    for phan in qual.split("."):
        doi_tuong = getattr(doi_tuong, phan)
    return doi_tuong


@pytest.mark.parametrize("ten", TEN_JOB)
def test_duong_dan_CU_van_resolve(client, ten):
    """Job đã nằm trong hàng đợi trước lúc deploy mang đường dẫn này."""
    fn = _resolve_kieu_rq(f"app.main.{ten}")
    assert callable(fn), f"app.main.{ten} không resolve được — job cũ trong hàng đợi sẽ chết"


@pytest.mark.parametrize("ten", TEN_JOB)
def test_duong_dan_MOI_resolve(client, ten):
    fn = _resolve_kieu_rq(f"{DUONG_MOI[ten]}.{ten}")
    assert callable(fn), f"{DUONG_MOI[ten]}.{ten} không import được ở worker"


@pytest.mark.parametrize("ten", TEN_JOB)
def test_chuoi_rq_sinh_ra_tu_ham_o_main_van_resolve_nguoc_lai(client, ten):
    """Vòng khép kín: lấy hàm -> sinh chuỗi như RQ -> resolve lại -> phải ra hàm gọi được.

    Đây là phép thử duy nhất mô phỏng đúng thứ xảy ra giữa hai tiến trình.
    """
    import app.main as be

    fn = getattr(be, ten)
    chuoi = f"{fn.__module__}.{fn.__qualname__}"
    lai = _resolve_kieu_rq(chuoi)
    assert callable(lai), f"chuỗi RQ {chuoi!r} không resolve ngược được"


def _import_cua(f: pathlib.Path) -> set[str]:
    goc = set()
    for n in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
        if isinstance(n, ast.Import):
            goc |= {a.name.split(".")[0] for a in n.names}
        elif isinstance(n, ast.ImportFrom) and n.module and n.level == 0:
            goc.add(n.module.split(".")[0])
    return goc


def test_application_khong_import_flask_faiss_ollama():
    """Kể cả import LƯỜI bên trong hàm — `ast.walk` thấy hết, khác với grep đầu file."""
    vi_pham = {}
    for f in sorted(THU_MUC_APP.glob("*.py")):
        xau = _import_cua(f) & set(CAM)
        if xau:
            vi_pham[f.name] = sorted(xau)
    assert not vi_pham, f"tầng Application chạm hạ tầng cấm: {vi_pham}"


def _co_import_main(f: pathlib.Path) -> bool:
    """Chỉ tính IMPORT thật, kể cả import lười trong thân hàm.

    Không tìm chuỗi `"app.main"` trong file: docstring của các module này có nhắc tên đó
    để giải thích wrapper, và tìm chuỗi sẽ báo động giả trên chính lời giải thích.
    """
    for n in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
        if isinstance(n, ast.Import):
            if any(a.name == "app.main" or a.name.startswith("app.main.") for a in n.names):
                return True
        elif isinstance(n, ast.ImportFrom):
            if (n.module or "") == "app.main" or (n.module or "").startswith("app.main."):
                return True
    return False


def test_application_khong_import_nguoc_len_main():
    """`application` import `app.main` là đảo hướng phụ thuộc — và tạo vòng import."""
    xau = sorted(f.name for f in THU_MUC_APP.glob("*.py") if _co_import_main(f))
    assert not xau, f"tầng Application import ngược lên app.main: {xau}"


def test_main_chi_con_wrapper_mong_cho_sau_job(client):
    """Wrapper phải MỎNG. Đếm dòng thân hàm: quá ngưỡng nghĩa là logic còn sót lại."""
    import inspect

    import app.main as be

    day = {}
    for ten in TEN_JOB:
        dong = [d for d in inspect.getsource(getattr(be, ten)).split("\n")
                if d.strip() and not d.strip().startswith("#")]
        if len(dong) > 10:
            day[ten] = len(dong)
    assert not day, f"wrapper còn dày, logic chưa chuyển hết: {day}"
