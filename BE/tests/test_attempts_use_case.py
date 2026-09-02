"""Phase 2B — ranh giới của tầng use case attempt, và MỘT hợp đồng dễ hỏng im lặng.

Hành vi nghiệp vụ của 8 route (điểm, cổng trạng thái, quyền sở hữu, chấm nền) đã có
`test_quiz_attempt.py`, `test_gap_and_review.py`, `test_practice_and_progress.py` khoá
qua HTTP. File này KHÔNG lặp lại chúng. Nó chỉ khoá bốn thứ mà một lần di chuyển mã
làm gãy mà không test nào kêu:

1. **Đường dẫn dotted của job chấm.** `queue.enqueue_job` đưa hàm cho RQ, RQ lưu
   `module.qualname` rồi import lại ở worker. Nếu route đổi sang truyền thẳng impl ở
   `app.application.short_answer_grading`, job đã nằm trong hàng đợi lúc deploy sẽ
   `ImportError` — và **không test nào hiện có bắt được**, vì chế độ thread
   (`QUEUE_ENABLED=false`) không dùng đường dẫn.
2. **Bảng ánh xạ lỗi phải phủ hết.** Tra `_ATTEMPT_ERR_HTTP[type(exc)]` thiếu một lớp
   là `KeyError` trong route, tức 500 thay cho 404/409 — đúng thứ khó thấy nhất.
3. **Tầng use case không biết HTTP.**
4. **Route còn mỏng.**
"""

from __future__ import annotations

import ast
import inspect
import pathlib

import pytest

UC_PY = pathlib.Path(__file__).resolve().parents[1] / "app" / "application" / "attempts.py"

# 8 route của batch Phase 2B.
TEN_ROUTE = [
    "api_attempt_open",
    "api_quiz_attempts",
    "api_attempt_get",
    "api_attempt_save_answers",
    "api_attempt_submit",
    "api_attempt_results",
    "api_attempt_masteries",
    "api_attempt_grading_job",
]


def test_dispatch_grading_giu_dung_duong_dan_rq(client, monkeypatch, capsys):
    """Hàm được enqueue phải là `app.main.run_short_answer_grading_job`, không phải impl."""
    import app.jobs.queue as queue_mod
    import app.main as be

    bat = {}

    def _gia(func, args=(), queue="ingest", job_id=None):
        bat["duong_dan"] = f"{func.__module__}.{func.__qualname__}"
        bat["args"] = tuple(args)
        bat["queue"] = queue
        bat["job_id"] = job_id
        return {"mode": "thread"}

    monkeypatch.setattr(queue_mod, "enqueue_job", _gia)
    be._dispatch_grading("job-1", "attempt-1", "user-1")

    assert bat["duong_dan"] == "app.main.run_short_answer_grading_job", (
        f"đường dẫn RQ đổi thành {bat['duong_dan']!r} — job cũ trong hàng đợi sẽ chết")
    assert bat["args"] == ("job-1", "attempt-1", "user-1"), "thứ tự tham số đổi"
    assert bat["queue"] == "mindmap", "đổi hàng đợi là đổi worker xử lý"
    assert bat["job_id"] == "job-1"
    assert "grading_enqueue_thread job_id=job-1" in capsys.readouterr().out


def test_moi_loi_use_case_deu_co_ma_http(client):
    """Thiếu một lớp trong bảng = `KeyError` trong route = 500 thay cho 404/409."""
    import app.main as be
    from app.application import attempts as uc

    con = {c for c in vars(uc).values()
           if isinstance(c, type) and issubclass(c, uc.AttemptError) and c is not uc.AttemptError}
    thieu = sorted(c.__name__ for c in con if c not in be._ATTEMPT_ERR_HTTP)
    assert not thieu, f"lỗi chưa có mã HTTP: {thieu}"


@pytest.mark.parametrize("lop,ma", [
    ("AttemptKhongTonTai", 404), ("QuizKhongTonTai", 404), ("JobChamKhongTonTai", 404),
    ("QuizChuaSanSang", 409), ("AttemptDaNop", 409), ("AttemptKhongConDangLam", 409),
    ("AttemptChuaNop", 409), ("ThieuDapAn", 400), ("CauHoiLac", 400),
])
def test_ma_http_cua_tung_loi_khong_doi(client, lop, ma):
    """Bảng này LÀ hợp đồng API. Đổi một số ở đây là đổi API mà URL không đổi."""
    import app.main as be
    from app.application import attempts as uc

    assert be._ATTEMPT_ERR_HTTP[getattr(uc, lop)] == ma


def test_loi_mang_kem_giu_nguyen_truong_status(client):
    """Hai lỗi 409 trả kèm `status` hiện tại của attempt — FE đọc trường đó."""
    import app.main as be
    from app.application import attempts as uc

    with be.app.test_request_context():
        body, ma = be._attempt_err(uc.AttemptDaNop(status="graded"))
        assert ma == 409
        assert body.get_json() == {"error": "Attempt đã nộp, không sửa được đáp án",
                                   "status": "graded"}


def _import_goc(f: pathlib.Path) -> set[str]:
    ra: set[str] = set()
    for n in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
        if isinstance(n, ast.Import):
            ra |= {a.name for a in n.names}
        elif isinstance(n, ast.ImportFrom) and n.module and n.level == 0:
            ra.add(n.module)
    return ra


def test_use_case_khong_biet_http_va_khong_import_nguoc():
    """`flask`, `app.main`, và cả `app.jobs.queue` (hạ tầng hàng đợi cụ thể) đều cấm.

    Hàng đợi vào qua `dispatch_grading` được tiêm — đó là lý do tham số ấy tồn tại.
    """
    goc = _import_goc(UC_PY)
    xau = {m for m in goc
           if m == "flask" or m.startswith("flask.")
           or m == "app.main" or m.startswith("app.main.")
           or m.startswith("app.jobs")}
    assert not xau, f"tầng use case chạm HTTP/hạ tầng: {sorted(xau)}"


def test_use_case_khong_chua_ma_http():
    """Con số status là việc của route. Một `404` lọt vào đây là ranh giới đã rò."""
    nguon = UC_PY.read_text(encoding="utf-8")
    so = [n.value for n in ast.walk(ast.parse(nguon))
          if isinstance(n, ast.Constant) and isinstance(n.value, int)
          and n.value in (200, 201, 202, 400, 401, 403, 404, 409, 500)]
    assert not so, f"mã HTTP xuất hiện trong tầng use case: {so}"


def test_route_attempts_con_mong(client):
    """Quá ngưỡng nghĩa là logic nghiệp vụ còn sót lại trong tầng HTTP."""
    import app.main as be

    day = {}
    for ten in TEN_ROUTE:
        dong = [d for d in inspect.getsource(getattr(be, ten)).split("\n")
                if d.strip() and not d.strip().startswith("#")]
        if len(dong) > 14:
            day[ten] = len(dong)
    assert not day, f"route còn dày, logic chưa chuyển hết: {day}"
