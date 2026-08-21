"""Phase 5 — vòng đời attempt + chấm điểm (FR-07, FR-08) trên DB thật, LLM giả."""

from __future__ import annotations

import io
import os
import uuid

import pytest

from app.domains.attempts.grading import grade_objective, totals


# ── chấm khách quan: thuần, không DB ────────────────────────────────────────

def test_objective_grading_ignores_case_and_accents():
    assert grade_objective("multiple_choice", " 2X ", "2x") == ("correct", 1.0)
    assert grade_objective("multiple_choice", "x", "2x") == ("incorrect", 0.0)
    # người học bấm "Đúng", DB lưu "true"
    assert grade_objective("true_false", "Đúng", "true") == ("correct", 1.0)
    assert grade_objective("true_false", "Sai", "true") == ("incorrect", 0.0)
    assert grade_objective("multiple_choice", None, "2x") == ("incorrect", 0.0)


def test_totals_follow_the_spec_formula():
    t = totals([{"verdict": "correct", "score": 1.0},
                {"verdict": "partial", "score": 0.5}], total_questions=4)
    # max_score tính trên TỔNG số câu, không phải số câu đã chấm
    assert t["max_score"] == 4.0 and t["score"] == 1.5
    assert t["percentage"] == 37.5 == round(t["score"] / t["max_score"] * 100, 2)
    assert t["score"] <= t["max_score"]
    assert t["correct_count"] == 1 and t["incorrect_count"] == 1


# ── phần chạy trên DB thật ──────────────────────────────────────────────────

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

    u = users_store.create_user(f"att_{uuid.uuid4().hex[:8]}@example.com", "password123")
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


def _seed_quiz(client, owner, *, with_short_answer=False):
    """Tạo document + chunk + quiz ready. Trả (quiz_id, [question_id...])."""
    from app.domains.documents import repository as docs_repo
    from app.domains.documents.sections import build_sections
    from app.domains.quiz import repository as quiz_repo

    r = client.post("/api/documents/upload",
                    data={"file": (io.BytesIO(b"# Chuong 1\n\nnoi dung"),
                                   f"quiz {uuid.uuid4().hex[:6]}.md")},
                    content_type="multipart/form-data")
    doc_id = r.get_json()["document_id"]
    sections, keys = build_sections(["Chuong 1", "Chuong 1"])
    key_to_id = docs_repo.replace_sections(doc_id, sections)
    docs_repo.replace_chunks(doc_id, [
        {"chunk_index": i, "text": f"Dao ham noi dung {i}.", "heading": "Chuong 1",
         "section_id": key_to_id.get(keys[i]), "embedding_id": str(900 + i)}
        for i in range(2)
    ])
    chunks = docs_repo.list_chunks(doc_id)

    questions = [
        {"question_text": "Dao ham cua x^2?", "question_type": "multiple_choice",
         "options": ["2x", "x", "1"], "correct_answer": "2x",
         "explanation": "Quy tac luy thua.", "difficulty": "easy",
         "concept_tags": ["dao ham"], "section_id": chunks[0]["section_id"],
         "chunk_ids": [chunks[0]["chunk_id"]]},
        {"question_text": "Dao ham hang so bang 0?", "question_type": "true_false",
         "options": ["true", "false"], "correct_answer": "true",
         "explanation": "Hang so khong doi.", "difficulty": "easy",
         "concept_tags": ["dao ham"], "section_id": chunks[1]["section_id"],
         "chunk_ids": [chunks[1]["chunk_id"]]},
    ]
    if with_short_answer:
        questions.append({
            "question_text": "Neu quy tac dao ham hop.", "question_type": "short_answer",
            "options": [], "correct_answer": "Dao ham ngoai nhan dao ham trong.",
            "explanation": "Chain rule.", "difficulty": "medium",
            "concept_tags": ["dao ham hop"], "section_id": chunks[0]["section_id"],
            "chunk_ids": [chunks[0]["chunk_id"]]})

    quiz_id = quiz_repo.create_quiz(
        user_id=owner, document_id=doc_id, title="Quiz thu",
        scope={"type": "full_document", "section_ids": []},
        question_count=len(questions), difficulty="easy")
    quiz_repo.save_questions(quiz_id, questions)
    quiz_repo.finish(quiz_id, "ready", question_count=len(questions))
    full = quiz_repo.get_quiz(quiz_id)
    return quiz_id, [q["question_id"] for q in full["questions"]]


