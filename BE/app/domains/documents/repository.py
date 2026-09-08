"""Truy cập bảng `documents` / `sections` / `document_chunks`.

Thay `index/source_registry.json` — trước Phase 2 file JSON đó là nguồn sự thật
cho trạng thái ingest và quyền sở hữu. Giữ song song hai nguồn là mời gọi drift,
nên registry bị bỏ hẳn; các hàm ở đây trả về **đúng shape dict cũ** để call site
trong `main.py` không phải viết lại:

    {filename, source_stem, input_path, status, progress, created_at,
     user_id, error?, substatus?, capabilities?}

Ánh xạ status: pipeline dùng `processing | index_ready | ready | error`, còn cột
`documents.status` chỉ nhận giá trị đặc tả. Trạng thái pipeline giữ nguyên trong
`metadata_json.ingest_status`, cột `status` lưu bản đã quy đổi để truy vấn/báo cáo
theo đúng đặc tả.
"""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import delete as sa_delete
from sqlalchemy import select

from app.db import session_scope
from app.db.models import Document, DocumentChunk, Section, User
from app.domains.documents import provenance as _provenance
from shared.source_id import canonical_source_stem

# pipeline status → documents.status (đặc tả 3.2.4)
_STATUS_TO_DB = {
    "processing": "processing",
    "index_ready": "processing",   # FAISS xong nhưng memory tree chưa → vẫn đang xử lý
    "ready": "completed",
    "error": "failed",
    "deleted": "deleted",
    "uploaded": "uploaded",
}

ANONYMOUS_EMAIL = "anonymous@studymap.local"

# all_rows() nằm trên hot path (owned_stems chạy mỗi request) và DB là Supabase ở
# xa (~50-100ms RTT) — registry JSON cũ đọc từ đĩa local nên không ai để ý chi phí.
# Cache TTL rất ngắn + xoá tường minh ở MỌI đường ghi → không có cửa sổ stale thật
# sự (write-then-read trong cùng process luôn thấy dữ liệu mới).
_CACHE_TTL = float(os.getenv("DOCUMENTS_CACHE_TTL_SEC", "2") or 2)
_cache_lock = threading.Lock()
_cache: dict = {"t": 0.0, "rows": None}


def invalidate_cache() -> None:
    with _cache_lock:
        _cache["rows"] = None
        _cache["t"] = 0.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


_anon_id_cache: Optional[str] = None


def anonymous_user_id() -> Optional[str]:
    """Id user ẩn danh nếu đã tồn tại (không tạo mới). Cache trong process."""
    global _anon_id_cache
    if _anon_id_cache:
        return _anon_id_cache
    with session_scope() as s:
        u = s.execute(select(User).where(User.email == ANONYMOUS_EMAIL)).scalar_one_or_none()
        _anon_id_cache = u.id if u else None
        return _anon_id_cache


def ensure_anonymous_user() -> str:
    """User giữ chỗ cho chế độ mở (AUTH_PROTECT_APP_APIS=off).

    `documents.user_id` NOT NULL + FK theo đặc tả, nhưng luồng upload cũ cho phép
    ẩn danh. Thay vì nới ràng buộc, gắn mọi upload ẩn danh vào một user hệ thống.
    ponytail: shim tương thích ngược — bỏ khi bật auth bắt buộc cho mọi API.
    """
    with session_scope() as s:
        u = s.execute(select(User).where(User.email == ANONYMOUS_EMAIL)).scalar_one_or_none()
        if u is None:
            u = User(
                email=ANONYMOUS_EMAIL,
                full_name="Anonymous",
                password_hash="!",   # không đăng nhập được: hash không hợp lệ
                role="learner",
            )
            s.add(u)
            s.flush()
    global _anon_id_cache
    _anon_id_cache = u.id
    return u.id


