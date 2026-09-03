"""Phase 2D — khoá hành vi QUAN SÁT ĐƯỢC của 7 route job TRƯỚC khi rút khỏi `main.py`.

Bốn route đọc job trả **bốn phép chiếu khác nhau**, và khác biệt giữa chúng chỉ là một
hai trường:

    /api/jobs/<id>              job_id job_type status progress current_step result error
    /api/quizzes/jobs/<id>      job_id          status progress current_step result error
    /api/study-maps/jobs/<id>   job_id          status progress current_step result error
    /jobs/<id>/timeline         job_id job_type status progress events totals

(`/api/attempts/jobs/<id>` là phép chiếu thứ tư — không có `job_type` LẪN `current_step`
— nhưng nó đã ở `application/attempts.py` từ Phase 2B và NGOÀI phạm vi file này.)

Đó đúng là loại khác biệt biến mất khi gộp bốn đoạn `jsonify` gần giống nhau vào một
hàm. Nên test ở đây so **tập khoá chính xác**, không phải tập con: thừa một trường cũng
đỏ, thiếu một trường cũng đỏ.

Hai luật huỷ cũng khác nhau và cũng không được gộp: route chung gác bằng
`_CANCELLABLE_JOB_TYPES` rồi trả **409 kèm thân riêng**; hai route huỷ theo domain gác
bằng chủ sở hữu + loại rồi chỉ trả 404.

Cố ý KHÔNG khoá: nội dung `events` (đã có `test_jobs_timeline`), thứ tự gọi nội bộ,
hay giá trị tuyệt đối của `queue_wait_ms` (phụ thuộc đồng hồ).
"""

from __future__ import annotations

import pytest

from app.domains.jobs import jobs_store as js
from app.graphs.logger import log_node_event

# Tập khoá CHÍNH XÁC của từng phép chiếu. Sửa bảng này chỉ khi CỐ Ý đổi API.
KHOA_JOB_CHUNG = {"job_id", "job_type", "status", "progress", "current_step",
                  "result", "error"}
KHOA_JOB_DOMAIN = {"job_id", "status", "progress", "current_step", "result", "error"}
KHOA_TIMELINE = {"job_id", "job_type", "status", "progress", "events", "totals"}
KHOA_TOTALS = {"total_ms", "llm_calls", "queue_wait_ms"}


@pytest.fixture()
def be(client):
    import app.main as main

    return main


