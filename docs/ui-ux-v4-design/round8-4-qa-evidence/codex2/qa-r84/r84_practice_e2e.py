"""RECONSTRUCTED from the Codex Round 8.4 session; no captured secrets/tokens."""
from __future__ import annotations

import json, os, sys, time, uuid
from pathlib import Path
import requests
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "BE"))
API, WEB = "http://127.0.0.1:8280", "http://127.0.0.1:4373"
DB_URL = "postgresql://postgres:postgres@localhost:55432/studymap_test"
os.environ.update(DATABASE_URL=DB_URL, TEST_DATABASE_URL=DB_URL,
                  SKIP_MODEL_LOAD="1", MEMVID_DISABLE_LC_DEFAULTS="1")


def register(label):
    suffix = f"{int(time.time()*1000)}-{uuid.uuid4().hex[:8]}"
    response = requests.post(f"{API}/auth/register", json={
        "email": f"r84-practice-{label}-{suffix}@example.test",
        "password": f"{uuid.uuid4()}-Aa1!",
        "display_name": f"R84 Practice {label}",
    }, timeout=20)
    response.raise_for_status()
    return response.json()


def seed_review_item(user_id):
    from app.domains.attempts import repository as attempts_repo
    from app.domains.attempts import service as grading_service
    from app.domains.documents import repository as docs_repo
    from app.domains.documents.sections import build_sections
    from app.domains.quiz import repository as quiz_repo
    from app.domains.review import service as review_service

    document_id = str(uuid.uuid4())
    filename = f"r84-practice-{document_id[:8]}.md"
    docs_repo.create(document_id=document_id, filename=filename, file_type="md",
        file_path=f"e2e://{filename}", user_id=user_id, input_path=None, file_size=1024)
    headings = ["Practice source", "Practice source"]
    sections, keys = build_sections(headings)
    key_to_id = docs_repo.replace_sections(document_id, sections)
    docs_repo.replace_chunks(document_id, [{
        "chunk_index": i,
        "text": f"Round 8.4 permitted practice source {i+1}.",
        "heading": heading,
        "section_id": key_to_id.get(keys[i]),
        "embedding_id": f"r84-{document_id[:8]}-{i}",
    } for i, heading in enumerate(headings)])
    docs_repo.set_counts(document_id, char_count=1024, chunk_count=2, page_count=1)
    docs_repo.update_status(document_id, "ready", progress=1.0,
        capabilities={"chunk_query": True, "memory_query": False})
    chunks = docs_repo.list_chunks(document_id)

    quiz_id = quiz_repo.create_quiz(user_id=user_id, document_id=document_id,
        title="R84 diagnostic prerequisite", scope={"type": "full_document", "section_ids": []},
        question_count=1, difficulty="easy")
    quiz_repo.save_questions(quiz_id, [{
        "question_text": "R84 prerequisite question?",
        "question_type": "multiple_choice",
        "options": ["Correct prerequisite", "Wrong prerequisite", "Other"],
        "correct_answer": "Correct prerequisite",
        "explanation": "R84 deterministic prerequisite explanation.",
        "difficulty": "easy",
        "concept_tags": ["round 8.4 practice topic"],
        "section_id": chunks[0]["section_id"],
        "chunk_ids": [chunks[0]["chunk_id"]],
    }])
    quiz_repo.finish(quiz_id, "ready", question_count=1)
    question_id = quiz_repo.get_quiz(quiz_id)["questions"][0]["question_id"]
    attempt_id = attempts_repo.open_attempt(quiz_id, user_id)["attempt_id"]
    attempts_repo.save_draft_answers(attempt_id, {question_id: "Wrong prerequisite"})
    assert attempts_repo.submit(attempt_id) is not None
    grading_service.grade_attempt(attempt_id)
    plan = review_service.generate(attempt_id, ask=lambda *_a, **_k: json.dumps({
        "summary": "R84 deterministic review plan",
        "items": [{
            "topic": "round 8.4 practice topic",
            "reason": "Prerequisite answer was intentionally wrong.",
            "review_tasks": ["Read the permitted source again."],
        }],
    }))
    item = plan["items"][0]
    return {"document_id": document_id, "source_attempt_id": attempt_id,
            "review_item_id": item["review_item_id"], "review_chunk_ids": item["chunk_ids"]}


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def main():
    owner, other = register("owner"), register("other")
    seeded = seed_review_item(owner["user"]["id"])
    request_log = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(base_url=WEB)

        def on_response(response):
            if response.url.startswith(API):
                request_log.append({"method": response.request.method,
                    "path": response.url.removeprefix(API).split("?", 1)[0],
                    "status": response.status})

        page.on("response", on_response)
        page.add_init_script(f"localStorage.setItem('memvid-token', {json.dumps(owner['token'])})")
        page.goto(f"/app/study/review/{seeded['source_attempt_id']}")
        page.wait_for_load_state("networkidle")
        page.screenshot(path=str(ARTIFACTS / "r84-review-guide.png"), full_page=True)
        expect(page.get_by_text("round 8.4 practice topic", exact=True)).to_be_visible()
        with page.expect_response(lambda r: r.request.method == "POST" and
                r.url == f"{API}/api/practice/generate") as info:
            page.get_by_role("button", name="Luyện ngay (5 câu)").click()
        generated = info.value
        assert generated.status == 202
        generate_body = generated.json()
        page.wait_for_url("**/app/study/practice/*", timeout=30000)
        page.wait_for_load_state("networkidle")
        practice_id = page.url.rsplit("/", 1)[-1]
        expect(page.get_by_text("E2E practice question 5?", exact=True)).to_be_visible()

        page.get_by_role("button", name="A Correct 1", exact=True).click()
        assert "selected" in (page.get_by_role("button", name="A Correct 1", exact=True).get_attribute("class") or "")
        page.reload()
        page.wait_for_load_state("networkidle")
        assert "selected" not in (page.get_by_role("button", name="A Correct 1", exact=True).get_attribute("class") or "")
        for number in range(1, 5):
            page.get_by_role("button", name=f"A Correct {number}", exact=True).click()
        page.get_by_role("button", name="B Wrong 5", exact=True).click()
        before = sum(row["method"] == "POST" and row["path"].endswith("/submit") for row in request_log)
        with page.expect_response(lambda r: r.request.method == "POST" and
                r.url == f"{API}/api/practice/{practice_id}/submit") as info:
            page.get_by_role("button", name="Nộp bài luyện tập").click()
        submitted = info.value
        assert submitted.status == 200
        submit_body = submitted.json()
        expect(page.get_by_text("4 / 5", exact=True)).to_be_visible()
        expect(page.get_by_text("Trước và sau khi luyện", exact=True)).to_be_visible()
        after = sum(row["method"] == "POST" and row["path"].endswith("/submit") for row in request_log)
        assert after - before == 1
        page.screenshot(path=str(ARTIFACTS / "r84-practice-graded.png"), full_page=True)
        browser.close()

    owner_headers, other_headers = auth(owner["token"]), auth(other["token"])
    attempt_id = submit_body["attempt_id"]
    result = requests.get(f"{API}/api/quizzes/results/{attempt_id}", headers=owner_headers, timeout=20)
    comparison = requests.get(f"{API}/api/practice/{practice_id}/comparison", headers=owner_headers, timeout=20)
    cross_account = {
        "practice_get": requests.get(f"{API}/api/practice/{practice_id}", headers=other_headers, timeout=20).status_code,
        "practice_submit": requests.post(f"{API}/api/practice/{practice_id}/submit", headers=other_headers, json={"answers": {}}, timeout=20).status_code,
        "attempt_get": requests.get(f"{API}/api/attempts/{attempt_id}", headers=other_headers, timeout=20).status_code,
        "attempt_patch": requests.patch(f"{API}/api/attempts/{attempt_id}/answers", headers=other_headers, json={"answers": {}}, timeout=20).status_code,
        "attempt_submit": requests.post(f"{API}/api/attempts/{attempt_id}/submit", headers=other_headers, timeout=20).status_code,
    }
    retries = [requests.post(f"{API}/api/practice/generate", headers=owner_headers,
        json={"review_item_id": seeded["review_item_id"], "question_count": 1,
              "question_types": ["multiple_choice"]}, timeout=20) for _ in range(2)]
    output = {"owner_user_id": owner["user"]["id"], "other_user_id": other["user"]["id"],
        **seeded, "generation": {"job_id": generate_body["job_id"], "practice_quiz_id": practice_id},
        "submit": submit_body, "result": result.json(), "comparison": comparison.json(),
        "cross_account": cross_account,
        "generation_retry": {"statuses": [r.status_code for r in retries],
                             "job_ids": [r.json()["job_id"] for r in retries]},
        "request_log": request_log}
    (ARTIFACTS / "r84-practice-results.json").write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