def _row(d: Document) -> Dict[str, Any]:
    meta = d.metadata_json or {}
    # Chủ sở hữu: MỘT nguồn duy nhất là cột `documents.user_id`. Upload ẩn danh
    # (chế độ mở) trỏ vào user hệ thống → trả None để mọi kiểm tra quyền cũ
    # (so với `_current_user_id()`) hành xử y như trước.
    owner = d.user_id
    if owner and owner == anonymous_user_id():
        owner = None
    out: Dict[str, Any] = {
        "filename": d.title,
        "source_stem": meta.get("source_stem") or canonical_source_stem(d.title),
        "input_path": meta.get("input_path"),
        "file_path": d.file_path,
        # `status` = trạng thái PIPELINE (processing/index_ready/ready/error) — call
        # site cũ (`/list-indexed`, `/sources/<id>/status`) đọc giá trị này.
        "status": meta.get("ingest_status") or d.status,
        # `spec_status` = cột `documents.status`, chỉ nhận tập đặc tả 3.2.4. API mới
        # `/api/documents/*` PHẢI trả giá trị này: `ready` không nằm trong tập đặc tả,
        # client theo tài liệu sẽ không bao giờ thấy tài liệu xử lý xong.
        "spec_status": d.status,
        "progress": meta.get("progress", 0.0),
        "created_at": d.created_at.isoformat() if d.created_at else _now_iso(),
        "user_id": owner,
        "page_count": d.page_count,
        "char_count": d.char_count,
        "chunk_count": d.chunk_count,
        # Tiến trình nào đã nạp tài liệu này. `None` với mọi hàng tạo trước
        # 2026-09-04 — và `None` KHÔNG BAO GIỜ đủ để vào index (allowlist.duoc_index).
        "ingest_origin": meta.get("ingest_origin"),
        # ── Thư viện học tập (Phase 1A) ──────────────────────────────────────
        # Đường ĐỌC của bảy cột mới. Viết trước đọc là tạo tính năng ma: cột có,
        # nút có, và không chỗ nào hiện ra giá trị (bài học `deleted_at`).
        "file_type": d.file_type,
        "display_name": d.display_name,
        "favorite": bool(d.favorite),
        "pinned": bool(d.pinned),
        "archived_at": d.archived_at.isoformat() if d.archived_at else None,
        "tags": list(d.tags) if isinstance(d.tags, list) else [],
        "last_opened_at": d.last_opened_at.isoformat() if d.last_opened_at else None,
        "last_workspace": d.last_workspace,
    }
    if d.error_message:
        out["error"] = d.error_message
    if meta.get("substatus") is not None:
        out["substatus"] = meta["substatus"]
    if meta.get("capabilities") is not None:
        out["capabilities"] = meta["capabilities"]
    return out


def create(*, document_id: str, filename: str, file_type: str, file_path: str,
           user_id: Optional[str], input_path: Optional[str] = None,
           file_size: Optional[int] = None) -> Dict[str, Any]:
    """Tạo bản ghi documents lúc upload (status = processing).

    `user_id` None (chế độ mở) → gắn vào user ẩn danh; `metadata_json.owner_user_id`
    giữ NGUYÊN None để mọi kiểm tra quyền cũ (so sánh với `_current_user_id()`)
    hành xử y như trước.
    """
    owner = user_id or ensure_anonymous_user()
    meta = {
        "source_stem": canonical_source_stem(filename),
        "input_path": input_path,
        "progress": 0.0,
        "ingest_status": "processing",
        # CỐ Ý không phải tham số của hàm này. Nếu nó là tham số thì một route nào đó
        # sẽ chuyền giá trị lấy từ request vào, và cái nhãn quyết định quyền vào index
        # trở thành thứ client đặt được. Hàm tự hỏi tiến trình của chính nó.
        "ingest_origin": _provenance.nguon_ingest(),
    }
    with session_scope() as s:
        doc = Document(
            id=document_id,
            user_id=owner,
            title=filename,
            file_type=(file_type or os.path.splitext(filename)[1].lstrip(".") or "bin")[:50],
            file_path=file_path,
            status="processing",
            file_size=file_size if (file_size or 0) > 0 else None,
            metadata_json=meta,
        )
        s.add(doc)
        s.flush()
        s.refresh(doc)
        row = _row(doc)
    invalidate_cache()
    return row


def get(document_id: str) -> Optional[Dict[str, Any]]:
    if not document_id:
        return None
    with session_scope() as s:
        d = s.get(Document, str(document_id))
        return _row(d) if d is not None and d.status != "deleted" else None


def get_by_stem(source_stem: str) -> Optional[Dict[str, Any]]:
    target = canonical_source_stem(source_stem)
    if not target:
        return None
    for row in all_rows().values():
        if canonical_source_stem(row.get("source_stem") or row.get("filename") or "") == target:
            return row
    return None


