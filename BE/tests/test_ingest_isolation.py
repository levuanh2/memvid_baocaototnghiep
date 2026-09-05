"""Ingest nặng không được chạy trong tiến trình web khi đã bật hàng đợi.

Sự cố đo trên production 2026-09-05: một PDF 190 KB đẩy tiến trình web từ nền 332 MB
lên >425 MB rồi bị OOM killer giết (trần 512 MiB, Render free). Trong 61 giây sau đó
KHÔNG có tiến trình nào lắng nghe, nên `/sources/<id>/status` và cả `/health` nhận 502
từ proxy Render — không một dòng log gunicorn nào. Flask không có đường nào trả 502 cho
endpoint ấy; nó chưa bao giờ được gọi tới.

Hai khẳng định ở đây:

  1. Bật `QUEUE_ENABLED` thì việc nặng đi ra ngoài, hoặc THẤT BẠI RÕ RÀNG. Không có
     đường thứ ba "chạy tạm trong web" — đó chính là đường đã làm sập dịch vụ.
  2. Tiến trình chết giữa chừng thì tài liệu KHÔNG nằm lại `processing` vĩnh viễn.

Kèm bốn khẳng định phòng hồi quy: fallback thread lúc TẮT queue vẫn nguyên (đó là chế
độ chạy của máy dev), đường enqueue thành công vẫn nguyên, phân loại lỗi FPT vẫn nguyên,
và ngữ nghĩa xuất bản index vẫn nguyên.
"""

from __future__ import annotations

import ast
import inspect
import io as _io
import json
import pathlib
import threading

import pytest

from app.jobs import queue as q

# `conftest.client` gán đè `app.main._trigger_background_ingest` bằng một lambda và
# KHÔNG hoàn lại (conftest.py:150) — cùng họ với lỗi phụ thuộc thứ tự đã ghi ở
# known-issues 2026-09-02. Bắt bản thật ngay lúc COLLECT, trước khi fixture nào chạy,
# rồi lắp lại trong test cần nó. Không có dòng này thì test đỏ/xanh tuỳ thứ tự chạy.
import app.main as _be_luc_collect  # noqa: E402

_TRIGGER_THAT = _be_luc_collect._trigger_background_ingest


# ── Khung dùng chung ──────────────────────────────────────────────────────
class _TaiLieuGia:
    """Đủ thuộc tính cho `reconcile_interrupted_documents` đọc, không cần database."""

    def __init__(self, doc_id: str, ingest_status: str):
        self.id = doc_id
        self.status = "processing"
        self.metadata_json = {"ingest_status": ingest_status}


def _gia_lap_db(monkeypatch, rows):
    """Thay `session_scope` bằng một phiên giả trả đúng `rows`, và ghi lại mọi lượt
    `update_status`. Nhờ vậy test chạy được không cần TEST_DATABASE_URL."""
    import contextlib

    from app.domains.documents import repository as repo

    da_ha: list = []

    class _KetQua:
        def scalars(self):
            return self

        def all(self):
            return rows

    class _Phien:
        def execute(self, *_a, **_k):
            return _KetQua()

    @contextlib.contextmanager
    def phien_gia():
        yield _Phien()

    monkeypatch.setattr(repo, "session_scope", phien_gia)
    monkeypatch.setattr(repo, "update_status",
                        lambda doc_id, status, **kw: da_ha.append((doc_id, status, kw)))
    return repo, da_ha


# ── 1. Bật queue: việc nặng KHÔNG được chạy trong tiến trình web ──────────
def test_bat_queue_va_day_hong_thi_NEM_chu_khong_chay_tai_cho(monkeypatch):
    """Khẳng định chính của phase. `fail_closed=True` + Redis hỏng = ném, và tuyệt đối
    không có thread nào được dựng."""
    monkeypatch.setenv("QUEUE_ENABLED", "1")
    monkeypatch.setattr(q, "get_queue", lambda *_a, **_k: (_ for _ in ()).throw(
        RuntimeError("redis down")))
    da_chay = threading.Event()

    with pytest.raises(q.EnqueueFailed) as e:
        q.enqueue_job(lambda: da_chay.set(), queue="ingest", fail_closed=True)

    assert not da_chay.wait(0.3), "việc nặng đã chạy trong tiến trình web"
    assert "ingest" in str(e.value)


