"""Đóng băng hợp đồng của hai route sinh quiz TRƯỚC khi động vào `_quiz_config`.

`POST /api/quizzes/generate` và `POST /api/practice/generate` **dùng chung một pipeline**:
cùng `_quiz_config`, cùng `job_type="quiz_generation"`, cùng callable
`app.main.run_quiz_generation_job`, cùng hàng đợi `"mindmap"`. Practice không phải một
đường sinh riêng — nó là quiz lấy ngữ liệu từ review item thay vì theo section. Vì thế
hai route nằm chung một file characterization.

Bốn thứ ở đây chưa test nào khoá, và cả bốn đều hỏng trong im lặng:

1. **Tập khoá chính xác của response 202.** Test hiện có chỉ `assert body["job_id"]`.
2. **Hợp đồng dispatch**: tên hàng đợi, đường dẫn dotted của RQ, thứ tự `args`,
   `job_type` lúc khởi tạo. Không dòng nào trong bộ test chạm tới.
3. **`deduped: true` qua HTTP.** `test_quiz_job_dedupe` khoá ở mức HÀM
   (`_quiz_job_giu_cho`), chưa ai đi qua route.
4. **Nhả chỗ dedupe khi `enqueue_job` ném** — nhánh nguy hiểm nhất. Giữ chỗ mà job
   không bao giờ chạy là khoá VĨNH VIỄN một cấu hình quiz cho một người dùng: mọi lần
   bấm sau đều bị trả về đúng job chết đó. Không test nào chạm.

Không dùng Postgres: `_owned_document` và `review.service.get_item` được thay ở đúng chỗ
route TRA TÊN, nên test đo hợp đồng HTTP chứ không đo tầng lưu trữ.
"""

from __future__ import annotations

import pytest

DUONG_DAN_RQ = "app.main.run_quiz_generation_job"


@pytest.fixture()
def be(client):
    import app.main as main

    return main


@pytest.fixture(autouse=True)
def _sach(be, monkeypatch):
    """Xoá bộ nhớ dedupe trong tiến trình + tắt cưỡng chế sở hữu.

    `_QUIZ_INFLIGHT` là OrderedDict mức module, sống xuyên test. Không xoá thì thứ tự
    chạy trở thành một phần của hợp đồng — đúng thứ `test_quiz_job_dedupe` cũng phải
    tự dọn.
    """
    be._QUIZ_INFLIGHT.clear()
    monkeypatch.setattr(be, "_auth_protect_enabled", lambda: False)
    monkeypatch.setattr(be, "_current_user_id", lambda: "u1")
    yield
    be._QUIZ_INFLIGHT.clear()


@pytest.fixture()
def bat(monkeypatch):
    """Chặn `create_job` + `enqueue_job`, ghi lại đối số. Không chạm DB, không chạy job."""
    import app.domains.jobs.jobs_store as js
    import app.jobs.queue as queue_mod

    ghi = {"create": [], "enqueue": []}

    def _create(job_id, **kw):
        ghi["create"].append({"job_id": job_id, **kw})

    def _enqueue(func, args=(), queue="ingest", job_id=None):
        ghi["enqueue"].append({
            "duong_dan": f"{func.__module__}.{func.__qualname__}",
            "args": tuple(args), "queue": queue, "job_id": job_id,
        })
        return {"mode": "thread"}

    monkeypatch.setattr(js, "create_job", _create)
    monkeypatch.setattr(queue_mod, "enqueue_job", _enqueue)
    return ghi


def _tai_lieu_cua_toi(be, monkeypatch, *, source_stem="giao-trinh"):
    monkeypatch.setattr(be, "_owned_document",
                        lambda doc_id, uid: ({"source_stem": source_stem}, None))


def _khong_co_section_la(monkeypatch, ids=()):
    from app.domains.quiz import repository as quiz_repo

    monkeypatch.setattr(quiz_repo, "section_ids_of", lambda doc_id: list(ids))