def all_rows(*, use_cache: bool = True) -> Dict[str, Dict[str, Any]]:
    """Thay `_load_source_registry()`: {document_id: row}. Bỏ tài liệu soft-deleted."""
    if use_cache and _CACHE_TTL > 0:
        with _cache_lock:
            rows = _cache["rows"]
            if rows is not None and (time.time() - _cache["t"]) < _CACHE_TTL:
                return rows
    with session_scope() as s:
        docs = s.execute(select(Document).where(Document.status != "deleted")).scalars().all()
        rows = {d.id: _row(d) for d in docs}
    with _cache_lock:
        _cache["rows"] = rows
        _cache["t"] = time.time()
    return rows


def update_status(document_id: str, status: str, progress: Optional[float] = None,
                  error: Optional[str] = None, substatus: Optional[str] = None,
                  capabilities: Optional[Dict[str, bool]] = None) -> None:
    """Cập nhật trạng thái pipeline. Không có bản ghi → bỏ qua (fail-open như cũ)."""
    with session_scope() as s:
        d = s.get(Document, str(document_id))
        if d is None:
            return
        meta = dict(d.metadata_json or {})
        meta["ingest_status"] = status
        if progress is not None:
            meta["progress"] = progress
        if substatus is not None:
            meta["substatus"] = substatus
        elif status == "error":
            meta.pop("substatus", None)
        if capabilities is not None:
            meta["capabilities"] = capabilities
        elif status == "error":
            meta.pop("capabilities", None)

        d.metadata_json = meta
        d.status = _STATUS_TO_DB.get(status, "processing")
        if error is not None:
            d.error_message = error
        elif status != "error":
            d.error_message = None
    invalidate_cache()


LY_DO_GIAN_DOAN = (
    "Tiến trình xử lý dừng giữa chừng trước khi ingest xong (container khởi động lại). "
    "Tài liệu chưa được lập chỉ mục — hãy tải lên lại."
)


def reconcile_interrupted_documents(bo_qua: Optional[Iterable[str]] = None) -> List[str]:
    """Hạ tài liệu kẹt `processing` xuống `error` sau khi tiến trình chết.

    Vì sao cần: ingest chạy trong thread của chính tiến trình web. Tiến trình bị giết
    (OOM trên Render free, đo 2026-09-05) là thread bay theo mà không ai ghi trạng
    thái. `reconcile_interrupted` cũ chỉ chạm `jobs.sqlite`, còn hàng `documents` nằm
    lại ở `processing` VĨNH VIỄN — FE poll nó không bao giờ dừng. Hai tài liệu
    production đang ở đúng tình trạng đó (b68beaf3 từ 03:10, d3d4c0c5 từ hôm trước).

    Hai hàng rào để KHÔNG hạ nhầm việc đang chạy hoặc việc đã xong:

    1. Chỉ `ingest_status == "processing"`. `index_ready` KHÔNG bị đụng — FAISS đã
       xong, tài liệu truy vấn được, chỉ còn cây nhớ dang dở; hạ nó xuống lỗi là vứt
       một tài liệu dùng được. `ready` thì cột `status` đã là `completed`, không lọt
       vào truy vấn này.
    2. `bo_qua`: id đang sống theo registry RQ. Ở queue mode, web khởi động lại KHÔNG
       được hạ tài liệu mà worker đang xử lý dở.

    Trả về danh sách id đã hạ. Đi qua `update_status` chứ không tự ghi cột — quy đổi
    `error -> failed` và việc xoá `substatus`/`capabilities` chỉ nên có MỘT chỗ định nghĩa.
    """
    bo = {str(x) for x in (bo_qua or ())}
    can_ha: List[str] = []
    with session_scope() as s:
        rows = s.execute(select(Document).where(Document.status == "processing")).scalars().all()
        for d in rows:
            meta = d.metadata_json or {}
            if meta.get("ingest_status") != "processing":
                continue
            if str(d.id) in bo:
                continue
            can_ha.append(str(d.id))
    for doc_id in can_ha:
        update_status(doc_id, "error", progress=0.0, error=LY_DO_GIAN_DOAN)
    return can_ha


