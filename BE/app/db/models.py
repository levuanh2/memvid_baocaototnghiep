"""Lược đồ 19 bảng StudyMap AI.

Nguồn chuẩn: `docs/tailieu/DacTa_Module_CSDL_StudyMapAI_v1.1.md` mục 5 (bảng),
8.8 (UNIQUE), 8.9 (CHECK), 9 (index), 6.2 (cây cascade). Mọi lệch so với đặc tả
đều ghi rõ ngay tại cột.

Hai lệch có chủ đích:
  1. TIMESTAMP dùng `timestamptz` (đặc tả chỉ ghi "TIMESTAMP"). Lưu naive local
     time trên DB hosted khác múi giờ là bug kinh điển; timestamptz là superset,
     không mất thông tin nào.
  2. `users.token_version` là cột THÊM ngoài đặc tả — phục vụ logout-all /
     thu hồi token (auth JWT tự viết, xem `app/domains/auth/tokens.py`).
"""

from __future__ import annotations

import uuid

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def _uuid() -> str:
    return str(uuid.uuid4())


def pk() -> Column:
    return Column(UUID(as_uuid=False), primary_key=True, default=_uuid)


def created_at() -> Column:
    return Column(DateTime(timezone=True), nullable=False, server_default=func.now())


def updated_at() -> Column:
    return Column(
        DateTime(timezone=True), nullable=False,
        server_default=func.now(), onupdate=func.now(),
    )


def fk(target: str, *, nullable: bool = False, ondelete: str = "CASCADE", **kw) -> Column:
    return Column(
        UUID(as_uuid=False),
        ForeignKey(target, ondelete=ondelete, **kw),
        nullable=nullable,
    )


# ─────────────────────────────────────────────────────────── 1. Người dùng ────

class User(Base):
    __tablename__ = "users"

    id = pk()
    full_name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=False, unique=True)
    password_hash = Column(Text, nullable=False)
    role = Column(String(50), nullable=False, server_default="learner")
    # Ngoài đặc tả: tăng lên để vô hiệu mọi token đã phát (logout-all).
    token_version = Column(Integer, nullable=False, server_default="1")
    # Bộ nhớ đệm HIỂN THỊ, không phải hồ sơ: URL công khai của ảnh đại diện ở provider
    # ngoài. KHÔNG lưu byte ảnh. Có mặt vì sau khi tải lại trang, máy chủ không còn
    # token nào để hỏi lại provider. Chỉ nhận https tuyệt đối (xem migration
    # c7f3a92b5e41). NULL = không biết, và sẽ tự điền ở lần đăng nhập kế tiếp.
    avatar_url = Column(String(500), nullable=True)
    created_at = created_at()
    updated_at = updated_at()

    __table_args__ = (
        CheckConstraint("role IN ('learner','teacher','admin')", name="ck_users_role"),
        Index("ix_users_email", "email"),
    )


class Identity(Base):
    """Danh tính ở provider ngoài (NKS…) trỏ về một `users` row.

    Bảng này là thứ CHẶN chiếm tài khoản qua email: nhận ra người quay lại bằng
    `UNIQUE(provider, provider_user_id)` — một phép tra khoá — thay vì bằng cách so
    email, vốn cho phép bất kỳ ai đăng ký được email đó ở provider ngoài nuốt tài
    khoản StudyMap sẵn có.

    `provider` để dạng chuỗi tự do có chủ đích: lõi không được có danh sách cứng tên
    provider, nếu không gỡ một provider lại thành sửa lược đồ.
    """

    __tablename__ = "identities"

    id = pk()
    provider = Column(String(50), nullable=False)
    provider_user_id = Column(String(255), nullable=False)
    user_id = fk("users.id")
    created_at = created_at()
    last_login_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("provider", "provider_user_id", name="uq_identities_provider_user"),
        Index("ix_identities_user_id", "user_id"),
    )


# ───────────────────────────────────────────────────────────── 2. Tài liệu ────

