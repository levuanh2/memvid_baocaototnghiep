"""Lớp tri thức giữ các suy luận học tập nhất quán và có thể giải thích được.

Mọi dữ liệu vào đây đã được lớp gọi lấy sẵn.  Giữ phép chiếu thuần giúp cùng một
tài liệu luôn có cùng phần tri thức, đồng thời những quy tắc như điểm sẵn sàng
và dòng thời gian được kiểm thử mà không cần database hay dịch vụ bên ngoài.
"""

from __future__ import annotations

from datetime import datetime, timezone
import unicodedata
from typing import Any, Iterable, Mapping

from .thu_vien import GENERATING, NOT_GENERATED, READY, _cat, _chuoi


ARTIFACTS = ("summary", "mindmap", "studymap", "quiz", "review", "index")
EVENTS = (
    "uploaded", "summary", "mindmap", "studymap", "quiz_created",
    "quiz_attempted", "quiz_graded", "review_created", "last_opened", "last_chat",
)


def _khoa(text: Any) -> str:
    """Khoá so sánh tên: tiếng Việt không phân biệt hoa/thường hay dấu."""
    value = _chuoi(text).casefold().replace("đ", "d")
    value = unicodedata.normalize("NFD", value)
    return "".join(char for char in value if not unicodedata.combining(char))


