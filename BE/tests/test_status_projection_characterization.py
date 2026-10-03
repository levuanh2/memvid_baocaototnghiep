"""Khoá TẬP KHOÁ CHÍNH XÁC của hai route trạng thái Summary/Mindmap.

Hệ thống hiện có **năm** phép chiếu job khác nhau. Ba cái của `application/jobs.py` đã
được `test_jobs_characterization.py` khoá từ Phase 2D. Hai cái còn lại — hai file này —
chưa ai khoá, và chúng khác ba cái kia ở đúng những chỗ dễ mất nhất khi gộp mã:

    /api/jobs/<id>           job_id  job_type  status progress current_step result error
    /api/quizzes/jobs/<id>                     status progress current_step result error
                             + job_id
    /summary-status/<id>                       status progress current_node  result error
    /mindmap-status/<id>                       status progress current_node  result error
                                               (+ partial, CÓ ĐIỀU KIỆN)

Hai điểm khác biệt không nhìn ra được nếu chỉ đọc lướt: hai route ở đây **không trả
`job_id`**, và trường node tên là **`current_node`**, không phải `current_step`.

Cố ý KHÔNG dùng helper chung cho hai nhóm test bên dưới. Hai route này có ngữ nghĩa
lệch nhau (chỉ mindmap có `partial`, chỉ mindmap không kiểm lại loại khi huỷ), và một
hàm `assert_projection(..., include_partial=...)` sẽ giấu đúng thứ file này sinh ra để
canh. Trùng lặp ở tầng test là giá phải trả, có chủ đích.

Quyền sở hữu KHÔNG khoá lại ở đây — `test_summary_ownership` và `test_mindmap_ownership`
đã phủ đủ (401 khi chưa đăng nhập, 200 cho chủ, 404 cho người khác). File này chỉ bổ
sung phần thân response mà hai file đó không assert.
"""

from __future__ import annotations

import pytest

# Tập khoá CHÍNH XÁC. Sửa hai hằng này chỉ khi CỐ Ý đổi API.
KHOA_SUMMARY = {"status", "progress", "current_node", "result", "error", "usage"}
KHOA_MINDMAP = {"status", "progress", "current_node", "result", "error", "usage"}


@pytest.fixture()
def be(client):
    import app.main as main

    return main


@pytest.fixture(autouse=True)
def _tat_cuong_che(be, monkeypatch):
    """Tắt cưỡng chế sở hữu để test đo ĐÚNG phép chiếu, không lẫn cổng quyền.

    Đặt tường minh chứ không dựa vào mặc định của env: test khác trong bộ có
    `monkeypatch.setenv("AUTH_PROTECT_APP_APIS", ...)`, và file này phải chạy đúng
    dù xếp ở vị trí nào.
    """
    monkeypatch.setattr(be, "_auth_protect_enabled", lambda: False)


def _job(monkeypatch, row, job_id="j1"):
    """Thay `jobs_store.get_job` — route tra tên này trong module đó lúc chạy."""
    from app.domains.jobs import jobs_store as js

    monkeypatch.setattr(js, "get_job", lambda jid: row if jid == job_id else None)


# ══════════════════════════════════════════════════════════════════════════
# SUMMARY  —  GET /summary-status/<job_id>
# ══════════════════════════════════════════════════════════════════════════
def test_summary_status_projection_exact_keys(client, monkeypatch):
    """Thừa một khoá cũng đỏ, thiếu một khoá cũng đỏ."""
    _job(monkeypatch, {"job_type": "summary", "status": "running", "progress": 40,
                       "current_node": "SummarizeSections", "result": None,
                       "error": None, "user_id": None,
                       # Những trường này CÓ trong bản ghi job nhưng KHÔNG được lộ ra:
                       "created_at": "2026-09-03T00:00:00Z", "updated_at": "x"})

    r = client.get("/summary-status/j1")
    assert r.status_code == 200
    body = r.get_json()

    assert set(body) == KHOA_SUMMARY, f"phép chiếu đổi: {sorted(body)}"
    assert "job_id" not in body, "/summary-status chưa bao giờ trả job_id"
    assert "current_step" not in body, "trường node ở route này tên là `current_node`"
    assert body["status"] == "running"
    assert body["progress"] == 40
    assert body["current_node"] == "SummarizeSections"


def test_summary_status_done_job_tra_nguyen_result(client, monkeypatch):
    ket_qua = {"id": "s1", "title": "T", "sections": [{"h": "1"}]}
    _job(monkeypatch, {"job_type": "summary", "status": "done", "progress": 100,
                       "current_node": "Persist", "result": ket_qua, "error": None})

    body = client.get("/summary-status/j1").get_json()
    assert set(body) == KHOA_SUMMARY
    assert body["result"] == ket_qua, "result đi thẳng ra, không bị bọc thêm lớp nào"
    assert body["error"] is None


def test_summary_status_job_loi_giu_nguyen_van_ban_loi(client, monkeypatch):
    _job(monkeypatch, {"job_type": "summary", "status": "error", "progress": 60,
                       "current_node": "Synthesize", "result": None,
                       "error": "LLM tra ve JSON hong"})

    body = client.get("/summary-status/j1").get_json()
    assert set(body) == KHOA_SUMMARY
    assert body["status"] == "error"
    assert body["error"] == "LLM tra ve JSON hong"


