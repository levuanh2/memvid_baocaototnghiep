"""Phase 4 — AI Validation (FR-13).

Luật chạy thuần (không DB); phần ghi `ai_validation_logs` chạy trên Postgres thật.
"""

from __future__ import annotations

import os
import uuid

import pytest

from app.domains.ai_validation.rules import (
    RULE_CHUNK_REFS,
    RULE_CONCEPT_TAGS,
    RULE_CORRECT_ANSWER,
    RULE_DUPLICATE,
    RULE_EXPLANATION,
    RULE_JSON,
    RULE_NO_SOURCE,
    json_failure,
    validate_questions,
)

GOOD = {
    "question_text": "Đạo hàm của x^2 là gì?",
    "question_type": "multiple_choice",
    "options": ["2x", "x", "x^2", "1"],
    "correct_answer": "2x",
    "explanation": "Quy tắc luỹ thừa.",
    "concept_tags": ["đạo hàm"],
    "chunk_refs": ["c1"],
    "difficulty": "easy",
}


def _one(item, **kw):
    return validate_questions([item], allowed_chunk_refs=["c1", "c2"], **kw)


def test_valid_question_passes_unchanged():
    ok, bad = _one(GOOD)
    assert not bad and len(ok) == 1
    assert ok[0]["correct_answer"] == "2x" and ok[0]["chunk_refs"] == ["c1"]


@pytest.mark.parametrize("patch,rule", [
    ({"correct_answer": ""}, RULE_CORRECT_ANSWER),
    ({"correct_answer": "khong co trong options"}, RULE_CORRECT_ANSWER),
    ({"explanation": "   "}, RULE_EXPLANATION),
    ({"concept_tags": []}, RULE_CONCEPT_TAGS),
    ({"chunk_refs": []}, RULE_CHUNK_REFS),
    ({"chunk_refs": ["c404"]}, RULE_NO_SOURCE),
    ({"question_text": ""}, RULE_JSON),
    ({"question_type": "essay"}, RULE_JSON),
    ({"options": ["chi mot lua chon"]}, RULE_JSON),
])
def test_each_defect_has_its_own_rule_code(patch, rule):
    ok, bad = _one({**GOOD, **patch})
    assert not ok, "câu hỏng không được lọt"
    assert len(bad) == 1 and bad[0]["rule_code"] == rule
    assert bad[0]["severity"] == "rejected"
    # FR-13.11: log giữ NGUYÊN VĂN item bị loại, không chỉ mã lỗi
    assert bad[0]["payload"]["item"] == {**GOOD, **patch}


def test_duplicate_question_is_rejected_ignoring_case_and_accents():
    ok, bad = validate_questions(
        [GOOD, {**GOOD, "question_text": "ĐẠO HÀM CỦA X^2 LÀ GÌ?"}],
        allowed_chunk_refs=["c1"])
    assert len(ok) == 1 and bad[0]["rule_code"] == RULE_DUPLICATE


def test_true_false_answer_is_normalised_not_rejected():
    ok, bad = validate_questions([{
        "question_text": "Đạo hàm hằng số bằng 0?", "question_type": "true_false",
        "correct_answer": "Đúng", "explanation": "Hằng số không đổi.",
        "concept_tags": ["đạo hàm"], "chunk_refs": ["c1"],
    }], allowed_chunk_refs=["c1"])
    assert not bad and ok[0]["correct_answer"] == "true"
    assert ok[0]["options"] == ["true", "false"]


def test_cosmetic_fields_are_normalised_instead_of_dropping_the_question():
    """Độ khó lạ / section_id lạ không làm mất câu hỏi vốn dùng được."""
    ok, bad = validate_questions([{**GOOD, "difficulty": "sieu kho", "section_id": "la"}],
                                 allowed_chunk_refs=["c1"], allowed_section_ids=["s1"])
    assert not bad and ok[0]["difficulty"] == "medium" and ok[0]["section_id"] is None


def test_allowed_types_narrows_what_survives():
    ok, bad = validate_questions([GOOD], allowed_chunk_refs=["c1"],
                                 allowed_types=["true_false"])
    assert not ok and bad[0]["rule_code"] == RULE_JSON


def test_refs_are_filtered_to_real_ones():
    ok, _ = validate_questions([{**GOOD, "chunk_refs": ["c1", "c404", "c2"]}],
                               allowed_chunk_refs=["c1", "c2"])
    assert ok[0]["chunk_refs"] == ["c1", "c2"], "ref bịa bị bỏ, ref thật giữ lại"


# ── ghi ai_validation_logs (FR-13.10) ───────────────────────────────────────

@pytest.fixture(scope="module", autouse=True)
def _need_db():
    from shared.env_loader import load_project_env
    load_project_env()
    if not (os.getenv("DATABASE_URL") or "").strip():
        pytest.skip("cần DATABASE_URL (PostgreSQL) — xem BE/.env")


def test_rejections_are_persisted_with_rule_code_and_payload():
    from app.db import session_scope
    from app.db.models import AIValidationLog
    from app.domains.ai_validation import store

    _ok, bad = validate_questions(
        [{**GOOD, "chunk_refs": []}, {**GOOD, "question_text": "Khac", "explanation": ""}],
        allowed_chunk_refs=["c1"])
    assert len(bad) == 2
    ref = f"test-{uuid.uuid4().hex[:8]}"
    for r in bad:
        r["target_ref"] = ref

    try:
        # job_id để None: job chỉ sống trong SQLite thì FK sang `jobs` không trỏ được,
        # nhưng log VẪN phải ghi (FR-13.10 không kèm điều kiện).
        assert store.log_rejections(bad, job_id=None) == 2
        with session_scope() as s:
            rows = s.query(AIValidationLog).filter(AIValidationLog.target_ref == ref).all()
            codes = sorted(r.rule_code for r in rows)
            assert codes == sorted([RULE_CHUNK_REFS, RULE_EXPLANATION])
            assert all(r.target_type == "quiz_question" for r in rows)
            assert all(r.payload_json and "item" in r.payload_json for r in rows)
    finally:
        with session_scope() as s:
            s.query(AIValidationLog).filter(AIValidationLog.target_ref == ref).delete()


def test_json_failure_record_carries_raw_output():
    rec = json_failure("Output không phải JSON hợp lệ sau 2 lần", "xin loi day khong phai json")
    assert rec["rule_code"] == RULE_JSON and rec["severity"] == "rejected"
    assert "xin loi" in rec["payload"]["raw_excerpt"]
    assert rec["target_ref"] is None
