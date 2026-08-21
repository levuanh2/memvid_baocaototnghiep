"""Phase 4 — sinh quiz chẩn đoán (FR-06) trên DB thật, LLM giả."""

from __future__ import annotations

import io
import json
import os
import uuid

import pytest


@pytest.fixture(scope="module", autouse=True)
def _need_db():
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

    u = users_store.create_user(f"quiz_{uuid.uuid4().hex[:8]}@example.com", "password123")
    yield u["user_id"]
    with session_scope() as s:
        row = s.get(User, u["user_id"])
        if row is not None:
            s.delete(row)
    from app.domains.documents import repository as docs_repo
    docs_repo.invalidate_cache()


def _protect(main, monkeypatch, uid):
    monkeypatch.setattr(main, "_auth_protect_enabled", lambda: True)
    monkeypatch.setattr(main, "_current_user_id", lambda: uid)


def _seed_document(client, name="giao trinh.md"):
    """Upload + ghi 2 section và 3 chunk, trả (document_id, section_ids)."""
    from app.domains.documents import repository as docs_repo
    from app.domains.documents.sections import build_sections

    r = client.post("/api/documents/upload",
                    data={"file": (io.BytesIO(b"# Chuong 1\n\nnoi dung"), name)},
                    content_type="multipart/form-data")
    assert r.status_code == 201, r.get_data(as_text=True)
    doc_id = r.get_json()["document_id"]

    headings = ["Chuong 1 > 1.1 Dao ham", "Chuong 1 > 1.1 Dao ham", "Chuong 2 > 2.1 Tich phan"]
    texts = ["Dao ham cua x^2 la 2x.", "Dao ham cua hang so bang 0.",
             "Tich phan cua 2x la x^2 + C."]
    sections, keys = build_sections(headings)
    key_to_id = docs_repo.replace_sections(doc_id, sections)
    docs_repo.replace_chunks(doc_id, [
        {"chunk_index": i, "text": texts[i], "heading": headings[i],
         "section_id": key_to_id.get(keys[i]), "embedding_id": str(700 + i)}
        for i in range(3)
    ])
    return doc_id, [key_to_id[k] for k in dict.fromkeys(keys)]


def _fake_llm(monkeypatch, payload, *, capture=None):
    """Thay LLM bằng hàm trả sẵn chuỗi. `payload` là str hoặc dict."""
    from app.domains.quiz import generator as gen

    text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)

    def _ask(prompt, **kw):
        if capture is not None:
            capture.append(prompt)
        return text

    # Giữ hàm gốc TRƯỚC khi patch — tham chiếu qua module sau khi patch là đệ quy vô hạn.
    original = gen.generate_questions
    monkeypatch.setattr(gen, "generate_questions",
                        lambda ctx, cfg, **kw: original(ctx, cfg, ask=_ask))


def _run_inline(monkeypatch):
    import app.jobs.queue as queue_mod

    def _sync(fn, args=(), queue=None, job_id=None, **kw):
        fn(*args)
        return {"mode": "sync"}

    monkeypatch.setattr(queue_mod, "enqueue_job", _sync)


def _question(text, ref="c0", **kw):
    return {"question_text": text, "question_type": "multiple_choice",
            "options": ["2x", "x", "x^2", "1"], "correct_answer": "2x",
            "explanation": "Quy tac luy thua.", "concept_tags": ["dao ham"],
            "chunk_refs": [ref], "difficulty": "easy", **kw}


def _generate(client, doc_id, **cfg):
    body = {"document_id": doc_id, "question_count": 5, **cfg}
    r = client.post("/api/quizzes/generate", json=body)
    return r


