"""Audit vòng 8 — BE#5, #6, #7, #8.

BE#5 memory tree: `filtered_indices` được dựng (hai lần) rồi KHÔNG ai đọc; `idx.search`
      vẫn quét toàn bộ index rồi lọc chủ sở hữu SAU. Ai sở hữu 2/200 tài liệu thì top-15
      node gần nhất hầu như đều của người khác → `scored` rỗng → `return None` → chat
      im lặng tụt về chunk search, không log, không lỗi.
BE#6  Sổ cái `jobs` (Postgres) tồn đọng hàng `status='running'` vĩnh viễn: sweep /
      mark_interrupted / reconcile / request_cancel chỉ ghi sqlite, không gọi
      `close_job`. Và `close_job` map "interrupted" không có trong STATUS_MAP nên rơi
      về "failed" trong im lặng.
BE#7  Xem lại kế hoạch ôn của attempt có quiz đã bị xoá → 500 traceback trống.
BE#8  `ungraded_count` chỉ nằm trong `result` của job, mà job bị prune sau 7 ngày.
"""

import uuid

import pytest


# ── BE#5: bề rộng tìm kiếm phải tính theo tỉ lệ node được phép ──────────────
def test_be_rong_tim_no_ra_khi_chi_so_huu_mot_phan_nho():
    from app.domains.memory import tree

    # 200 node trong index, người dùng chỉ sở hữu 2. Quét 15 node gần nhất thì gần như
    # chắc chắn không node nào của họ lọt vào — đó chính là ca `scored` rỗng.
    rong = tree._be_rong_tim(strategy_top_k=5, tong_node=200, so_node_duoc_phep=2)
    assert rong > 15, "phải quét rộng hơn khi phần được phép rất nhỏ"
    assert rong <= 200, "không bao giờ vượt kích thước index"


def test_be_rong_tim_giu_nguyen_khi_so_huu_toan_bo():
    from app.domains.memory import tree

    assert tree._be_rong_tim(strategy_top_k=5, tong_node=200, so_node_duoc_phep=200) == 15


def test_be_rong_tim_khong_chia_cho_khong():
    from app.domains.memory import tree

    assert tree._be_rong_tim(strategy_top_k=5, tong_node=200, so_node_duoc_phep=0) == 0
    assert tree._be_rong_tim(strategy_top_k=5, tong_node=0, so_node_duoc_phep=0) == 0


def test_be_rong_tim_khong_be_hon_so_node_duoc_phep_khi_index_nho():
    from app.domains.memory import tree

    assert tree._be_rong_tim(strategy_top_k=5, tong_node=8, so_node_duoc_phep=3) == 8


# ── BE#6: sổ cái Postgres phải được đóng ────────────────────────────────────
def test_status_map_biet_interrupted():
    from app.domains.jobs import ledger

    assert ledger.STATUS_MAP.get("interrupted") == "failed", (
        "'interrupted' phải được map TƯỜNG MINH — rơi vào default cũng ra 'failed' "
        "nhưng không ai biết là cố ý hay bỏ sót")


def test_dong_so_cai_theo_jobs_store_ton_tai():
    from app.domains.jobs import ledger

    assert callable(getattr(ledger, "dong_theo_jobs_store", None))


# ── BE#7: quiz đã xoá không được thành 500 ──────────────────────────────────
def test_persist_review_plan_khong_no_khi_quiz_da_bi_xoa(monkeypatch):
    """`s.get(QuizAttempt, ...)` CÓ guard None, `s.get(Quiz, ...)` ngay dưới thì không."""
    import inspect

    from app.domains.review import service

    src = inspect.getsource(service._persist)
    dong = [l.strip() for l in src.split("\n") if "s.get(Quiz," in l]
    assert dong, "không tìm thấy chỗ lấy Quiz"
    assert not any(l.startswith("document_id = s.get(Quiz,") and l.endswith(".document_id")
                   for l in dong), (
        "lấy thuộc tính thẳng trên s.get(...) là 500 khi quiz đã bị xoá")


# ── BE#8: số câu chưa chấm được phải sống lâu bằng attempt ──────────────────
def test_ungraded_count_duoc_ghi_vao_attempt(monkeypatch):
    """Job bị prune sau JOB_RETENTION_DAYS=7; `percentage` thì ở lại DB vĩnh viễn và
    chảy vào `progress.overview`. Lý do phần trăm thấp phải ở lại cùng nó."""
    import inspect

    from app.domains.attempts import repository

    tham_so = inspect.signature(repository.save_grades).parameters
    assert "ungraded_count" in tham_so, (
        "save_grades phải nhận số câu chưa chấm được để ghi vào attempt")


def test_attempt_public_lo_ra_so_cau_chua_cham(monkeypatch):
    import app.main as be

    attempt = {
        "attempt_id": str(uuid.uuid4()), "quiz_id": str(uuid.uuid4()),
        "status": "graded", "score": 2.0, "max_score": 3.0, "percentage": 66.67,
        "correct_count": 2, "incorrect_count": 0, "total_questions": 3,
        "duration_seconds": 10, "started_at": None, "submitted_at": None,
        "graded_at": None, "answers": [],
        "metadata": {"ungraded_count": 1},
    }
    ra = be._attempt_public(attempt)
    assert ra.get("ungraded_count") == 1, (
        "66.7% mà không biết vì sao: một câu LLM chấm hỏng vẫn nằm ở mẫu số")


def test_attempt_public_khong_bia_so_khi_khong_co_metadata():
    import app.main as be

    attempt = {
        "attempt_id": str(uuid.uuid4()), "quiz_id": str(uuid.uuid4()),
        "status": "graded", "score": 3.0, "max_score": 3.0, "percentage": 100.0,
        "correct_count": 3, "incorrect_count": 0, "total_questions": 3,
        "duration_seconds": 10, "started_at": None, "submitted_at": None,
        "graded_at": None, "answers": [],
    }
    assert be._attempt_public(attempt).get("ungraded_count") == 0
