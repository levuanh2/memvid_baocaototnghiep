"""Thư viện học tập — phép chiếu THUẦN cho `GET /api/library` (Phase 1A).

Module này KHÔNG chạm database, KHÔNG chạm HTTP, KHÔNG gọi LLM. Nó nhận những bộ
sưu tập đã được lấy sẵn rồi trả ra payload. Nhờ vậy toàn bộ phần khó — khớp stem,
suy ra AI Overview, quy tắc ba trạng thái — test được mà không cần Postgres, không
cần Flask, không cần cả một bản ghi tóm tắt thật.

Ba quy tắc định hình mọi thứ ở đây:

1. **Không bao giờ suy ra GENERATING từ sự VẮNG MẶT.** Không thấy bản tóm tắt chỉ
   có nghĩa là không thấy. Máy chủ chỉ được nói GENERATING khi có bằng chứng
   DƯƠNG: `knowledge_maps.status == 'processing'`. Với tóm tắt và sơ đồ tư duy,
   job đang chạy KHÔNG gắn được với tài liệu ở phía máy chủ (bảng `jobs` không có
   cột nguồn), nên máy chủ trả NOT_GENERATED và client tự nâng cấp bằng
   `activeSummaryJob`/`activeMindmapJob` — nơi `sources` đã có sẵn.

2. **Không lưu thứ suy ra được.** `ai_overview` tính từ `sections[].key_points`,
   `preview` từ `overview`, `reading_minutes` từ `char_count`. Không cột nào cho
   ba thứ này: một giá trị vừa lưu vừa suy ra được là hai nguồn sự thật, và bản
   lưu sẽ lệch ngay lần tóm tắt được tạo lại.

3. **Bền vững đứng trước phù du.** Trạng thái từ Postgres (trích xuất, chỉ mục,
   StudyMap, quiz, ôn tập) sống qua mọi lần deploy. Trạng thái từ SQLite trong
   `DATA_DIR` (tóm tắt, sơ đồ tư duy) bị xoá mỗi lần deploy hoặc mỗi lần dịch vụ
   ngủ. Thẻ phải đọc được khi nhóm thứ hai biến mất — mất chúng là NOT_GENERATED
   kèm một hành động thật, không phải một lời nói dối "đang tạo".
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Mapping, Optional

from shared.source_id import canonical_source_stem

# ── Hằng số hiển thị ────────────────────────────────────────────────────────
# Cắt ở máy chủ, không ở client: payload thư viện đi kèm MỌI tài liệu, nên phần
# văn bản phải nhỏ ngay từ lúc rời máy chủ. Toàn văn tóm tắt và đồ thị sơ đồ tư duy
# KHÔNG BAO GIỜ có mặt trong payload này.
PREVIEW_MAX = 240
OVERVIEW_BULLETS = 3
OVERVIEW_BULLET_MAX = 120
ENTITIES_MAX = 20

# ~200 từ/phút, ~5 ký tự/từ → ~1000 ký tự/phút.
CHARS_PER_MINUTE = 1000

READY = "ready"
GENERATING = "generating"
NOT_GENERATED = "not_generated"

# Bề mặt học tập hợp lệ cho `last_workspace`. CỐ Ý không phải CHECK constraint
# dưới database: thêm bề mặt thứ sáu không được kéo theo một migration.
WORKSPACES = ("summary", "mindmap", "studymap", "quiz", "review", "chat")


def _chuoi(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _cat(text: str, gioi_han: int) -> str:
    """Cắt theo ranh giới từ khi cắt được — cắt giữa từ đọc như dữ liệu hỏng."""
    text = " ".join(text.split())
    if len(text) <= gioi_han:
        return text
    cat = text[:gioi_han].rstrip()
    khoang = cat.rfind(" ")
    if khoang > gioi_han * 0.6:
        cat = cat[:khoang].rstrip()
    return cat + "…"


# ── Suy ra từ dữ liệu đã có ─────────────────────────────────────────────────

def reading_minutes(char_count: Optional[int]) -> Optional[int]:
    """Suy từ `documents.char_count`. Không có số ký tự → None, KHÔNG phải 0:
    "0 phút đọc" là một lời khẳng định sai, "không biết" thì không."""
    try:
        so = int(char_count)
    except (TypeError, ValueError):
        return None
    if so <= 0:
        return None
    return max(1, -(-so // CHARS_PER_MINUTE))   # ceil


def ai_overview(record: Optional[Mapping[str, Any]]) -> Optional[List[str]]:
    """Tối đa 3 gạch đầu dòng, suy TỪ bản ghi tóm tắt đã có. Không LLM, không lưu.

    Vì nó được TÍNH nên nó không thể lệch: tóm tắt được tạo lại thì overview đổi
    theo ngay, không cần cột nào phải cập nhật cùng.

    Thứ tự ưu tiên: `key_points` của các section (đúng thứ hạng section) → nếu quá
    ít thì lùi về tiêu đề section → không có gì thì None. KHÔNG BAO GIỜ bịa.
    """
    if not isinstance(record, Mapping):
        return None
    sections = record.get("sections")
    if not isinstance(sections, list):
        return None

    def _thu_tu(s: Any) -> int:
        if isinstance(s, Mapping):
            try:
                return int(s.get("order", 0))
            except (TypeError, ValueError):
                return 0
        return 0

    xep = sorted([s for s in sections if isinstance(s, Mapping)], key=_thu_tu)

    diem: List[str] = []
    for s in xep:
        for p in s.get("key_points") or []:
            t = _chuoi(p)
            if t:
                diem.append(_cat(t, OVERVIEW_BULLET_MAX))
            if len(diem) >= OVERVIEW_BULLETS:
                return diem

    # Dưới hai gạch đầu dòng thì danh sách trông như hỏng chứ không như tóm lược —
    # tiêu đề section là lời tóm lược thật khác đang có sẵn, dùng nó thay vì
    # hiện một dòng lẻ loi.
    if len(diem) < 2:
        tieu_de = [_cat(_chuoi(s.get("title")), OVERVIEW_BULLET_MAX)
                   for s in xep if _chuoi(s.get("title"))]
        if len(tieu_de) >= 2:
            return tieu_de[:OVERVIEW_BULLETS]
    return diem or None


def summary_preview(record: Optional[Mapping[str, Any]]) -> Optional[str]:
    """`overview` của bản ghi, cắt ở máy chủ. Rỗng → None chứ không phải "" —
    client phân biệt "chưa có" với "có nhưng trống"."""
    if not isinstance(record, Mapping):
        return None
    return _cat(_chuoi(record.get("overview")), PREVIEW_MAX) or None


def entities(record: Optional[Mapping[str, Any]]) -> List[str]:
    """Thực thể đã được pipeline tóm tắt trích sẵn (đã chặn 20 ở schema). Miễn phí
    với ta, và là trường tìm kiếm chính xác nhất trên mỗi byte mà thư viện có."""
    if not isinstance(record, Mapping):
        return []
    out: List[str] = []
    seen: set = set()
    for e in record.get("entities") or []:
        t = _chuoi(e)
        khoa = t.lower()
        if t and khoa not in seen:
            seen.add(khoa)
            out.append(t)
        if len(out) >= ENTITIES_MAX:
            break
    return out


# ── Khớp bản ghi theo stem ──────────────────────────────────────────────────

def index_by_stem(records: Iterable[Mapping[str, Any]]) -> Dict[str, Mapping[str, Any]]:
    """{stem canonical: bản ghi mới nhất}. Cả `summary_store` lẫn `mindmap_store`
    đều đã chuẩn hoá `sources` về stem canonical khi ghi, nên đây chỉ là đảo chiều.

    `list_records` trả về mới-nhất-trước, nên bản ghi ĐẦU cho một stem là bản mới
    nhất; các bản sau không được ghi đè. Một bản ghi nhiều nguồn (tóm tắt gộp)
    được tính cho mọi nguồn của nó — đúng, vì tài liệu ấy thật sự đã có tóm tắt.
    """
    out: Dict[str, Mapping[str, Any]] = {}
    for rec in records or []:
        if not isinstance(rec, Mapping):
            continue
        for src in rec.get("sources") or []:
            stem = canonical_source_stem(str(src))
            if stem and stem not in out:
                out[stem] = rec
    return out


# ── Trạng thái AI ───────────────────────────────────────────────────────────

def _trang_thai_bo_nho_phu_du(record: Optional[Mapping[str, Any]]) -> str:
    """Kho phù du (SQLite trong DATA_DIR): CHỈ có READY hoặc NOT_GENERATED.

    Máy chủ không bao giờ trả GENERATING ở đây, kể cả khi có job tóm tắt đang chạy
    thật: bảng `jobs` không lưu nguồn của job nên không gắn được job với tài liệu.
    Client nâng cấp bằng `activeSummaryJob`/`activeMindmapJob` (đã lưu sẵn
    `sources`). Đoán "đang tạo" từ chỗ trống là đúng thứ lời nói dối mà quy tắc
    ba trạng thái sinh ra để chặn.
    """
    return READY if isinstance(record, Mapping) and record else NOT_GENERATED


def _trang_thai_studymap(status: Optional[str]) -> str:
    """StudyMap là hạng nhất: nằm ở Postgres, khoá theo `document_id`, và `status`
    có sẵn `processing` — nên đây là chỗ DUY NHẤT máy chủ được nói GENERATING."""
    s = _chuoi(status).lower()
    if s == "completed":
        return READY
    if s == "processing":
        return GENERATING
    return NOT_GENERATED


def trang_thai_ingest(row: Mapping[str, Any]) -> Dict[str, Any]:
    """Trích xuất / nhúng / chỉ mục / sẵn sàng hỏi đáp — tất cả từ `documents`,
    tất cả bền vững. Không thêm truy vấn nào.

    `chat_ready` CỐ Ý suy từ `capabilities` chứ không từ kho hội thoại: hỏi đáp
    sẵn sàng khi tài liệu đã vào chỉ mục, không phải khi đã từng có ai hỏi. Định
    nghĩa này còn tránh một lượt đọc kho phù du trên đường đi nóng.
    """
    caps = row.get("capabilities") or {}
    if not isinstance(caps, Mapping):
        caps = {}
    chunk_ready = bool(caps.get("chunk_query"))
    memory_ready = bool(caps.get("memory_query"))
    ingest = _chuoi(row.get("status")).lower()
    try:
        progress = float(row.get("progress") or 0.0)
    except (TypeError, ValueError):
        progress = 0.0

    hong = ingest == "error"
    dang_chay = ingest in ("processing", "index_ready")

    if chunk_ready or progress >= 0.3:
        extraction = READY
    elif hong:
        extraction = NOT_GENERATED
    else:
        extraction = GENERATING if dang_chay else NOT_GENERATED

    if chunk_ready:
        embedding = READY
    elif hong:
        embedding = NOT_GENERATED
    else:
        embedding = GENERATING if (dang_chay and progress >= 0.3) else NOT_GENERATED

    return {
        "extraction": extraction,
        "embedding": embedding,
        "index": READY if chunk_ready else NOT_GENERATED,
        "chat_ready": READY if (chunk_ready or memory_ready) else NOT_GENERATED,
        "progress": progress,
        "substatus": row.get("substatus"),
        "capabilities": {"chunk_query": chunk_ready, "memory_query": memory_ready},
        "failed": hong,
    }


# ── Trường thư viện của người dùng ──────────────────────────────────────────

def library_fields(row: Mapping[str, Any]) -> Dict[str, Any]:
    """Bảy cột người dùng, đọc thẳng. `display_name` NULL nghĩa là chưa đổi tên —
    client tự lùi về `title`, máy chủ KHÔNG lùi hộ: gộp hai giá trị ở đây thì
    không ai còn phân biệt được "đặt tên trùng tên file" với "chưa đặt tên"."""
    tags = row.get("tags")
    return {
        "display_name": row.get("display_name"),
        "favorite": bool(row.get("favorite")),
        "pinned": bool(row.get("pinned")),
        "archived_at": row.get("archived_at"),
        "tags": [t for t in tags if isinstance(t, str)] if isinstance(tags, list) else [],
        "last_opened_at": row.get("last_opened_at"),
        "last_workspace": row.get("last_workspace"),
    }


# ── Phép chiếu ──────────────────────────────────────────────────────────────

def chieu_tai_lieu(
    document_id: str,
    row: Mapping[str, Any],
    *,
    summary_record: Optional[Mapping[str, Any]] = None,
    mindmap_record: Optional[Mapping[str, Any]] = None,
    studymap_status: Optional[str] = None,
    quiz_count: int = 0,
    graded_attempt_count: int = 0,
    latest_quiz_id: Optional[str] = None,
    review_count: int = 0,
    latest_review_attempt_id: Optional[str] = None,
    language: Optional[str] = None,
) -> Dict[str, Any]:
    """Một tài liệu → một mục thư viện. Thuần: cùng đầu vào, cùng đầu ra."""
    ingest = trang_thai_ingest(row)

    doc: Dict[str, Any] = {
        "document_id": document_id,
        "title": row.get("filename"),
        "source_stem": row.get("source_stem"),
        "file_type": _chuoi(row.get("file_type")).lower() or None,
        # Giữ NGUYÊN hai tên trạng thái của `_doc_public`: `status` là tập theo đặc
        # tả, `ingest_status` là trạng thái pipeline. Frontend đang đọc đúng cặp này.
        "status": row.get("spec_status") or row.get("status"),
        "ingest_status": row.get("status"),
        "progress": ingest["progress"],
        "substatus": ingest["substatus"],
        "capabilities": ingest["capabilities"],
        "page_count": row.get("page_count"),
        "char_count": row.get("char_count"),
        "chunk_count": row.get("chunk_count"),
        "reading_minutes": reading_minutes(row.get("char_count")),
        "language": _chuoi(language).lower() or None,
        "created_at": row.get("created_at"),
        "error": row.get("error"),
    }
    doc.update(library_fields(row))

    doc["ai"] = {
        "extraction": ingest["extraction"],
        "embedding": ingest["embedding"],
        "index": ingest["index"],
        "chat_ready": ingest["chat_ready"],
        "summary": {
            "state": _trang_thai_bo_nho_phu_du(summary_record),
            "summary_id": (summary_record or {}).get("id") if summary_record else None,
            "created_at": (summary_record or {}).get("created_at") if summary_record else None,
            "preview": summary_preview(summary_record),
            "ai_overview": ai_overview(summary_record),
            "entities": entities(summary_record),
        },
        "mindmap": {
            "state": _trang_thai_bo_nho_phu_du(mindmap_record),
            "mindmap_id": (mindmap_record or {}).get("id") if mindmap_record else None,
        },
        "studymap": {"state": _trang_thai_studymap(studymap_status)},
        # `latest_*_id` là ĐÍCH RESUME, suy ra từ bảng đã có — không phải cột mới.
        # Thiếu nó thì nút "Tiếp tục" chỉ về được tới tài liệu, không về đúng bài.
        "quiz": {"ready": quiz_count > 0, "count": int(quiz_count),
                 "graded_attempts": int(graded_attempt_count),
                 "latest_quiz_id": latest_quiz_id},
        "review": {"ready": review_count > 0, "count": int(review_count),
                   "latest_attempt_id": latest_review_attempt_id},
    }
    return doc


def chieu_thu_vien(
    rows: Mapping[str, Mapping[str, Any]],
    *,
    summaries: Iterable[Mapping[str, Any]] = (),
    mindmaps: Iterable[Mapping[str, Any]] = (),
    studymap_status: Optional[Mapping[str, str]] = None,
    quiz_counts: Optional[Mapping[str, Mapping[str, int]]] = None,
    review_counts: Optional[Mapping[str, int]] = None,
    languages: Optional[Mapping[str, str]] = None,
) -> List[Dict[str, Any]]:
    """Toàn bộ thư viện. `rows` là {document_id: hàng} đã lọc quyền sở hữu ở lớp gọi.

    Khớp tóm tắt/sơ đồ theo stem (kho phù du khoá theo stem), khớp phần còn lại
    theo `document_id` (bảng Postgres khoá theo id). Đó là ranh giới giữa hai thế
    giới tài liệu, và nó nằm gọn trong đúng hàm này.
    """
    sum_theo_stem = index_by_stem(summaries)
    map_theo_stem = index_by_stem(mindmaps)
    sm = studymap_status or {}
    qc = quiz_counts or {}
    rc = review_counts or {}
    lang = languages or {}

    out: List[Dict[str, Any]] = []
    for did, row in (rows or {}).items():
        stem = canonical_source_stem(str(row.get("source_stem") or row.get("filename") or ""))
        q = qc.get(did) or {}
        r = rc.get(did) or {}
        out.append(chieu_tai_lieu(
            did, row,
            summary_record=sum_theo_stem.get(stem),
            mindmap_record=map_theo_stem.get(stem),
            studymap_status=sm.get(did),
            quiz_count=int(q.get("quizzes") or 0),
            graded_attempt_count=int(q.get("graded_attempts") or 0),
            latest_quiz_id=q.get("latest_quiz_id"),
            review_count=int(r.get("count") or 0),
            latest_review_attempt_id=r.get("latest_attempt_id"),
            language=lang.get(did),
        ))
    # Mới nhất trước — client sắp lại theo lựa chọn của người dùng, nhưng thứ tự
    # mặc định phải ổn định để danh sách không nhảy giữa hai lần tải.
    out.sort(key=lambda d: str(d.get("created_at") or ""), reverse=True)
    return out
