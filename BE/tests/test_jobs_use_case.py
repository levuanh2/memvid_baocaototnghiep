"""Phase 2D — ranh giới của `app/application/jobs.py`.

Hành vi qua HTTP đã có `test_jobs_characterization.py` (24 ca) và `test_jobs_timeline.py`
khoá. File này không lặp lại; nó khoá bốn thứ chỉ nhìn thấy được ở tầng dưới:

1. module không biết HTTP, không chạm hạ tầng cấm, không import ngược lên `app.main`;
2. hai luật huỷ vẫn là HAI — gồm cả chỗ bất đối xứng dễ bị "dọn" nhầm: đường huỷ theo
   domain KHÔNG kiểm gì khi tắt cưỡng chế sở hữu;
3. phép chiếu `xem` bật/tắt `job_type` đúng như hai nhóm route đang cần;
4. phép tổng kết timeline, kể cả các ca dữ liệu hỏng, mà không cần DB.
"""

from __future__ import annotations

import ast
import inspect
import pathlib

import pytest

from app.application import jobs as jobs_uc

UC_PY = pathlib.Path(__file__).resolve().parents[1] / "app" / "application" / "jobs.py"

TEN_ROUTE = [
    "api_job_get", "api_job_cancel",
    "api_quizzes_job", "api_quizzes_job_cancel",
    "api_study_maps_job", "api_study_maps_job_cancel",
    "job_timeline",
]


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


def test_khong_enqueue_job_nao():
    """Cụm này chạy đồng bộ hết. `request_cancel` là ghi cờ, KHÔNG phải đẩy hàng đợi."""
    nguon = UC_PY.read_text(encoding="utf-8")
    assert "enqueue_job" not in nguon, "use case job không được đẩy job mới vào hàng đợi"
    assert "app.jobs.queue" not in nguon


def test_khong_chua_ma_http():
    so = [n.value for n in ast.walk(ast.parse(UC_PY.read_text(encoding="utf-8")))
          if isinstance(n, ast.Constant) and isinstance(n.value, int)
          and n.value in (200, 201, 202, 400, 401, 403, 404, 409, 500)]
    assert not so, f"mã HTTP trong tầng use case: {so}"


def test_moi_loi_deu_co_ma_http(client):
    import app.main as be
    from app.application import attempts as attempts_uc

    con = {c for c in vars(jobs_uc).values()
           if isinstance(c, type) and issubclass(c, attempts_uc.AttemptError)
           and c is not attempts_uc.AttemptError}
    thieu = sorted(c.__name__ for c in con if c not in be._ATTEMPT_ERR_HTTP)
    assert not thieu, f"lỗi chưa có mã HTTP (route sẽ 500): {thieu}"


@pytest.mark.parametrize("lop,ma", [("JobKhongTonTai", 404), ("JobKhongHoTroHuy", 409)])
def test_ma_http_cua_tung_loi(client, lop, ma):
    import app.main as be

    assert be._ATTEMPT_ERR_HTTP[getattr(jobs_uc, lop)] == ma


def test_than_loi_khong_ho_tro_huy_giu_du_ba_truong(client):
    import app.main as be

    with be.app.test_request_context():
        body, ma = be._attempt_err(jobs_uc.JobKhongHoTroHuy("j9", "ingest"))
    assert ma == 409
    assert body.get_json() == {
        "error": "Loại job 'ingest' không hỗ trợ huỷ giữa chừng.",
        "job_id": "j9",
        "cancel_requested": False,
    }


# ── Phép chiếu ─────────────────────────────────────────────────────────────
def _gia_job(monkeypatch, row):
    import app.domains.jobs.jobs_store as js

    monkeypatch.setattr(js, "get_job", lambda jid: row)


