"""Phase 1 — lược đồ 19 bảng StudyMap trên PostgreSQL phải khớp đặc tả.

Kiểm cả hai chiều: bảng/RLS có mặt, VÀ ràng buộc thật sự chặn dữ liệu sai (CHECK
chỉ nằm trong model mà DB không có thì test model-only sẽ không bắt được).

Cần DATABASE_URL; không có thì skip. Test tự dọn mọi dòng nó tạo ra.
"""

from __future__ import annotations

import os
import uuid

import pytest


@pytest.fixture(scope="module")
def engine():
    from shared.env_loader import load_project_env
    load_project_env()
    if not (os.getenv("TEST_DATABASE_URL") or "").strip():
        pytest.skip("cần TEST_DATABASE_URL — xem `python -m scripts.setup_test_db --help`")
    from app.db import get_engine
    return get_engine()


@pytest.fixture()
def user_id(engine):
    """Một user tạm; xoá xong thì mọi dòng con cascade theo."""
    from sqlalchemy import text
    uid = str(uuid.uuid4())
    with engine.begin() as c:
        c.execute(
            text("INSERT INTO users(id, full_name, email, password_hash, role) "
                 "VALUES (:id, 'Schema Test', :em, 'x', 'learner')"),
            {"id": uid, "em": f"schema_{uid[:8]}@example.com"},
        )
    yield uid
    with engine.begin() as c:
        c.execute(text("DELETE FROM users WHERE id = :id"), {"id": uid})


def test_all_19_tables_exist_with_rls(engine):
    from sqlalchemy import text

    from app.db.models import ALL_TABLES

    with engine.connect() as c:
        rows = c.execute(text(
            "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'"
        )).all()
    present = {r[0]: r[1] for r in rows if r[0] != "alembic_version"}
    assert set(ALL_TABLES) == set(present), (
        f"thiếu: {set(ALL_TABLES) - set(present)} | thừa: {set(present) - set(ALL_TABLES)}"
    )
    # 19 bảng đặc tả Phase 1 + `identities` (2026-09-05, liên kết provider ngoài).
    assert len(ALL_TABLES) == 20
    # RLS bật + không policy nào = deny-all cho publishable key (đặc tả Phase 1).
    assert [t for t, rls in present.items() if not rls] == []


def test_no_rls_policy_exists(engine):
    """Deny-all: bật RLS mà tạo policy là vô tình mở cửa cho anon key."""
    from sqlalchemy import text
    with engine.connect() as c:
        n = c.execute(text("SELECT count(*) FROM pg_policies WHERE schemaname = 'public'")).scalar()
    assert n == 0, "có policy RLS — FE không gọi thẳng Supabase nên không được có policy nào"


def test_users_role_check_rejects_unknown_role(engine):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError
    with pytest.raises(IntegrityError):
        with engine.begin() as c:
            c.execute(
                text("INSERT INTO users(id, full_name, email, password_hash, role) "
                     "VALUES (:id, 'X', :em, 'x', 'superadmin')"),
                {"id": str(uuid.uuid4()), "em": f"bad_{uuid.uuid4().hex[:8]}@example.com"},
            )


def test_users_email_is_unique(engine, user_id):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError
    with engine.connect() as c:
        em = c.execute(text("SELECT email FROM users WHERE id = :id"), {"id": user_id}).scalar()
    with pytest.raises(IntegrityError):
        with engine.begin() as c:
            c.execute(
                text("INSERT INTO users(id, full_name, email, password_hash, role) "
                     "VALUES (:id, 'X', :em, 'x', 'learner')"),
                {"id": str(uuid.uuid4()), "em": em},
            )


def _make_document(c, user_id):
    from sqlalchemy import text
    did = str(uuid.uuid4())
    c.execute(
        text("INSERT INTO documents(id, user_id, title, file_type, file_path, status) "
             "VALUES (:id, :uid, 'Doc', 'pdf', 'bucket/doc.pdf', 'completed')"),
        {"id": did, "uid": user_id},
    )
    return did