class Collection(Base):
    """Bộ sưu tập — ĐỐI TƯỢNG hạng nhất, không phải một cái thẻ.

    Khác thẻ ở bốn điểm và cả bốn đều cần danh tính riêng: đổi tên mà không đụng
    tài liệu nào, có màu, có biểu tượng, có thứ tự người dùng tự sắp, và tồn tại
    được cả khi rỗng. `documents.tags` (JSONB, Phase 1A) không làm được thứ nào
    trong số đó — nên hai khái niệm này KHÔNG hợp nhất.

    Phẳng, cố ý: không cha-con, không bộ sưu tập thông minh. Cây thư mục là thứ
    Phase 1A đã bỏ công tránh, thêm lại ở đây thì mất cả mục đích.
    """

    __tablename__ = "collections"

    id = pk()
    user_id = fk("users.id")
    name = Column(String(100), nullable=False)
    color = Column(String(20))
    icon = Column(String(40))
    sort_order = Column(Integer, nullable=False, server_default=text("0"))
    # `archived_at` chứ không phải bool — đối xứng với `documents.archived_at`, và
    # trả lời thêm "lưu trữ từ bao giờ".
    archived_at = Column(DateTime(timezone=True))
    created_at = created_at()
    updated_at = updated_at()

    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0", name="ck_collections_name_nonempty"),
        Index("ix_collections_user_id", "user_id"),
    )


class Document(Base):
    __tablename__ = "documents"

    id = pk()
    user_id = fk("users.id")
    title = Column(String(255), nullable=False)
    file_type = Column(String(50), nullable=False)
    file_path = Column(Text, nullable=False)   # storage path trong bucket Supabase
    status = Column(String(50), nullable=False)
    file_size = Column(BigInteger)
    page_count = Column(Integer)
    char_count = Column(Integer)
    chunk_count = Column(Integer)
    error_message = Column(Text)
    # THÊM ngoài đặc tả: trạng thái runtime của pipeline ingest — progress,
    # substatus (faiss_ready / building_memory_tree / ...), capabilities
    # (chunk_query/memory_query), source_stem canonical, input_path tạm.
    # Đặc tả cho documents chỉ có `status`; các bảng khác đều có metadata_json,
    # documents thiếu là lỗ hổng — không có chỗ này thì phải giữ song song
    # source_registry.json (hai nguồn sự thật).
    metadata_json = Column(JSONB)
    # Thư viện học tập (Phase 1A) — thứ NGƯỜI DÙNG tự đặt, không suy ra được từ đâu.
    # `archived_at` CỐ Ý không dùng `status`: đưa "đã lưu trữ" vào `status` sẽ đẩy tài
    # liệu ra khỏi `all_rows()` và khỏi `owned_stems()`, tức là ẩn nó khỏi cả RAG —
    # lưu trữ chỉ được ẩn khỏi giao diện, không được đụng tới truy hồi.
    display_name = Column(String(200))
    favorite = Column(Boolean, nullable=False, server_default=text("false"))
    pinned = Column(Boolean, nullable=False, server_default=text("false"))
    archived_at = Column(DateTime(timezone=True))
    tags = Column(JSONB)
    # Mốc MỞ, không phải mốc TẠO. Không bảng nào đang ghi lại việc người dùng mở một
    # artifact (mở tóm tắt ba lần không sinh dòng nào), nên hai cột này không suy ra được.
    last_opened_at = Column(DateTime(timezone=True))
    last_workspace = Column(String(20))
    # Phase 1B. `collection_id` 0..1 — một tài liệu thuộc nhiều nhất một bộ sưu tập,
    # nên khoá ngoại đủ diễn tả, bảng nối chỉ thêm một lượt JOIN vô ích.
    # `open_count` là TẦN SUẤT: `last_opened_at` nói "lần cuối khi nào", không nói
    # "mở bao nhiêu lần" — xếp hạng Học gần đây cần cả hai.
    collection_id = Column(UUID(as_uuid=False),
                           ForeignKey("collections.id", ondelete="SET NULL"))
    open_count = Column(Integer, nullable=False, server_default=text("0"))
    created_at = created_at()
    updated_at = updated_at()

    __table_args__ = (
        CheckConstraint(
            "status IN ('uploaded','processing','completed','failed','deleted')",
            name="ck_documents_status",
        ),
        CheckConstraint("file_size IS NULL OR file_size > 0", name="ck_documents_file_size"),
        Index("ix_documents_user_id", "user_id"),
        Index("ix_documents_status", "status"),
        # BẮT BUỘC: Postgres không tự đánh chỉ mục khoá ngoại, nên xoá một bộ sưu tập
        # (ON DELETE SET NULL) sẽ quét toàn bảng `documents` nếu thiếu chỉ mục này.
        Index("ix_documents_collection_id", "collection_id"),
    )