def set_counts(document_id: str, *, page_count: Optional[int] = None,
               char_count: Optional[int] = None, chunk_count: Optional[int] = None) -> None:
    with session_scope() as s:
        d = s.get(Document, str(document_id))
        if d is None:
            return
        if page_count is not None:
            d.page_count = int(page_count)
        if char_count is not None:
            d.char_count = int(char_count)
        if chunk_count is not None:
            d.chunk_count = int(chunk_count)
    invalidate_cache()


def soft_delete(document_id: str) -> bool:
    """Xoá mềm theo đặc tả 8.10: giữ dữ liệu con, ẩn ở tầng truy vấn."""
    with session_scope() as s:
        d = s.get(Document, str(document_id))
        if d is None:
            return False
        d.status = "deleted"
        meta = dict(d.metadata_json or {})
        meta["ingest_status"] = "deleted"
        d.metadata_json = meta
    invalidate_cache()
    return True


# ───────────────────────────────── thư viện học tập (Phase 1A) ────

# Sentinel cho "không gửi trường này" — `None` là một GIÁ TRỊ hợp lệ với
# `display_name` (xoá tên đã đặt) nên nó không thể đồng thời mang nghĩa "bỏ qua".
KHONG_DOI = object()


def set_library_fields(document_id: str, *, display_name: Any = KHONG_DOI,
                       favorite: Any = KHONG_DOI, pinned: Any = KHONG_DOI,
                       archived: Any = KHONG_DOI, tags: Any = KHONG_DOI) -> bool:
    """Cập nhật một phần các cột thư viện. Chỉ ghi trường được gửi.

    Hoàn toàn tách khỏi `update_status`: hàm kia chỉ đụng `metadata_json` và
    `status`, hàm này chỉ đụng cột người dùng. Hai đường ghi không giao nhau, nên
    ingest chạy giữa chừng không thể xoá mất tên người dùng vừa đặt.

    `archived` là bool ở API nhưng là mốc thời gian dưới database — người gọi
    không bao giờ gửi timestamp, nếu không thứ tự "mới lưu trữ" là thứ client đặt.
    """
    with session_scope() as s:
        d = s.get(Document, str(document_id))
        if d is None:
            return False
        if display_name is not KHONG_DOI:
            d.display_name = display_name
        if favorite is not KHONG_DOI:
            d.favorite = bool(favorite)
        if pinned is not KHONG_DOI:
            d.pinned = bool(pinned)
        if archived is not KHONG_DOI:
            d.archived_at = datetime.now(timezone.utc) if archived else None
        if tags is not KHONG_DOI:
            d.tags = list(tags) if tags else None
    invalidate_cache()
    return True


def touch_opened(document_id: str, workspace: Optional[str] = None) -> bool:
    """Ghi mốc MỞ. Mốc do máy chủ đặt, không nhận từ client.

    Tách khỏi `set_library_fields` vì đây là đường ghi duy nhất chạm mốc thời gian,
    và nó phải nằm sau một route riêng: client vá được timestamp là client giả mạo
    được thứ tự "mở gần đây".
    """
    with session_scope() as s:
        d = s.get(Document, str(document_id))
        if d is None:
            return False
        d.last_opened_at = datetime.now(timezone.utc)
        if workspace:
            d.last_workspace = str(workspace)[:20]
    invalidate_cache()
    return True


def languages_for(document_ids: Iterable[str]) -> Dict[str, str]:
    """{document_id: ngôn ngữ} — MỘT truy vấn cho cả thư viện, không phải mỗi tài
    liệu một lượt.

    Ngôn ngữ đã được ingest phát hiện sẵn (`domains/ingest/enrich.py`, langdetect)
    và nằm trong metadata của từng chunk. Đọc lại từ đó rẻ hơn nhiều so với thêm
    một cột — và thêm cột nghĩa là sửa ingest, thứ phase này không được đụng.

    Lấy chunk có `chunk_index` nhỏ nhất của mỗi tài liệu: chunk đầu là đoạn văn
    xuôi thật, còn chunk cuối hay là bảng biểu/phụ lục và đoán sai ngôn ngữ.
    """
    ids = [str(i) for i in document_ids if i]
    if not ids:
        return {}
    out: Dict[str, str] = {}
    with session_scope() as s:
        rows = s.execute(
            select(DocumentChunk.document_id, DocumentChunk.metadata_json)
            .where(DocumentChunk.document_id.in_(ids))
            .order_by(DocumentChunk.document_id, DocumentChunk.chunk_index)
            .distinct(DocumentChunk.document_id)
        ).all()
        for doc_id, meta in rows:
            lang = (meta or {}).get("language") if isinstance(meta, dict) else None
            if isinstance(lang, str) and lang.strip():
                out[str(doc_id)] = lang.strip().lower()
    return out