def test_summary_status_thieu_progress_thi_la_0(client, monkeypatch):
    """Bản ghi job cũ có thể không có `progress`; route điền 0, không phải None."""
    _job(monkeypatch, {"job_type": "summary", "status": "pending",
                       "current_node": None, "result": None, "error": None})

    body = client.get("/summary-status/j1").get_json()
    assert body["progress"] == 0
    assert body["current_node"] == "", "`current_node` None phải thành chuỗi rỗng"


def test_summary_status_job_cu_khong_co_job_type_van_duoc_chap_nhan(client, monkeypatch):
    """Cổng loại là `("summary", None)` — job sinh trước khi có cột `job_type` vẫn đọc
    được. Ghi nhận hiện trạng, KHÔNG phải đề xuất sửa."""
    _job(monkeypatch, {"job_type": None, "status": "running", "progress": 5,
                       "current_node": "CollectInput", "result": None, "error": None})

    r = client.get("/summary-status/j1")
    assert r.status_code == 200
    assert set(r.get_json()) == KHOA_SUMMARY


def test_summary_status_missing_job_preserves_response(client, monkeypatch):
    _job(monkeypatch, None)

    r = client.get("/summary-status/khong-he-co")
    assert r.status_code == 404
    assert r.get_json() == {"error": "Job not found"}


# ══════════════════════════════════════════════════════════════════════════
# MINDMAP  —  GET /mindmap-status/<job_id>
# ══════════════════════════════════════════════════════════════════════════
def test_mindmap_status_projection_exact_keys(client, monkeypatch):
    _job(monkeypatch, {"job_type": "mindmap", "status": "running", "progress": 30,
                       "current_node": "Skeleton", "result": None, "error": None,
                       "user_id": None, "created_at": "2026-09-03T00:00:00Z"})

    r = client.get("/mindmap-status/j1")
    assert r.status_code == 200
    body = r.get_json()

    assert set(body) == KHOA_MINDMAP, f"phép chiếu đổi: {sorted(body)}"
    assert "job_id" not in body, "/mindmap-status chưa bao giờ trả job_id"
    assert "current_step" not in body, "trường node ở route này tên là `current_node`"
    assert "partial" not in body, "không có partial thì KHÔNG được thêm khoá rỗng"
    assert body["current_node"] == "Skeleton"


def test_mindmap_status_partial_included_while_running(client, monkeypatch):
    """Node Skeleton ghi `result={"partial": …}` để FE vẽ trước khi job xong."""
    xem_truoc = {"nodes": [{"id": "n1", "label": "A"}], "relations": []}
    _job(monkeypatch, {"job_type": "mindmap", "status": "running", "progress": 45,
                       "current_node": "Skeleton", "result": {"partial": xem_truoc},
                       "error": None})

    body = client.get("/mindmap-status/j1").get_json()
    assert set(body) == KHOA_MINDMAP | {"partial"}
    assert body["partial"] == xem_truoc, "giá trị partial đi thẳng ra, không sao chép nông"
    assert body["result"] == {"partial": xem_truoc}, "`result` vẫn giữ nguyên bản gốc"


def test_mindmap_status_partial_only_while_running(client, monkeypatch):
    """Điều kiện là `status == "running"`, KHÔNG phải "result có partial".

    Job đã xong mà result vẫn còn khoá `partial` thì route KHÔNG nâng nó lên tầng trên.
    Đây là hành vi hiện tại, khoá lại nguyên trạng.
    """
    _job(monkeypatch, {"job_type": "mindmap", "status": "done", "progress": 100,
                       "current_node": "Persist",
                       "result": {"partial": {"nodes": []}, "id": "m1"}, "error": None})

    body = client.get("/mindmap-status/j1").get_json()
    assert set(body) == KHOA_MINDMAP
    assert "partial" not in body, "xong rồi thì không còn xem trước"
    assert body["result"]["partial"] == {"nodes": []}, "nhưng `result` không bị đụng vào"


def test_mindmap_status_partial_bo_qua_khi_result_khong_phai_dict(client, monkeypatch):
    """`isinstance(result, dict)` là điều kiện thứ hai — result kiểu khác thì bỏ qua."""
    _job(monkeypatch, {"job_type": "mindmap", "status": "running", "progress": 10,
                       "current_node": "Outline", "result": "chuoi-khong-phai-dict",
                       "error": None})

    body = client.get("/mindmap-status/j1").get_json()
    assert set(body) == KHOA_MINDMAP
    assert "partial" not in body


def test_mindmap_status_job_loi_giu_nguyen_van_ban_loi(client, monkeypatch):
    _job(monkeypatch, {"job_type": "mindmap", "status": "error", "progress": 20,
                       "current_node": "Enrich", "result": None,
                       "error": "khong ket noi duoc Ollama"})

    body = client.get("/mindmap-status/j1").get_json()
    assert set(body) == KHOA_MINDMAP
    assert body["error"] == "khong ket noi duoc Ollama"
    assert "partial" not in body


def test_mindmap_status_job_cu_khong_co_job_type_van_duoc_chap_nhan(client, monkeypatch):
    """Cổng loại là `("mindmap", None)`, song song với summary."""
    _job(monkeypatch, {"job_type": None, "status": "running", "progress": 1,
                       "current_node": "CollectInput", "result": None, "error": None})

    r = client.get("/mindmap-status/j1")
    assert r.status_code == 200
    assert set(r.get_json()) == KHOA_MINDMAP


def test_mindmap_status_missing_job_preserves_response(client, monkeypatch):
    _job(monkeypatch, None)

    r = client.get("/mindmap-status/khong-he-co")
    assert r.status_code == 404
    assert r.get_json() == {"error": "Job not found"}