class Section(Base):
    __tablename__ = "sections"

    id = pk()
    document_id = fk("documents.id")
    parent_section_id = fk("sections.id", nullable=True, ondelete="CASCADE")
    title = Column(String(500), nullable=False)
    level = Column(Integer, nullable=False)
    order_index = Column(Integer, nullable=False)
    page_start = Column(Integer)
    page_end = Column(Integer)
    summary = Column(Text)
    metadata_json = Column(JSONB)
    created_at = created_at()

    __table_args__ = (
        CheckConstraint("id <> parent_section_id", name="ck_sections_not_self_parent"),
        CheckConstraint("level >= 1", name="ck_sections_level"),
        Index("ix_sections_document_id", "document_id"),
        Index("ix_sections_parent_section_id", "parent_section_id"),
    )


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = pk()
    document_id = fk("documents.id")
    section_id = fk("sections.id", nullable=True, ondelete="SET NULL")
    chunk_index = Column(Integer, nullable=False)
    text = Column(Text, nullable=False)
    heading = Column(String(500))
    page_number = Column(Integer)
    token_count = Column(Integer)
    checksum = Column(String(255))
    # ID của vector trong FAISS (int tăng dần) — Postgres giữ khoá nghiệp vụ,
    # FAISS chỉ là chỉ mục tìm kiếm (đặc tả 3.5.5).
    embedding_id = Column(String(255))
    embedding_model = Column(String(100))
    embedding_dim = Column(Integer)
    metadata_json = Column(JSONB)
    created_at = created_at()

    __table_args__ = (
        UniqueConstraint("document_id", "chunk_index", name="uq_document_chunks_doc_index"),
        CheckConstraint("length(trim(text)) > 0", name="ck_document_chunks_text_nonempty"),
        Index("ix_document_chunks_document_id", "document_id"),
        Index("ix_document_chunks_section_id", "section_id"),
        Index("ix_document_chunks_embedding_id", "embedding_id"),
    )


# ──────────────────────────────────────────────────────────── 3. Study Map ────

class KnowledgeMap(Base):
    __tablename__ = "knowledge_maps"

    id = pk()
    document_id = fk("documents.id")
    user_id = fk("users.id")
    title = Column(String(500), nullable=False)
    status = Column(String(50), nullable=False)
    generator_json = Column(JSONB)
    created_at = created_at()
    updated_at = updated_at()

    __table_args__ = (
        CheckConstraint(
            "status IN ('processing','completed','failed')", name="ck_knowledge_maps_status"
        ),
        Index("ix_knowledge_maps_document_id", "document_id"),
    )


class KnowledgeNode(Base):
    __tablename__ = "knowledge_nodes"

    id = pk()
    map_id = fk("knowledge_maps.id")
    document_id = fk("documents.id")
    section_id = fk("sections.id", nullable=True, ondelete="SET NULL")
    parent_node_id = fk("knowledge_nodes.id", nullable=True, ondelete="CASCADE")
    title = Column(String(500), nullable=False)
    summary = Column(Text)
    node_type = Column(String(50), nullable=False)
    level = Column(Integer, nullable=False)
    order_index = Column(Integer, nullable=False)
    metadata_json = Column(JSONB)
    created_at = created_at()

    __table_args__ = (
        CheckConstraint("id <> parent_node_id", name="ck_knowledge_nodes_not_self_parent"),
        Index("ix_knowledge_nodes_map_id", "map_id"),
        Index("ix_knowledge_nodes_parent_node_id", "parent_node_id"),
        Index("ix_knowledge_nodes_section_id", "section_id"),
    )