def test_document_status_check(engine, user_id):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError
    with pytest.raises(IntegrityError):
        with engine.begin() as c:
            c.execute(
                text("INSERT INTO documents(id, user_id, title, file_type, file_path, status) "
                     "VALUES (:id, :uid, 'Doc', 'pdf', 'p', 'archived')"),
                {"id": str(uuid.uuid4()), "uid": user_id},
            )


def test_chunk_text_must_be_nonempty_and_index_unique(engine, user_id):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError
    with engine.begin() as c:
        did = _make_document(c, user_id)
        c.execute(
            text("INSERT INTO document_chunks(id, document_id, chunk_index, text) "
                 "VALUES (:id, :did, 0, 'noi dung')"),
            {"id": str(uuid.uuid4()), "did": did},
        )
    # text chỉ toàn khoảng trắng → CHECK length(trim(text)) > 0 chặn
    with pytest.raises(IntegrityError):
        with engine.begin() as c:
            c.execute(
                text("INSERT INTO document_chunks(id, document_id, chunk_index, text) "
                     "VALUES (:id, :did, 1, '   ')"),
                {"id": str(uuid.uuid4()), "did": did},
            )
    # trùng (document_id, chunk_index)
    with pytest.raises(IntegrityError):
        with engine.begin() as c:
            c.execute(
                text("INSERT INTO document_chunks(id, document_id, chunk_index, text) "
                     "VALUES (:id, :did, 0, 'khac')"),
                {"id": str(uuid.uuid4()), "did": did},
            )


def test_practice_quiz_requires_source_review_item(engine, user_id):
    """Đặc tả 8.9: quiz_type='practice' bắt buộc có source_review_item_id."""
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError
    with engine.begin() as c:
        did = _make_document(c, user_id)
    with pytest.raises(IntegrityError):
        with engine.begin() as c:
            c.execute(
                text("INSERT INTO quizzes(id, user_id, document_id, title, quiz_type, "
                     "question_count, difficulty, status) "
                     "VALUES (:id, :uid, :did, 'Q', 'practice', 5, 'easy', 'ready')"),
                {"id": str(uuid.uuid4()), "uid": user_id, "did": did},
            )
    # diagnostic thì không cần
    with engine.begin() as c:
        c.execute(
            text("INSERT INTO quizzes(id, user_id, document_id, title, quiz_type, "
                 "question_count, difficulty, status) "
                 "VALUES (:id, :uid, :did, 'Q', 'diagnostic', 5, 'mixed', 'ready')"),
            {"id": str(uuid.uuid4()), "uid": user_id, "did": did},
        )


def test_quiz_answer_score_domain(engine, user_id):
    """score chỉ nhận 0 / 0.5 / 1 (đặc tả 8.9) — 0.75 phải bị chặn."""
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError
    with engine.begin() as c:
        did = _make_document(c, user_id)
        qid, aid, qqid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
        c.execute(
            text("INSERT INTO quizzes(id, user_id, document_id, title, quiz_type, "
                 "question_count, difficulty, status) "
                 "VALUES (:id, :uid, :did, 'Q', 'diagnostic', 1, 'easy', 'ready')"),
            {"id": qid, "uid": user_id, "did": did},
        )
        c.execute(
            text("INSERT INTO quiz_questions(id, quiz_id, question_text, question_type, "
                 "correct_answer, explanation, difficulty, concept_tags_json, order_index) "
                 "VALUES (:id, :qid, 'Hoi?', 'true_false', 'true', 'vi the', 'easy', "
                 "'[\"a\"]'::jsonb, 1)"),
            {"id": qqid, "qid": qid},
        )
        c.execute(
            text("INSERT INTO quiz_attempts(id, quiz_id, user_id, total_questions, "
                 "max_score, status) VALUES (:id, :qid, :uid, 1, 1.0, 'in_progress')"),
            {"id": aid, "qid": qid, "uid": user_id},
        )
    with pytest.raises(IntegrityError):
        with engine.begin() as c:
            c.execute(
                text("INSERT INTO quiz_answers(id, attempt_id, question_id, score) "
                     "VALUES (:id, :aid, :qqid, 0.75)"),
                {"id": str(uuid.uuid4()), "aid": aid, "qqid": qqid},
            )
    # 0.5 (partial) hợp lệ
    with engine.begin() as c:
        c.execute(
            text("INSERT INTO quiz_answers(id, attempt_id, question_id, verdict, score) "
                 "VALUES (:id, :aid, :qqid, 'partial', 0.5)"),
            {"id": str(uuid.uuid4()), "aid": aid, "qqid": qqid},
        )
    # một attempt chỉ có MỘT answer cho mỗi câu hỏi
    with pytest.raises(IntegrityError):
        with engine.begin() as c:
            c.execute(
                text("INSERT INTO quiz_answers(id, attempt_id, question_id, score) "
                     "VALUES (:id, :aid, :qqid, 1)"),
                {"id": str(uuid.uuid4()), "aid": aid, "qqid": qqid},
            )


