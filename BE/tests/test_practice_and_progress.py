"""Phase 7 — luyện tập bổ sung + tiến độ (FR-11, FR-12) trên DB thật, LLM giả."""

from __future__ import annotations

import io
import json
import os
import uuid

import pytest

from app.domains.progress.service import compare_masteries


# ── so sánh trước/sau: thuần, không DB ──────────────────────────────────────

def test_comparison_reports_delta_and_newly_mastered():
    out = compare_masteries(
        [{"concept_name": "ham hop", "mastery_score": 0.0, "status": "critical_gap"},
         {"concept_name": "dao ham", "mastery_score": 1.0, "status": "mastered"}],
        [{"concept_name": "ham hop", "mastery_score": 1.0, "status": "mastered"},
         {"concept_name": "dao ham", "mastery_score": 0.5, "status": "review_needed"}])
    by_name = {c["concept_name"]: c for c in out["concepts"]}
    assert by_name["ham hop"]["delta"] == 1.0 and by_name["ham hop"]["became_mastered"]
    assert by_name["dao ham"]["delta"] == -0.5
    assert out["improved_count"] == 1 and out["declined_count"] == 1
    assert out["became_mastered_count"] == 1


def test_concept_missing_on_one_side_has_no_delta():
    """"Chưa có số liệu" khác "0 điểm" — gộp lại là báo cáo sai tiến bộ."""
    out = compare_masteries(
        [{"concept_name": "chi truoc", "mastery_score": 0.5, "status": "review_needed"}],
        [{"concept_name": "chi sau", "mastery_score": 1.0, "status": "mastered"}])
    by_name = {c["concept_name"]: c for c in out["concepts"]}
    assert by_name["chi truoc"]["after"] is None and by_name["chi truoc"]["delta"] is None
    assert by_name["chi sau"]["before"] is None and by_name["chi sau"]["delta"] is None
    assert out["improved_count"] == 0 and out["declined_count"] == 0


def test_comparison_can_be_narrowed_to_the_practised_topic():
    before = [{"concept_name": "a", "mastery_score": 0.0, "status": "critical_gap"},
              {"concept_name": "b", "mastery_score": 0.0, "status": "critical_gap"}]
    after = [{"concept_name": "a", "mastery_score": 1.0, "status": "mastered"},
             {"concept_name": "b", "mastery_score": 1.0, "status": "mastered"}]
    only = compare_masteries(before, after, topics=["a"])
    assert [c["concept_name"] for c in only["concepts"]] == ["a"]
    assert only["improved_count"] == 1


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

    u = users_store.create_user(f"prac_{uuid.uuid4().hex[:8]}@example.com", "password123")
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


def _run_inline(monkeypatch):
    import app.jobs.queue as queue_mod
    monkeypatch.setattr(queue_mod, "enqueue_job",
                        lambda fn, args=(), **kw: (fn(*args), {"mode": "sync"})[1])


_ORIGINAL_GENERATE_QUESTIONS = None


def _fake_quiz_llm(monkeypatch, questions, *, capture=None):
    """Thay LLM sinh quiz. Giữ hàm gốc ở cấp module (patch chồng patch là đệ quy)."""
    global _ORIGINAL_GENERATE_QUESTIONS
    from app.domains.quiz import generator as gen

    if _ORIGINAL_GENERATE_QUESTIONS is None:
        _ORIGINAL_GENERATE_QUESTIONS = gen.generate_questions
    original = _ORIGINAL_GENERATE_QUESTIONS
    text = json.dumps({"questions": questions}, ensure_ascii=False)

    def _ask(prompt, **kw):
        if capture is not None:
            capture.append(prompt)
        return text

    monkeypatch.setattr(gen, "generate_questions",
                        lambda ctx, cfg, **kw: original(ctx, cfg, ask=_ask))


_ORIGINAL_REVIEW_GENERATE = None