def test_thong_bao_loi_KHONG_kem_chi_tiet_ket_noi(monkeypatch):
    """URL Redis có thể mang mật khẩu. Chỉ tên lớp ngoại lệ được đi ra ngoài."""
    monkeypatch.setenv("QUEUE_ENABLED", "1")
    monkeypatch.setattr(q, "get_queue", lambda *_a, **_k: (_ for _ in ()).throw(
        RuntimeError("redis://user:secret@host:6379/0 refused")))
    with pytest.raises(q.EnqueueFailed) as e:
        q.enqueue_job(lambda: None, queue="ingest", fail_closed=True)
    assert "secret" not in str(e.value) and "redis://" not in str(e.value)


def test_mac_dinh_VAN_fallback_thread(monkeypatch):
    """Không truyền cờ thì hành vi cũ giữ nguyên — summary/mindmap dựa vào nó, và một
    tính năng phụ hỏng không đáng đánh đổi bằng việc từ chối cả request."""
    monkeypatch.setenv("QUEUE_ENABLED", "1")
    monkeypatch.setattr(q, "get_queue", lambda *_a, **_k: (_ for _ in ()).throw(
        RuntimeError("redis down")))
    ev = threading.Event()
    res = q.enqueue_job(lambda: ev.set(), queue="summary")
    assert res["mode"] == "thread_fallback"
    assert ev.wait(2)


def test_TAT_queue_thi_thread_van_la_che_do_chay(monkeypatch):
    """`fail_closed` chỉ chặn cái FALLBACK sau khi hỏng. Tắt queue là chế độ chạy được
    chọn có chủ đích (máy dev, demo) — không phải một lượt dự phòng."""
    monkeypatch.setenv("QUEUE_ENABLED", "false")
    ev = threading.Event()
    res = q.enqueue_job(lambda: ev.set(), queue="ingest", fail_closed=True)
    assert res["mode"] == "thread"
    assert ev.wait(2)


def test_enqueue_thanh_cong_KHONG_dung_thread(monkeypatch):
    """Đường đi đúng: việc nằm ở RQ, tiến trình web KHÔNG chạy gì cả.

    Bản đầu của test này chỉ khẳng định `mode == "rq"` và tham số gửi đi — nếu mã lỡ
    dựng thêm một thread chạy cùng hàm ấy thì test vẫn xanh. Đo bằng `Event` như nhánh
    fail-closed: hàm được đẩy đi phải KHÔNG chạy ở đây.
    """
    monkeypatch.setenv("QUEUE_ENABLED", "1")
    da_gui: dict = {}
    da_chay = threading.Event()

    class _Q:
        def enqueue(self, func, *args, **kw):
            da_gui["func"] = func
            da_gui["args"] = args
            da_gui["job_id"] = kw.get("job_id")
            # RQ chỉ ghi việc vào Redis; nó KHÔNG gọi hàm ở đây.

    monkeypatch.setattr(q, "get_queue", lambda name="ingest": _Q())
    res = q.enqueue_job(lambda *a: da_chay.set(), args=(1,), queue="ingest",
                        job_id="j1", fail_closed=True)

    assert res["mode"] == "rq" and da_gui["job_id"] == "j1" and da_gui["args"] == (1,)
    assert not da_chay.wait(0.3), "việc đã chạy trong tiến trình web dù đã đẩy sang RQ"
    assert da_gui["func"] is not None, "hàm phải được trao cho hàng đợi"


# ── 2. Đường upload dùng đúng cờ, và từ chối rõ ràng khi hàng đợi hỏng ────
def test_duong_ingest_truyen_co_fail_closed(monkeypatch):
    """Cờ phải nằm ở CHỖ GỌI của ingest, không phải mặc định toàn cục."""
    import app.main as be

    ghi: dict = {}
    monkeypatch.setattr(be, "_trigger_background_ingest", _TRIGGER_THAT)
    monkeypatch.setattr(be, "INGEST_GRAPH", object())
    monkeypatch.setattr(be, "_jobs_create_job", lambda *a, **k: None)
    monkeypatch.setattr(be, "_current_user_id", lambda: "u-1")
    monkeypatch.setattr(q, "enqueue_job",
                        lambda *a, **k: ghi.update(k) or {"mode": "rq"})

    be._trigger_background_ingest("s-1", "/tmp/x.txt", "x.txt")
    assert ghi.get("fail_closed") is True, "ingest phải fail-closed"
    assert ghi.get("queue") == "ingest"


