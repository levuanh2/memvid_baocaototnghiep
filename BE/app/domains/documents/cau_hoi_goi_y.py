"""Câu hỏi gợi ý Tier-0 phải luôn giải thích được từ dữ liệu đã có.

Module này không đoán chủ đề mới và không gọi mô hình: mỗi câu hỏi chỉ là một khung
cố định đi cùng nguồn dữ liệu cụ thể.  Confidence là tín hiệu của chính nguồn đó:
topic dùng số pipeline thấy nó, entity dùng vị trí trong danh sách đầu vào, section
dùng việc có tóm tắt, và QuizMe dùng mức mastery.  Tier-1 sau này có thể viết lại
`text`, nhưng phải giữ nguyên mọi trường định danh và bằng chứng của Tier-0.
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Mapping

from .tri_thuc import _chuoi, _khoa


DANH_MUC = (
    "Explain", "Definitions", "Summarize", "QuizMe", "Compare", "Timeline",
    "Architecture", "Implementation", "ProsCons",
)
DAU_MOC_THOI_GIAN = ("bước", "giai đoạn", "quy trình", "chương", "phần", "step", "phase")
_DAU_DE = re.compile(r"^\s*(?:\d+|[ivxlcdm]+)\b", re.IGNORECASE)


def _danh_sach(values: Iterable[Any] | None) -> tuple[Any, ...]:
    return tuple(values or ())


def _so(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _chuan(value: float) -> float:
    return round(min(1.0, max(0.0, value)), 2)


def _slug(category: str, subject: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", _khoa(subject)).strip("-") or "unknown"
    return f"{category.lower()}-{text}"


def _topics(values: Iterable[Any] | None) -> list[dict]:
    out: list[dict] = []
    for item in _danh_sach(values):
        if not isinstance(item, Mapping):
            continue
        name = _chuoi(item.get("name"))
        if not name:
            continue
        mastery = item.get("mastery")
        mastery_value = _so(mastery) if mastery is not None else None
        out.append({
            "name": name,
            "weight": max(0, int(_so(item.get("weight")))),
            "mastery": mastery_value,
            "status": _chuoi(item.get("status")) or None,
        })
    return out


def _entities(values: Iterable[Any] | None) -> list[str]:
    return [text for text in (_chuoi(value) for value in _danh_sach(values)) if text]


def _sections(values: Iterable[Any] | None) -> list[dict]:
    out: list[dict] = []
    for item in _danh_sach(values):
        if not isinstance(item, Mapping):
            continue
        title = _chuoi(item.get("title"))
        if not title:
            continue
        out.append({
            "title": title,
            "order": _so(item.get("order_index")),
            "summary": _chuoi(item.get("summary")),
        })
    return sorted(out, key=lambda item: (item["order"], _khoa(item["title"])))


def _la_moc_thoi_gian(title: str) -> bool:
    normal = _khoa(title)
    return bool(_DAU_DE.match(normal) or any(_khoa(marker) in normal for marker in DAU_MOC_THOI_GIAN))


def _confidence_topic(topic: Mapping[str, Any]) -> float:
    return _chuan(_so(topic.get("weight")) / 4.0)


def _confidence_entity(index: int, total: int) -> float:
    return _chuan(0.7 - 0.3 * (index / max(1, total - 1)))


def _candidate(category: str, subject: str, text: str, target: str, reason_source: str,
               reason_value: str, confidence: float, *, weak: bool = False,
               weight: int = 0, entity_index: int = 9999, section_order: float = 9999,
               recent_rank: int = 9999) -> dict:
    return {
        "id": _slug(category, subject),
        "category": category,
        "text": text,
        "target": target,
        "reason": {"source": reason_source, "value": reason_value},
        "confidence": _chuan(confidence),
        "_rank": (not weak, -weight, entity_index, section_order, recent_rank),
    }


def _ung_vien(*, topic_list=(), entity_list=(), section_list=(), relation_types=(),
              recent_ai=()) -> list[dict]:
    topics = _topics(topic_list)
    entities = _entities(entity_list)
    sections = _sections(section_list)
    relations = tuple(sorted({_chuoi(value) for value in _danh_sach(relation_types) if _chuoi(value)}))
    # `recent_ai` is supplied for the shared ranking vocabulary.  Tier-0 has no frame
    # whose factual subject is an event, so it cannot honestly manufacture one from it.
    _ = _danh_sach(recent_ai)
    out: list[dict] = []

    for topic in topics:
        name, weight = topic["name"], topic["weight"]
        weak = topic["status"] == "weak" or (topic["mastery"] is not None and topic["mastery"] < 0.5)
        out.append(_candidate("Explain", name, f"Giải thích {name}", "chat", "topic", name,
                              _confidence_topic(topic), weak=weak, weight=weight))
        if weak:
            confidence = 1.0 - topic["mastery"] if topic["mastery"] is not None else 0.6
            out.append(_candidate("QuizMe", name, f"Kiểm tra tôi về {name}", "quiz",
                                  "weak_mastery", name, confidence, weak=True, weight=weight))
        if relations:
            out.append(_candidate("Architecture", name,
                                  f"{name} liên hệ với phần còn lại thế nào?", "studymap",
                                  "relation", ", ".join(relations), _confidence_topic(topic),
                                  weak=weak, weight=weight))
        if "contrasts" in relations:
            out.append(_candidate("ProsCons", name, f"Ưu và nhược điểm của {name}?", "chat",
                                  "relation", "contrasts", _confidence_topic(topic),
                                  weak=weak, weight=weight))

    for index, entity in enumerate(entities):
        confidence = _confidence_entity(index, len(entities))
        out.append(_candidate("Definitions", entity, f"{entity} là gì?", "chat", "entity", entity,
                              confidence, entity_index=index))
        out.append(_candidate("Implementation", entity, f"{entity} hoạt động thế nào?", "chat",
                              "entity", entity, confidence, entity_index=index))

    if len(entities) >= 2:
        first, second = entities[:2]
        confidence = (_confidence_entity(0, len(entities)) + _confidence_entity(1, len(entities))) / 2
        out.append(_candidate("Compare", f"{first}-{second}", f"So sánh {first} và {second}", "chat",
                              "entity", f"{first} | {second}", confidence, entity_index=0))
    elif len(topics) >= 2:
        first, second = topics[:2]
        confidence = (_confidence_topic(first) + _confidence_topic(second)) / 2
        out.append(_candidate("Compare", f"{first['name']}-{second['name']}",
                              f"So sánh {first['name']} và {second['name']}", "chat", "topic",
                              f"{first['name']} | {second['name']}", confidence,
                              weight=max(first["weight"], second["weight"])))

    for section in sections:
        title, has_summary = section["title"], bool(section["summary"])
        out.append(_candidate("Summarize", title, f"Tóm tắt {title}", "chat", "section", title,
                              0.8 if has_summary else 0.6, section_order=section["order"]))
        if _la_moc_thoi_gian(title):
            out.append(_candidate("Timeline", title, f"Trình tự các bước trong {title}?", "chat",
                                  "section", title, 0.7 if has_summary else 0.5,
                                  section_order=section["order"]))
    return out


def _chon_rong(ung_vien: list[dict], gioi_han: int = 6) -> list[dict]:
    """Chọn vòng tròn theo category: vòng đầu trải rộng nguồn học, vòng sau mới lấp đầy."""
    # Input thường đã khử trùng, nhưng payload cũ có thể lặp entity/section.  Một id
    # chỉ đại diện một câu hỏi; giữ ứng viên có rank tốt hơn để hợp đồng unique vẫn đúng.
    unique: dict[str, dict] = {}
    for item in ung_vien:
        previous = unique.get(item["id"])
        if previous is None or (*item["_rank"], item["id"]) < (*previous["_rank"], previous["id"]):
            unique[item["id"]] = item
    ranked = sorted(unique.values(), key=lambda item: (*item["_rank"], item["id"]))
    groups: dict[str, list[dict]] = {}
    for item in ranked:
        groups.setdefault(item["category"], []).append(item)
    category_order = sorted(groups, key=lambda category: (*groups[category][0]["_rank"],
                                                           groups[category][0]["id"]))
    selected: list[dict] = []
    index = 0
    while len(selected) < gioi_han:
        added = False
        for category in category_order:
            if index < len(groups[category]) and len(selected) < gioi_han:
                selected.append(groups[category][index])
                added = True
        if not added:
            break
        index += 1
    return [{key: value for key, value in item.items() if key != "_rank"} for item in selected]


def sinh_cau_hoi(*, topic_list=(), entity_list=(), section_list=(), relation_types=(),
                 recent_ai=(), viet_lai=None) -> list[dict]:
    """Trả Tier-0; Tier-1 sau này được tiêm để chỉ viết lại `text`, không đổi metadata.

    `viet_lai` hiện là seam có chủ ý và không được gọi trong 1C.2a: output phải hoàn
    toàn xác định, không phụ thuộc model hay thời điểm chạy.
    """
    _ = viet_lai
    return _chon_rong(_ung_vien(
        topic_list=topic_list, entity_list=entity_list, section_list=section_list,
        relation_types=relation_types, recent_ai=recent_ai,
    ))