def _review_item(monkeypatch, item):
    from app.domains.review import service as review_svc

    monkeypatch.setattr(review_svc, "get_item", lambda rid: item)


# ══════════════════════════════════════════════════════════════════════════
# QUIZ  —  POST /api/quizzes/generate
# ══════════════════════════════════════════════════════════════════════════
def test_quiz_generate_202_exact_keys(be, client, monkeypatch, bat):
    _tai_lieu_cua_toi(be, monkeypatch)

    r = client.post("/api/quizzes/generate", json={"document_id": "d1"})
    assert r.status_code == 202
    body = r.get_json()

    assert set(body) == {"job_id", "status"}, f"thân 202 đổi: {sorted(body)}"
    assert body["status"] == "started"
    assert body["job_id"], "job_id phải có giá trị"
    assert "deduped" not in body, "lần đầu KHÔNG được kèm cờ deduped"


def test_quiz_generate_hop_dong_dispatch(be, client, monkeypatch, bat):
    """Hàng đợi, đường dẫn RQ, thứ tự args, và job_type lúc khởi tạo."""
    _tai_lieu_cua_toi(be, monkeypatch)

    body = client.post("/api/quizzes/generate",
                       json={"document_id": "d1", "question_count": 7}).get_json()
    job_id = body["job_id"]

    tao = bat["create"][0]
    assert tao["job_id"] == job_id
    assert tao["job_type"] == "quiz_generation"
    assert tao["status"] == "pending"
    assert tao["progress"] == 0
    assert tao["current_node"] == "Queued"

    day = bat["enqueue"][0]
    assert day["duong_dan"] == DUONG_DAN_RQ, (
        f"đường dẫn RQ đổi thành {day['duong_dan']!r} — job cũ trong hàng đợi sẽ chết")
    assert day["queue"] == "mindmap", "hàng đợi của quiz là 'mindmap', không phải 'quiz'"
    assert day["job_id"] == job_id
    assert len(day["args"]) == 4, "chữ ký (job_id, document_id, config, uid)"
    assert day["args"][0] == job_id
    assert day["args"][1] == "d1"
    assert day["args"][2]["question_count"] == 7
    # Cờ sở hữu TẮT thì `_require_app_user()` trả (None, None) và không bao giờ gọi
    # `_current_user_id` — job được đóng dấu user_id=None. Đây là hành vi ở chế độ mở.
    assert day["args"][3] is None
    assert tao["user_id"] is None


def test_quiz_generate_deduped_response_exact_keys(be, client, monkeypatch, bat):
    """Bấm lại đúng cấu hình đã xin: trả job ĐANG chạy, không mở job thứ hai."""
    import app.domains.jobs.jobs_store as js

    _tai_lieu_cua_toi(be, monkeypatch)
    monkeypatch.setattr(js, "get_job", lambda jid: {"job_id": jid, "status": "running"})

    dau = client.post("/api/quizzes/generate", json={"document_id": "d1"}).get_json()
    r2 = client.post("/api/quizzes/generate", json={"document_id": "d1"})

    assert r2.status_code == 202
    body = r2.get_json()
    assert set(body) == {"job_id", "status", "deduped"}, f"thân dedupe đổi: {sorted(body)}"
    assert body["deduped"] is True
    assert body["status"] == "started"
    assert body["job_id"] == dau["job_id"], "phải trả lại job CŨ, không sinh job mới"
    assert len(bat["enqueue"]) == 1, "lần thứ hai KHÔNG được xếp hàng thêm"


