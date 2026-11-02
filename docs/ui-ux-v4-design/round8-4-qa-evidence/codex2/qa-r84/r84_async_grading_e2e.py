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
        "email": f"r84-async-{label}-{suffix}@example.test",
        "password": f"{uuid.uuid4()}-Aa1!",
        "display_name": f"R84 Async {label}",
    }, timeout=20)
    response.raise_for_status()
    return response.json()


def seed_quizzes(user_id):
    from app.domains.documents import repository as docs_repo
    from app.domains.documents.sections import build_sections
    from app.domains.quiz import repository as quiz_repo

    document_id = str(uuid.uuid4())
    filename = f"r84-async-{document_id[:8]}.md"
    docs_repo.create(document_id=document_id, filename=filename, file_type="md",
        file_path=f"e2e://{filename}", user_id=user_id, input_path=None, file_size=1024)
    sections, keys = build_sections(["Async grading"])
    key_to_id = docs_repo.replace_sections(document_id, sections)
    docs_repo.replace_chunks(document_id, [{
        "chunk_index": 0,
        "text": "Round 8.4 async grading source.",
        "heading": "Async grading",
        "section_id": key_to_id.get(keys[0]),
        "embedding_id": f"r84-{document_id[:8]}",
    }])
    docs_repo.set_counts(document_id, char_count=1024, chunk_count=1, page_count=1)
    docs_repo.update_status(document_id, "ready", progress=1.0,
        capabilities={"chunk_query": True, "memory_query": False})
    chunk = docs_repo.list_chunks(document_id)[0]

    def build(title):
        quiz_id = quiz_repo.create_quiz(user_id=user_id, document_id=document_id,
            title=title, scope={"type": "full_document", "section_ids": []},
            question_count=2, difficulty="easy")
        quiz_repo.save_questions(quiz_id, [
            {"question_text": f"{title} objective?", "question_type": "multiple_choice",
             "options": ["Objective correct", "Objective wrong", "Other"],
             "correct_answer": "Objective correct", "explanation": "Objective explanation.",
             "difficulty": "easy", "concept_tags": ["async grading"],
             "section_id": chunk["section_id"], "chunk_ids": [chunk["chunk_id"]]},
            {"question_text": f"{title} short answer?", "question_type": "short_answer",
             "options": [], "correct_answer": "Expected short answer",
             "explanation": "Short-answer explanation.", "difficulty": "easy",
             "concept_tags": ["async grading"], "section_id": chunk["section_id"],
             "chunk_ids": [chunk["chunk_id"]]},
        ])
        quiz_repo.finish(quiz_id, "ready", question_count=2)
        return quiz_id

    return {"document_id": document_id,
            "success_quiz_id": build("R84 async success"),
            "failure_quiz_id": build("R84 async failure")}


def headers(token):
    return {"Authorization": f"Bearer {token}"}


def run_quiz(page, quiz_id, short_answer, token, request_log, other_token, expected_score):
    with page.expect_response(lambda r: r.request.method == "POST" and
            r.url == f"{API}/api/quizzes/{quiz_id}/attempts") as opened:
        page.goto(f"/app/study/quiz/{quiz_id}")
    attempt_id = opened.value.json()["attempt_id"]
    page.wait_for_load_state("networkidle")
    page.get_by_role("radiogroup", name="Đáp án câu 1").get_by_text(
        "Objective correct", exact=True).click()
    page.get_by_role("button", name="Câu 2 chưa trả lời").click()
    page.get_by_placeholder("Viết câu trả lời ngắn của bạn…").fill(short_answer)
    page.get_by_role("button", name="Nộp bài", exact=True).click()
    dialog = page.get_by_role("dialog", name="Nộp bài?")
    with page.expect_response(lambda r: r.request.method == "POST" and
            r.url == f"{API}/api/attempts/{attempt_id}/submit") as submitted:
        dialog.get_by_role("button", name="Nộp bài", exact=True).click()
    submit_response = submitted.value
    assert submit_response.status == 202
    submit_body = submit_response.json()
    job_id = submit_body["job_id"]
    page.wait_for_url(f"**/app/study/result/{attempt_id}")
    expect(page.get_by_text("Đang chấm", exact=True).first).to_be_visible()
    pending = requests.get(f"{API}/api/quizzes/results/{attempt_id}",
                           headers=headers(token), timeout=20).json()
    assert pending["status"] == "submitted"
    assert pending["score"] is None and pending["percentage"] is None
    assert page.get_by_text("Từng câu", exact=True).count() == 0
    assert page.get_by_text(expected_score, exact=True).count() == 0
    foreign_job_status = requests.get(f"{API}/api/attempts/jobs/{job_id}",
        headers=headers(other_token), timeout=20).status_code
    assert foreign_job_status == 404
    page.reload()
    page.wait_for_load_state("networkidle")
    expect(page.get_by_text("Đang chấm", exact=True).first).to_be_visible()
    expect(page.get_by_text(expected_score, exact=True)).to_be_visible(timeout=15000)
    expect(page.get_by_text("Từng câu", exact=True)).to_be_visible()
    final = requests.get(f"{API}/api/quizzes/results/{attempt_id}",
                         headers=headers(token), timeout=20).json()
    job = requests.get(f"{API}/api/attempts/jobs/{job_id}",
                       headers=headers(token), timeout=20).json()
    return {"quiz_id": quiz_id, "attempt_id": attempt_id, "job_id": job_id,
            "submit": submit_body, "pending": pending, "final": final,
            "job": job, "foreign_job_status": foreign_job_status}


def main():
    owner, other = register("owner"), register("other")
    seeded = seed_quizzes(owner["user"]["id"])
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
        success = run_quiz(page, seeded["success_quiz_id"],
            "A complete deterministic answer.", owner["token"], request_log,
            other["token"], "2 / 2")
        expect(page.get_by_text("E2E deterministic short-answer feedback.", exact=True)).to_be_visible()
        page.screenshot(path=str(ARTIFACTS / "r84-async-success.png"), full_page=True)

        failure = run_quiz(page, seeded["failure_quiz_id"],
            "__E2E_GRADE_FAIL__", owner["token"], request_log,
            other["token"], "1 / 2")
        expect(page.get_by_text("Chưa chấm", exact=True)).to_be_visible()
        assert failure["final"]["ungraded_count"] == 1
        assert failure["job"]["status"] == "done"
        duplicate = requests.post(f"{API}/api/attempts/{failure['attempt_id']}/submit",
            headers=headers(owner["token"]), timeout=20).status_code
        assert duplicate == 409
        page.screenshot(path=str(ARTIFACTS / "r84-async-failure.png"), full_page=True)
        browser.close()

    output = {"owner_user_id": owner["user"]["id"],
        "other_user_id": other["user"]["id"], **seeded,
        "success": success, "failure": failure,
        "duplicate_submit_status": duplicate, "request_log": request_log}
    (ARTIFACTS / "r84-async-results.json").write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
