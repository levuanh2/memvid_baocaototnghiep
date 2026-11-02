"""Deterministically seed quiz content; all learner APIs remain real."""
from __future__ import annotations
import json, os, sys, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "BE"))

def build_quiz(user_id, document_id, section_ids, chunk_ids, *, title, count):
    from app.domains.quiz import repository as quiz_repo
    questions = []
    for index in range(count):
        number = index + 1
        concept = "Core concepts" if number <= 5 else "Advanced concepts"
        questions.append({
            "question_text": f"Round 8.2 deterministic question {number}?",
            "question_type": "multiple_choice",
            "options": [f"Correct {number}", f"Wrong {number}", f"Distractor {number}"],
            "correct_answer": f"Correct {number}",
            "explanation": f"Deterministic feedback for question {number}.",
            "difficulty": "medium", "concept_tags": [concept],
            "section_id": section_ids[index % len(section_ids)],
            "chunk_ids": [chunk_ids[index % len(chunk_ids)]],
        })
    quiz_id = quiz_repo.create_quiz(user_id=user_id, document_id=document_id, title=title,
        scope={"type": "full_document", "section_ids": section_ids},
        question_count=count, difficulty="medium")
    quiz_repo.save_questions(quiz_id, questions)
    quiz_repo.finish(quiz_id, "ready", question_count=count)
    full = quiz_repo.get_quiz(quiz_id)
    return {"quiz_id": quiz_id,
            "question_ids": [question["question_id"] for question in full["questions"]]}

def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: seed_quiz_10q.py USER_ID")
    user_id = str(uuid.UUID(sys.argv[1]))
    database_url = os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not database_url or "55432" not in database_url or "studymap_test" not in database_url:
        raise SystemExit("refusing to seed: disposable TEST_DATABASE_URL on port 55432 required")
    os.environ["DATABASE_URL"] = database_url
    os.environ["TEST_DATABASE_URL"] = database_url
    os.environ.setdefault("SKIP_MODEL_LOAD", "1")
    os.environ.setdefault("MEMVID_DISABLE_LC_DEFAULTS", "1")
    from app.domains.documents import repository as docs_repo
    from app.domains.documents.sections import build_sections

    document_id = str(uuid.uuid4())
    filename = f"round8-2-quiz-source-{document_id[:8]}.md"
    docs_repo.create(document_id=document_id, filename=filename, file_type="md",
        file_path=f"e2e://{filename}", user_id=user_id, input_path=None, file_size=2048)
    headings = ["Core concepts"] * 5 + ["Advanced concepts"] * 5
    sections, keys = build_sections(headings)
    key_to_id = docs_repo.replace_sections(document_id, sections)
    chunks = [{"chunk_index": index,
               "text": f"Permitted source section {heading}; deterministic content {index + 1}.",
               "heading": heading, "section_id": key_to_id.get(keys[index]),
               "embedding_id": f"r82-{document_id[:8]}-{index}"}
              for index, heading in enumerate(headings)]
    docs_repo.replace_chunks(document_id, chunks)
    docs_repo.set_counts(document_id, char_count=2048, chunk_count=10, page_count=2)
    docs_repo.update_status(document_id, "ready", progress=1.0,
        capabilities={"chunk_query": True, "memory_query": False})
    stored_chunks = docs_repo.list_chunks(document_id)
    section_ids = list(dict.fromkeys(c["section_id"] for c in stored_chunks if c["section_id"]))
    chunk_ids = [c["chunk_id"] for c in stored_chunks]
    main_quiz = build_quiz(user_id, document_id, section_ids, chunk_ids,
                            title="Round 8.2 Quiz 10Q", count=10)
    switch_quiz = build_quiz(user_id, document_id, section_ids, chunk_ids,
                              title="Round 8.2 Attempt Switch", count=1)
    print(json.dumps({"document_id": document_id, "section_ids": section_ids,
        "chunk_ids": chunk_ids, **main_quiz, "switch_quiz_id": switch_quiz["quiz_id"],
        "switch_question_ids": switch_quiz["question_ids"]}))

if __name__ == "__main__":
    main()