@pytest.fixture(autouse=True)
def _iso(tmp_path, monkeypatch):
    """Mỗi test một bộ DB riêng — job của test trước không rò sang test sau."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("LOG_DB_PATH", str(tmp_path / "logs.sqlite"))
    monkeypatch.setenv("JOBS_DB_PATH", str(tmp_path / "jobs.sqlite"))


def _protect(be, monkeypatch, uid, on=True):
    monkeypatch.setattr(be, "_auth_protect_enabled", lambda: on)
    monkeypatch.setattr(be, "_current_user_id", lambda: uid)


# ── Phép chiếu ─────────────────────────────────────────────────────────────
def test_job_chung_tra_dung_bay_truong(client, be, monkeypatch):
    _protect(be, monkeypatch, None, on=False)
    js.create_job("j-chung", job_type="quiz_generation", status="done", progress=100,
                  current_node="Persist")

    body = client.get("/api/jobs/j-chung").get_json()
    assert set(body) == KHOA_JOB_CHUNG, f"phép chiếu đổi: {sorted(body)}"
    assert body["job_type"] == "quiz_generation"
    assert body["current_step"] == "Persist"
    assert body["progress"] == 100


@pytest.mark.parametrize("duong_dan,loai", [
    ("/api/quizzes/jobs/{}", "quiz_generation"),
    ("/api/study-maps/jobs/{}", "study_map_generation"),
])
def test_job_theo_domain_KHONG_co_job_type(client, be, monkeypatch, duong_dan, loai):
    """Route theo domain đã biết loại từ URL nên không lặp lại trong thân — giữ vậy."""
    _protect(be, monkeypatch, None, on=False)
    js.create_job("j-dom", job_type=loai, status="running", progress=42,
                  current_node="GenerateQuestions")

    body = client.get(duong_dan.format("j-dom")).get_json()
    assert set(body) == KHOA_JOB_DOMAIN, f"phép chiếu đổi: {sorted(body)}"
    assert "job_type" not in body, "route theo domain không được thêm job_type"
    assert body["current_step"] == "GenerateQuestions"


def test_timeline_tra_dung_sau_truong_va_totals_ba_khoa(client, be, monkeypatch):
    _protect(be, monkeypatch, None, on=False)
    js.create_job("j-tl", job_type="summary", status="done")
    log_node_event("j-tl", "CollectInput", "ok", 100.0)
    log_node_event("j-tl", "LLMCalls", "ok", 50.5, {"llm_calls": 4})

    body = client.get("/jobs/j-tl/timeline").get_json()
    assert set(body) == KHOA_TIMELINE, f"phép chiếu đổi: {sorted(body)}"
    assert set(body["totals"]) == KHOA_TOTALS, f"totals đổi: {sorted(body['totals'])}"
    assert body["totals"]["total_ms"] == pytest.approx(150.5)
    assert body["totals"]["llm_calls"] == 4
    qw = body["totals"]["queue_wait_ms"]
    assert qw is None or qw >= 0, f"queue_wait_ms âm: {qw}"


def test_timeline_khong_co_event_van_du_khoa(client, be, monkeypatch):
    """Job chưa chạy node nào: `events` rỗng, `llm_calls`/`queue_wait_ms` là None —
    None nghĩa là "không đo được", KHÁC với 0."""
    _protect(be, monkeypatch, None, on=False)
    js.create_job("j-rong", job_type="summary", status="pending")

    body = client.get("/jobs/j-rong/timeline").get_json()
    assert set(body["totals"]) == KHOA_TOTALS
    assert body["events"] == []
    assert body["totals"]["total_ms"] == 0
    assert body["totals"]["llm_calls"] is None
    assert body["totals"]["queue_wait_ms"] is None


# ── Quyền sở hữu: 404, không phải 403, không tạo oracle ────────────────────
@pytest.mark.parametrize("duong_dan,loai", [
    ("/api/jobs/{}", "quiz_generation"),
    ("/api/quizzes/jobs/{}", "quiz_generation"),
    ("/api/study-maps/jobs/{}", "study_map_generation"),
    ("/jobs/{}/timeline", "summary"),
])
def test_job_cua_nguoi_khac_la_404(client, be, monkeypatch, duong_dan, loai):
    js.create_job("j-nguoi-khac", job_type=loai, status="done", user_id="chu-that")
    _protect(be, monkeypatch, "ke-khac", on=True)

    r = client.get(duong_dan.format("j-nguoi-khac"))
    assert r.status_code == 404
    assert r.get_json() == {"error": "Job not found"}


@pytest.mark.parametrize("duong_dan", [
    "/api/jobs/{}", "/api/quizzes/jobs/{}", "/api/study-maps/jobs/{}", "/jobs/{}/timeline",
])
def test_job_khong_ton_tai_cung_than_loi_voi_job_nguoi_khac(client, be, monkeypatch,
                                                            duong_dan):
    """Hai ca phải KHÔNG phân biệt được — nếu khác nhau thì thân lỗi thành oracle."""
    _protect(be, monkeypatch, "ai-do", on=True)
    r = client.get(duong_dan.format("j-khong-he-co"))
    assert r.status_code == 404
    assert r.get_json() == {"error": "Job not found"}


# ── Cổng loại job ──────────────────────────────────────────────────────────
@pytest.mark.parametrize("duong_dan,loai_sai", [
    ("/api/quizzes/jobs/{}", "study_map_generation"),
    ("/api/study-maps/jobs/{}", "quiz_generation"),
])
def test_job_dung_id_nhung_sai_loai_la_404(client, be, monkeypatch, duong_dan, loai_sai):
    _protect(be, monkeypatch, None, on=False)
    js.create_job("j-sai-loai", job_type=loai_sai, status="done")

    r = client.get(duong_dan.format("j-sai-loai"))
    assert r.status_code == 404
    assert r.get_json() == {"error": "Job not found"}


# ── Huỷ: hai luật khác nhau, không gộp ─────────────────────────────────────
@pytest.mark.parametrize("loai", ["mindmap", "summary", "quiz_generation",
                                  "study_map_generation", "query"])
def test_huy_chung_loai_ho_tro_tra_200(client, be, monkeypatch, loai):
    _protect(be, monkeypatch, None, on=False)
    js.create_job("j-huy", job_type=loai, status="running")

    r = client.post("/api/jobs/j-huy/cancel")
    assert r.status_code == 200
    assert r.get_json() == {"job_id": "j-huy", "cancel_requested": True}
    assert js.is_cancel_requested("j-huy") is True


@pytest.mark.parametrize("loai", ["ingest", "short_answer_grading"])
def test_huy_chung_loai_khong_ho_tro_tra_409_kem_than_rieng(client, be, monkeypatch, loai):
    """Từ chối thẳng thay vì hứa suông: executor của các loại này KHÔNG đọc cờ huỷ,
    nên trả `cancel_requested: true` sẽ làm FE hiện "Đang huỷ…" rồi treo tới hết TTL."""
    _protect(be, monkeypatch, None, on=False)
    js.create_job("j-khong-huy", job_type=loai, status="running")

    r = client.post("/api/jobs/j-khong-huy/cancel")
    assert r.status_code == 409
    body = r.get_json()
    assert set(body) == {"error", "job_id", "cancel_requested"}
    assert body["job_id"] == "j-khong-huy"
    assert body["cancel_requested"] is False
    assert loai in body["error"]
    assert js.is_cancel_requested("j-khong-huy") is False, "không được ghi cờ khi từ chối"


@pytest.mark.parametrize("duong_dan,loai", [
    ("/api/quizzes/jobs/{}/cancel", "quiz_generation"),
    ("/api/study-maps/jobs/{}/cancel", "study_map_generation"),
])
def test_huy_theo_domain_dung_loai_thi_200(client, be, monkeypatch, duong_dan, loai):
    js.create_job("j-dhuy", job_type=loai, status="running", user_id="chu-that")
    _protect(be, monkeypatch, "chu-that", on=True)

    r = client.post(duong_dan.format("j-dhuy"))
    assert r.status_code == 200
    assert r.get_json() == {"job_id": "j-dhuy", "cancel_requested": True}


@pytest.mark.parametrize("duong_dan,loai_sai", [
    ("/api/quizzes/jobs/{}/cancel", "study_map_generation"),
    ("/api/study-maps/jobs/{}/cancel", "quiz_generation"),
])
def test_huy_theo_domain_sai_loai_hoac_khac_chu_deu_404(client, be, monkeypatch,
                                                        duong_dan, loai_sai):
    """KHÔNG có nhánh 409 ở đây — luật huỷ theo domain khác luật của route chung."""
    js.create_job("j-dsai", job_type=loai_sai, status="running", user_id="chu-that")
    _protect(be, monkeypatch, "chu-that", on=True)

    r = client.post(duong_dan.format("j-dsai"))
    assert r.status_code == 404
    assert r.get_json() == {"error": "Job not found"}
    assert js.is_cancel_requested("j-dsai") is False