def test_xem_kem_va_khong_kem_job_type(client, monkeypatch):
    _gia_job(monkeypatch, {"job_type": "quiz_generation", "status": "done",
                           "progress": 100, "current_node": "Persist",
                           "result": None, "error": None, "user_id": "u1"})

    co = jobs_uc.xem("j1", "u1", bat_buoc_chu_so_huu=True)
    khong = jobs_uc.xem("j1", "u1", loai_cho_phep=("quiz_generation",),
                        kem_job_type=False, bat_buoc_chu_so_huu=True)

    assert set(co) == {"job_id", "job_type", "status", "progress", "current_step",
                       "result", "error"}
    assert set(khong) == set(co) - {"job_type"}
    assert co["current_step"] == "Persist", "`current_node` phải đổi tên thành `current_step`"


def test_xem_current_step_rong_khi_chua_vao_node_nao(client, monkeypatch):
    """`None` phải thành chuỗi rỗng — FE hiển thị thẳng trường này."""
    _gia_job(monkeypatch, {"job_type": "summary", "status": "pending",
                           "current_node": None, "user_id": None})
    out = jobs_uc.xem("j1", None, bat_buoc_chu_so_huu=False)
    assert out["current_step"] == ""
    assert out["progress"] == 0, "thiếu `progress` phải là 0, không phải None"


@pytest.mark.parametrize("row,uid,loai", [
    (None, "u1", None),                                             # không tồn tại
    ({"job_type": "summary", "user_id": "nguoi-khac"}, "u1", None),  # khác chủ
    ({"job_type": "summary", "user_id": "u1"}, "u1", ("quiz_generation",)),  # sai loại
])
def test_ba_ca_hong_deu_la_JobKhongTonTai(client, monkeypatch, row, uid, loai):
    """Phân biệt được ba ca này là rò rỉ thông tin về dữ liệu người khác."""
    _gia_job(monkeypatch, row)
    with pytest.raises(jobs_uc.JobKhongTonTai):
        jobs_uc.xem("j1", uid, loai_cho_phep=loai, bat_buoc_chu_so_huu=True)


# ── Hai luật huỷ, không gộp ────────────────────────────────────────────────
def test_huy_chung_tu_choi_loai_khong_doc_co(client, monkeypatch):
    import app.domains.jobs.jobs_store as js

    _gia_job(monkeypatch, {"job_type": "ingest", "user_id": None})
    goi = []
    monkeypatch.setattr(js, "request_cancel", lambda jid: goi.append(jid))

    with pytest.raises(jobs_uc.JobKhongHoTroHuy):
        jobs_uc.huy_chung("j1", None, bat_buoc_chu_so_huu=False)
    assert goi == [], "bị từ chối thì KHÔNG được ghi cờ huỷ"


def test_huy_theo_loai_khong_kiem_gi_khi_tat_cuong_che(client, monkeypatch):
    """Ghi nhận hành vi ĐANG CÓ, không phải hành vi mong muốn.

    Ở chế độ mở, đường huỷ theo domain không tra job: id bịa vẫn trả
    `cancel_requested: True`. Route chung thì ngược lại — luôn tra. Viết chung một hàm
    cho hai đường sẽ âm thầm thêm một cổng vào chế độ mở.
    """
    import app.domains.jobs.jobs_store as js

    _gia_job(monkeypatch, None)
    goi = []
    monkeypatch.setattr(js, "request_cancel", lambda jid: goi.append(jid))

    out = jobs_uc.huy_theo_loai("khong-he-co", None,
                                loai_cho_phep=("quiz_generation",),
                                bat_buoc_chu_so_huu=False)
    assert out == {"job_id": "khong-he-co", "cancel_requested": True}
    assert goi == ["khong-he-co"]

    # Route chung KHÁC: luôn tra, nên id bịa là lỗi.
    with pytest.raises(jobs_uc.JobKhongTonTai):
        jobs_uc.huy_chung("khong-he-co", None, bat_buoc_chu_so_huu=False)