def test_generate_creates_quiz_with_sources_and_hides_answers(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    doc_id, section_ids = _seed_document(client)
    _run_inline(monkeypatch)
    prompts = []
    _fake_llm(monkeypatch, {"questions": [
        _question("Dao ham cua x^2?"),
        _question("Dao ham hang so?", ref="c1", question_type="true_false",
                  correct_answer="true", options=[]),
    ]}, capture=prompts)

    r = _generate(client, doc_id)
    assert r.status_code == 202, r.get_data(as_text=True)
    job = client.get(f"/api/quizzes/jobs/{r.get_json()['job_id']}").get_json()
    assert job["status"] == "done", job
    assert job["result"]["question_count"] == 2 and job["result"]["rejected_count"] == 0

    quiz = client.get(f"/api/quizzes/{job['result']['quiz_id']}").get_json()
    assert quiz["status"] == "ready" and quiz["document_id"] == doc_id
    assert "user_id" not in quiz
    assert len(quiz["questions"]) == 2
    for q in quiz["questions"]:
        # FR-06.12: đề bài không được lộ đáp án
        assert "correct_answer" not in q and "explanation" not in q
        assert q["question_text"] and q["concept_tags"]
        assert q["chunk_ids"], "FR-06.10: câu hỏi phải truy được về chunk nguồn"
        assert q["section_id"] in section_ids, "section suy từ chunk nguồn"

    # FR-06.11: ngữ liệu trong prompt chỉ gồm nội dung tài liệu
    assert "Dao ham cua x^2 la 2x." in prompts[0] and "[c0]" in prompts[0]


def test_questions_without_real_source_are_dropped_and_logged(be, client, monkeypatch, owner):
    """FR-13.5/13.6 + FR-13.10 — mỗi câu bị loại đúng một dòng log kèm rule_code."""
    _protect(be, monkeypatch, owner)
    doc_id, _ = _seed_document(client)
    _run_inline(monkeypatch)
    _fake_llm(monkeypatch, {"questions": [
        _question("Cau tot?"),
        _question("Thieu chunk_refs?", ref=None, chunk_refs=[]),
        _question("Nguon bia?", ref="c999"),
    ]})

    job_id = _generate(client, doc_id).get_json()["job_id"]
    job = client.get(f"/api/quizzes/jobs/{job_id}").get_json()
    assert job["status"] == "done"
    assert job["result"]["question_count"] == 1 and job["result"]["rejected_count"] == 2

    logs = client.get(f"/api/quizzes/jobs/{job_id}/validation-logs").get_json()
    assert logs["counts_by_rule"] == {"FR-13.5": 1, "FR-13.6": 1}
    assert all(entry["payload"]["item"]["question_text"] for entry in logs["logs"])

    quiz = client.get(f"/api/quizzes/{job['result']['quiz_id']}").get_json()
    assert [q["question_text"] for q in quiz["questions"]] == ["Cau tot?"]


def test_bad_json_retries_then_fails_quiz_without_leaving_it_processing(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    doc_id, _ = _seed_document(client)
    _run_inline(monkeypatch)
    _fake_llm(monkeypatch, "xin loi, day khong phai JSON")

    job_id = _generate(client, doc_id).get_json()["job_id"]
    job = client.get(f"/api/quizzes/jobs/{job_id}").get_json()
    assert job["status"] == "error" and job["error"]

    quizzes = client.get(f"/api/documents/{doc_id}/quizzes").get_json()["quizzes"]
    assert [q["status"] for q in quizzes] == ["failed"], "không được kẹt processing"

    logs = client.get(f"/api/quizzes/jobs/{job_id}/validation-logs").get_json()
    assert logs["counts_by_rule"].get("FR-13.1") == 1, "FR-13.8: hỏng JSON phải để lại vết"


def test_scope_limits_questions_to_chosen_sections(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    doc_id, section_ids = _seed_document(client)
    _run_inline(monkeypatch)
    prompts = []
    _fake_llm(monkeypatch, {"questions": [_question("Trong pham vi?")]}, capture=prompts)

    # section con "2.1 Tich phan" là section cuối trong cây
    tich_phan = section_ids[-1]
    r = _generate(client, doc_id, scope={"section_ids": [tich_phan]})
    assert r.status_code == 202
    assert "Tich phan" in prompts[0]
    assert "Dao ham cua x^2 la 2x." not in prompts[0], "chunk ngoài phạm vi không vào prompt"

    bad = _generate(client, doc_id, scope={"section_ids": [str(uuid.uuid4())]})
    assert bad.status_code == 400, "section lạ chặn ngay, không chạy job rồi mới hỏng"


def test_generate_validates_config(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    doc_id, _ = _seed_document(client)
    assert client.post("/api/quizzes/generate", json={}).status_code == 400
    assert _generate(client, doc_id, question_count=0).status_code == 400
    assert _generate(client, doc_id, question_count=999).status_code == 400
    assert _generate(client, doc_id, difficulty="cuc kho").status_code == 400
    assert _generate(client, doc_id, question_types=["essay"]).status_code == 400
    assert client.post("/api/quizzes/generate",
                       json={"document_id": str(uuid.uuid4())}).status_code == 404


def test_quiz_of_other_user_is_404(be, client, monkeypatch, owner):
    from app.domains.auth import users_store

    _protect(be, monkeypatch, owner)
    doc_id, _ = _seed_document(client)
    _run_inline(monkeypatch)
    _fake_llm(monkeypatch, {"questions": [_question("Cua toi?")]})
    job_id = _generate(client, doc_id).get_json()["job_id"]
    quiz_id = client.get(f"/api/quizzes/jobs/{job_id}").get_json()["result"]["quiz_id"]

    other = users_store.create_user(f"quiz_o_{uuid.uuid4().hex[:8]}@example.com", "password123")
    _protect(be, monkeypatch, other["user_id"])
    assert client.get(f"/api/quizzes/{quiz_id}").status_code == 404
    assert client.get(f"/api/quizzes/jobs/{job_id}").status_code == 404
    assert client.get(f"/api/quizzes/jobs/{job_id}/validation-logs").status_code == 404
    assert client.get(f"/api/documents/{doc_id}/quizzes").status_code == 404


def test_question_count_caps_what_is_saved(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    doc_id, _ = _seed_document(client)
    _run_inline(monkeypatch)
    _fake_llm(monkeypatch, {"questions": [
        _question(f"Cau so {i}?") for i in range(6)
    ]})

    job_id = _generate(client, doc_id, question_count=2).get_json()["job_id"]
    result = client.get(f"/api/quizzes/jobs/{job_id}").get_json()["result"]
    assert result["question_count"] == 2
    quiz = client.get(f"/api/quizzes/{result['quiz_id']}").get_json()
    assert len(quiz["questions"]) == 2 and quiz["question_count"] == 2
    assert [q["order_index"] for q in quiz["questions"]] == [0, 1]


def test_job_is_recorded_in_postgres_ledger(be, client, monkeypatch, owner):
    """`ai_validation_logs.job_id` là FK sang `jobs` — sổ cái phải có hàng thật."""
    from app.db import session_scope
    from app.db.models import Job

    _protect(be, monkeypatch, owner)
    doc_id, _ = _seed_document(client)
    _run_inline(monkeypatch)
    _fake_llm(monkeypatch, {"questions": [_question("Cau tot?"), _question("Nguon bia?", ref="c9")]})

    job_id = _generate(client, doc_id).get_json()["job_id"]
    result = client.get(f"/api/quizzes/jobs/{job_id}").get_json()["result"]

    with session_scope() as s:
        row = s.get(Job, job_id)
        assert row is not None
        assert row.job_type == "quiz_generation" and row.status == "completed"
        assert row.result_type == "quiz" and row.result_id == result["quiz_id"]
        assert row.input_json["document_id"] == doc_id

    logs = client.get(f"/api/quizzes/jobs/{job_id}/validation-logs").get_json()["logs"]
    assert len(logs) == 1, "log gắn được vào job qua FK"
