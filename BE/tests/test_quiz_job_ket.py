"""Audit vòng 8 — ba cách job quiz kẹt mà người dùng không hiểu vì sao.

BE#2  Enqueue xong không ai chạy → job nằm `pending` mãi. Dedupe vòng 7 thấy nó "còn
      sống" nên MỌI lần bấm sau đều trả về đúng cái job chết đó. Người dùng vĩnh viễn
      không tạo lại được quiz cùng cấu hình.
BE#3  Giữa `progress=30` và `progress=70` là `generate_questions` — không nhịp tim nào.
      `QUIZ_LLM_TIMEOUT_SEC=900` × `MAX_ATTEMPTS=2` = tối đa 1800s im lặng, trong khi
      `JOB_STUCK_AFTER_SECONDS=900`. Job đang chạy bình thường bị quét thành
      `interrupted`, người dùng bấm lại và job thứ hai tranh 1 slot LLM.
BE#9  Bấm Huỷ giữa lúc gọi model thì "Đang huỷ…" đứng cho tới khi model trả lời xong.
"""

import time

import pytest


# ── BE#2: giữ chỗ dedupe không được biến thành cửa khoá vĩnh viễn ───────────
@pytest.fixture()
def be_mod(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import app.main as be
    be._QUIZ_INFLIGHT.clear()
    return be


def _tao_job(status: str, *, cu_giay: float = 0.0):
    """Tạo job thật trong jobs_store, có thể lùi `updated_at` về quá khứ."""
    import uuid
    from datetime import datetime, timedelta, timezone

    from app.domains.jobs.jobs_store import create_job, get_conn, init_db

    job_id = str(uuid.uuid4())
    create_job(job_id, job_type="quiz_generation", status=status, progress=0,
               current_node="Queued", user_id="u1")
    if cu_giay:
        init_db()
        moc = (datetime.now(timezone.utc) - timedelta(seconds=cu_giay)).isoformat()
        conn = get_conn()
        try:
            conn.execute("UPDATE jobs SET updated_at=? WHERE job_id=?", (moc, job_id))
            conn.commit()
        finally:
            conn.close()
    return job_id


def test_job_pending_con_moi_van_duoc_dedupe(be_mod):
    """Đừng phá hành vi vòng 7: bấm năm lần trong hai giây vẫn phải ra một job."""
    cu = _tao_job("pending")
    be_mod._QUIZ_INFLIGHT["k"] = cu
    assert be_mod._quiz_job_giu_cho("k", "moi") == cu


def test_job_pending_qua_cu_khong_con_duoc_coi_la_dang_song(be_mod):
    """Enqueue xong mà không worker nào nhận: job nằm `pending` mãi.

    `sweep_stuck_jobs` CỐ Ý không đụng pending (hàng đợi chờ lâu là hợp lệ), nên không
    có ai dọn nó cho tới lần khởi động sau. Dedupe phải tự nhận ra.
    """
    cu = _tao_job("pending", cu_giay=be_mod._QUIZ_PENDING_TOI_DA_GIAY + 30)
    be_mod._QUIZ_INFLIGHT["k"] = cu
    assert be_mod._quiz_job_giu_cho("k", "moi") is None, "job pending chết phải nhường chỗ"
    assert be_mod._QUIZ_INFLIGHT["k"] == "moi"


def test_job_running_cu_van_duoc_coi_la_song(be_mod):
    """Chỉ `pending` mới bị nghi ngờ. `running` cũ là việc của `sweep_stuck_jobs`."""
    cu = _tao_job("running", cu_giay=be_mod._QUIZ_PENDING_TOI_DA_GIAY + 30)
    be_mod._QUIZ_INFLIGHT["k"] = cu
    assert be_mod._quiz_job_giu_cho("k", "moi") == cu


def test_nha_cho_khi_khong_xep_hang_duoc(be_mod):
    """Route hỏng sau khi giữ chỗ thì phải trả chỗ lại, đừng để khoá treo."""
    assert be_mod._quiz_job_giu_cho("k", "moi") is None
    be_mod._quiz_job_nha_cho("k", "moi")
    assert "k" not in be_mod._QUIZ_INFLIGHT


def test_nha_cho_khong_dam_vao_job_cua_nguoi_khac(be_mod):
    """Chỗ đã bị request khác chiếm thì không được xoá nhầm."""
    be_mod._QUIZ_INFLIGHT["k"] = "cua_nguoi_khac"
    be_mod._quiz_job_nha_cho("k", "moi")
    assert be_mod._QUIZ_INFLIGHT["k"] == "cua_nguoi_khac"


# ── BE#3: nhịp tim trong lúc gọi model ──────────────────────────────────────
def test_nhip_tim_cham_updated_at_trong_luc_job_chay(be_mod):
    from app.domains.jobs.jobs_store import get_job

    job_id = _tao_job("running")
    truoc = get_job(job_id)["updated_at"]

    with be_mod._nhip_tim_job(job_id, moi_giay=0.05):
        time.sleep(0.3)

    sau = get_job(job_id)["updated_at"]
    assert sau > truoc, "job chạy lâu phải tự báo còn sống, không thì bị quét"


def test_nhip_tim_dung_han_khi_ra_khoi_khoi(be_mod):
    from app.domains.jobs.jobs_store import get_job

    job_id = _tao_job("running")
    with be_mod._nhip_tim_job(job_id, moi_giay=0.05):
        time.sleep(0.15)
    moc = get_job(job_id)["updated_at"]
    time.sleep(0.3)
    assert get_job(job_id)["updated_at"] == moc, "ra khỏi khối là phải im"


def test_nhip_tim_khong_lam_hong_job_khi_update_that_bai(be_mod, monkeypatch):
    """Nhịp tim là việc phụ — hỏng thì im, không được ném vào luồng job."""
    import app.domains.jobs.jobs_store as js

    def _no(*a, **k):
        raise RuntimeError("sqlite locked")

    monkeypatch.setattr(js, "touch_job", _no)
    with be_mod._nhip_tim_job("khong-co-that", moi_giay=0.05):
        time.sleep(0.15)


# ── BE#9: huỷ được nhận giữa hai lượt gọi model ─────────────────────────────
def test_generate_questions_dung_lai_khi_da_huy():
    from app.domains.quiz import generator as gen

    lan = []

    def _ask(prompt, **kw):
        lan.append(1)
        return "không phải json"      # ép sang lượt 2

    qs, err, attempts = gen.generate_questions(
        "ngữ liệu", {}, ask=_ask, da_huy=lambda: len(lan) >= 1)

    assert len(lan) == 1, "đã huỷ thì không gọi model lượt nữa"
    assert not qs and err and "huỷ" in err.lower()


def test_khong_huy_thi_van_thu_du_luot():
    from app.domains.quiz import generator as gen

    lan = []

    def _ask(prompt, **kw):
        lan.append(1)
        return "không phải json"

    gen.generate_questions("ngữ liệu", {}, ask=_ask, da_huy=lambda: False)
    assert len(lan) == gen.MAX_ATTEMPTS