def test_co_fail_closed_nam_TRONG_ma_nguon_khong_chi_trong_runtime():
    """Đọc bằng AST trên FILE, nên không một lượt gán đè nào ở runtime che được.

    Khẳng định: trong thân `_trigger_background_ingest`, lời gọi `enqueue_job` mang
    `fail_closed=True` viết thẳng ra — không phải biến, không phải mặc định ở nơi khác."""
    import app.main as be

    cay = ast.parse(pathlib.Path(inspect.getfile(be)).read_text(encoding="utf-8"))
    ham = next(n for n in ast.walk(cay)
               if isinstance(n, ast.FunctionDef) and n.name == "_trigger_background_ingest")
    goi = [n for n in ast.walk(ham)
           if isinstance(n, ast.Call) and getattr(n.func, "id", "") == "enqueue_job"]
    assert goi, "không tìm thấy lời gọi enqueue_job"
    kw = {k.arg: k.value for k in goi[0].keywords}
    assert isinstance(kw.get("fail_closed"), ast.Constant) and kw["fail_closed"].value is True
    assert isinstance(kw.get("queue"), ast.Constant) and kw["queue"].value == "ingest"


def test_upload_tra_503_va_KHONG_de_lai_tai_lieu_ket(monkeypatch, tmp_path):
    """Bắn request THẬT. Hàng đợi hỏng thì người dùng nhận 503 nói rõ nguyên nhân, và
    hàng `documents` vừa tạo bị hạ xuống lỗi — không để lại đúng cái tài liệu kẹt
    `processing` mà phase này đang đi dọn."""
    import app.main as be
    from app.domains.documents import repository as _docs
    from app.domains.documents import storage as st

    monkeypatch.setenv("QUEUE_ENABLED", "1")
    # Ngoại lệ gốc mang đúng thứ dễ lọt nhất: URL Redis kèm mật khẩu.
    monkeypatch.setattr(q, "get_queue", lambda *_a, **_k: (_ for _ in ()).throw(
        RuntimeError("redis://admin:sieu-mat-khau@redis-prod:6379/0 refused")))

    trang_thai: list = []
    monkeypatch.setattr(be, "_trigger_background_ingest", _TRIGGER_THAT)
    monkeypatch.setattr(_docs, "create", lambda **kw: {"filename": kw.get("filename")})
    monkeypatch.setattr(_docs, "get", lambda *_a, **_k: {})
    monkeypatch.setattr(be, "_update_source_status",
                        lambda sid, status, **kw: trang_thai.append((sid, status, kw)))
    monkeypatch.setattr(be, "INGEST_GRAPH", object())
    monkeypatch.setattr(be, "_jobs_create_job", lambda *a, **k: None)
    monkeypatch.setattr(be, "INPUT_DIR", str(tmp_path))
    monkeypatch.setattr(be, "_current_user_id", lambda: "u-1")
    monkeypatch.setattr(be, "_require_app_user", lambda: ("u-1", None))
    monkeypatch.setattr(st, "is_configured", lambda: False)

    r = be.app.test_client().post(
        "/upload-file",
        data={"file": (_io.BytesIO(b"noi dung"), "bai giang.txt")},
        content_type="multipart/form-data")

    assert r.status_code == 503, r.get_data(as_text=True)[:200]
    than = r.get_json()
    assert "Hàng đợi" in than["error"] and "REDIS_URL" in than["hint"]
    assert trang_thai and trang_thai[0][1] == "error", "tài liệu phải bị hạ xuống lỗi"

    # Hợp đồng NHÌN THẤY ĐƯỢC từ ngoài: không một mảnh nào của chuỗi kết nối lọt ra.
    # Kiểm trên toàn thân đã tuần tự hoá, không chỉ vài khoá — thêm khoá mới sau này
    # vẫn bị test này soi.
    than_tho = json.dumps(than, ensure_ascii=False)
    for cam in ("redis://", "sieu-mat-khau", "admin:", "redis-prod"):
        assert cam not in than_tho, f"{cam!r} lọt ra phản hồi: {than_tho[:200]}"