def test_quiz_generate_enqueue_that_bai_thi_nha_cho_dedupe(be, client, monkeypatch):
    """Bất biến quan trọng nhất của phase này.

    Giữ chỗ mà job không bao giờ chạy = cửa khoá vĩnh viễn: mọi lần bấm sau đều bị
    dedupe trả về đúng job chết đó, và giao diện poll một job không bao giờ nhúc nhích.
    """
    import app.domains.jobs.jobs_store as js
    import app.jobs.queue as queue_mod

    _tai_lieu_cua_toi(be, monkeypatch)
    monkeypatch.setattr(js, "create_job", lambda *a, **k: None)
    monkeypatch.setattr(js, "get_job", lambda jid: {"job_id": jid, "status": "running"})

    def _no(func, args=(), queue="ingest", job_id=None):
        raise RuntimeError("redis sap")

    monkeypatch.setattr(queue_mod, "enqueue_job", _no)
    # Route nhả chỗ rồi RE-RAISE; Flask biến ngoại lệ chưa bắt thành 500. Ghi nhận
    # nguyên trạng — phase này không sửa việc lỗi hạ tầng lộ ra thành 500.
    assert client.post("/api/quizzes/generate", json={"document_id": "d1"}).status_code == 500

    assert be._QUIZ_INFLIGHT == {}, "chỗ giữ phải được nhả khi enqueue ném"

    # Và lần bấm sau phải chạy thật, không bị dedupe về job đã chết.
    lai = []
    monkeypatch.setattr(queue_mod, "enqueue_job",
                        lambda func, args=(), queue="ingest", job_id=None:
                        (lai.append(job_id), {"mode": "thread"})[1])
    r = client.post("/api/quizzes/generate", json={"document_id": "d1"})
    assert r.status_code == 202
    assert "deduped" not in r.get_json(), "không được dedupe về job chết"
    assert len(lai) == 1


def test_quiz_generate_thieu_document_id_400(be, client, monkeypatch, bat):
    r = client.post("/api/quizzes/generate", json={})
    assert r.status_code == 400
    assert r.get_json() == {"error": "Thiếu document_id"}
    assert bat["enqueue"] == []


def test_quiz_generate_tai_lieu_chua_index_409(be, client, monkeypatch, bat):
    monkeypatch.setattr(be, "_owned_document", lambda doc_id, uid: ({"source_stem": ""}, None))

    r = client.post("/api/quizzes/generate", json={"document_id": "d1"})
    assert r.status_code == 409
    assert r.get_json() == {"error": "Tài liệu chưa index xong"}
    assert bat["enqueue"] == []


def test_quiz_generate_section_id_khong_thuoc_tai_lieu_400(be, client, monkeypatch, bat):
    """Chặn ở route, không để job chạy xong rồi mới ra quiz rỗng."""
    _tai_lieu_cua_toi(be, monkeypatch)
    _khong_co_section_la(monkeypatch, ids=["s-that"])

    r = client.post("/api/quizzes/generate",
                    json={"document_id": "d1", "scope": {"section_ids": ["s-la"]}})
    assert r.status_code == 400
    assert r.get_json() == {"error": "section_ids không thuộc tài liệu: ['s-la']"}
    assert bat["enqueue"] == []


# `_quiz_config` sinh SÁU thân lỗi 400 riêng biệt (báo cáo Phase 2G ghi 5 — đếm thiếu
# ca `scope` không phải object). Mỗi thân được nêu tường minh ở đây, không gộp.
@pytest.mark.parametrize("payload,than_loi", [
    ({"question_count": "nhieu"}, "question_count phải là số nguyên"),
    ({"question_count": 0}, "question_count phải trong 1..50"),
    ({"difficulty": "kho-lam"}, "difficulty phải là easy|medium|hard|mixed"),
    ({"question_types": "multiple_choice"}, "question_types phải là list"),
    ({"question_types": ["bia-dat"]}, "question_types không hợp lệ: ['bia-dat']"),
    ({"scope": "toan-bo"}, "scope phải là object"),
])
def test_quiz_config_giu_nguyen_tung_than_loi_400(be, client, monkeypatch, bat,
                                                  payload, than_loi):
    _tai_lieu_cua_toi(be, monkeypatch)

    r = client.post("/api/quizzes/generate", json={"document_id": "d1", **payload})
    assert r.status_code == 400
    assert r.get_json() == {"error": than_loi}
    assert bat["enqueue"] == [], "cấu hình sai thì KHÔNG được xếp hàng"