def _open(client, quiz_id):
    r = client.post(f"/api/quizzes/{quiz_id}/attempts")
    assert r.status_code in (200, 201), r.get_data(as_text=True)
    return r.get_json()


def test_opening_quiz_creates_in_progress_attempt(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    quiz_id, question_ids = _seed_quiz(client, owner)

    body = _open(client, quiz_id)
    assert body["status"] == "in_progress" and body["total_questions"] == 2
    assert body["max_score"] == 2.0 and body["score"] is None
    # FR-07.6: FE cần biết còn câu nào bỏ trống
    assert sorted(body["unanswered_question_ids"]) == sorted(question_ids)
    assert body["unanswered_count"] == 2
    # FR-07.2/07.3: kèm đề bài nhưng KHÔNG kèm đáp án
    assert len(body["quiz"]["questions"]) == 2
    assert all("correct_answer" not in q for q in body["quiz"]["questions"])


def test_reopening_quiz_reuses_the_open_attempt(be, client, monkeypatch, owner):
    """F5 không được đẻ attempt mới, nếu không thống kê tiến bộ đếm toàn bài dở."""
    _protect(be, monkeypatch, owner)
    quiz_id, _ = _seed_quiz(client, owner)
    first = _open(client, quiz_id)
    again = client.post(f"/api/quizzes/{quiz_id}/attempts")
    assert again.status_code == 200
    assert again.get_json()["attempt_id"] == first["attempt_id"]
    assert len(client.get(f"/api/quizzes/{quiz_id}/attempts").get_json()["attempts"]) == 1


def test_draft_answers_are_overwritten_not_duplicated(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    quiz_id, qids = _seed_quiz(client, owner)
    attempt_id = _open(client, quiz_id)["attempt_id"]

    r = client.patch(f"/api/attempts/{attempt_id}/answers",
                     json={"answers": {qids[0]: "x"}})
    assert r.status_code == 200 and r.get_json()["unanswered_count"] == 1

    # FR-07.5: đổi đáp án trước khi nộp
    r = client.patch(f"/api/attempts/{attempt_id}/answers",
                     json={"answers": {qids[0]: "2x", qids[1]: "true"}})
    body = r.get_json()
    assert body["unanswered_count"] == 0
    assert len(body["answers"]) == 2, "UNIQUE(attempt,question) — không nhân đôi dòng"
    assert {a["question_id"]: a["user_answer"] for a in body["answers"]} == {
        qids[0]: "2x", qids[1]: "true"}


def test_draft_rejects_question_from_another_quiz(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    quiz_id, _ = _seed_quiz(client, owner)
    attempt_id = _open(client, quiz_id)["attempt_id"]
    r = client.patch(f"/api/attempts/{attempt_id}/answers",
                     json={"answers": {str(uuid.uuid4()): "x"}})
    assert r.status_code == 400
    assert client.patch(f"/api/attempts/{attempt_id}/answers", json={}).status_code == 400


def test_submit_grades_objective_quiz_immediately(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    quiz_id, qids = _seed_quiz(client, owner)
    attempt_id = _open(client, quiz_id)["attempt_id"]
    client.patch(f"/api/attempts/{attempt_id}/answers",
                 json={"answers": {qids[0]: "2x", qids[1]: "false"}})

    r = client.post(f"/api/attempts/{attempt_id}/submit")
    assert r.status_code == 200
    body = r.get_json()
    assert body["grading"] == "done" and body["status"] == "graded"
    assert body["score"] == 1.0 and body["max_score"] == 2.0
    assert body["percentage"] == 50.0
    assert body["correct_count"] == 1 and body["incorrect_count"] == 1
    assert body["duration_seconds"] is not None and body["duration_seconds"] >= 0


def test_patch_and_resubmit_after_submit_are_refused(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    quiz_id, qids = _seed_quiz(client, owner)
    attempt_id = _open(client, quiz_id)["attempt_id"]
    client.patch(f"/api/attempts/{attempt_id}/answers", json={"answers": {qids[0]: "2x"}})
    client.post(f"/api/attempts/{attempt_id}/submit")

    late = client.patch(f"/api/attempts/{attempt_id}/answers",
                        json={"answers": {qids[0]: "x"}})
    assert late.status_code == 409, "sửa đáp án sau khi nộp thì điểm vô nghĩa"
    assert client.post(f"/api/attempts/{attempt_id}/submit").status_code == 409

    # đáp án cũ không bị đổi
    answers = client.get(f"/api/attempts/{attempt_id}").get_json()["answers"]
    assert {a["question_id"]: a["user_answer"] for a in answers}[qids[0]] == "2x"


def test_results_expose_answers_only_after_submit(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    quiz_id, qids = _seed_quiz(client, owner)
    attempt_id = _open(client, quiz_id)["attempt_id"]

    early = client.get(f"/api/quizzes/results/{attempt_id}")
    assert early.status_code == 409, "chưa nộp mà trả đáp án là đưa bài giải cho người đang làm"

    client.patch(f"/api/attempts/{attempt_id}/answers",
                 json={"answers": {qids[0]: "2x", qids[1]: "true"}})
    client.post(f"/api/attempts/{attempt_id}/submit")

    body = client.get(f"/api/quizzes/results/{attempt_id}").get_json()
    assert body["score"] == 2.0 and body["percentage"] == 100.0
    by_id = {q["question_id"]: q for q in body["questions"]}
    # FR-08.8: sau khi nộp mới thấy đáp án + giải thích
    assert by_id[qids[0]]["correct_answer"] == "2x"
    assert by_id[qids[0]]["explanation"]
    assert by_id[qids[0]]["verdict"] == "correct" and by_id[qids[0]]["is_correct"] is True
    assert by_id[qids[0]]["feedback"] is None, "câu đúng không cần feedback thừa"


def test_wrong_answer_gets_feedback(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    quiz_id, qids = _seed_quiz(client, owner)
    attempt_id = _open(client, quiz_id)["attempt_id"]
    client.patch(f"/api/attempts/{attempt_id}/answers", json={"answers": {qids[0]: "x"}})
    client.post(f"/api/attempts/{attempt_id}/submit")

    body = client.get(f"/api/quizzes/results/{attempt_id}").get_json()
    wrong = next(q for q in body["questions"] if q["question_id"] == qids[0])
    assert wrong["verdict"] == "incorrect" and wrong["feedback"], "FR-08.6"
    # câu bỏ trống vẫn được chấm là sai, không bị bỏ qua
    blank = next(q for q in body["questions"] if q["question_id"] == qids[1])
    assert blank["verdict"] == "incorrect" and blank["score"] == 0.0
    assert body["score"] == 0.0 and body["percentage"] == 0.0


def test_short_answer_quiz_is_graded_in_background(be, client, monkeypatch, owner):
    import app.jobs.queue as queue_mod
    from app.domains.attempts import grading as grading_mod

    _protect(be, monkeypatch, owner)
    monkeypatch.setattr(queue_mod, "enqueue_job",
                        lambda fn, args=(), **kw: (fn(*args), {"mode": "sync"})[1])
    original = grading_mod.grade_short_answer

    def _graded(**kw):
        kw.pop("ask", None)  # service truyền ask=None — không được trùng keyword
        return original(**kw, ask=lambda *a, **k: (
            '{"verdict": "partial", "feedback": "thieu ve dao ham trong",'
            ' "missing_points": ["dao ham trong"]}'))

    monkeypatch.setattr(grading_mod, "grade_short_answer", _graded)

    quiz_id, qids = _seed_quiz(client, owner, with_short_answer=True)
    attempt_id = _open(client, quiz_id)["attempt_id"]
    client.patch(f"/api/attempts/{attempt_id}/answers",
                 json={"answers": {qids[0]: "2x", qids[1]: "true", qids[2]: "dao ham ngoai"}})

    r = client.post(f"/api/attempts/{attempt_id}/submit")
    assert r.status_code == 202 and r.get_json()["grading"] == "pending"
    job_id = r.get_json()["job_id"]

    job = client.get(f"/api/attempts/jobs/{job_id}").get_json()
    assert job["status"] == "done", job
    assert job["result"]["score"] == 2.5 and job["result"]["ungraded_count"] == 0

    body = client.get(f"/api/quizzes/results/{attempt_id}").get_json()
    assert body["status"] == "graded" and body["score"] == 2.5
    assert body["max_score"] == 3.0 and body["percentage"] == 83.33
    short = next(q for q in body["questions"] if q["question_id"] == qids[2])
    assert short["verdict"] == "partial" and short["score"] == 0.5
    assert "dao ham trong" in short["feedback"], "missing_points phải vào feedback"


def test_unreliable_llm_leaves_question_ungraded_instead_of_zero(be, client, monkeypatch, owner):
    """Model hỏng thì để trống, không cho 0 oan — chấm sai thành 0 tệ hơn chờ chấm lại."""
    import app.jobs.queue as queue_mod
    from app.domains.attempts import grading as grading_mod

    _protect(be, monkeypatch, owner)
    monkeypatch.setattr(queue_mod, "enqueue_job",
                        lambda fn, args=(), **kw: (fn(*args), {"mode": "sync"})[1])
    monkeypatch.setattr(grading_mod, "grade_short_answer", lambda **kw: None)

    quiz_id, qids = _seed_quiz(client, owner, with_short_answer=True)
    attempt_id = _open(client, quiz_id)["attempt_id"]
    client.patch(f"/api/attempts/{attempt_id}/answers",
                 json={"answers": {qids[0]: "2x", qids[1]: "true", qids[2]: "gi do"}})
    job_id = client.post(f"/api/attempts/{attempt_id}/submit").get_json()["job_id"]

    assert client.get(f"/api/attempts/jobs/{job_id}").get_json()["result"]["ungraded_count"] == 1
    body = client.get(f"/api/quizzes/results/{attempt_id}").get_json()
    assert body["status"] == "graded" and body["score"] == 2.0
    assert body["max_score"] == 3.0, "câu chưa chấm vẫn tính vào mẫu số"
    short = next(q for q in body["questions"] if q["question_id"] == qids[2])
    assert short["verdict"] is None and short["score"] is None


def test_attempt_of_other_user_is_404(be, client, monkeypatch, owner):
    from app.domains.auth import users_store

    _protect(be, monkeypatch, owner)
    quiz_id, _ = _seed_quiz(client, owner)
    attempt_id = _open(client, quiz_id)["attempt_id"]

    other = users_store.create_user(f"att_o_{uuid.uuid4().hex[:8]}@example.com", "password123")
    _protect(be, monkeypatch, other["user_id"])
    assert client.get(f"/api/attempts/{attempt_id}").status_code == 404
    assert client.patch(f"/api/attempts/{attempt_id}/answers",
                        json={"answers": {str(uuid.uuid4()): "x"}}).status_code == 404
    assert client.post(f"/api/attempts/{attempt_id}/submit").status_code == 404
    assert client.get(f"/api/quizzes/results/{attempt_id}").status_code == 404
    assert client.post(f"/api/quizzes/{quiz_id}/attempts").status_code == 404
    assert client.get(f"/api/quizzes/{quiz_id}/attempts").status_code == 404
    assert client.get(f"/api/attempts/{uuid.uuid4()}").status_code == 404