def ai_counts(user_id: Optional[str]) -> Dict[str, Dict[str, Any]]:
    """Đếm artifact AI BỀN VỮNG cho toàn bộ thư viện — ba truy vấn gộp, không có
    truy vấn nào chạy theo từng tài liệu.

    Quiz và số lần làm đã chấm đi CHUNG một truy vấn: cả hai đều treo dưới
    `quizzes.document_id`, và section "Cần hướng dẫn ôn tập" chỉ có nghĩa khi đã
    có bài chấm — tách ra là thêm một truy vấn thứ sáu mà không thêm thông tin gì.

    `review_plans` có `document_id` trực tiếp nên không cần đi vòng qua attempt.
    """
    from sqlalchemy import distinct, func
    from sqlalchemy.dialects.postgresql import aggregate_order_by

    from app.db.models import KnowledgeMap, Quiz, QuizAttempt, ReviewPlan

    quizzes: Dict[str, Dict[str, Any]] = {}
    reviews: Dict[str, Dict[str, Any]] = {}
    studymaps: Dict[str, str] = {}

    def _moi_nhat(cot, theo):
        """argmax — Postgres không có sẵn, `array_agg(... ORDER BY ...)[1]` là cách
        rẻ nhất lấy hàng MỚI NHẤT mà vẫn ở trong CÙNG một truy vấn gộp. Tách ra
        thành truy vấn riêng là phá ngân sách 5 truy vấn của `/api/library`."""
        return func.array_agg(aggregate_order_by(cot, theo.desc()))[1]

    with session_scope() as s:
        # Quiz: số quiz + số lượt ĐÃ CHẤM + id quiz mới nhất, một truy vấn. Số lượt
        # đã chấm là điều kiện của mục "Cần hướng dẫn ôn tập" (không có bài chấm thì
        # không dựng được hướng dẫn), nên tách nó ra là thêm truy vấn mà không thêm
        # thông tin.
        q = (select(Quiz.document_id,
                    func.count(distinct(Quiz.id)),
                    func.count(distinct(QuizAttempt.id)),
                    _moi_nhat(Quiz.id, Quiz.created_at))
             .select_from(Quiz)
             .outerjoin(QuizAttempt,
                        (QuizAttempt.quiz_id == Quiz.id) & (QuizAttempt.status == "graded"))
             .group_by(Quiz.document_id))
        if user_id is not None:
            q = q.where(Quiz.user_id == user_id)
        for doc_id, so_quiz, so_cham, quiz_moi in s.execute(q).all():
            quizzes[str(doc_id)] = {"quizzes": int(so_quiz or 0),
                                    "graded_attempts": int(so_cham or 0),
                                    "latest_quiz_id": str(quiz_moi) if quiz_moi else None}

        # Ôn tập: `review_plans.document_id` là FK trực tiếp nên KHÔNG phải đi vòng
        # qua attempt. `attempt_id` mới nhất là đích resume thật (`/app/study/review/
        # <attemptId>`) — không có nó thì nút "Tiếp tục" chỉ về được tới tài liệu.
        r = (select(ReviewPlan.document_id, func.count(ReviewPlan.id),
                    _moi_nhat(ReviewPlan.attempt_id, ReviewPlan.created_at))
             .group_by(ReviewPlan.document_id))
        if user_id is not None:
            r = r.where(ReviewPlan.user_id == user_id)
        for doc_id, so, attempt_moi in s.execute(r).all():
            reviews[str(doc_id)] = {"count": int(so or 0),
                                    "latest_attempt_id": str(attempt_moi) if attempt_moi else None}

        # `completed` thắng `processing`: một tài liệu có bản đồ xong VÀ một bản
        # đang dựng lại thì nó đã sẵn sàng — hiện "đang tạo" là giấu mất thứ đang
        # mở được. `created_at` tăng dần nên bản mới nhất ghi đè sau cùng.
        m = (select(KnowledgeMap.document_id, KnowledgeMap.status)
             .order_by(KnowledgeMap.created_at))
        if user_id is not None:
            m = m.where(KnowledgeMap.user_id == user_id)
        for doc_id, status in s.execute(m).all():
            key = str(doc_id)
            if studymaps.get(key) == "completed":
                continue
            studymaps[key] = str(status or "")

    return {"quizzes": quizzes, "reviews": reviews, "studymaps": studymaps}