def test_concept_mastery_score_range(engine, user_id):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError
    with engine.begin() as c:
        did = _make_document(c, user_id)
        qid, aid = str(uuid.uuid4()), str(uuid.uuid4())
        c.execute(
            text("INSERT INTO quizzes(id, user_id, document_id, title, quiz_type, "
                 "question_count, difficulty, status) "
                 "VALUES (:id, :uid, :did, 'Q', 'diagnostic', 1, 'easy', 'ready')"),
            {"id": qid, "uid": user_id, "did": did},
        )
        c.execute(
            text("INSERT INTO quiz_attempts(id, quiz_id, user_id, total_questions, "
                 "max_score, status) VALUES (:id, :qid, :uid, 1, 1.0, 'graded')"),
            {"id": aid, "qid": qid, "uid": user_id},
        )
    # mastery_score > 1 bị chặn
    with pytest.raises(IntegrityError):
        with engine.begin() as c:
            c.execute(
                text("INSERT INTO concept_masteries(id, user_id, document_id, attempt_id, "
                     "concept_name, correct_count, earned_score, total_count, mastery_score, status) "
                     "VALUES (:id, :uid, :did, :aid, 'X', 1, 1, 1, 1.5, 'mastered')"),
                {"id": str(uuid.uuid4()), "uid": user_id, "did": did, "aid": aid},
            )
    with engine.begin() as c:
        c.execute(
            text("INSERT INTO concept_masteries(id, user_id, document_id, attempt_id, "
                 "concept_name, correct_count, earned_score, total_count, mastery_score, status) "
                 "VALUES (:id, :uid, :did, :aid, 'X', 1, 1, 4, 0.25, 'critical_gap')"),
            {"id": str(uuid.uuid4()), "uid": user_id, "did": did, "aid": aid},
        )
    # (attempt_id, concept_name) là duy nhất — snapshot theo attempt
    with pytest.raises(IntegrityError):
        with engine.begin() as c:
            c.execute(
                text("INSERT INTO concept_masteries(id, user_id, document_id, attempt_id, "
                     "concept_name, correct_count, earned_score, total_count, mastery_score, status) "
                     "VALUES (:id, :uid, :did, :aid, 'X', 2, 2, 4, 0.5, 'review_needed')"),
                {"id": str(uuid.uuid4()), "uid": user_id, "did": did, "aid": aid},
            )


def test_delete_user_cascades_whole_tree(engine):
    """Hard delete theo cây quan hệ 6.2 — xoá user là sạch mọi dữ liệu con."""
    from sqlalchemy import text
    uid = str(uuid.uuid4())
    with engine.begin() as c:
        c.execute(
            text("INSERT INTO users(id, full_name, email, password_hash, role) "
                 "VALUES (:id, 'Cascade', :em, 'x', 'learner')"),
            {"id": uid, "em": f"cascade_{uid[:8]}@example.com"},
        )
        did = _make_document(c, uid)
        c.execute(
            text("INSERT INTO document_chunks(id, document_id, chunk_index, text) "
                 "VALUES (:id, :did, 0, 'noi dung')"),
            {"id": str(uuid.uuid4()), "did": did},
        )
    with engine.begin() as c:
        c.execute(text("DELETE FROM users WHERE id = :id"), {"id": uid})
    with engine.connect() as c:
        assert c.execute(
            text("SELECT count(*) FROM documents WHERE user_id = :id"), {"id": uid}
        ).scalar() == 0
        assert c.execute(
            text("SELECT count(*) FROM document_chunks WHERE document_id = :did"), {"did": did}
        ).scalar() == 0
