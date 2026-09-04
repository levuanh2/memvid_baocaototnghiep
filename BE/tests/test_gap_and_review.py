"""Phase 6 — lỗ hổng kiến thức + gợi ý ôn tập (FR-09, FR-10) trên DB thật, LLM giả."""

from __future__ import annotations

import io
import json
import os
import uuid

import pytest

from app.domains.ai_validation.rules import RULE_REVIEW_SCOPE, validate_review_items
from app.domains.gap_analysis.service import compute_masteries, status_for
from app.domains.review.service import fallback_text, rank_weak_concepts


# ── tính toán thuần: không DB, không LLM ────────────────────────────────────

@pytest.mark.parametrize("score,status", [
    (1.0, "mastered"), (0.80, "mastered"), (0.79, "light_review"), (0.60, "light_review"),
    (0.59, "review_needed"), (0.40, "review_needed"), (0.39, "critical_gap"),
    (0.0, "critical_gap"),
])
def test_status_thresholds_match_the_spec_table(score, status):
    assert status_for(score) == status


def test_partial_answer_counts_half_and_correct_count_stays_separate():
    """FR-09.9 — partial = 0.5 điểm; `correct_count` chỉ đếm câu đúng hoàn toàn."""
    questions = [{"question_id": f"q{i}", "concept_tags": ["dao ham"],
                  "section_id": "sA", "knowledge_node_id": None} for i in range(1, 4)]
    answers = [{"question_id": "q1", "verdict": "correct", "score": 1.0},
               {"question_id": "q2", "verdict": "partial", "score": 0.5},
               {"question_id": "q3", "verdict": "incorrect", "score": 0.0}]
    m = compute_masteries(questions, answers)[0]
    assert m["earned_score"] == 1.5 and m["total_count"] == 3
    assert m["mastery_score"] == 0.5 == round(1.5 / 3, 2)
    assert m["status"] == "review_needed"
    assert m["correct_count"] == 1 and m["wrong_count"] == 2


def test_ungraded_question_is_excluded_not_counted_zero():
    """LLM không chấm được thì đừng đổ lỗi cho người học."""
    questions = [{"question_id": "q1", "concept_tags": ["a"], "section_id": None,
                  "knowledge_node_id": None},
                 {"question_id": "q2", "concept_tags": ["a"], "section_id": None,
                  "knowledge_node_id": None},
                 {"question_id": "q3", "concept_tags": ["chua cham"], "section_id": None,
                  "knowledge_node_id": None}]
    answers = [{"question_id": "q1", "verdict": "correct", "score": 1.0},
               {"question_id": "q2", "verdict": None, "score": None},
               {"question_id": "q3", "verdict": None, "score": None}]
    out = {m["concept_name"]: m for m in compute_masteries(questions, answers)}
    assert out["a"]["total_count"] == 1 and out["a"]["mastery_score"] == 1.0
    assert "chua cham" not in out, "concept toàn câu chưa chấm thì không sinh bản ghi"


def test_question_with_many_tags_counts_into_every_concept():
    questions = [{"question_id": "q1", "concept_tags": ["a", "b"], "section_id": "s1",
                  "knowledge_node_id": "n1"}]
    answers = [{"question_id": "q1", "verdict": "incorrect", "score": 0.0}]
    out = {m["concept_name"]: m for m in compute_masteries(questions, answers)}
    assert set(out) == {"a", "b"}
    assert all(m["total_count"] == 1 and m["status"] == "critical_gap" for m in out.values())
    assert out["a"]["section_id"] == "s1" and out["a"]["knowledge_node_id"] == "n1"


def test_priority_puts_the_weakest_first_and_skips_mastered():
    ranked = rank_weak_concepts([
        {"concept_name": "ok", "status": "mastered", "mastery_score": 1.0, "wrong_count": 0},
        {"concept_name": "vua", "status": "review_needed", "mastery_score": 0.5,
         "wrong_count": 1, "chunk_ids": ["c1"]},
        {"concept_name": "nang", "status": "critical_gap", "mastery_score": 0.0,
         "wrong_count": 3, "chunk_ids": ["c2"]},
        {"concept_name": "it sai", "status": "critical_gap", "mastery_score": 0.0,
         "wrong_count": 1, "chunk_ids": []},
    ])
    assert [m["concept_name"] for m in ranked] == ["nang", "it sai", "vua"]
    assert [m["priority"] for m in ranked] == [1, 2, 3]
    assert "ok" not in [m["concept_name"] for m in ranked], "FR-10.2"


