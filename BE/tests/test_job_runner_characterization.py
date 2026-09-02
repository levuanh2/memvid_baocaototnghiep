"""Khoá hành vi QUAN SÁT ĐƯỢC của 6 job runner TRƯỚC khi rút chúng khỏi `main.py`.

Đây là characterization test, không phải test tính năng: mục tiêu không phải chứng minh
job làm đúng (1030 test hiện có lo việc đó), mà chốt lại những thứ **một cú di chuyển
mã sẽ làm gãy trong im lặng**.

Ba thứ đó, theo thứ tự nguy hiểm:

1. **Đường dẫn dotted.** `enqueue_job` đưa hàm cho RQ, và RQ serialize hàm bằng
   `module.qualname` rồi import lại ở tiến trình worker. Chuyển `run_quiz_generation_job`
   sang `app.application.quiz_generation` là mọi job ĐANG NẰM TRONG HÀNG ĐỢI trỏ vào một
   đường dẫn không còn tồn tại — worker `ImportError`, job chết, và ở chế độ thread thì
   KHÔNG có gì kêu vì chế độ thread không dùng đường dẫn. Test chạy ở chế độ thread sẽ
   xanh trong khi production hỏng.
2. **Chữ ký.** `enqueue_job(..., args=(job_id, document_id, config, uid))` truyền theo vị
   trí. Đổi thứ tự tham số lúc chuyển file là hỏng lặng.
3. **Trình tự tác dụng phụ.** Job ghi trạng thái qua `jobs_store.update_job` và mở/đóng
   sổ cái. Thứ tự các mốc đó là thứ FE poll nhìn thấy.

Cố ý KHÔNG khoá: nội dung câu hỏi sinh ra, số câu, văn bản lỗi. Đó là hành vi tính năng,
đã có test riêng, và khoá thêm ở đây chỉ tạo ra test đỏ giả mỗi lần chỉnh prompt.
"""

import importlib
import inspect
import os
import uuid

import pytest


# `be` / `owner` là fixture CỤC BỘ của `test_quiz_generation.py`, không nằm trong
# conftest. Khai lại ở đây thay vì import chéo giữa hai file test — import chéo làm thứ
# tự thu thập test thành một phần của hợp đồng, và đó là thứ không ai muốn gỡ lúc 2 giờ
# sáng. Chỉ HELPER (không phải fixture) mới import chéo, ở trong thân test.
@pytest.fixture(scope="module", autouse=True)
def _can_db():
    from shared.env_loader import load_project_env

    load_project_env()
    if not (os.getenv("DATABASE_URL") or "").strip():
        pytest.skip("cần DATABASE_URL (PostgreSQL) — xem BE/.env")


@pytest.fixture()
def be(client):
    import app.main as main

    return main


@pytest.fixture()
def owner():
    from app.db import session_scope
    from app.db.models import User
    from app.domains.auth import users_store

    u = users_store.create_user(f"jobchar_{uuid.uuid4().hex[:8]}@example.com", "password123")
    yield u["user_id"]
    with session_scope() as s:
        row = s.get(User, u["user_id"])
        if row is not None:
            s.delete(row)

TEN_JOB = [
    "run_study_map_job",
    "run_quiz_generation_job",
    "run_short_answer_grading_job",
    "run_memory_tree_job",
    "run_summary_job",
    "run_mindmap_job",
]

# Chữ ký hiện tại, chụp 2026-09-02. Sửa bảng này chỉ khi CỐ Ý đổi chữ ký.
CHU_KY = {
    "run_study_map_job": ["job_id", "document_id", "user_id"],
    "run_quiz_generation_job": ["job_id", "document_id", "config", "user_id"],
    "run_short_answer_grading_job": ["job_id", "attempt_id", "user_id"],
    "run_memory_tree_job": ["source_stems"],
    "run_summary_job": ["job_id", "source_names", "mm_input", "content_hash",
                        "length_mode", "user_id", "mode"],
    "run_mindmap_job": ["job_id", "source_names", "mm_input", "content_hash", "user_id"],
}


@pytest.mark.parametrize("ten", TEN_JOB)
def test_goi_duoc_theo_duong_dan_dotted(client, ten):
    """RQ import lại hàm bằng `app.main.<ten>` ở tiến trình worker.

    Sau khi chuyển sang `application/`, `main.py` PHẢI còn một tên gọi ở đúng chỗ này
    (wrapper trỏ sang use case là đủ), nếu không job đang nằm trong hàng đợi sẽ chết.
    """
    mod = importlib.import_module("app.main")
    fn = getattr(mod, ten, None)
    assert callable(fn), f"app.main.{ten} không còn gọi được — RQ sẽ ImportError"