def test_enqueue_hong_thi_CA_tai_lieu_LAN_so_job_deu_thanh_loi(monkeypatch):
    """C1 — hai nguồn sự thật phải nói cùng một chuyện.

    Job được tạo `pending` ngay trước lời gọi enqueue. Bỏ nguyên nó thì `/api/jobs`
    báo một lượt ingest đang chờ chạy mà sẽ không bao giờ chạy, và `sweep_stuck_jobs`
    CỐ Ý không quét `pending` — nên nó chỉ được dọn ở lần khởi động sau.

    Kiểm bằng lời gọi thật tới cơ chế cập nhật job, không đọc mã nguồn.
    """
    import app.main as be

    monkeypatch.setenv("QUEUE_ENABLED", "1")
    monkeypatch.setattr(q, "get_queue", lambda *_a, **_k: (_ for _ in ()).throw(
        RuntimeError("redis://admin:sieu-mat-khau@redis-prod:6379/0 refused")))

    tai_lieu: list = []
    job: list = []
    monkeypatch.setattr(be, "_trigger_background_ingest", _TRIGGER_THAT)
    monkeypatch.setattr(be, "INGEST_GRAPH", object())
    monkeypatch.setattr(be, "_jobs_create_job", lambda *a, **k: None)
    monkeypatch.setattr(be, "_jobs_update_job", lambda jid, **kw: job.append((jid, kw)))
    monkeypatch.setattr(be, "_update_source_status",
                        lambda sid, status, **kw: tai_lieu.append((sid, status, kw)))
    monkeypatch.setattr(be, "_don_file_tam", lambda *a, **k: None)
    monkeypatch.setattr(be, "_current_user_id", lambda: "u-1")

    with pytest.raises(be.IngestQueueRequired):
        be._trigger_background_ingest("s-9", "/tmp/x.txt", "x.txt")

    assert tai_lieu and tai_lieu[0][0] == "s-9" and tai_lieu[0][1] == "error"
    assert job, "sổ job không được bỏ mặc ở `pending`"
    jid, kw = job[0]
    assert jid == "s-9" and kw.get("status") == "error"
    # Sổ job bị nhiều nơi đọc và hiển thị — thông điệp ở đó phải là hằng số sạch.
    ghi_chu = str(kw.get("error_text") or "")
    assert ghi_chu and all(c not in ghi_chu for c in
                           ("redis://", "sieu-mat-khau", "admin:", "redis-prod"))


def test_ghi_so_job_hong_KHONG_che_mat_viec_chinh(monkeypatch):
    """Cập nhật sổ job là việc phụ. Nó hỏng thì người dùng vẫn phải nhận đúng lỗi
    hàng đợi, và tài liệu vẫn phải đã bị hạ xuống lỗi trước đó."""
    import app.main as be

    monkeypatch.setenv("QUEUE_ENABLED", "1")
    monkeypatch.setattr(q, "get_queue", lambda *_a, **_k: (_ for _ in ()).throw(
        RuntimeError("redis down")))

    tai_lieu: list = []
    monkeypatch.setattr(be, "_trigger_background_ingest", _TRIGGER_THAT)
    monkeypatch.setattr(be, "INGEST_GRAPH", object())
    monkeypatch.setattr(be, "_jobs_create_job", lambda *a, **k: None)
    monkeypatch.setattr(be, "_jobs_update_job", lambda *a, **k: (_ for _ in ()).throw(
        RuntimeError("jobs.sqlite khoá")))
    monkeypatch.setattr(be, "_update_source_status",
                        lambda sid, status, **kw: tai_lieu.append((sid, status)))
    monkeypatch.setattr(be, "_don_file_tam", lambda *a, **k: None)
    monkeypatch.setattr(be, "_current_user_id", lambda: "u-1")

    with pytest.raises(be.IngestQueueRequired):
        be._trigger_background_ingest("s-8", "/tmp/x.txt", "x.txt")
    assert tai_lieu == [("s-8", "error")]


# ── 3. Tài liệu gián đoạn phải được dọn, và chỉ đúng những cái đáng dọn ───
def test_processing_ket_thi_ha_xuong_loi(monkeypatch):
    repo, da_ha = _gia_lap_db(monkeypatch, [_TaiLieuGia("d1", "processing")])
    assert repo.reconcile_interrupted_documents() == ["d1"]
    assert da_ha[0][1] == "error"
    assert "khởi động lại" in da_ha[0][2]["error"]