def _diem(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _danh_sach(values: Iterable[Any] | None) -> tuple[Any, ...]:
    return tuple(values or ())


def key_takeaways(summary_record, *, gioi_han=7) -> list[str] | None:
    """Lấy các ý chính có thật, thay vì bịa phần tóm tắt khi dữ liệu còn trống."""
    if not isinstance(summary_record, Mapping):
        return None
    sections = summary_record.get("sections")
    if not isinstance(sections, list):
        return None

    def thu_tu(section: Any) -> int:
        try:
            return int(section.get("order", 0)) if isinstance(section, Mapping) else 0
        except (TypeError, ValueError):
            return 0

    out: list[str] = []
    for section in sorted((s for s in sections if isinstance(s, Mapping)), key=thu_tu):
        points = section.get("key_points")
        if not isinstance(points, list):
            continue
        for point in points:
            text = _chuoi(point)
            if text:
                out.append(_cat(text, 120))
            if len(out) >= max(0, int(gioi_han)):
                return out
    return out or None


def topics(*, masteries=(), quiz_concept_tags=(), review_topics=(),
           studymap_node_titles=()) -> list[dict]:
    """Gộp bốn dấu vết độc lập để một chủ đề không phụ thuộc một pipeline đơn lẻ."""
    out: dict[str, dict] = {}

    def them(value: Any, source: str, mastery: Any = None, status: Any = None) -> None:
        name = _chuoi(value)
        key = _khoa(name)
        if not key:
            return
        item = out.setdefault(key, {
            "name": name, "sources": [], "weight": 0, "mastery": None, "status": None,
        })
        if source not in item["sources"]:
            item["sources"].append(source)
            item["weight"] = len(item["sources"])
        if source == "mastery" and item["mastery"] is None:
            item["mastery"] = _diem(mastery)
            item["status"] = _chuoi(status) or None

    for row in _danh_sach(masteries):
        if isinstance(row, Mapping):
            them(row.get("name"), "mastery", row.get("mastery_score"), row.get("status"))
    for value in _danh_sach(quiz_concept_tags):
        them(value, "quiz")
    for value in _danh_sach(review_topics):
        them(value, "review")
    for value in _danh_sach(studymap_node_titles):
        them(value, "studymap")

    def sap_xep(item: dict) -> tuple:
        mastery = item["mastery"]
        return (-item["weight"], mastery is None, mastery if mastery is not None else 0.0,
                _khoa(item["name"]))

    return sorted(out.values(), key=sap_xep)[:12]


def keywords(*, topic_list=(), entity_list=(), tag_list=(), gioi_han=20) -> list[str]:
    """Một từ khoá chỉ hiện một lần, theo thứ tự tín hiệu đáng tin nhất."""
    out: list[str] = []
    seen: set[str] = set()
    for values in (topic_list, entity_list, tag_list):
        for value in _danh_sach(values):
            text = _chuoi(value)
            key = _khoa(text)
            if text and key not in seen:
                seen.add(key)
                out.append(text)
            if len(out) >= max(0, int(gioi_han)):
                return out
    return out


def _san_sang(ai_block: Any, artifact: str) -> bool:
    if not isinstance(ai_block, Mapping):
        return False
    value = ai_block.get(artifact)
    if artifact in ("quiz", "review"):
        return bool(value.get("ready")) if isinstance(value, Mapping) else False
    if artifact == "index":
        return value == READY
    return value.get("state") == READY if isinstance(value, Mapping) else False


def _mastery_values(masteries: Iterable[Any] | None) -> tuple[float, ...]:
    values: list[float] = []
    for row in _danh_sach(masteries):
        if isinstance(row, Mapping):
            score = _diem(row.get("mastery_score"))
            if score is not None:
                values.append(score)
    return tuple(values)


def diem_san_sang(*, ai_block, open_count=0, recency_score=0.0, masteries=()) -> dict:
    """Điểm sẵn sàng nói về dữ liệu và tiến độ, không tự nhận là hiểu biết của người học."""
    mastery_rows = _danh_sach(masteries)
    scores = _mastery_values(mastery_rows)
    mastery = sum(scores) / len(scores) if scores else 0.0
    try:
        opens = max(0, int(open_count or 0))
    except (TypeError, ValueError):
        opens = 0
    try:
        recency = min(1.0, max(0.0, float(recency_score or 0.0)))
    except (TypeError, ValueError):
        recency = 0.0
    pipeline = sum(_san_sang(ai_block, artifact) for artifact in ARTIFACTS) / len(ARTIFACTS)
    engagement = 0.5 * min(opens, 10) / 10 + 0.5 * recency
    missing = [artifact for artifact in ARTIFACTS if not _san_sang(ai_block, artifact)]
    return {
        "total": round(100 * (0.4 * pipeline + 0.3 * engagement + 0.3 * mastery)),
        "pipeline": round(100 * pipeline),
        "engagement": round(100 * engagement),
        "mastery": round(100 * mastery),
        "mastery_available": bool(mastery_rows),
        "missing": missing,
    }


def trang_thai_hoc(*, ai_block, last_opened_at=None, graded_attempts=0, masteries=()) -> str:
    """Trạng thái ưu tiên bằng chứng học thật trước các dấu vết thao tác yếu hơn."""
    scores = _mastery_values(masteries)
    if scores and sum(scores) / len(scores) >= 0.8:
        return "mastered"
    try:
        if int(graded_attempts or 0) > 0:
            return "in_progress"
    except (TypeError, ValueError):
        pass
    if last_opened_at:
        return "explored"
    if isinstance(ai_block, Mapping) and ai_block.get("index") == READY:
        return "indexed"
    return "untouched"


def _moc_hop_le(moc: Mapping[str, Any] | None) -> list[tuple[float, str, Any]]:
    if not isinstance(moc, Mapping):
        return []
    out: list[tuple[float, str, Any]] = []
    for event in EVENTS:
        value = moc.get(event)
        if not isinstance(value, str) or not value.strip():
            continue
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            out.append((parsed.timestamp(), event, value))
        except (TypeError, ValueError, OverflowError):
            continue
    return out


def dong_thoi_gian(*, moc: dict) -> list[dict]:
    """Chỉ hiển thị mốc có thời gian thật để timeline không kể một lịch sử bịa."""
    return [{"event": event, "at": value}
            for _, event, value in sorted(_moc_hop_le(moc), key=lambda item: item[0])]


def hoat_dong_gan_day(*, moc: dict, gioi_han=5) -> list[dict]:
    """Cùng mốc thật, nhưng đảo chiều cho phần việc vừa diễn ra."""
    return [{"event": event, "at": value}
            for _, event, value in sorted(_moc_hop_le(moc), key=lambda item: item[0], reverse=True)
            [:max(0, int(gioi_han))]]


def chieu_tri_thuc(*, ai_block, summary_record=None, entity_list=(), tag_list=(),
                   masteries=(), quiz_concept_tags=(), review_topics=(),
                   studymap_node_titles=(), moc=None, open_count=0,
                   recency_score=0.0, last_opened_at=None, graded_attempts=0) -> dict:
    """Ghép các dữ kiện có sẵn thành một khối tri thức độc lập với đường lấy dữ liệu."""
    topic_list = topics(
        masteries=masteries, quiz_concept_tags=quiz_concept_tags,
        review_topics=review_topics, studymap_node_titles=studymap_node_titles,
    )
    topic_names = [topic["name"] for topic in topic_list]
    entity_values = keywords(entity_list=entity_list, gioi_han=20)
    moc = moc or {}
    return {
        "takeaways": key_takeaways(summary_record),
        "topics": topic_list,
        "entities": entity_values,
        "keywords": keywords(topic_list=topic_names, entity_list=entity_values, tag_list=tag_list),
        "suggested_questions": None,
        "related": None,
        "readiness": diem_san_sang(
            ai_block=ai_block, open_count=open_count, recency_score=recency_score,
            masteries=masteries,
        ),
        "learning_status": trang_thai_hoc(
            ai_block=ai_block, last_opened_at=last_opened_at,
            graded_attempts=graded_attempts, masteries=masteries,
        ),
        "timeline": dong_thoi_gian(moc=moc),
        "recent_ai": hoat_dong_gan_day(moc=moc),
    }