def test_quiz_config_question_count_toi_da_lay_tu_hang_cua_main(be):
    """Thân lỗi nhúng `QUIZ_MAX_QUESTIONS` — nếu hằng đổi thì test trên phải đổi theo."""
    assert be.QUIZ_MAX_QUESTIONS == 50


# ══════════════════════════════════════════════════════════════════════════
# PRACTICE  —  POST /api/practice/generate
# ══════════════════════════════════════════════════════════════════════════
def _item_hop_le(monkeypatch, **over):
    _review_item(monkeypatch, {
        "user_id": "u1", "chunk_ids": ["c1", "c2"], "document_id": "d9",
        "attempt_id": "at1", "topic": "Dao ham", **over,
    })


def test_practice_generate_202_exact_keys(be, client, monkeypatch, bat):
    _item_hop_le(monkeypatch)

    r = client.post("/api/practice/generate", json={"review_item_id": "ri1"})
    assert r.status_code == 202
    body = r.get_json()

    assert set(body) == {"job_id", "status"}, f"thân 202 đổi: {sorted(body)}"
    assert body["status"] == "started"
    assert body["job_id"]


def test_practice_generate_dung_chung_pipeline_quiz(be, client, monkeypatch, bat):
    """Practice KHÔNG có job_type riêng: nó là quiz, chỉ khác nguồn ngữ liệu."""
    _item_hop_le(monkeypatch)

    job_id = client.post("/api/practice/generate",
                         json={"review_item_id": "ri1"}).get_json()["job_id"]

    tao = bat["create"][0]
    assert tao["job_type"] == "quiz_generation", (
        "Practice CỐ Ý dùng lại pipeline quiz — không phải 'practice_generation'")
    assert tao["job_id"] == job_id

    day = bat["enqueue"][0]
    assert day["duong_dan"] == DUONG_DAN_RQ, "cùng callable với quiz chẩn đoán"
    assert day["queue"] == "mindmap"
    assert day["args"][1] == "d9", "document_id lấy từ review item, không từ request"


def test_practice_generate_bo_sung_dung_sau_khoa_truy_vet(be, client, monkeypatch, bat):
    """FR-11.8/11.9: mất hai khoá nguồn là mất cả chuỗi yếu → ôn → luyện."""
    _item_hop_le(monkeypatch)

    client.post("/api/practice/generate", json={"review_item_id": "ri1"})
    config = bat["enqueue"][0]["args"][2]

    assert config["quiz_type"] == "practice"
    assert config["chunk_ids"] == ["c1", "c2"]
    assert config["source_review_item_id"] == "ri1"
    assert config["source_attempt_id"] == "at1"
    assert config["title"] == "Luyện tập: Dao ham"
    assert config["practice_topic"] == "Dao ham"
    # Vẫn giữ nguyên các trường của `_quiz_config`
    assert config["question_count"] == 10
    assert config["difficulty"] == "mixed"
    assert config["scope"] == {"type": "full_document", "section_ids": []}


def test_practice_generate_thieu_review_item_id_400(be, client, monkeypatch, bat):
    r = client.post("/api/practice/generate", json={})
    assert r.status_code == 400
    assert r.get_json() == {"error": "Thiếu review_item_id"}
    assert bat["enqueue"] == []


def test_practice_generate_review_item_khong_ton_tai_404(be, client, monkeypatch, bat):
    _review_item(monkeypatch, None)

    r = client.post("/api/practice/generate", json={"review_item_id": "ri-la"})
    assert r.status_code == 404
    assert r.get_json() == {"error": "Review item not found"}
    assert bat["enqueue"] == []