def test_index_ready_KHONG_bi_dung(monkeypatch):
    """FAISS đã xong, tài liệu truy vấn được, chỉ còn cây nhớ dang dở. Hạ nó xuống lỗi
    là vứt một tài liệu dùng được — đúng cái mà đề bài cấm."""
    repo, da_ha = _gia_lap_db(monkeypatch, [_TaiLieuGia("d2", "index_ready")])
    assert repo.reconcile_interrupted_documents() == []
    assert da_ha == []


def test_tai_lieu_worker_dang_lam_KHONG_bi_dung(monkeypatch):
    """Ở queue mode, web khởi động lại không được hạ tài liệu mà worker đang xử lý."""
    repo, da_ha = _gia_lap_db(
        monkeypatch, [_TaiLieuGia("d3", "processing"), _TaiLieuGia("d4", "processing")])
    assert repo.reconcile_interrupted_documents(bo_qua={"d3"}) == ["d4"]
    assert [x[0] for x in da_ha] == ["d4"]


def test_reconcile_tat_queue_co_don_tai_lieu(monkeypatch):
    """Không bật queue: mọi thread đã chết cùng tiến trình, dọn tất."""
    monkeypatch.setenv("QUEUE_ENABLED", "false")
    from app.domains.jobs import jobs_store

    monkeypatch.setattr(jobs_store, "mark_interrupted_jobs", lambda: None)
    monkeypatch.setattr(q, "_don_tai_lieu_ket", lambda bo_qua=None: ["d1"])
    ra = q.reconcile_interrupted()
    assert ra["mode"] == "mark_all" and ra["documents"] == ["d1"]


def test_reconcile_queue_mode_truyen_tap_job_con_song(monkeypatch):
    """`job_id == source_id` cho ingest, nên tập job sống dùng thẳng làm tập bỏ qua."""
    monkeypatch.setenv("QUEUE_ENABLED", "1")
    from app.domains.jobs import jobs_store

    monkeypatch.setattr(q, "_live_job_ids", lambda: {"d9"})
    monkeypatch.setattr(jobs_store, "list_active_jobs", lambda: [])
    nhan: dict = {}
    monkeypatch.setattr(q, "_don_tai_lieu_ket",
                        lambda bo_qua=None: nhan.setdefault("bo_qua", bo_qua) or [])
    q.reconcile_interrupted()
    assert nhan["bo_qua"] == {"d9"}


def test_RQ_khong_ket_noi_duoc_thi_KHONG_dung_gi(monkeypatch):
    """Fail safe cũ giữ nguyên: không nhìn thấy registry thì không được đoán."""
    monkeypatch.setenv("QUEUE_ENABLED", "1")
    monkeypatch.setattr(q, "_live_job_ids", lambda: None)
    monkeypatch.setattr(q, "_don_tai_lieu_ket", lambda bo_qua=None: pytest.fail(
        "RQ không đọc được mà vẫn đụng vào documents"))
    assert q.reconcile_interrupted()["mode"] == "skipped"


def test_don_tai_lieu_hong_thi_nuot_chu_khong_chan_khoi_dong(monkeypatch):
    """Hàm này chạy lúc import `app.main`. Ném ở đây là không lên được ứng dụng."""
    from app.domains.documents import repository as repo

    monkeypatch.setattr(repo, "reconcile_interrupted_documents",
                        lambda **_k: (_ for _ in ()).throw(RuntimeError("db down")))
    assert q._don_tai_lieu_ket() == []


# ── 4. Những thứ KHÔNG được đổi ──────────────────────────────────────────
def test_phan_loai_loi_FPT_khong_doi():
    """Phase trước tách lỗi nhà cung cấp khỏi lỗi chỉ mục. Không được đụng."""
    from shared.interfaces import errors as loi

    assert loi.ma_loi(loi.EmbeddingProviderAuthFailed("x")) == loi.EMBEDDING_PROVIDER_AUTH_FAILED
    assert "rebuild" not in loi.thong_diep(loi.EMBEDDING_PROVIDER_AUTH_FAILED).lower()
    assert "rebuild" in loi.thong_diep(loi.INDEX_INCOMPATIBLE).lower()


def test_xuat_ban_sau_ingest_khong_doi(monkeypatch):
    """Bật persistence mà đẩy hỏng thì vẫn NÉM — tài liệu không được thành `completed`."""
    from app.domains.vectorstore import persistence as ps

    monkeypatch.setenv("INDEX_PERSISTENCE_ENABLED", "1")
    monkeypatch.setattr(ps, "publish", lambda *a, **k: (_ for _ in ()).throw(
        RuntimeError("bucket 500")))
    with pytest.raises(ps.PublishFailed):
        ps.cong_bo_sau_ingest()


