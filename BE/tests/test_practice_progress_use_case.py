"""Phase 2C — ranh giới của ba module use case practice / review-plans / progress.

Hành vi nghiệp vụ đã có `test_gap_and_review.py` và `test_practice_and_progress.py`
khoá qua HTTP (cache/force, cổng `graded`, cách ly người dùng, nộp bài luyện tập,
chế độ mở). File này KHÔNG lặp lại chúng. Nó khoá những thứ mà một lần di chuyển mã
làm gãy trong im lặng:

- ba module mới không biết HTTP, không import ngược lên `app.main`, không chạm hàng đợi;
- MỌI lớp lỗi ngữ nghĩa đều có mã HTTP — thiếu một lớp là `KeyError` trong route,
  tức 500 thay cho 404/409;
- `generate` phân biệt được "vừa tạo" với "lấy từ kho" — đó là ranh giới 201 vs 200;
- `practice.submit` giữ đúng trình tự tác dụng phụ, và dùng LẠI hàm chuẩn hoá đáp án
  của `attempts` thay vì có bản sao thứ hai.
"""

from __future__ import annotations

import ast
import inspect
import pathlib

import pytest

THU_MUC_UC = pathlib.Path(__file__).resolve().parents[1] / "app" / "application"
MODULE_MOI = ["practice.py", "progress.py", "review_plans.py"]

TEN_ROUTE = [
    "api_review_plan_generate",
    "api_review_plan_by_attempt",
    "api_review_plan_items",
    "api_practice_get",
    "api_practice_submit",
    "api_practice_comparison",
    "api_progress_overview",
    "api_progress_concepts",
    "api_progress_attempts",
]


def _import_goc(f: pathlib.Path) -> set[str]:
    """Module được import, kể cả import lười trong thân hàm (AST, không phải grep)."""
    ra: set[str] = set()
    for n in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
        if isinstance(n, ast.Import):
            ra |= {a.name for a in n.names}
        elif isinstance(n, ast.ImportFrom) and n.module and n.level == 0:
            ra.add(n.module)
    return ra


@pytest.mark.parametrize("ten", MODULE_MOI)
def test_use_case_khong_import_flask(ten):
    goc = _import_goc(THU_MUC_UC / ten)
    xau = sorted(m for m in goc if m == "flask" or m.startswith("flask."))
    assert not xau, f"{ten} chạm Flask: {xau}"


@pytest.mark.parametrize("ten", MODULE_MOI)
def test_use_case_khong_import_nguoc_len_main(ten):
    goc = _import_goc(THU_MUC_UC / ten)
    xau = sorted(m for m in goc if m == "app.main" or m.startswith("app.main."))
    assert not xau, f"{ten} import ngược lên app.main: {xau}"


@pytest.mark.parametrize("ten", MODULE_MOI)
def test_use_case_khong_cham_hang_doi(ten):
    """Batch này chạy đồng bộ hết. Một `app.jobs` lọt vào là đã đổi kiến trúc."""
    goc = _import_goc(THU_MUC_UC / ten)
    xau = sorted(m for m in goc if m.startswith("app.jobs"))
    assert not xau, f"{ten} chạm hàng đợi: {xau}"


@pytest.mark.parametrize("ten", MODULE_MOI)
def test_use_case_khong_chua_ma_http(ten):
    """Con số status là việc của route."""
    so = [n.value for n in ast.walk(ast.parse((THU_MUC_UC / ten).read_text(encoding="utf-8")))
          if isinstance(n, ast.Constant) and isinstance(n.value, int)
          and n.value in (200, 201, 202, 400, 401, 403, 404, 409, 500)]
    assert not so, f"mã HTTP trong {ten}: {so}"


def test_moi_loi_use_case_deu_co_ma_http(client):
    """Quét MỌI lớp con của `AttemptError` trong bốn module application."""
    import app.main as be
    from app.application import attempts as attempts_uc
    from app.application import practice as practice_uc
    from app.application import review_plans as review_uc

    con = set()
    for mod in (attempts_uc, practice_uc, review_uc):
        con |= {c for c in vars(mod).values()
                if isinstance(c, type) and issubclass(c, attempts_uc.AttemptError)
                and c is not attempts_uc.AttemptError}
    thieu = sorted(c.__name__ for c in con if c not in be._ATTEMPT_ERR_HTTP)
    assert not thieu, f"lỗi chưa có mã HTTP (route sẽ 500): {thieu}"


@pytest.mark.parametrize("mod,lop,ma", [
    ("review_plans", "ThieuAttemptId", 400),
    ("review_plans", "AttemptChuaCham", 409),
    ("review_plans", "ReviewPlanKhongTonTai", 404),
    # 500 là hành vi ĐANG CÓ, không phải thiết kế mong muốn — xem known-issues.
    ("review_plans", "KhongTaoDuocPlan", 500),
    ("practice", "PracticeKhongTonTai", 404),
    ("practice", "PracticeChuaSanSang", 409),
    ("practice", "ChuaCoLanChamNao", 409),
])
def test_ma_http_cua_tung_loi_khong_doi(client, mod, lop, ma):
    """Bảng này LÀ hợp đồng API. Đổi một số ở đây là đổi API mà URL không đổi."""
    import importlib

    import app.main as be

    m = importlib.import_module(f"app.application.{mod}")
    assert be._ATTEMPT_ERR_HTTP[getattr(m, lop)] == ma