def test_practice_generate_review_item_cua_nguoi_khac_404(be, client, monkeypatch, bat):
    """404 chứ không 403 — không tạo oracle cho biết id đó có thật hay không."""
    monkeypatch.setattr(be, "_auth_protect_enabled", lambda: True)
    _item_hop_le(monkeypatch, user_id="nguoi-khac")

    r = client.post("/api/practice/generate", json={"review_item_id": "ri1"})
    assert r.status_code == 404
    assert r.get_json() == {"error": "Review item not found"}
    assert bat["enqueue"] == []


def test_practice_generate_item_khong_co_chunk_409(be, client, monkeypatch, bat):
    _item_hop_le(monkeypatch, chunk_ids=[])

    r = client.post("/api/practice/generate", json={"review_item_id": "ri1"})
    assert r.status_code == 409
    assert r.get_json() == {"error": "Review item không có chunk nguồn để ra đề"}
    assert bat["enqueue"] == []


# ══════════════════════════════════════════════════════════════════════════
# DEDUPE — bất đối xứng giữa hai route, và khoá dedupe được tính từ ĐÂU
#
# `test_quiz_job_dedupe.py` đã khoá `_quiz_job_key` / `_quiz_job_giu_cho` ở MỨC HÀM
# (khác người / khác tài liệu / khác cấu hình / thứ tự khoá). Phần chưa ai khoá là
# đoạn nối từ ROUTE xuống hàm đó: route tính khoá từ `_quiz_config(data)` — tức
# cấu hình ĐÃ CHUẨN HOÁ — chứ không từ payload thô, và `uid` lấy từ
# `_require_app_user()`.
# ══════════════════════════════════════════════════════════════════════════
def test_practice_generate_KHONG_di_qua_dedupe(be, client, monkeypatch, bat):
    """Hai route dùng chung pipeline nhưng CHỈ quiz có dedupe. Practice thì không.

    Ghi nhận hiện trạng, không phải đề xuất. Đây là chỗ dễ bị "thống nhất" nhất khi
    gộp hai route vào một use case chung: thêm dedupe cho practice, hoặc bỏ dedupe của
    quiz, đều là đổi hành vi mà không ai thấy.
    """
    import app.domains.jobs.jobs_store as js

    _item_hop_le(monkeypatch)
    monkeypatch.setattr(js, "get_job", lambda jid: {"job_id": jid, "status": "running"})

    a = client.post("/api/practice/generate", json={"review_item_id": "ri1"}).get_json()
    b = client.post("/api/practice/generate", json={"review_item_id": "ri1"}).get_json()

    assert "deduped" not in a and "deduped" not in b, "practice chưa bao giờ trả cờ deduped"
    assert a["job_id"] != b["job_id"], "practice tạo job MỚI mỗi lần bấm"
    assert len(bat["enqueue"]) == 2, "cả hai lần đều được xếp hàng"
    assert be._QUIZ_INFLIGHT == {}, "practice không giữ chỗ nào trong sổ dedupe"


def test_quiz_dedupe_tinh_tren_cau_hinh_da_chuan_hoa(be, client, monkeypatch, bat):
    """Hai payload KHÁC NHAU nhưng chuẩn hoá về cùng một config vẫn là một yêu cầu.

    Route gọi `_quiz_job_key(uid, document_id, config)` với `config` là đầu ra của
    `_quiz_config`, nên `difficulty` gửi đúng bằng mặc định không tạo yêu cầu mới.
    """
    import app.domains.jobs.jobs_store as js

    _tai_lieu_cua_toi(be, monkeypatch)
    monkeypatch.setattr(js, "get_job", lambda jid: {"job_id": jid, "status": "running"})

    a = client.post("/api/quizzes/generate", json={"document_id": "d1"}).get_json()
    b = client.post("/api/quizzes/generate",
                    json={"document_id": "d1", "difficulty": "mixed"}).get_json()

    assert b.get("deduped") is True, "gửi đúng giá trị mặc định không phải yêu cầu mới"
    assert b["job_id"] == a["job_id"]
    assert len(bat["enqueue"]) == 1