def _fake_review_llm(monkeypatch, payload):
    global _ORIGINAL_REVIEW_GENERATE
    from app.domains.review import service as review_mod

    if _ORIGINAL_REVIEW_GENERATE is None:
        _ORIGINAL_REVIEW_GENERATE = review_mod.generate
    original = _ORIGINAL_REVIEW_GENERATE
    text = json.dumps(payload, ensure_ascii=False)
    monkeypatch.setattr(review_mod, "generate", lambda attempt_id, **kw: original(
        attempt_id, ask=lambda *a, **k: text, job_id=kw.get("job_id")))


def _seed_and_fail_a_quiz(client, owner, monkeypatch):
    """Dựng tài liệu, quiz 2 câu 'ham hop', làm sai hết, sinh review plan.

    Trả (document_id, attempt_id, review_item_id, chunk_ids của item).
    """
    from app.domains.documents import repository as docs_repo
    from app.domains.documents.sections import build_sections
    from app.domains.quiz import repository as quiz_repo

    r = client.post("/api/documents/upload",
                    data={"file": (io.BytesIO(b"# Chuong 2\n\nnoi dung"),
                                   f"prac {uuid.uuid4().hex[:6]}.md")},
                    content_type="multipart/form-data")
    doc_id = r.get_json()["document_id"]
    headings = ["Chuong 2 > 2.3 Ham hop", "Chuong 2 > 2.3 Ham hop", "Chuong 1 > 1.1 Dao ham"]
    sections, keys = build_sections(headings)
    key_to_id = docs_repo.replace_sections(doc_id, sections)
    docs_repo.replace_chunks(doc_id, [
        {"chunk_index": i, "text": f"Quy tac ham hop phan {i}." if i < 2 else "Dao ham co ban.",
         "heading": headings[i], "section_id": key_to_id.get(keys[i]),
         "embedding_id": str(1300 + i)}
        for i in range(3)
    ])
    chunks = docs_repo.list_chunks(doc_id)

    def _q(text, tags, chunk):
        return {"question_text": text, "question_type": "multiple_choice",
                "options": ["dung", "sai", "khac"], "correct_answer": "dung",
                "explanation": f"Giai thich {text}.", "difficulty": "easy",
                "concept_tags": tags, "section_id": chunk["section_id"],
                "chunk_ids": [chunk["chunk_id"]]}

    quiz_id = quiz_repo.create_quiz(
        user_id=owner, document_id=doc_id, title="Quiz chan doan",
        scope={"type": "full_document", "section_ids": []},
        question_count=3, difficulty="easy")
    quiz_repo.save_questions(quiz_id, [
        _q("Ham hop 1?", ["quy tac ham hop"], chunks[0]),
        _q("Ham hop 2?", ["quy tac ham hop"], chunks[1]),
        _q("Dao ham?", ["dao ham"], chunks[2]),
    ])
    quiz_repo.finish(quiz_id, "ready", question_count=3)
    qids = [q["question_id"] for q in quiz_repo.get_quiz(quiz_id)["questions"]]

    attempt_id = client.post(f"/api/quizzes/{quiz_id}/attempts").get_json()["attempt_id"]
    client.patch(f"/api/attempts/{attempt_id}/answers",
                 json={"answers": dict(zip(qids, ["sai", "sai", "dung"]))})
    client.post(f"/api/attempts/{attempt_id}/submit")

    _fake_review_llm(monkeypatch, {"summary": "on ham hop", "items": [
        {"topic": "quy tac ham hop", "reason": "sai ca 2", "review_tasks": ["doc lai 2.3"]}]})
    plan = client.post("/api/review-plans/generate",
                       json={"attempt_id": attempt_id}).get_json()
    item = plan["items"][0]
    return doc_id, attempt_id, item["review_item_id"], item["chunk_ids"]


def _practice_question(text, ref="c0"):
    return {"question_text": text, "question_type": "multiple_choice",
            "options": ["dung", "sai", "khac"], "correct_answer": "dung",
            "explanation": "Giai thich.", "difficulty": "easy",
            "concept_tags": ["quy tac ham hop"], "chunk_refs": [ref]}