class KnowledgeEdge(Base):
    __tablename__ = "knowledge_edges"

    id = pk()
    map_id = fk("knowledge_maps.id")
    source_node_id = fk("knowledge_nodes.id")
    target_node_id = fk("knowledge_nodes.id")
    relation_type = Column(String(50), nullable=False)
    description = Column(Text)
    created_at = created_at()

    __table_args__ = (
        CheckConstraint(
            "source_node_id <> target_node_id", name="ck_knowledge_edges_no_self_loop"
        ),
        CheckConstraint(
            "relation_type IN ('parent_child','supports','prerequisite','contrasts','related')",
            name="ck_knowledge_edges_relation_type",
        ),
        Index("ix_knowledge_edges_map_id", "map_id"),
        Index("ix_knowledge_edges_source_node_id", "source_node_id"),
        Index("ix_knowledge_edges_target_node_id", "target_node_id"),
    )


class KnowledgeNodeChunk(Base):
    __tablename__ = "knowledge_node_chunks"

    id = pk()
    node_id = fk("knowledge_nodes.id")
    chunk_id = fk("document_chunks.id")
    created_at = created_at()

    __table_args__ = (
        UniqueConstraint("node_id", "chunk_id", name="uq_knowledge_node_chunks"),
        Index("ix_knowledge_node_chunks_node_id", "node_id"),
        Index("ix_knowledge_node_chunks_chunk_id", "chunk_id"),
    )


# ───────────────────────────────────────────────────────────────── 4. Quiz ────

class Quiz(Base):
    __tablename__ = "quizzes"

    id = pk()
    user_id = fk("users.id")
    document_id = fk("documents.id")
    map_id = fk("knowledge_maps.id", nullable=True, ondelete="SET NULL")
    # Vòng FK quizzes → review_plan_items → review_plans → quiz_attempts → quizzes.
    # use_alter: tạo constraint SAU khi cả hai bảng tồn tại (nếu không, DDL kẹt).
    source_review_item_id = fk(
        "review_plan_items.id", nullable=True, ondelete="CASCADE",
        use_alter=True, name="fk_quizzes_source_review_item",
    )
    source_attempt_id = fk(
        "quiz_attempts.id", nullable=True, ondelete="CASCADE",
        use_alter=True, name="fk_quizzes_source_attempt",
    )
    title = Column(String(500), nullable=False)
    quiz_type = Column(String(50), nullable=False)
    scope_json = Column(JSONB)
    question_count = Column(Integer, nullable=False)
    difficulty = Column(String(50), nullable=False)
    status = Column(String(50), nullable=False)
    created_at = created_at()
    updated_at = updated_at()

    __table_args__ = (
        CheckConstraint("quiz_type IN ('diagnostic','practice')", name="ck_quizzes_type"),
        CheckConstraint(
            "difficulty IN ('easy','medium','hard','mixed')", name="ck_quizzes_difficulty"
        ),
        CheckConstraint(
            "status IN ('processing','ready','failed')", name="ck_quizzes_status"
        ),
        # Practice quiz PHẢI truy vết được về review item sinh ra nó (đặc tả 3.11.5).
        CheckConstraint(
            "quiz_type <> 'practice' OR source_review_item_id IS NOT NULL",
            name="ck_quizzes_practice_needs_source",
        ),
        Index("ix_quizzes_user_id", "user_id"),
        Index("ix_quizzes_document_id", "document_id"),
        Index("ix_quizzes_quiz_type", "quiz_type"),
        Index("ix_quizzes_status", "status"),
        Index("ix_quizzes_source_review_item_id", "source_review_item_id"),
        Index("ix_quizzes_source_attempt_id", "source_attempt_id"),
    )