def test_quiz_doi_cau_hinh_thi_KHONG_dedupe(be, client, monkeypatch, bat):
    """Đổi số câu là một yêu cầu khác và phải được chạy — mặt còn lại của luật trên."""
    import app.domains.jobs.jobs_store as js

    _tai_lieu_cua_toi(be, monkeypatch)
    monkeypatch.setattr(js, "get_job", lambda jid: {"job_id": jid, "status": "running"})

    a = client.post("/api/quizzes/generate",
                    json={"document_id": "d1", "question_count": 5}).get_json()
    b = client.post("/api/quizzes/generate",
                    json={"document_id": "d1", "question_count": 7}).get_json()

    assert "deduped" not in b
    assert a["job_id"] != b["job_id"]
    assert len(bat["enqueue"]) == 2


def test_quiz_dedupe_tach_theo_nguoi_dung_khi_bat_cuong_che(be, client, monkeypatch, bat):
    """Bật cưỡng chế sở hữu: cùng tài liệu + cùng cấu hình nhưng KHÁC người là hai
    yêu cầu. Người B không được nhận job của người A."""
    import app.domains.jobs.jobs_store as js

    _tai_lieu_cua_toi(be, monkeypatch)
    monkeypatch.setattr(js, "get_job", lambda jid: {"job_id": jid, "status": "running"})
    monkeypatch.setattr(be, "_auth_protect_enabled", lambda: True)

    ai = {"v": "userA"}
    monkeypatch.setattr(be, "_current_user_id", lambda: ai["v"])

    a = client.post("/api/quizzes/generate", json={"document_id": "d1"}).get_json()
    ai["v"] = "userB"
    b = client.post("/api/quizzes/generate", json={"document_id": "d1"}).get_json()

    assert "deduped" not in b, "job của người khác không được nuốt yêu cầu của mình"
    assert a["job_id"] != b["job_id"]
    assert len(bat["enqueue"]) == 2
    assert bat["enqueue"][0]["args"][3] == "userA"
    assert bat["enqueue"][1]["args"][3] == "userB"


def test_che_do_mo_moi_nguoi_dung_CHUNG_mot_khoa_dedupe(be, client, monkeypatch, bat):
    """Hệ quả của chế độ mở, ghi nhận nguyên trạng.

    Cờ sở hữu TẮT thì `_require_app_user()` trả `(None, None)` cho MỌI người gọi, nên
    `uid` trong khoá dedupe luôn là None. Hai người khác nhau xin cùng một tài liệu sẽ
    dùng chung một job. Chấp nhận được ở chế độ mở (không có khái niệm người dùng),
    nhưng là thứ phải biết trước khi ai đó bật/tắt cờ.
    """
    import app.domains.jobs.jobs_store as js

    _tai_lieu_cua_toi(be, monkeypatch)
    monkeypatch.setattr(js, "get_job", lambda jid: {"job_id": jid, "status": "running"})
    # `_sach` đã đặt _auth_protect_enabled -> False; đổi _current_user_id không có tác
    # dụng vì `_require_app_user` không gọi tới nó khi cờ tắt.
    monkeypatch.setattr(be, "_current_user_id", lambda: "userA")
    a = client.post("/api/quizzes/generate", json={"document_id": "d1"}).get_json()
    monkeypatch.setattr(be, "_current_user_id", lambda: "userB")
    b = client.post("/api/quizzes/generate", json={"document_id": "d1"}).get_json()

    assert b.get("deduped") is True
    assert b["job_id"] == a["job_id"]
    assert bat["enqueue"][0]["args"][3] is None, "chế độ mở: job không mang chủ sở hữu"