def test_practice_quiz_is_traceable_and_uses_only_review_chunks(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    _run_inline(monkeypatch)
    doc_id, attempt_id, item_id, item_chunks = _seed_and_fail_a_quiz(client, owner, monkeypatch)
    prompts = []
    _fake_quiz_llm(monkeypatch, [_practice_question("Luyen 1?"),
                                 _practice_question("Luyen 2?", "c1")], capture=prompts)

    r = client.post("/api/practice/generate",
                    json={"review_item_id": item_id, "question_count": 2, "difficulty": "easy"})
    assert r.status_code == 202, r.get_data(as_text=True)
    result = client.get(f"/api/quizzes/jobs/{r.get_json()['job_id']}").get_json()["result"]
    practice_id = result["quiz_id"]

    body = client.get(f"/api/practice/{practice_id}").get_json()
    assert body["quiz_type"] == "practice" and body["status"] == "ready"
    # FR-11.8 / FR-11.9: truy được về review item và attempt gốc
    assert body["source_review_item_id"] == item_id
    assert body["source_attempt_id"] == attempt_id
    assert len(body["questions"]) == 2
    assert all("correct_answer" not in q for q in body["questions"])
    # FR-11.4: ngữ liệu chỉ gồm chunk của review item, không kéo cả tài liệu vào
    assert "Quy tac ham hop phan 0." in prompts[0]
    assert "Dao ham co ban." not in prompts[0]
    for q in body["questions"]:
        assert set(q["chunk_ids"]).issubset(set(item_chunks))
    assert doc_id


def test_practice_submit_grades_and_comparison_shows_improvement(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    _run_inline(monkeypatch)
    _doc, attempt_id, item_id, _chunks = _seed_and_fail_a_quiz(client, owner, monkeypatch)
    _fake_quiz_llm(monkeypatch, [_practice_question("Luyen 1?"),
                                 _practice_question("Luyen 2?", "c1")])
    job = client.post("/api/practice/generate",
                      json={"review_item_id": item_id, "question_count": 2}).get_json()
    practice_id = client.get(
        f"/api/quizzes/jobs/{job['job_id']}").get_json()["result"]["quiz_id"]
    qids = [q["question_id"] for q in
            client.get(f"/api/practice/{practice_id}").get_json()["questions"]]

    early = client.get(f"/api/practice/{practice_id}/comparison")
    assert early.status_code == 409, "chưa làm thì chưa có gì để so"

    r = client.post(f"/api/practice/{practice_id}/submit",
                    json={"answers": {qids[0]: "dung", qids[1]: "dung"}})
    assert r.status_code == 200
    graded = r.get_json()
    assert graded["status"] == "graded" and graded["percentage"] == 100.0

    body = client.get(f"/api/practice/{practice_id}/comparison").get_json()
    assert body["topic"] == "quy tac ham hop"
    assert body["source_attempt_id"] == attempt_id
    # FR-11.10: chỉ so đúng chủ đề đã luyện
    assert [c["concept_name"] for c in body["concepts"]] == ["quy tac ham hop"]
    concept = body["concepts"][0]
    assert concept["before"]["mastery_score"] == 0.0
    assert concept["after"]["mastery_score"] == 1.0
    assert concept["delta"] == 1.0 and concept["became_mastered"] is True
    assert body["improved_count"] == 1 and body["became_mastered_count"] == 1


def test_practice_tags_are_forced_to_the_review_topic(be, client, monkeypatch, owner):
    """FR-11.10 — model đặt tên chủ đề khác thì so sánh trước/sau im lặng hỏng.

    Bài chẩn đoán gắn "quy tắc ham hop"; nếu để model đặt tag cho bài luyện (ở đây là
    "ten khac hoan toan") thì hai bên không khớp và trang tiến bộ mãi hiện "chưa đo".
    """
    _protect(be, monkeypatch, owner)
    _run_inline(monkeypatch)
    _doc, _attempt, item_id, _chunks = _seed_and_fail_a_quiz(client, owner, monkeypatch)
    _fake_quiz_llm(monkeypatch, [
        {**_practice_question("Luyen 1?"), "concept_tags": ["ten khac hoan toan"]},
    ])
    job = client.post("/api/practice/generate",
                      json={"review_item_id": item_id, "question_count": 1}).get_json()
    practice_id = client.get(
        f"/api/quizzes/jobs/{job['job_id']}").get_json()["result"]["quiz_id"]

    q = client.get(f"/api/practice/{practice_id}").get_json()["questions"][0]
    assert q["concept_tags"][0] == "quy tac ham hop", q["concept_tags"]

    # và so sánh trước/sau phải có SỐ ở cả hai phía, không phải "chưa đo"
    client.post(f"/api/practice/{practice_id}/submit",
                json={"answers": {q["question_id"]: "dung"}})
    cmp_ = client.get(f"/api/practice/{practice_id}/comparison").get_json()
    row = next(c for c in cmp_["concepts"] if c["concept_name"] == "quy tac ham hop")
    assert row["before"] is not None and row["after"] is not None, row
    assert row["delta"] == 1.0 and row["became_mastered"] is True
    assert cmp_["improved_count"] == 1


def test_practice_submit_validates_input(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    _run_inline(monkeypatch)
    _doc, _attempt, item_id, _chunks = _seed_and_fail_a_quiz(client, owner, monkeypatch)
    _fake_quiz_llm(monkeypatch, [_practice_question("Luyen 1?")])
    job = client.post("/api/practice/generate",
                      json={"review_item_id": item_id, "question_count": 1}).get_json()
    practice_id = client.get(
        f"/api/quizzes/jobs/{job['job_id']}").get_json()["result"]["quiz_id"]

    assert client.post(f"/api/practice/{practice_id}/submit", json={}).status_code == 400
    assert client.post(f"/api/practice/{practice_id}/submit",
                       json={"answers": {str(uuid.uuid4()): "x"}}).status_code == 400
    assert client.post("/api/practice/generate", json={}).status_code == 400
    assert client.post("/api/practice/generate",
                       json={"review_item_id": str(uuid.uuid4())}).status_code == 404
    assert client.get(f"/api/practice/{uuid.uuid4()}").status_code == 404


def test_diagnostic_quiz_is_not_reachable_through_practice_routes(be, client, monkeypatch, owner):
    """Hai luồng khác nhau — quiz chẩn đoán vào route practice phải 404."""
    _protect(be, monkeypatch, owner)
    _run_inline(monkeypatch)
    _doc, attempt_id, _item, _chunks = _seed_and_fail_a_quiz(client, owner, monkeypatch)
    quiz_id = client.get(f"/api/attempts/{attempt_id}").get_json()["quiz_id"]

    assert client.get(f"/api/practice/{quiz_id}").status_code == 404
    assert client.get(f"/api/practice/{quiz_id}/comparison").status_code == 404
    assert client.post(f"/api/practice/{quiz_id}/submit",
                       json={"answers": {"x": "y"}}).status_code == 404


def test_progress_overview_and_history(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    _run_inline(monkeypatch)
    _doc, attempt_id, item_id, _chunks = _seed_and_fail_a_quiz(client, owner, monkeypatch)
    _fake_quiz_llm(monkeypatch, [_practice_question("Luyen 1?")])
    job = client.post("/api/practice/generate",
                      json={"review_item_id": item_id, "question_count": 1}).get_json()
    practice_id = client.get(
        f"/api/quizzes/jobs/{job['job_id']}").get_json()["result"]["quiz_id"]
    qid = client.get(f"/api/practice/{practice_id}").get_json()["questions"][0]["question_id"]
    client.post(f"/api/practice/{practice_id}/submit", json={"answers": {qid: "dung"}})

    over = client.get("/api/progress/overview").get_json()
    assert over["document_count"] == 1
    assert over["quiz_count_by_type"] == {"diagnostic": 1, "practice": 1}
    assert over["attempt_count"] == 2 and over["completion_rate"] == 1.0
    assert over["review_plan_count"] == 1
    assert over["weak_concept_count"] >= 0 and over["average_percentage"] is not None

    history = client.get("/api/progress/attempts").get_json()["attempts"]
    assert len(history) == 2
    practice_row = next(a for a in history if a["quiz_type"] == "practice")
    assert practice_row["source_attempt_id"] == attempt_id
    assert practice_row["source_review_item_id"] == item_id
    assert practice_row["percentage"] == 100.0
    assert client.get("/api/progress/attempts?limit=abc").status_code == 400


def test_progress_concepts_uses_latest_snapshot_not_a_running_sum(be, client, monkeypatch, owner):
    """Cộng dồn thì một bài tệ hồi đầu kéo điểm xuống mãi dù người học đã nắm được."""
    _protect(be, monkeypatch, owner)
    _run_inline(monkeypatch)
    _doc, _attempt, item_id, _chunks = _seed_and_fail_a_quiz(client, owner, monkeypatch)
    _fake_quiz_llm(monkeypatch, [_practice_question("Luyen 1?")])
    job = client.post("/api/practice/generate",
                      json={"review_item_id": item_id, "question_count": 1}).get_json()
    practice_id = client.get(
        f"/api/quizzes/jobs/{job['job_id']}").get_json()["result"]["quiz_id"]
    qid = client.get(f"/api/practice/{practice_id}").get_json()["questions"][0]["question_id"]
    client.post(f"/api/practice/{practice_id}/submit", json={"answers": {qid: "dung"}})

    rows = {c["concept_name"]: c
            for c in client.get("/api/progress/concepts").get_json()["concepts"]}
    ham_hop = rows["quy tac ham hop"]
    assert ham_hop["attempt_count"] == 2
    assert ham_hop["first_mastery_score"] == 0.0
    assert ham_hop["mastery_score"] == 1.0, "mức hiện tại là snapshot mới nhất"
    assert ham_hop["status"] == "mastered" and ham_hop["improvement"] == 1.0

    weak = client.get("/api/progress/concepts?weak=1").get_json()["concepts"]
    assert "quy tac ham hop" not in [c["concept_name"] for c in weak]


def test_generic_job_route_works_for_any_type(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    _run_inline(monkeypatch)
    _doc, _attempt, item_id, _chunks = _seed_and_fail_a_quiz(client, owner, monkeypatch)
    _fake_quiz_llm(monkeypatch, [_practice_question("Luyen 1?")])
    job_id = client.post("/api/practice/generate",
                         json={"review_item_id": item_id}).get_json()["job_id"]

    body = client.get(f"/api/jobs/{job_id}").get_json()
    assert body["job_type"] == "quiz_generation" and body["status"] == "done"
    assert body["result"]["quiz_id"]
    assert client.post(f"/api/jobs/{job_id}/cancel").status_code == 200
    assert client.get(f"/api/jobs/{uuid.uuid4()}").status_code == 404


def test_practice_and_progress_of_other_user_are_isolated(be, client, monkeypatch, owner):
    from app.domains.auth import users_store

    _protect(be, monkeypatch, owner)
    _run_inline(monkeypatch)
    _doc, _attempt, item_id, _chunks = _seed_and_fail_a_quiz(client, owner, monkeypatch)
    _fake_quiz_llm(monkeypatch, [_practice_question("Luyen 1?")])
    job = client.post("/api/practice/generate",
                      json={"review_item_id": item_id}).get_json()
    practice_id = client.get(
        f"/api/quizzes/jobs/{job['job_id']}").get_json()["result"]["quiz_id"]

    other = users_store.create_user(f"prac_o_{uuid.uuid4().hex[:8]}@example.com", "password123")
    _protect(be, monkeypatch, other["user_id"])
    assert client.get(f"/api/practice/{practice_id}").status_code == 404
    assert client.get(f"/api/practice/{practice_id}/comparison").status_code == 404
    assert client.post(f"/api/practice/{practice_id}/submit",
                       json={"answers": {"x": "y"}}).status_code == 404
    assert client.post("/api/practice/generate",
                       json={"review_item_id": item_id}).status_code == 404
    assert client.get(f"/api/jobs/{job['job_id']}").status_code == 404
    # tiến độ của người mới phải trống, không thấy dữ liệu người khác
    assert client.get("/api/progress/overview").get_json()["attempt_count"] == 0
    assert client.get("/api/progress/concepts").get_json()["concepts"] == []
    assert client.get("/api/progress/attempts").get_json()["attempts"] == []