class QuizQuestion(Base):
    __tablename__ = "quiz_questions"

    id = pk()
    quiz_id = fk("quizzes.id")
    section_id = fk("sections.id", nullable=True, ondelete="SET NULL")
    knowledge_node_id = fk("knowledge_nodes.id", nullable=True, ondelete="SET NULL")
    question_text = Column(Text, nullable=False)
    question_type = Column(String(50), nullable=False)
    options_json = Column(JSONB)
    correct_answer = Column(Text, nullable=False)
    explanation = Column(Text, nullable=False)
    difficulty = Column(String(50), nullable=False)
    concept_tags_json = Column(JSONB, nullable=False)
    order_index = Column(Integer, nullable=False)
    created_at = created_at()

    __table_args__ = (
        CheckConstraint(
            "question_type IN ('multiple_choice','true_false','short_answer')",
            name="ck_quiz_questions_type",
        ),
        CheckConstraint(
            "difficulty IN ('easy','medium','hard')", name="ck_quiz_questions_difficulty"
        ),
        CheckConstraint(
            "length(trim(question_text)) > 0", name="ck_quiz_questions_text_nonempty"
        ),
        CheckConstraint(
            "length(trim(correct_answer)) > 0", name="ck_quiz_questions_answer_nonempty"
        ),
        CheckConstraint(
            "length(trim(explanation)) > 0", name="ck_quiz_questions_explanation_nonempty"
        ),
        Index("ix_quiz_questions_quiz_id", "quiz_id"),
        Index("ix_quiz_questions_section_id", "section_id"),
        Index("ix_quiz_questions_knowledge_node_id", "knowledge_node_id"),
        Index("ix_quiz_questions_quiz_order", "quiz_id", "order_index"),
    )


class QuizQuestionChunk(Base):
    __tablename__ = "quiz_question_chunks"

    id = pk()
    question_id = fk("quiz_questions.id")
    chunk_id = fk("document_chunks.id")
    created_at = created_at()

    __table_args__ = (
        UniqueConstraint("question_id", "chunk_id", name="uq_quiz_question_chunks"),
        Index("ix_quiz_question_chunks_question_id", "question_id"),
        Index("ix_quiz_question_chunks_chunk_id", "chunk_id"),
    )


# ─────────────────────────────────────────────────────────────── 5. Làm bài ────

class QuizAttempt(Base):
    __tablename__ = "quiz_attempts"

    id = pk()
    quiz_id = fk("quizzes.id")
    user_id = fk("users.id")
    score = Column(Numeric(5, 2))
    correct_count = Column(Integer)
    incorrect_count = Column(Integer)
    total_questions = Column(Integer, nullable=False)
    max_score = Column(Numeric(5, 2), nullable=False)
    percentage = Column(Numeric(5, 2))
    duration_seconds = Column(Integer)
    status = Column(String(50), nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    submitted_at = Column(DateTime(timezone=True))
    graded_at = Column(DateTime(timezone=True))
    metadata_json = Column(JSONB)

    __table_args__ = (
        CheckConstraint(
            "status IN ('in_progress','submitted','graded','cancelled')",
            name="ck_quiz_attempts_status",
        ),
        CheckConstraint(
            "correct_count IS NULL OR incorrect_count IS NULL "
            "OR correct_count + incorrect_count <= total_questions",
            name="ck_quiz_attempts_counts",
        ),
        CheckConstraint("score IS NULL OR score <= max_score", name="ck_quiz_attempts_score"),
        CheckConstraint(
            "percentage IS NULL OR (percentage BETWEEN 0 AND 100)",
            name="ck_quiz_attempts_percentage",
        ),
        Index("ix_quiz_attempts_quiz_id", "quiz_id"),
        Index("ix_quiz_attempts_user_id", "user_id"),
        Index("ix_quiz_attempts_status", "status"),
    )


class QuizAnswer(Base):
    __tablename__ = "quiz_answers"

    id = pk()
    attempt_id = fk("quiz_attempts.id")
    question_id = fk("quiz_questions.id")
    user_answer = Column(Text)
    verdict = Column(String(20))
    is_correct = Column(Boolean)
    score = Column(Numeric(4, 2))
    feedback = Column(Text)
    graded_at = Column(DateTime(timezone=True))
    created_at = created_at()
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("attempt_id", "question_id", name="uq_quiz_answers_attempt_question"),
        CheckConstraint(
            "verdict IS NULL OR verdict IN ('correct','partial','incorrect')",
            name="ck_quiz_answers_verdict",
        ),
        CheckConstraint("score IS NULL OR score IN (0, 0.5, 1)", name="ck_quiz_answers_score"),
        Index("ix_quiz_answers_attempt_id", "attempt_id"),
        Index("ix_quiz_answers_question_id", "question_id"),
    )


# ───────────────────────────────────────────────────────────── 6. Chẩn đoán ────