def test_llm_cannot_invent_topics(monkeypatch):
    """FR-13.9 — gợi ý chủ đề người học không hề làm sai là gợi ý không liên quan."""
    ok, bad = validate_review_items(
        [{"topic": "QUY TAC HAM HOP", "reason": "r", "review_tasks": ["t1", "t2"]},
         {"topic": "chu de bia dat", "reason": "r", "review_tasks": ["t"]},
         {"topic": "quy tac ham hop", "reason": "trung", "review_tasks": ["t"]}],
        allowed_topics=["quy tac ham hop", "dao ham"])
    assert [a["topic"] for a in ok] == ["quy tac ham hop"]
    assert len(bad) == 2 and all(b["rule_code"] == RULE_REVIEW_SCOPE for b in bad)
    assert all(b["target_type"] == "review_item" for b in bad)
    assert bad[0]["payload"]["item"]["topic"] == "chu de bia dat"


def test_fallback_text_is_usable_without_llm():
    reason, tasks = fallback_text({"concept_name": "ham hop", "wrong_count": 2,
                                   "total_count": 3, "mastery_score": 0.33,
                                   "status": "critical_gap"})
    assert "2/3" in reason and "ham hop" in reason and "nghiêm trọng" in reason
    assert len(tasks) == 3 and all(t.strip() for t in tasks)


# ── phần chạy trên DB thật ──────────────────────────────────────────────────

@pytest.fixture(scope="module", autouse=True)
def _need_db():
    from shared.env_loader import load_project_env
    load_project_env()
    if not (os.getenv("TEST_DATABASE_URL") or "").strip():
        pytest.skip("cần TEST_DATABASE_URL — xem `python -m scripts.setup_test_db --help`")


@pytest.fixture()
def be(client):
    import app.main as main
    return main


@pytest.fixture()
def owner():
    from app.db import session_scope
    from app.db.models import User
    from app.domains.auth import users_store

    u = users_store.create_user(f"gap_{uuid.uuid4().hex[:8]}@example.com", "password123")
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


def _seed_quiz(client, owner):
    """3 câu: 2 câu concept 'ham hop' (sẽ sai), 1 câu 'dao ham' (sẽ đúng).

    Trả (quiz_id, [question_id...], {chunk_id...}, section_ids).
    """
    from app.domains.documents import repository as docs_repo
    from app.domains.documents.sections import build_sections
    from app.domains.quiz import repository as quiz_repo

    r = client.post("/api/documents/upload",
                    data={"file": (io.BytesIO(b"# Chuong 2\n\nnoi dung"),
                                   f"gap {uuid.uuid4().hex[:6]}.md")},
                    content_type="multipart/form-data")
    doc_id = r.get_json()["document_id"]
    headings = ["Chuong 2 > 2.3 Ham hop", "Chuong 2 > 2.3 Ham hop", "Chuong 1 > 1.1 Dao ham"]
    sections, keys = build_sections(headings)
    key_to_id = docs_repo.replace_sections(doc_id, sections)
    docs_repo.replace_chunks(doc_id, [
        {"chunk_index": i, "text": f"Noi dung {i}.", "heading": headings[i],
         "section_id": key_to_id.get(keys[i]), "embedding_id": str(1100 + i)}
        for i in range(3)
    ])
    chunks = docs_repo.list_chunks(doc_id)

    def _q(text, tags, chunk):
        return {"question_text": text, "question_type": "multiple_choice",
                "options": ["dung", "sai", "khac"], "correct_answer": "dung",
                "explanation": f"Giai thich {text}.", "difficulty": "easy",
                "concept_tags": tags, "section_id": chunk["section_id"],
                "chunk_ids": [chunk["chunk_id"]]}

    questions = [
        _q("Ham hop cau 1?", ["quy tac ham hop"], chunks[0]),
        _q("Ham hop cau 2?", ["quy tac ham hop"], chunks[1]),
        _q("Dao ham co ban?", ["dao ham"], chunks[2]),
    ]
    quiz_id = quiz_repo.create_quiz(
        user_id=owner, document_id=doc_id, title="Quiz chan doan",
        scope={"type": "full_document", "section_ids": []},
        question_count=3, difficulty="easy")
    quiz_repo.save_questions(quiz_id, questions)
    quiz_repo.finish(quiz_id, "ready", question_count=3)
    full = quiz_repo.get_quiz(quiz_id)
    qids = [q["question_id"] for q in full["questions"]]
    return quiz_id, qids, chunks


def _take_quiz(client, quiz_id, qids, answers):
    attempt_id = client.post(f"/api/quizzes/{quiz_id}/attempts").get_json()["attempt_id"]
    client.patch(f"/api/attempts/{attempt_id}/answers",
                 json={"answers": dict(zip(qids, answers))})
    client.post(f"/api/attempts/{attempt_id}/submit")
    return attempt_id


_ORIGINAL_GENERATE = None