def hard_delete(document_id: str) -> bool:
    """Xoá cứng — cascade xuống sections/chunks/quizzes/... theo cây 6.2."""
    with session_scope() as s:
        d = s.get(Document, str(document_id))
        if d is None:
            return False
        s.delete(d)
    invalidate_cache()
    return True


# ───────────────────────────────────────── sections & chunks (FR-03) ────

def replace_sections(document_id: str, sections: List[Dict[str, Any]]) -> Dict[str, str]:
    """Ghi lại toàn bộ sections của tài liệu. Trả map {key → section_id}.

    `sections` là list dict: {key, title, level, order_index, parent_key?,
    page_start?, page_end?}. `parent_key` trỏ tới `key` của section cha trong
    CÙNG list — resolve theo thứ tự nên cha phải đứng trước con.
    """
    out: Dict[str, str] = {}
    with session_scope() as s:
        s.execute(sa_delete(Section).where(Section.document_id == str(document_id)))
        s.flush()
        for item in sections:
            parent_key = item.get("parent_key")
            row = Section(
                document_id=str(document_id),
                parent_section_id=out.get(parent_key) if parent_key else None,
                title=(item.get("title") or "Untitled")[:500],
                level=int(item.get("level") or 1),
                order_index=int(item.get("order_index") or 0),
                page_start=item.get("page_start"),
                page_end=item.get("page_end"),
                metadata_json=item.get("metadata_json"),
            )
            s.add(row)
            s.flush()
            out[str(item.get("key"))] = row.id
    return out


def replace_chunks(document_id: str, chunks: List[Dict[str, Any]]) -> int:
    """Ghi lại toàn bộ document_chunks. Trả số chunk đã ghi.

    `chunks`: {chunk_index, text, heading?, page_number?, token_count?, checksum?,
    embedding_id?, embedding_model?, embedding_dim?, section_id?, metadata_json?}.
    Chunk rỗng bị bỏ (DB có CHECK length(trim(text)) > 0).
    """
    n = 0
    with session_scope() as s:
        s.execute(sa_delete(DocumentChunk).where(DocumentChunk.document_id == str(document_id)))
        s.flush()
        for item in chunks:
            text = (item.get("text") or "").strip()
            if not text:
                continue
            s.add(DocumentChunk(
                document_id=str(document_id),
                section_id=item.get("section_id"),
                chunk_index=int(item.get("chunk_index") or n),
                text=text,
                heading=(item.get("heading") or None) and str(item["heading"])[:500],
                page_number=item.get("page_number"),
                token_count=item.get("token_count"),
                checksum=item.get("checksum"),
                embedding_id=(str(item["embedding_id"]) if item.get("embedding_id") is not None else None),
                embedding_model=item.get("embedding_model"),
                embedding_dim=item.get("embedding_dim"),
                metadata_json=item.get("metadata_json"),
            ))
            n += 1
    return n


def set_chunk_embedding_id(chunk_id: str, embedding_id: str) -> bool:
    """Gán id FAISS cho MỘT chunk. Trả True nếu có dòng được cập nhật.

    `embedding_id` là cầu nối giữa id FAISS (int) và khoá nghiệp vụ (UUID);
    `lookup_by_embedding_ids` tra ngược qua nó. Chunk chưa từng được index có giá
    trị NULL — đúng tình trạng khi `SKIP_MODEL_LOAD=1` bỏ qua đường ghi index.
    Nên dựng lại index từ Postgres bắt buộc kèm một lượt ghi cột này, nếu không
    thì index có vector mà không ai tra ngược được về chunk.

    Cập nhật MỘT cột, không xoá gì, chạy lại được.
    """
    with session_scope() as s:
        row = s.get(DocumentChunk, str(chunk_id))
        if row is None:
            return False
        row.embedding_id = str(embedding_id)
        return True