class ConceptMastery(Base):
    __tablename__ = "concept_masteries"

    id = pk()
    user_id = fk("users.id")
    document_id = fk("documents.id")
    attempt_id = fk("quiz_attempts.id")
    section_id = fk("sections.id", nullable=True, ondelete="SET NULL")
    knowledge_node_id = fk("knowledge_nodes.id", nullable=True, ondelete="SET NULL")
    concept_name = Column(String(255), nullable=False)
    correct_count = Column(Integer, nullable=False)
    earned_score = Column(Numeric(5, 2), nullable=False)
    total_count = Column(Integer, nullable=False)
    mastery_score = Column(Numeric(4, 2), nullable=False)
    status = Column(String(50), nullable=False)
    created_at = created_at()

    __table_args__ = (
        # Snapshot theo attempt, không phải mastery tích luỹ (đặc tả 5.14).
        UniqueConstraint("attempt_id", "concept_name", name="uq_concept_masteries_attempt_concept"),
        CheckConstraint("mastery_score BETWEEN 0 AND 1", name="ck_concept_masteries_score"),
        CheckConstraint("total_count > 0", name="ck_concept_masteries_total"),
        CheckConstraint("correct_count <= total_count", name="ck_concept_masteries_correct"),
        CheckConstraint("earned_score <= total_count", name="ck_concept_masteries_earned"),
        CheckConstraint(
            "status IN ('mastered','light_review','review_needed','critical_gap')",
            name="ck_concept_masteries_status",
        ),
        Index("ix_concept_masteries_user_id", "user_id"),
        Index("ix_concept_masteries_document_id", "document_id"),
        Index("ix_concept_masteries_attempt_id", "attempt_id"),
        Index("ix_concept_masteries_status", "status"),
        Index("ix_concept_masteries_concept_name", "concept_name"),
    )


# ──────────────────────────────────────────────────────────────── 7. Ôn tập ────

class ReviewPlan(Base):
    __tablename__ = "review_plans"

    id = pk()
    # Một attempt sinh tối đa MỘT review plan (đặc tả 8.8).
    attempt_id = fk("quiz_attempts.id")
    user_id = fk("users.id")
    document_id = fk("documents.id")
    summary = Column(Text, nullable=False)
    created_at = created_at()
    updated_at = updated_at()

    __table_args__ = (
        UniqueConstraint("attempt_id", name="uq_review_plans_attempt"),
        Index("ix_review_plans_user_id", "user_id"),
        Index("ix_review_plans_attempt_id", "attempt_id"),
    )


class ReviewPlanItem(Base):
    __tablename__ = "review_plan_items"

    id = pk()
    review_plan_id = fk("review_plans.id")
    concept_mastery_id = fk("concept_masteries.id", nullable=True, ondelete="SET NULL")
    section_id = fk("sections.id", nullable=True, ondelete="SET NULL")
    knowledge_node_id = fk("knowledge_nodes.id", nullable=True, ondelete="SET NULL")
    topic = Column(String(255), nullable=False)
    priority = Column(Integer, nullable=False)
    reason = Column(Text, nullable=False)
    status = Column(String(50), nullable=False)
    mastery_score = Column(Numeric(4, 2), nullable=False)
    review_tasks_json = Column(JSONB, nullable=False)
    created_at = created_at()

    __table_args__ = (
        UniqueConstraint("review_plan_id", "priority", name="uq_review_plan_items_priority"),
        CheckConstraint("priority >= 1", name="ck_review_plan_items_priority"),
        CheckConstraint(
            "status IN ('light_review','review_needed','critical_gap')",
            name="ck_review_plan_items_status",
        ),
        Index("ix_review_plan_items_review_plan_id", "review_plan_id"),
        Index("ix_review_plan_items_priority", "priority"),
    )


class ReviewItemChunk(Base):
    __tablename__ = "review_item_chunks"

    id = pk()
    review_item_id = fk("review_plan_items.id")
    chunk_id = fk("document_chunks.id")
    created_at = created_at()

    __table_args__ = (
        UniqueConstraint("review_item_id", "chunk_id", name="uq_review_item_chunks"),
        Index("ix_review_item_chunks_review_item_id", "review_item_id"),
        Index("ix_review_item_chunks_chunk_id", "chunk_id"),
    )