def test_endpoint_status_khong_doi(monkeypatch):
    """Hợp đồng FE đang poll. Phase này không được chạm vào nó."""
    import app.main as be

    monkeypatch.setattr(be, "_require_app_user", lambda: ("u-1", None))
    monkeypatch.setattr(be, "_get_source_status", lambda sid: {
        "status": "ready", "progress": 100, "user_id": "u-1",
        "capabilities": {"chunk_query": True}, "source_stem": "x"})
    r = be.app.test_client().get("/sources/s-1/status")
    assert r.status_code == 200
    than = r.get_json()
    assert than["status"] == "ready" and than["can_query"] is True
    assert set(than) >= {"status", "progress", "substatus", "capabilities",
                         "can_query", "video_stem"}


def test_endpoint_status_van_404_khi_khong_co(monkeypatch):
    import app.main as be

    monkeypatch.setattr(be, "_require_app_user", lambda: ("u-1", None))
    monkeypatch.setattr(be, "_get_source_status", lambda sid: None)
    assert be.app.test_client().get("/sources/x/status").status_code == 404


# ── 5. Recovery chạy trên DATABASE THẬT ──────────────────────────────────
def test_reconcile_tren_database_that(can_db_test):
    """Bốn test recovery ở trên thay `session_scope` bằng phiên giả, nên mệnh đề
    `WHERE Document.status == "processing"` và phép quy đổi `error -> failed` KHÔNG
    bao giờ được chạy: đổi nhầm cột thì chúng vẫn xanh.

    Ở đây dùng đúng `repository.create` / `update_status` / `get` trên database test,
    nên truy vấn thật và ánh xạ trạng thái thật đều bị soi. Skip sạch khi không có
    `TEST_DATABASE_URL` — không bao giờ chạm database production.
    """
    import uuid

    from sqlalchemy import delete as sa_delete

    from app.db import session_scope
    from app.db.models import Document
    from app.domains.documents import repository as repo

    dang_xu_ly = str(uuid.uuid4())
    da_co_index = str(uuid.uuid4())
    worker_dang_lam = str(uuid.uuid4())
    ids = [dang_xu_ly, da_co_index, worker_dang_lam]
    try:
        for i in ids:
            repo.create(document_id=i, filename=f"{i[:8]}.txt", file_type="txt",
                        file_path=f"/tmp/{i}.txt", user_id=None)
        # FAISS đã xong, chỉ còn cây nhớ dang dở — cột `documents.status` vẫn là
        # `processing`, nên đây đúng là ca mà chỉ bộ lọc metadata mới cứu được.
        repo.update_status(da_co_index, "index_ready", progress=0.7,
                           substatus="faiss_ready", capabilities={"chunk_query": True})

        da_ha = repo.reconcile_interrupted_documents(bo_qua={worker_dang_lam})

        assert dang_xu_ly in da_ha
        assert da_co_index not in da_ha, "tài liệu đã có index bị hạ xuống lỗi"
        assert worker_dang_lam not in da_ha, "tài liệu worker đang làm bị hạ xuống lỗi"

        ha = repo.get(dang_xu_ly)
        assert ha["status"] == "error" and ha["spec_status"] == "failed"
        assert "khởi động lại" in (ha.get("error") or "")

        con = repo.get(da_co_index)
        assert con["status"] == "index_ready" and con["spec_status"] == "processing"
        assert con.get("capabilities") == {"chunk_query": True}

        bo_qua_row = repo.get(worker_dang_lam)
        assert bo_qua_row["status"] == "processing"

        # Chạy lại phải bất biến: cái đã hạ rồi không được hạ thêm lần nữa (nếu nó
        # còn lọt vào truy vấn thì mỗi lần khởi động lại ghi đè `error_message`).
        lan_hai = repo.reconcile_interrupted_documents(bo_qua={worker_dang_lam})
        assert dang_xu_ly not in lan_hai
        assert repo.get(dang_xu_ly)["status"] == "error"
    finally:
        try:
            with session_scope() as s:
                s.execute(sa_delete(Document).where(Document.id.in_(ids)))
            repo.invalidate_cache()
        except Exception as exc:
            print(f"[test] không dọn được tài liệu test: {exc}")