def test_chu_so_huu_hop_le_giu_ba_trang_thai(client, monkeypatch):
    """`None` (không biết / sai loại) và `False` (khác chủ) phải phân biệt được —
    `summary-cancel` và `mindmap-cancel` ngoài batch vẫn dùng chữ ký này."""
    _gia_job(monkeypatch, None)
    assert jobs_uc.chu_so_huu_hop_le("j", "u1", ("summary",)) is None

    _gia_job(monkeypatch, {"job_type": "mindmap", "user_id": "u1"})
    assert jobs_uc.chu_so_huu_hop_le("j", "u1", ("summary",)) is None, "sai loại -> None"

    _gia_job(monkeypatch, {"job_type": "summary", "user_id": "nguoi-khac"})
    assert jobs_uc.chu_so_huu_hop_le("j", "u1", ("summary",)) is False

    _gia_job(monkeypatch, {"job_type": "summary", "user_id": "u1"})
    assert jobs_uc.chu_so_huu_hop_le("j", "u1", ("summary",)) is True


def test_kho_job_hong_thi_coi_nhu_khong_biet(client, monkeypatch):
    """Đọc hỏng không được biến thành "cho qua"."""
    import app.domains.jobs.jobs_store as js

    def _no(jid):
        raise RuntimeError("kho job hong")

    monkeypatch.setattr(js, "get_job", _no)
    assert jobs_uc.chu_so_huu_hop_le("j", "u1", ("summary",)) is None


# ── Tổng kết timeline (không cần DB) ───────────────────────────────────────
def test_tong_ket_cong_duration_va_lay_llm_calls():
    events = [{"duration_ms": 100.0, "ts": "2026-09-03 10:00:05"},
              {"duration_ms": 50.5, "metadata": {"llm_calls": 4}}]
    out = jobs_uc._tong_ket(events, "2026-09-03T10:00:00+00:00")
    assert out["total_ms"] == pytest.approx(150.5)
    assert out["llm_calls"] == 4
    assert out["queue_wait_ms"] == pytest.approx(5000.0)


def test_tong_ket_created_at_khong_timezone_van_tinh_duoc():
    """`created_at` naive được coi là UTC — cùng múi với `datetime('now')` của sqlite."""
    out = jobs_uc._tong_ket([{"duration_ms": 1.0, "ts": "2026-09-03 10:00:02"}],
                            "2026-09-03T10:00:00")
    assert out["queue_wait_ms"] == pytest.approx(2000.0)


@pytest.mark.parametrize("events,created_at", [
    ([], "2026-09-03T10:00:00+00:00"),                                  # chưa có event
    ([{"duration_ms": 1.0, "ts": "khong-phai-ngay"}], "2026-09-03T10:00:00+00:00"),
    ([{"duration_ms": 1.0, "ts": "2026-09-03 09:59:00"}], "2026-09-03T10:00:00+00:00"),
])
def test_queue_wait_None_khi_khong_do_duoc(events, created_at):
    """None = KHÔNG ĐO ĐƯỢC, khác 0. Ca cuối: event trước cả created_at -> âm -> bỏ."""
    assert jobs_uc._tong_ket(events, created_at)["queue_wait_ms"] is None


def test_tong_ket_bo_qua_duration_hong_thay_vi_ne():
    out = jobs_uc._tong_ket([{"duration_ms": "hong"}, {"duration_ms": 7.0}], None)
    assert out["total_ms"] == pytest.approx(7.0)
    assert out["llm_calls"] is None


# ── Route còn mỏng ─────────────────────────────────────────────────────────
def test_route_job_con_mong(client):
    import app.main as be

    day = {}
    for ten in TEN_ROUTE:
        dong = [d for d in inspect.getsource(getattr(be, ten)).split("\n")
                if d.strip() and not d.strip().startswith("#")]
        if len(dong) > 16:
            day[ten] = len(dong)
    assert not day, f"route còn dày, logic chưa chuyển hết: {day}"