@pytest.mark.parametrize("ten", TEN_JOB)
def test_chu_ky_khong_doi(client, ten):
    """`enqueue_job(args=(...))` truyền theo VỊ TRÍ — đổi thứ tự là hỏng lặng."""
    import app.main as be

    thuc_te = list(inspect.signature(getattr(be, ten)).parameters)
    assert thuc_te == CHU_KY[ten], f"chữ ký {ten} đổi: {thuc_te} != {CHU_KY[ten]}"


def test_moi_job_runner_deu_o_muc_module(client):
    """Hàm lồng trong hàm khác KHÔNG rút ra được mà không đổi chữ ký.

    `process_query_job` là ca đó: nó nằm trong `query()` và đọc `req_user_id` từ closure.
    Test này khoá việc 6 job runner còn lại KHÔNG rơi vào tình trạng ấy.
    """
    import app.main as be

    for ten in TEN_JOB:
        fn = getattr(be, ten)
        assert fn.__qualname__ == ten, (
            f"{ten} là hàm lồng ({fn.__qualname__}) — không rút ra được nguyên trạng")


def test_process_query_job_van_la_ham_long_trong_query(client):
    """Ghi nhận hiện trạng, KHÔNG phải yêu cầu sửa.

    `process_query_job` đọc `req_user_id`, `session_id`, `conv_enforce`… từ closure của
    `query()`. Nó không nằm trong danh sách 6 job runner sẽ chuyển ở Phase 1, và test này
    tồn tại để nếu ai đó rút nó ra thì phải làm có chủ đích, không phải tiện tay.
    """
    import app.main as be

    assert not hasattr(be, "process_query_job"), (
        "process_query_job giờ ở mức module — nếu là cố ý thì cập nhật test này và ghi "
        "rõ closure đã được truyền tường minh thế nào")


def test_quiz_job_giu_dung_trinh_tu_trang_thai(be, client, monkeypatch, owner):
    """Trình tự mốc trạng thái là thứ FE poll nhìn thấy — di chuyển mã không được đổi nó."""
    from tests.test_quiz_generation import (_fake_llm, _generate, _protect, _question,
                                            _run_inline, _seed_document)

    import app.domains.jobs.jobs_store as js

    _protect(be, monkeypatch, owner)
    doc_id, _ = _seed_document(client)
    _run_inline(monkeypatch)
    _fake_llm(monkeypatch, {"questions": [_question("Cau tot?")]})

    moc = []
    that = js.update_job

    def _ghi(job_id, **kw):
        if "status" in kw or "current_node" in kw:
            moc.append((kw.get("status"), kw.get("current_node")))
        return that(job_id, **kw)

    monkeypatch.setattr(js, "update_job", _ghi)

    job_id = _generate(client, doc_id, question_count=1).get_json()["job_id"]
    assert client.get(f"/api/quizzes/jobs/{job_id}").get_json()["status"] == "done"

    node = [n for _, n in moc if n]
    assert node[0] == "BuildContext", f"mốc đầu đổi: {node}"
    assert node[-1] == "Persist", f"mốc cuối đổi: {node}"
    assert "GenerateQuestions" in node and "Validate" in node, node
    assert moc[-1][0] == "done", f"trạng thái cuối phải là done: {moc[-1]}"


def test_quiz_job_mo_va_dong_so_cai(be, client, monkeypatch, owner):
    """Sổ cái Postgres (`jobs`) phải được mở lúc bắt đầu và đóng lúc kết thúc.

    Đây là ràng buộc FK của `ai_validation_logs.job_id`; chuyển mã mà quên gọi ledger là
    log validation mất dấu job sinh ra nó.
    """
    from tests.test_quiz_generation import (_fake_llm, _generate, _protect, _question,
                                            _run_inline, _seed_document)

    import app.domains.jobs.ledger as ledger

    _protect(be, monkeypatch, owner)
    doc_id, _ = _seed_document(client)
    _run_inline(monkeypatch)
    _fake_llm(monkeypatch, {"questions": [_question("Cau tot?")]})

    goi = []
    mo_that, dong_that = ledger.open_job, ledger.close_job
    monkeypatch.setattr(ledger, "open_job",
                        lambda *a, **k: (goi.append("open"), mo_that(*a, **k))[1])
    monkeypatch.setattr(ledger, "close_job",
                        lambda *a, **k: (goi.append("close"), dong_that(*a, **k))[1])

    _generate(client, doc_id, question_count=1)
    assert goi == ["open", "close"], f"trình tự sổ cái đổi: {goi}"