# ───────────────────────────────────────────────────────────── 8. Vận hành ────

class Job(Base):
    __tablename__ = "jobs"

    id = pk()
    user_id = fk("users.id", nullable=True, ondelete="SET NULL")
    job_type = Column(String(100), nullable=False)
    status = Column(String(50), nullable=False)
    progress = Column(Integer, nullable=False, server_default="0")
    current_step = Column(String(255))
    input_json = Column(JSONB)
    result_type = Column(String(100))
    # Khoá đa hình → KHÔNG đặt FK; app kiểm theo result_type (đặc tả 5.18).
    result_id = Column(UUID(as_uuid=False))
    error_message = Column(Text)
    cancel_requested = Column(Boolean, nullable=False, server_default="false")
    created_at = created_at()
    updated_at = updated_at()

    __table_args__ = (
        CheckConstraint("progress BETWEEN 0 AND 100", name="ck_jobs_progress"),
        CheckConstraint(
            "status IN ('pending','running','completed','failed','cancelled','timeout')",
            name="ck_jobs_status",
        ),
        Index("ix_jobs_user_id", "user_id"),
        Index("ix_jobs_status", "status"),
        Index("ix_jobs_result", "result_type", "result_id"),
    )


class AIValidationLog(Base):
    __tablename__ = "ai_validation_logs"

    id = pk()
    job_id = fk("jobs.id", nullable=True, ondelete="SET NULL")
    target_type = Column(String(50), nullable=False)
    target_ref = Column(String(255))
    rule_code = Column(String(50), nullable=False)
    severity = Column(String(20), nullable=False)
    message = Column(Text)
    payload_json = Column(JSONB)
    created_at = created_at()

    __table_args__ = (
        CheckConstraint("severity IN ('rejected','warning')", name="ck_ai_validation_logs_severity"),
        CheckConstraint(
            "target_type IN ('quiz_question','review_item')",
            name="ck_ai_validation_logs_target_type",
        ),
        Index("ix_ai_validation_logs_job_id", "job_id"),
        Index("ix_ai_validation_logs_rule_code", "rule_code"),
    )


class GuidedMindmapJob(Base):
    """Durable job ledger for Guided Mind Map V3 (see BE/app/domains/jobs/guided_store.py).

    Declared here purely so schema-completeness/RLS tests (test_db_schema.py)
    see this table — guided_store.py itself queries it via SQLAlchemy Core,
    not this ORM class.
    """

    __tablename__ = "guided_mindmap_jobs"

    job_id = Column(Text, primary_key=True)
    user_id = Column(Text, nullable=False)
    map_id = Column(Text)
    result_map_id = Column(Text)
    idempotency_key = Column(Text, nullable=False)
    request_fingerprint = Column(Text, nullable=False)
    source_ids_json = Column(JSONB, nullable=False)
    guided_config_json = Column(JSONB, nullable=False)
    status = Column(Text, nullable=False, server_default=text("'queued'"))
    stage = Column(Text, nullable=False, server_default=text("'queued'"))
    attempts = Column(Integer, nullable=False, server_default=text("0"))
    progress = Column(Integer, nullable=False, server_default=text("0"))
    current_node = Column(Text)
    lease_owner = Column(Text)
    lease_expires_at = Column(DateTime(timezone=True))
    heartbeat_at = Column(DateTime(timezone=True))
    not_before = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    started_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))
    error_code = Column(Text)
    error_message = Column(Text)
    result_json = Column(JSONB)

    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_guided_job_user_idempotency"),
        Index("ix_guided_jobs_status_lease", "status", "lease_expires_at"),
    )


class GuidedMindmapWorkerHeartbeat(Base):
    """Worker liveness for the Guided Mind Map supervised worker."""

    __tablename__ = "guided_mindmap_worker_heartbeats"

    worker_id = Column(Text, primary_key=True)
    heartbeat_at = Column(DateTime(timezone=True), nullable=False)
    ttl_seconds = Column(Integer, nullable=False, server_default=text("90"))


ALL_TABLES = tuple(Base.metadata.tables.keys())
