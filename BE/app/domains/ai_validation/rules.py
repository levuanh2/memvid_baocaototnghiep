"""Luật kiểm chất lượng câu hỏi do AI sinh (FR-13).

Thuần: vào là JSON đã parse, ra là (câu hợp lệ, danh sách bị loại). Không DB, không LLM
— chạy được bằng `python -m app.domains.ai_validation.rules`.

Mỗi lần loại đều mang `rule_code` khớp mã trong SRS và **nguyên văn item bị loại**
(FR-13.11): log không có item thì không truy được vì sao câu đó bị bỏ.

Nguyên tắc: câu hỏi chỉ bị loại khi thiếu thứ khiến nó **vô dụng cho người học** hoặc
**không kiểm chứng được từ tài liệu**. Trường trang trí (độ khó ghi sai chính tả) thì
chuẩn hoá, không loại — loại thì người dùng mất câu hỏi vốn dùng được.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from shared.text_norm import norm_text as _norm

# Mã quy tắc — khớp SRS 4.13.
RULE_JSON = "FR-13.1"            # output không parse được / cấu trúc câu hỏi sai
RULE_CORRECT_ANSWER = "FR-13.2"  # thiếu hoặc sai đáp án đúng
RULE_EXPLANATION = "FR-13.3"     # thiếu explanation
RULE_CONCEPT_TAGS = "FR-13.4"    # thiếu concept_tags
RULE_CHUNK_REFS = "FR-13.5"      # thiếu chunk_refs
RULE_NO_SOURCE = "FR-13.6"       # chunk_refs không trỏ vào chunk nào của tài liệu
RULE_DUPLICATE = "FR-13.7"       # trùng câu đã có
RULE_REVIEW_SCOPE = "FR-13.9"    # review item gợi ý ngoài phạm vi câu sai (Phase 6)

# Hai lựa chọn giống nhau tới mức này thì câu hỏi không còn phân biệt được bằng HIỂU.
#
# Đo 2026-09-02 trên 8 câu multiple_choice thật trong DB — max Jaccard (tập token, đã
# `norm_text`) giữa các cặp lựa chọn:
#     dùng được : 0.467 · 0.700 · 0.722
#     hỏng      : 0.864 · 0.900 · 0.905 · 1.000 · 1.000
# Khoảng trống thật nằm giữa 0.722 và 0.864, nên ngưỡng đặt 0.80. KHÔNG phải con số đẹp
# chọn bừa: 0.72 (dự đoán ban đầu) sẽ loại nhầm câu "…dữ liệu nội bộ / creative writing /
# citation" vốn phân biệt được rõ ở phần đuôi.
#
# TRẦN ĐÃ BIẾT — đây là phép đo CHỮ, không phải nghĩa. Ca hỏng thật ở attempt 01597551 là
# ba "đáp án nhiễu" ĐỀU MÔ TẢ ĐÚNG về RAG; chúng bị bắt vì tình cờ cũng giống nhau về chữ.
# Một bộ nhiễu diễn đạt khác hẳn nhưng cùng đúng thì luật này KHÔNG bắt được. Muốn bắt
# phải kiểm bằng nghĩa (NLI/embedding), đắt hơn nhiều — chưa làm.
NGUONG_LUA_CHON_GIONG = 0.80

QUESTION_TYPES = ("multiple_choice", "true_false", "short_answer")
DIFFICULTIES = ("easy", "medium", "hard")
DEFAULT_DIFFICULTY = "medium"

_TRUE_WORDS = {"true", "dung", "đúng", "t", "yes", "co", "có"}
_FALSE_WORDS = {"false", "sai", "f", "no", "khong", "không"}


def _reject(rule_code: str, message: str, item: Any, index: int) -> Dict[str, Any]:
    return {
        "rule_code": rule_code,
        "severity": "rejected",
        "message": message,
        "target_type": "quiz_question",
        "target_ref": str(index),
        "payload": {"index": index, "item": item},
    }


def _giong_nhau(a: str, b: str) -> float:
    """Jaccard trên tập token đã chuẩn hoá. 1.0 = cùng bộ từ, 0.0 = không chung từ nào."""
    ta, tb = set(_norm(a).split()), set(_norm(b).split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _as_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return [str(v).strip() for v in value if str(v or "").strip()]
    text = str(value).strip()
    return [text] if text else []


def validate_questions(
    raw_questions: Sequence[Any],
    *,
    allowed_chunk_refs: Iterable[str],
    allowed_section_ids: Iterable[str] = (),
    allowed_types: Iterable[str] = QUESTION_TYPES,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """(câu hợp lệ đã chuẩn hoá, danh sách bị loại).

    `allowed_chunk_refs`: nhãn chunk đã đưa cho model (vd `c0`, `c1`) — câu nào trích
    nhãn không có trong đó là AI bịa nguồn.
    """
    allowed_refs = {str(r) for r in allowed_chunk_refs}
    allowed_sections = {str(s) for s in allowed_section_ids}
    allowed_types = tuple(allowed_types) or QUESTION_TYPES

    accepted: List[Dict[str, Any]] = []
    rejected: List[Dict[str, Any]] = []
    seen: set = set()

    for index, raw in enumerate(raw_questions or []):
        if not isinstance(raw, dict):
            rejected.append(_reject(RULE_JSON, "Item không phải object JSON.", raw, index))
            continue

        text = str(raw.get("question_text") or "").strip()
        if not text:
            rejected.append(_reject(RULE_JSON, "Thiếu question_text.", raw, index))
            continue

        qtype = str(raw.get("question_type") or "").strip().lower()
        if qtype not in allowed_types:
            rejected.append(_reject(
                RULE_JSON, f"question_type '{qtype}' không nằm trong dạng đã yêu cầu.", raw, index))
            continue

        options = _as_list(raw.get("options"))
        answer = str(raw.get("correct_answer") or "").strip()
        if not answer:
            rejected.append(_reject(RULE_CORRECT_ANSWER, "Thiếu correct_answer.", raw, index))
            continue

        if qtype == "multiple_choice":
            # Gộp lựa chọn trùng TRƯỚC khi đếm: model yếu hay trả "C" hai lần, và hai
            # lựa chọn giống hệt nhau thì câu hỏi không chấm công bằng được. Gộp chứ
            # không loại cả câu — ba lựa chọn phân biệt vẫn là câu dùng được.
            deduped: List[str] = []
            for o in options:
                if not any(_norm(o) == _norm(k) for k in deduped):
                    deduped.append(o)
            options = deduped
            if len(options) < 2:
                rejected.append(_reject(
                    RULE_JSON, "multiple_choice cần ít nhất 2 lựa chọn phân biệt.",
                    raw, index))
                continue
            # Trùng KHÍT đã gộp ở trên; còn lại là cặp GẦN trùng. Người học không phân
            # biệt được bằng hiểu thì điểm số thu về không nói lên điều gì — thà loại câu.
            gan_trung = [
                (options[i], options[j])
                for i in range(len(options)) for j in range(i + 1, len(options))
                if _giong_nhau(options[i], options[j]) >= NGUONG_LUA_CHON_GIONG
            ]
            if gan_trung:
                rejected.append(_reject(
                    RULE_JSON,
                    f"Các lựa chọn gần như trùng nhau ({len(gan_trung)} cặp) — câu hỏi "
                    "không phân biệt được bằng hiểu.", raw, index))
                continue
            # Đáp án phải NẰM TRONG lựa chọn, nếu không câu hỏi không chấm được.
            match = next((o for o in options if _norm(o) == _norm(answer)), None)
            if match is None:
                rejected.append(_reject(
                    RULE_CORRECT_ANSWER, "correct_answer không khớp lựa chọn nào.", raw, index))
                continue
            answer = match
        elif qtype == "true_false":
            key = _norm(answer)
            if key in _TRUE_WORDS:
                answer = "true"
            elif key in _FALSE_WORDS:
                answer = "false"
            else:
                rejected.append(_reject(
                    RULE_CORRECT_ANSWER, "true_false cần đáp án đúng/sai.", raw, index))
                continue
            options = ["true", "false"]
        else:
            options = []

        explanation = str(raw.get("explanation") or "").strip()
        if not explanation:
            rejected.append(_reject(RULE_EXPLANATION, "Thiếu explanation.", raw, index))
            continue

        tags = _as_list(raw.get("concept_tags"))
        if not tags:
            rejected.append(_reject(RULE_CONCEPT_TAGS, "Thiếu concept_tags.", raw, index))
            continue

        refs = _as_list(raw.get("chunk_refs"))
        if not refs:
            rejected.append(_reject(RULE_CHUNK_REFS, "Thiếu chunk_refs.", raw, index))
            continue

        kept_refs = [r for r in refs if r in allowed_refs]
        if not kept_refs:
            rejected.append(_reject(
                RULE_NO_SOURCE,
                "chunk_refs không trỏ vào chunk nào của tài liệu (FR-06.11).", raw, index))
            continue

        key = _norm(text)
        if key in seen:
            rejected.append(_reject(RULE_DUPLICATE, "Trùng câu hỏi đã nhận.", raw, index))
            continue
        seen.add(key)

        difficulty = str(raw.get("difficulty") or "").strip().lower()
        if difficulty not in DIFFICULTIES:
            difficulty = DEFAULT_DIFFICULTY  # trường trang trí: chuẩn hoá, không loại

        section_id = str(raw.get("section_id") or "").strip() or None
        if section_id and allowed_sections and section_id not in allowed_sections:
            section_id = None  # id lạ → bỏ liên kết, đừng để FK nổ khi insert

        accepted.append({
            "question_text": text,
            "question_type": qtype,
            "options": options,
            "correct_answer": answer,
            "explanation": explanation,
            "concept_tags": tags,
            "chunk_refs": kept_refs,
            "difficulty": difficulty,
            "section_id": section_id,
        })

    return accepted, rejected


def json_failure(message: str, raw_excerpt: Optional[str] = None) -> Dict[str, Any]:
    """Bản ghi loại cho cả lượt sinh khi output không parse được (FR-13.1 + FR-13.8)."""
    return {
        "rule_code": RULE_JSON,
        "severity": "rejected",
        "message": message,
        "target_type": "quiz_question",
        "target_ref": None,
        "payload": {"raw_excerpt": (raw_excerpt or "")[:2000]},
    }


def demo() -> None:
    """Self-check: `python -m app.domains.ai_validation.rules`."""
    base = {
        "question_text": "Dao ham cua x^2 la gi?",
        "question_type": "multiple_choice",
        "options": ["2x", "x", "x^2", "1"],
        "correct_answer": "2x",
        "explanation": "Quy tac luy thua.",
        "concept_tags": ["dao ham"],
        "chunk_refs": ["c1"],
        "difficulty": "easy",
    }
    ok, bad = validate_questions([base], allowed_chunk_refs=["c1", "c2"])
    assert len(ok) == 1 and not bad
    assert ok[0]["correct_answer"] == "2x"

    def without(**kw):
        return {**base, **kw}

    cases = [
        (without(correct_answer=""), RULE_CORRECT_ANSWER),
        (without(correct_answer="9x"), RULE_CORRECT_ANSWER),   # không khớp lựa chọn
        (without(explanation="  "), RULE_EXPLANATION),
        (without(concept_tags=[]), RULE_CONCEPT_TAGS),
        (without(chunk_refs=[]), RULE_CHUNK_REFS),
        (without(chunk_refs=["c99"]), RULE_NO_SOURCE),         # nguồn bịa
        (without(question_text=""), RULE_JSON),
        (without(question_type="essay"), RULE_JSON),
        (without(options=["2x"]), RULE_JSON),                  # MC 1 lựa chọn
    ]
    for item, code in cases:
        ok, bad = validate_questions([item], allowed_chunk_refs=["c1", "c2"])
        assert not ok and len(bad) == 1 and bad[0]["rule_code"] == code, (code, bad)
        assert bad[0]["payload"]["item"] == item, "FR-13.11: log phải giữ nguyên item"

    # lựa chọn GẦN trùng: đo trên dữ liệu thật (attempt 01597551) — ba nhiễu đều là
    # cách diễn đạt khác của đáp án đúng
    ok, bad = validate_questions([{**base, "options": [
        "Retrieval-Augmented Generation la ky thuat ket hop truy xuat thong tin",
        "RAG la mot ky thuat su dung LLM de tra loi cau hoi dua tren du lieu noi bo",
        "RAG la mot ky thuat su dung LLM de tra loi cau hoi dua tren du lieu internet",
        "RAG la mot ky thuat su dung LLM de tra loi cau hoi dua tren du lieu kho",
    ], "correct_answer": "Retrieval-Augmented Generation la ky thuat ket hop truy xuat thong tin"}],
        allowed_chunk_refs=["c1"])
    assert not ok and "gan nhu trung" in _norm(bad[0]["message"]), bad[0]["message"]

    # khuc dau giong nhung duoi khac han thi GIU (khong loai nham de tot)
    ok, bad = validate_questions([{**base, "options": [
        "RAG giup giai quyet van de lien quan den kien thuc chung khong can citation",
        "RAG giup giai quyet van de lien quan den du lieu noi bo co tinh thay doi",
        "RAG giup giai quyet van de lien quan den task creative writing brainstorm",
        "RAG giup giai quyet van de lien quan den task co yeu cau citation",
    ], "correct_answer": "RAG giup giai quyet van de lien quan den du lieu noi bo co tinh thay doi"}],
        allowed_chunk_refs=["c1"])
    assert ok and not bad, "de tot bi loai nham"

    # trùng câu: chỉ khác dấu/hoa thường vẫn là trùng
    ok, bad = validate_questions(
        [base, {**base, "question_text": "DAO HAM CUA X^2 LA GI?"}],
        allowed_chunk_refs=["c1"])
    assert len(ok) == 1 and bad[0]["rule_code"] == RULE_DUPLICATE

    # true_false chuẩn hoá; độ khó lạ thì chuẩn hoá chứ không loại
    ok, bad = validate_questions([{
        "question_text": "Dao ham cua hang so bang 0?",
        "question_type": "true_false", "correct_answer": "Đúng",
        "explanation": "Hang so khong doi.", "concept_tags": ["dao ham"],
        "chunk_refs": ["c1", "c99"], "difficulty": "sieu kho",
    }], allowed_chunk_refs=["c1"])
    assert not bad and ok[0]["correct_answer"] == "true"
    assert ok[0]["difficulty"] == DEFAULT_DIFFICULTY
    assert ok[0]["chunk_refs"] == ["c1"], "ref lạ bị lọc, ref thật giữ lại"

    # section_id lạ → bỏ liên kết chứ không loại câu
    ok, _ = validate_questions([{**base, "section_id": "khong-co"}],
                               allowed_chunk_refs=["c1"], allowed_section_ids=["s1"])
    assert ok[0]["section_id"] is None

    assert validate_questions([], allowed_chunk_refs=[]) == ([], [])
    print("ai_validation rules demo OK")


if __name__ == "__main__":
    demo()


def validate_review_items(
    raw_items: Sequence[Any],
    *,
    allowed_topics: Iterable[str],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """FR-13.9 — review item chỉ được nói về concept yếu CÓ THẬT trong bài làm.

    Model chỉ được viết `reason` + `review_tasks`; `section_id` và `chunk_refs` do
    tầng rule quyết định từ chính câu sai (PRD 17.2), nên mọi khoá nguồn model trả về
    đều bị **bỏ qua** chứ không phải bị từ chối — nó không có quyền quyết định phần đó.

    Cái bắt ở đây là model **bịa topic**: gợi ý ôn một chủ đề người học không hề làm
    sai chính là "gợi ý phần không liên quan".
    """
    by_norm = {_norm(t): t for t in allowed_topics}
    accepted: List[Dict[str, Any]] = []
    rejected: List[Dict[str, Any]] = []
    seen: set = set()

    for index, raw in enumerate(raw_items or []):
        if not isinstance(raw, dict):
            rejected.append({
                "rule_code": RULE_REVIEW_SCOPE, "severity": "rejected",
                "message": "Item không phải object JSON.",
                "target_type": "review_item", "target_ref": str(index),
                "payload": {"index": index, "item": raw},
            })
            continue

        topic = by_norm.get(_norm(raw.get("topic")))
        if topic is None or topic in seen:
            rejected.append({
                "rule_code": RULE_REVIEW_SCOPE, "severity": "rejected",
                "message": ("Trùng topic." if topic in seen else
                            "Topic không nằm trong danh sách concept yếu của bài làm."),
                "target_type": "review_item", "target_ref": str(raw.get("topic") or index)[:255],
                "payload": {"index": index, "item": raw},
            })
            continue
        seen.add(topic)

        tasks = _as_list(raw.get("review_tasks"))
        accepted.append({
            "topic": topic,
            "reason": str(raw.get("reason") or "").strip(),
            "review_tasks": tasks[:5],
        })
    return accepted, rejected


# Mã quy tắc -> câu nói được cho người học. Dùng khi báo "N câu bị loại": nói nguyên
# nhân ĐO ĐƯỢC thay vì đoán.
#
# Giao diện từng ghi "thường là do đoạn tài liệu tương ứng quá ngắn để ra đề" — một
# phỏng đoán không dựa trên gì. Log thật của job e4bfd2dd (2026-09-01) cho thấy 9/12 câu
# bị loại vì FR-13.5 (model không trích nhãn nguồn), 2 vì trùng, 1 vì lựa chọn không
# phân biệt. Không câu nào vì đoạn ngắn.
_CAU_THEO_RULE = {
    RULE_JSON: "model trả về câu hỏi không dùng được (sai dạng đã chọn, hoặc các lựa chọn gần như trùng nhau)",
    RULE_CORRECT_ANSWER: "đáp án đúng không khớp lựa chọn nào",
    RULE_EXPLANATION: "model bỏ phần giải thích đáp án",
    RULE_CONCEPT_TAGS: "model không gắn khái niệm cho câu hỏi",
    RULE_CHUNK_REFS: "model không trích được đoạn nguồn cho câu hỏi",
    RULE_NO_SOURCE: "model trích một đoạn nguồn không có trong tài liệu",
    RULE_DUPLICATE: "câu hỏi trùng với câu đã nhận",
}


def ly_do_loai(rejections: Sequence[Any]) -> Tuple[Dict[str, int], str]:
    """(đếm theo rule_code, câu mô tả nguyên nhân CHIẾM ĐA SỐ).

    Trả `("")` khi không có gì bị loại — không có gì để nói thì đừng nói.
    """
    dem: Dict[str, int] = {}
    for r in rejections or []:
        ma = str((r or {}).get("rule_code") or "").strip() or "?"
        dem[ma] = dem.get(ma, 0) + 1
    if not dem:
        return {}, ""
    ma_nhieu_nhat = max(dem, key=lambda k: dem[k])
    cau = _CAU_THEO_RULE.get(ma_nhieu_nhat)
    if not cau:
        # Mã lạ (luật mới thêm mà quên cập nhật bảng) vẫn phải nói được gì đó, và nói
        # rõ là chưa dịch được — im lặng ở đây là quay lại đúng chỗ vừa sửa.
        cau = f"không đạt kiểm chất lượng (mã {ma_nhieu_nhat})"
    return dem, cau
