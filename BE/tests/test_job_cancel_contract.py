"""`/api/jobs/<id>/cancel` chỉ được nhận job mà executor THẬT SỰ ack cờ huỷ.

Trước 2026-08-28 route nhận mọi job_id và luôn trả `cancel_requested: true`. Nhưng
`grep -rn is_cancel_requested BE/app BE/services` chỉ trúng mindmap, summary, quiz và
study map — `ingest`, `query`, `short_answer_grading` không đọc cờ ở bất kỳ đâu. Với ba
loại đó, huỷ là lời hứa suông: cờ bật, không ai đọc, `sweep_stuck_jobs` cũng không cứu
được vì job đang chạy vẫn heartbeat đều. FE hiện "Đang huỷ…" tới hết TTL — đúng lớp lỗi
known-issues 2026-07-17.

Đo thật trước khi sửa (tạo job running rồi gọi request_cancel):

    ingest                 status=running    cancel_requested=True
    short_answer_grading   status=running    cancel_requested=True
    query                  status=running    cancel_requested=True
    summary                status=running    cancel_requested=True   <- chỉ cái này có ai ack

**Cập nhật 2026-09-01 — `query` đã chuyển sang nhóm ACK.** `build_query_graph` nhận
`da_huy` và `_boc_huy` bọc CẢ 18 node, đọc cờ trước mỗi node; `_query_da_huy` nối qua
`wiring.py` vào graph production; `_finalize_query_job` ghi `status="cancelled"` chứ
không rơi vào nhánh lỗi. Xem `tests/test_query_cancel.py` (11 test).

Trần đã biết và KHÔNG được hứa quá: huỷ chỉ tới được ở RANH GIỚI node. Node đang chạy là
một request HTTP tới Ollama, Python không cắt ngang được — worst case là thời lượng node
đó (`AI_TIMEOUT_SEC=180` với GenerateAnswer). Nhưng đó vẫn là ack thật: job dừng và nhả
slot LLM, khác hẳn `ingest`/`short_answer_grading` vốn không đọc cờ ở đâu cả.
"""

import uuid

import pytest

from app.domains.jobs import jobs_store


@pytest.fixture()
def job_factory(client):
    """Tạo job running thật, dọn sạch sau mỗi test."""
    ids = []

    def make(job_type: str) -> str:
        jid = f"test-cancel-{uuid.uuid4()}"
        jobs_store.create_job(jid, job_type=job_type)
        jobs_store.update_job(jid, status="running", progress=40)
        ids.append(jid)
        return jid

    yield make

    conn = jobs_store.get_conn()
    try:
        conn.executemany("DELETE FROM jobs WHERE job_id=?", [(i,) for i in ids])
        conn.commit()
    finally:
        conn.close()


@pytest.mark.parametrize("job_type", ["mindmap", "summary", "quiz_generation",
                                      "study_map_generation", "query"])
def test_loai_co_ack_thi_huy_duoc(client, job_factory, job_type):
    jid = job_factory(job_type)
    r = client.post(f"/api/jobs/{jid}/cancel")
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["cancel_requested"] is True
    assert jobs_store.is_cancel_requested(jid) is True


@pytest.mark.parametrize("job_type", ["ingest", "short_answer_grading"])
def test_loai_khong_ack_thi_tu_choi_thay_vi_hua_suong(client, job_factory, job_type):
    """409 + cờ KHÔNG bật. Bật cờ mà không ai đọc là cách tạo ra 'Đang huỷ…' kẹt."""
    jid = job_factory(job_type)
    r = client.post(f"/api/jobs/{jid}/cancel")
    assert r.status_code == 409, r.get_json()
    body = r.get_json()
    assert body["cancel_requested"] is False
    assert job_type in body["error"], "thông báo phải nói RÕ loại nào không huỷ được"
    assert jobs_store.is_cancel_requested(jid) is False, "không được bật cờ rồi bỏ đó"


def test_job_khong_ton_tai_van_la_404(client):
    assert client.post(f"/api/jobs/{uuid.uuid4()}/cancel").status_code == 404