def clear_chunk_embedding_ids(document_id: str) -> int:
    """Xoá liên kết FAISS của một tài liệu (đặt về NULL). Trả số dòng đổi.

    Dùng khi index bị vứt đi: để `embedding_id` trỏ vào một index không còn tồn
    tại thì `lookup_by_embedding_ids` trả về chunk cho những hit không có thật.
    KHÔNG xoá chunk — chỉ bỏ liên kết.
    """
    with session_scope() as s:
        rows = s.execute(
            select(DocumentChunk).where(
                DocumentChunk.document_id == str(document_id),
                DocumentChunk.embedding_id.isnot(None))
        ).scalars().all()
        for r in rows:
            r.embedding_id = None
        return len(rows)


def list_sections(document_id: str) -> List[Dict[str, Any]]:
    with session_scope() as s:
        rows = s.execute(
            select(Section)
            .where(Section.document_id == str(document_id))
            .order_by(Section.order_index)
        ).scalars().all()
        return [{
            "section_id": r.id,
            "parent_section_id": r.parent_section_id,
            "title": r.title,
            "level": r.level,
            "order_index": r.order_index,
            "page_start": r.page_start,
            "page_end": r.page_end,
            "summary": r.summary,
        } for r in rows]


def list_chunks(document_id: str, *, limit: int = 200, offset: int = 0) -> List[Dict[str, Any]]:
    with session_scope() as s:
        rows = s.execute(
            select(DocumentChunk)
            .where(DocumentChunk.document_id == str(document_id))
            .order_by(DocumentChunk.chunk_index)
            .limit(int(limit)).offset(int(offset))
        ).scalars().all()
        return [{
            "chunk_id": r.id,
            "section_id": r.section_id,
            "chunk_index": r.chunk_index,
            "text": r.text,
            "heading": r.heading,
            "page_number": r.page_number,
            "token_count": r.token_count,
            "embedding_id": r.embedding_id,
        } for r in rows]


def count_chunks(document_id: str) -> int:
    from sqlalchemy import func
    with session_scope() as s:
        return int(s.execute(
            select(func.count()).select_from(DocumentChunk)
            .where(DocumentChunk.document_id == str(document_id))
        ).scalar() or 0)


def chunks_by_embedding(document_id: str) -> Dict[str, Dict[str, Any]]:
    """`embedding_id` (id FAISS dạng chuỗi) → {chunk_id, section_id, chunk_index}.

    Cầu nối giữa chỉ mục tìm kiếm (int FAISS) và khoá nghiệp vụ (UUID). Mindmap
    trả `chunk_refs` là id FAISS nên Study Map phải đi qua đây mới ghi được
    `knowledge_node_chunks`.
    """
    with session_scope() as s:
        rows = s.execute(
            select(DocumentChunk.id, DocumentChunk.section_id,
                   DocumentChunk.chunk_index, DocumentChunk.embedding_id)
            .where(DocumentChunk.document_id == str(document_id),
                   DocumentChunk.embedding_id.isnot(None))
        ).all()
        return {
            str(emb): {"chunk_id": cid, "section_id": sec, "chunk_index": idx}
            for cid, sec, idx, emb in rows
        }


def lookup_by_embedding_ids(embedding_ids: List[str], *, user_id: Optional[str] = None,
                            ) -> Dict[str, Dict[str, Any]]:
    """Tra ngược nhiều id FAISS một lượt (API tìm kiếm).

    `user_id` không None thì chỉ trả chunk thuộc tài liệu của người đó và chưa xoá
    mềm (FR-05.5) — lọc ngay trong SQL, không lọc sau ở Python. Xoá mềm là
    `status = 'deleted'` (không có cột deleted_at), khớp `all_rows()`.
    """
    keys = [str(e) for e in (embedding_ids or []) if str(e or "").strip()]
    if not keys:
        return {}
    with session_scope() as s:
        q = (
            select(DocumentChunk.id, DocumentChunk.document_id, DocumentChunk.section_id,
                   DocumentChunk.chunk_index, DocumentChunk.embedding_id, Document.title)
            .join(Document, Document.id == DocumentChunk.document_id)
            .where(DocumentChunk.embedding_id.in_(keys), Document.status != "deleted")
        )
        if user_id is not None:
            q = q.where(Document.user_id == str(user_id))
        return {
            str(emb): {"chunk_id": cid, "document_id": doc, "section_id": sec,
                       "chunk_index": idx, "document_title": title}
            for cid, doc, sec, idx, emb, title in s.execute(q).all()
        }
