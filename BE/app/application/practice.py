"""Use case luyện tập — FR-11, FR-12.7.

Bài luyện tập đi qua ĐÚNG repository attempt như bài chẩn đoán, để lịch sử và mastery
thống nhất; chỗ khác nhau là nhịp: luồng chẩn đoán tách mở/nháp/nộp vì người học làm
dài và cần lưu nháp, còn bài luyện tập ngắn nên gộp cả bốn bước vào một lượt gọi.

Ba điểm dễ làm hỏng khi đọc lướt:

1. **Quiz chẩn đoán lọt vào route practice cũng là "không tồn tại".** Cổng là
   `quiz_type == "practice"`, không phải chỉ quyền sở hữu — hai luồng khác nhau và
   không được lẫn.
2. **Chuẩn hoá đáp án dùng LẠI hàm của `attempts`**, không chép sang đây. Hai bản sao
   của cùng một luật sẽ lệch nhau ở lần sửa thứ hai; và thân lỗi phải giống hệt vì
   test khoá cả chuỗi.
3. **`AttemptKhongConDangLam` ở đây ném KHÔNG kèm `status`.** Route submit của bài
   chẩn đoán ném kèm. Hai response khác nhau, cả hai đang có, giữ nguyên cả hai.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.application import attempts as attempts_uc


class PracticeKhongTonTai(attempts_uc.AttemptError):
    """Không có, của người khác, hoặc là quiz chẩn đoán — cùng một thân lỗi."""
    loi = "Practice quiz not found"


class PracticeChuaSanSang(attempts_uc.AttemptError):
    loi = "Practice quiz chưa sẵn sàng"


class ChuaCoLanChamNao(attempts_uc.AttemptError):
    loi = "Chưa có lần làm nào đã chấm cho practice quiz này"


def _load_owned_practice(quiz_id: str, user_id: Optional[str], *,
                         bat_buoc_chu_so_huu: bool) -> Dict[str, Any]:
    from app.domains.quiz import repository as _quiz_repo

    meta = _quiz_repo.get_meta(quiz_id)
    if not meta or meta.get("quiz_type") != "practice":
        raise PracticeKhongTonTai()
    if bat_buoc_chu_so_huu and meta.get("user_id") != user_id:
        raise PracticeKhongTonTai()
    return meta


def get(practice_quiz_id: str, user_id: Optional[str], *,
        bat_buoc_chu_so_huu: bool) -> Dict[str, Any]:
    """Đề luyện tập. Vẫn KHÔNG kèm đáp án trước khi nộp (FR-06.12)."""
    from app.domains.quiz import repository as _quiz_repo

    _load_owned_practice(practice_quiz_id, user_id,
                         bat_buoc_chu_so_huu=bat_buoc_chu_so_huu)
    quiz = _quiz_repo.get_quiz(practice_quiz_id, include_answers=False)
    quiz.pop("user_id", None)
    meta = _quiz_repo.get_meta(practice_quiz_id) or {}
    return {**quiz,
            "source_review_item_id": meta.get("source_review_item_id"),
            "source_attempt_id": meta.get("source_attempt_id")}


def submit(practice_quiz_id: str, user_id: Optional[str], raw: Any, *,
           bat_buoc_chu_so_huu: bool) -> Dict[str, Any]:
    """Nộp bài luyện tập trong MỘT lần gọi (FR-11.6, FR-11.7).

    Thứ tự tác dụng phụ là hợp đồng, không phải chi tiết: mở attempt -> ghi nháp ->
    nộp -> chấm, tất cả trong cùng một request. Không hàng đợi, không job nền.
    """
    from app.domains.attempts import repository as _attempts
    from app.domains.attempts import service as _grading_service

    meta = _load_owned_practice(practice_quiz_id, user_id,
                                bat_buoc_chu_so_huu=bat_buoc_chu_so_huu)
    if meta.get("status") != "ready":
        raise PracticeChuaSanSang()

    raw = attempts_uc._chuan_hoa_dap_an(raw)
    known = set(_attempts.question_ids_of_quiz(practice_quiz_id))
    unknown = [q for q in raw if str(q) not in known]
    if unknown:
        raise attempts_uc.CauHoiLac(f"question_id không thuộc quiz: {unknown}")

    attempt_id = _attempts.open_attempt(practice_quiz_id, user_id)["attempt_id"]
    _attempts.save_draft_answers(attempt_id, {str(k): v for k, v in raw.items()})
    if _attempts.submit(attempt_id) is None:
        raise attempts_uc.AttemptKhongConDangLam()
    result = _grading_service.grade_attempt(attempt_id)
    return {**attempts_uc.attempt_public(_attempts.get_attempt(attempt_id)),
            "grading": "done", **(result or {})}


def comparison(practice_quiz_id: str, user_id: Optional[str], *,
               bat_buoc_chu_so_huu: bool) -> Dict[str, Any]:
    """Mastery trước/sau luyện tập (FR-11.10, FR-12.7).

    "Trước" là attempt chẩn đoán gốc (`source_attempt_id`), "sau" là lần làm practice
    gần nhất đã chấm. Cả hai đều có thể thiếu: review item bị xoá thì `topic` là None
    và phép so không thu hẹp theo chủ đề; chưa từng có attempt gốc thì so với rỗng.
    """
    from app.domains.gap_analysis import service as _gap
    from app.domains.progress import service as _progress
    from app.domains.review import service as _review

    meta = _load_owned_practice(practice_quiz_id, user_id,
                                bat_buoc_chu_so_huu=bat_buoc_chu_so_huu)

    after_attempt = _progress.latest_graded_attempt(practice_quiz_id, user_id)
    if not after_attempt:
        raise ChuaCoLanChamNao()

    source_attempt = meta.get("source_attempt_id")
    item = _review.get_item(meta.get("source_review_item_id") or "")
    topics = [item["topic"]] if item else None

    body = _progress.compare_masteries(
        _gap.list_for_attempt(source_attempt) if source_attempt else [],
        _gap.list_for_attempt(after_attempt),
        topics=topics,
    )
    return {
        "practice_quiz_id": practice_quiz_id,
        "topic": item["topic"] if item else None,
        "source_attempt_id": source_attempt,
        "practice_attempt_id": after_attempt,
        **body,
    }
