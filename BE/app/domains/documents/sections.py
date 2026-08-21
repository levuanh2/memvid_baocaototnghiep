"""Dựng cây `sections` từ heading của tài liệu (FR-03.3, FR-03.4).

`chunk_markdown_spans` đã trả `heading_path` dạng "Chương 1 > 1.1 Khái niệm" cho
mỗi chunk. Ở đây tách chuỗi đó thành cây cha–con và ánh xạ mỗi chunk về section
sâu nhất chứa nó.

Tài liệu không có heading rõ → MỘT section mặc định (đặc tả 3.3.7).

Vì sao không tái dùng `memory.tree._simple_section_group`: hàm đó chia section
theo KÍCH THƯỚC với tiêu đề vị trí ("Section 1", "Section 2"). Review guide phải
nói được "ôn lại mục 2.3 Quy tắc hàm hợp" — tiêu đề vị trí làm gợi ý ôn tập vô
nghĩa. Heading thật > nhóm theo kích thước; không có heading thì một section
mặc định trung thực hơn là bịa ra sáu cái tên rỗng.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

HEADING_SEP = " > "
DEFAULT_SECTION_TITLE = "Toàn văn"


def build_sections(headings: List[str]) -> Tuple[List[Dict[str, Any]], List[Optional[str]]]:
    """headings[i] = heading_path của chunk i ('' nếu không có).

    Trả (sections, chunk_section_keys):
      - sections: list dict {key, title, level, order_index, parent_key} — cha
        LUÔN đứng trước con để `repository.replace_sections` resolve được FK.
      - chunk_section_keys[i]: key section của chunk i (None nếu không có section).
    """
    sections: List[Dict[str, Any]] = []
    by_path: Dict[str, str] = {}          # heading path đầy đủ → key
    chunk_keys: List[Optional[str]] = []

    has_heading = any((h or "").strip() for h in headings)
    if not has_heading:
        if not headings:
            return [], []
        key = "s0"
        sections.append({
            "key": key, "title": DEFAULT_SECTION_TITLE,
            "level": 1, "order_index": 0, "parent_key": None,
        })
        return sections, [key for _ in headings]

    for raw in headings:
        path = (raw or "").strip()
        if not path:
            chunk_keys.append(None)
            continue

        parts = [p.strip() for p in path.split(HEADING_SEP) if p.strip()]
        if not parts:
            chunk_keys.append(None)
            continue

        parent_key: Optional[str] = None
        full = ""
        for level, part in enumerate(parts, start=1):
            full = full + HEADING_SEP + part if full else part
            key = by_path.get(full)
            if key is None:
                key = f"s{len(sections)}"
                by_path[full] = key
                sections.append({
                    "key": key,
                    "title": part,
                    "level": level,
                    "order_index": len(sections),
                    "parent_key": parent_key,
                })
            parent_key = key
        chunk_keys.append(parent_key)

    return sections, chunk_keys


def demo() -> None:
    """Self-check: chạy `python -m app.domains.documents.sections`."""
    secs, keys = build_sections([
        "Chương 1 > 1.1 Khái niệm",
        "Chương 1 > 1.1 Khái niệm",
        "Chương 1 > 1.2 Ví dụ",
        "Chương 2",
    ])
    titles = [s["title"] for s in secs]
    assert titles == ["Chương 1", "1.1 Khái niệm", "1.2 Ví dụ", "Chương 2"], titles
    assert [s["level"] for s in secs] == [1, 2, 2, 1]
    # con trỏ đúng cha, cha đứng trước con
    by_key = {s["key"]: s for s in secs}
    assert by_key[keys[0]]["title"] == "1.1 Khái niệm"
    assert by_key[keys[0]]["parent_key"] == secs[0]["key"]
    assert keys[0] == keys[1], "cùng heading → cùng section"
    assert by_key[keys[3]]["parent_key"] is None
    for s in secs:
        if s["parent_key"]:
            assert s["order_index"] > by_key[s["parent_key"]]["order_index"]

    # không heading → một section mặc định
    secs2, keys2 = build_sections(["", "", ""])
    assert len(secs2) == 1 and secs2[0]["title"] == DEFAULT_SECTION_TITLE
    assert keys2 == [secs2[0]["key"]] * 3

    # heading lẫn lộn: chunk không heading → không gắn section
    secs3, keys3 = build_sections(["A", "", "A > B"])
    assert keys3[1] is None
    assert len(secs3) == 2 and [s["title"] for s in secs3] == ["A", "B"]

    assert build_sections([]) == ([], [])
    print("sections demo OK")


if __name__ == "__main__":
    demo()