def _fake_guide(monkeypatch, payload):
    """Thay LLM viết review guide. Gọi được NHIỀU lần trong cùng một test.

    Phải giữ hàm gốc ở cấp module: lần patch thứ hai mà đọc `review_mod.generate` thì
    bắt phải chính bản đã patch lần đầu, và payload mới không bao giờ có tác dụng.
    """
    global _ORIGINAL_GENERATE
    from app.domains.review import service as review_mod

    if _ORIGINAL_GENERATE is None:
        _ORIGINAL_GENERATE = review_mod.generate
    original = _ORIGINAL_GENERATE

    text = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    monkeypatch.setattr(review_mod, "generate", lambda attempt_id, **kw: original(
        attempt_id, ask=lambda *a, **k: text,
        job_id=kw.get("job_id")))


def test_grading_writes_concept_masteries_automatically(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    quiz_id, qids, _ = _seed_quiz(client, owner)
    attempt_id = _take_quiz(client, quiz_id, qids, ["sai", "sai", "dung"])

    body = client.get(f"/api/attempts/{attempt_id}/concept-masteries").get_json()
    by_name = {m["concept_name"]: m for m in body["concept_masteries"]}
    assert set(by_name) == {"quy tac ham hop", "dao ham"}
    assert by_name["quy tac ham hop"]["mastery_score"] == 0.0
    assert by_name["quy tac ham hop"]["status"] == "critical_gap"
    assert by_name["quy tac ham hop"]["section_id"], "FR-09.3: gắn được về section"
    assert by_name["dao ham"]["mastery_score"] == 1.0
    assert by_name["dao ham"]["status"] == "mastered"

    weak = client.get(f"/api/attempts/{attempt_id}/concept-masteries?weak=1").get_json()
    assert [m["concept_name"] for m in weak["concept_masteries"]] == ["quy tac ham hop"]


def test_regrading_replaces_the_snapshot_instead_of_stacking(be, client, monkeypatch, owner):
    """UNIQUE(attempt_id, concept_name) — snapshot theo attempt, không cộng dồn."""
    from app.domains.gap_analysis import service as gap_service

    _protect(be, monkeypatch, owner)
    quiz_id, qids, _ = _seed_quiz(client, owner)
    attempt_id = _take_quiz(client, quiz_id, qids, ["sai", "sai", "dung"])

    gap_service.analyze_attempt(attempt_id)
    gap_service.analyze_attempt(attempt_id)
    rows = gap_service.list_for_attempt(attempt_id)
    assert len(rows) == 2, "chạy lại không được nhân đôi bản ghi"


def test_review_plan_points_only_at_chunks_from_wrong_questions(be, client, monkeypatch, owner):
    """PRD 17.2 — không đoán mục mới, chỉ dùng nguồn của chính câu sai."""
    _protect(be, monkeypatch, owner)
    quiz_id, qids, chunks = _seed_quiz(client, owner)
    attempt_id = _take_quiz(client, quiz_id, qids, ["sai", "sai", "dung"])
    _fake_guide(monkeypatch, {"summary": "Can on lai ham hop.", "items": [
        {"topic": "quy tac ham hop", "reason": "Sai ca 2 cau.",
         "review_tasks": ["Doc lai muc 2.3", "Lam vi du"]}]})

    r = client.post("/api/review-plans/generate", json={"attempt_id": attempt_id})
    assert r.status_code == 201, r.get_data(as_text=True)
    plan = r.get_json()
    assert plan["summary"] == "Can on lai ham hop."
    assert "user_id" not in plan
    assert len(plan["items"]) == 1, "concept đã mastered không vào review plan"

    item = plan["items"][0]
    assert item["topic"] == "quy tac ham hop" and item["priority"] == 1
    assert item["status"] == "critical_gap" and item["mastery_score"] == 0.0
    assert item["reason"] == "Sai ca 2 cau." and item["review_tasks"] == [
        "Doc lai muc 2.3", "Lam vi du"]
    # FR-10.6: chunk cần ôn đúng bằng chunk của 2 câu sai, KHÔNG kèm chunk câu đúng
    assert sorted(item["chunk_ids"]) == sorted([chunks[0]["chunk_id"], chunks[1]["chunk_id"]])
    assert chunks[2]["chunk_id"] not in item["chunk_ids"]
    assert item["section_id"] == chunks[0]["section_id"]


def test_review_plan_survives_a_broken_llm(be, client, monkeypatch, owner):
    """Model hỏng vẫn ra plan rule-based — người học vừa làm bài xong không được tay trắng."""
    _protect(be, monkeypatch, owner)
    quiz_id, qids, _ = _seed_quiz(client, owner)
    attempt_id = _take_quiz(client, quiz_id, qids, ["sai", "sai", "dung"])
    _fake_guide(monkeypatch, "xin loi day khong phai JSON")

    plan = client.post("/api/review-plans/generate",
                       json={"attempt_id": attempt_id}).get_json()
    assert len(plan["items"]) == 1
    item = plan["items"][0]
    assert "2/2" in item["reason"] and item["review_tasks"]
    assert item["chunk_ids"], "nguồn vẫn phải có — nó do rule quyết định, không phải LLM"


def test_invented_topics_are_dropped_and_logged(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    quiz_id, qids, _ = _seed_quiz(client, owner)
    attempt_id = _take_quiz(client, quiz_id, qids, ["sai", "sai", "dung"])
    _fake_guide(monkeypatch, {"summary": "s", "items": [
        {"topic": "quy tac ham hop", "reason": "that", "review_tasks": ["t"]},
        {"topic": "tich phan bia dat", "reason": "bia", "review_tasks": ["t"]}]})

    plan = client.post("/api/review-plans/generate",
                       json={"attempt_id": attempt_id}).get_json()
    assert [i["topic"] for i in plan["items"]] == ["quy tac ham hop"]

    from app.db import session_scope
    from app.db.models import AIValidationLog
    with session_scope() as s:
        rows = s.query(AIValidationLog).filter(
            AIValidationLog.target_ref == "tich phan bia dat").all()
        assert rows and rows[0].rule_code == RULE_REVIEW_SCOPE
        for r in rows:
            s.delete(r)


def test_plan_is_cached_until_force_and_regeneration_replaces_it(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    quiz_id, qids, _ = _seed_quiz(client, owner)
    attempt_id = _take_quiz(client, quiz_id, qids, ["sai", "sai", "dung"])
    _fake_guide(monkeypatch, {"summary": "lan 1", "items": [
        {"topic": "quy tac ham hop", "reason": "r1", "review_tasks": ["t1"]}]})
    first = client.post("/api/review-plans/generate",
                        json={"attempt_id": attempt_id}).get_json()

    again = client.post("/api/review-plans/generate", json={"attempt_id": attempt_id})
    assert again.status_code == 200 and again.get_json()["cached"] is True
    assert again.get_json()["review_plan_id"] == first["review_plan_id"]

    _fake_guide(monkeypatch, {"summary": "lan 2", "items": [
        {"topic": "quy tac ham hop", "reason": "r2", "review_tasks": ["t2"]}]})
    forced = client.post("/api/review-plans/generate",
                         json={"attempt_id": attempt_id, "force": True}).get_json()
    assert forced["summary"] == "lan 2"
    assert forced["review_plan_id"] != first["review_plan_id"]
    # UNIQUE(attempt_id): đúng MỘT plan cho mỗi attempt
    assert client.get(f"/api/review-plans/{attempt_id}").get_json()[
        "review_plan_id"] == forced["review_plan_id"]

    items = client.get(
        f"/api/review-plans/{forced['review_plan_id']}/items").get_json()["items"]
    assert [i["reason"] for i in items] == ["r2"]


def test_review_plan_needs_a_graded_attempt(be, client, monkeypatch, owner):
    _protect(be, monkeypatch, owner)
    quiz_id, qids, _ = _seed_quiz(client, owner)
    attempt_id = client.post(f"/api/quizzes/{quiz_id}/attempts").get_json()["attempt_id"]

    r = client.post("/api/review-plans/generate", json={"attempt_id": attempt_id})
    assert r.status_code == 409, "chưa chấm thì chưa biết yếu ở đâu"
    assert client.post("/api/review-plans/generate", json={}).status_code == 400
    assert client.post("/api/review-plans/generate",
                       json={"attempt_id": str(uuid.uuid4())}).status_code == 404
    assert client.get(f"/api/review-plans/{attempt_id}").status_code == 404


def test_review_plan_of_other_user_is_404(be, client, monkeypatch, owner):
    from app.domains.auth import users_store

    _protect(be, monkeypatch, owner)
    quiz_id, qids, _ = _seed_quiz(client, owner)
    attempt_id = _take_quiz(client, quiz_id, qids, ["sai", "sai", "dung"])
    _fake_guide(monkeypatch, {"summary": "s", "items": []})
    plan_id = client.post("/api/review-plans/generate",
                          json={"attempt_id": attempt_id}).get_json()["review_plan_id"]

    other = users_store.create_user(f"gap_o_{uuid.uuid4().hex[:8]}@example.com", "password123")
    _protect(be, monkeypatch, other["user_id"])
    assert client.get(f"/api/review-plans/{attempt_id}").status_code == 404
    assert client.get(f"/api/review-plans/{plan_id}/items").status_code == 404
    assert client.get(f"/api/attempts/{attempt_id}/concept-masteries").status_code == 404
    assert client.post("/api/review-plans/generate",
                       json={"attempt_id": attempt_id}).status_code == 404