def test_practice_submit_khong_kem_status_con_attempt_submit_thi_co(client):
    """Hai route cùng ném `AttemptKhongConDangLam` nhưng thân response khác nhau:
    bài chẩn đoán kèm `status`, bài luyện tập không. Cả hai đang có, giữ cả hai."""
    import app.main as be
    from app.application import attempts as attempts_uc

    with be.app.test_request_context():
        khong_kem, ma1 = be._attempt_err(attempts_uc.AttemptKhongConDangLam())
        co_kem, ma2 = be._attempt_err(attempts_uc.AttemptKhongConDangLam(status="graded"))
    assert ma1 == ma2 == 409
    assert khong_kem.get_json() == {"error": "Attempt không còn ở trạng thái in_progress"}
    assert co_kem.get_json() == {"error": "Attempt không còn ở trạng thái in_progress",
                                 "status": "graded"}


def test_review_generate_phan_biet_tao_moi_voi_lay_tu_kho(client, monkeypatch):
    """Cờ thứ hai của `generate` là thứ route dịch thành 201 vs 200. Nhầm nó là đổi API."""
    from app.application import attempts as attempts_uc
    from app.application import review_plans as review_uc
    from app.domains.review import service as review_svc

    monkeypatch.setattr(attempts_uc, "load_owned_attempt",
                        lambda *a, **k: {"status": "graded"})

    monkeypatch.setattr(review_svc, "get_by_attempt", lambda aid: {"review_plan_id": "p1"})
    plan, tao_moi = review_uc.generate("a1", "u1", force=False, bat_buoc_chu_so_huu=True)
    assert tao_moi is False and plan["cached"] is True

    monkeypatch.setattr(review_svc, "generate", lambda aid: {"review_plan_id": "p2"})
    plan, tao_moi = review_uc.generate("a1", "u1", force=True, bat_buoc_chu_so_huu=True)
    assert tao_moi is True and "cached" not in plan


def test_practice_submit_dung_lai_ham_chuan_hoa_cua_attempts():
    """Bản sao thứ hai của luật chuẩn hoá sẽ lệch ở lần sửa thứ hai. Chặn ngay bây giờ."""
    from app.application import attempts as attempts_uc
    from app.application import practice as practice_uc

    nguon = inspect.getsource(practice_uc.submit)
    assert "attempts_uc._chuan_hoa_dap_an(" in nguon, "practice.submit tự chuẩn hoá đáp án"
    assert not hasattr(practice_uc, "_chuan_hoa_dap_an"), "practice có bản sao riêng"
    assert callable(attempts_uc._chuan_hoa_dap_an)


def test_practice_submit_giu_dung_trinh_tu_tac_dung_phu(client, monkeypatch):
    """`mở -> ghi nháp -> nộp -> chấm` trong cùng một request. Đảo thứ tự là mất bài."""
    from app.application import practice as practice_uc
    from app.domains.attempts import repository as attempts_repo
    from app.domains.attempts import service as grading_svc
    from app.domains.quiz import repository as quiz_repo

    goi = []
    monkeypatch.setattr(quiz_repo, "get_meta",
                        lambda qid: {"quiz_type": "practice", "status": "ready",
                                     "user_id": "u1"})
    monkeypatch.setattr(attempts_repo, "question_ids_of_quiz", lambda qid: ["q1"])
    monkeypatch.setattr(attempts_repo, "open_attempt",
                        lambda qid, uid: (goi.append("open"), {"attempt_id": "at1"})[1])
    monkeypatch.setattr(attempts_repo, "save_draft_answers",
                        lambda aid, ans: goi.append("save"))
    monkeypatch.setattr(attempts_repo, "submit",
                        lambda aid: (goi.append("submit"), {"attempt_id": aid})[1])
    monkeypatch.setattr(attempts_repo, "get_attempt", lambda aid: {"attempt_id": aid})
    monkeypatch.setattr(grading_svc, "grade_attempt",
                        lambda aid: (goi.append("grade"), {"score": 1.0})[1])

    out = practice_uc.submit("pq1", "u1", {"q1": "A"}, bat_buoc_chu_so_huu=True)

    assert goi == ["open", "save", "submit", "grade"], f"trình tự đổi: {goi}"
    assert out["grading"] == "done" and out["score"] == 1.0


def test_route_batch_2c_con_mong(client):
    """Quá ngưỡng nghĩa là logic nghiệp vụ còn sót lại trong tầng HTTP."""
    import app.main as be

    day = {}
    for ten in TEN_ROUTE:
        dong = [d for d in inspect.getsource(getattr(be, ten)).split("\n")
                if d.strip() and not d.strip().startswith("#")]
        if len(dong) > 16:
            day[ten] = len(dong)
    assert not day, f"route còn dày, logic chưa chuyển hết: {day}"
