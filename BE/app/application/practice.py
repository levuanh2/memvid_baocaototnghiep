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

import re
import uuid
from typing import Any, Dict, Optional

from app.application import attempts as attempts_uc


class PracticeKhongTonTai(attempts_uc.AttemptError):
    """Không có, của người khác, hoặc là quiz chẩn đoán — cùng một thân lỗi."""
    loi = "Practice quiz not found"


class PracticeChuaSanSang(attempts_uc.AttemptError):
    loi = "Practice quiz chưa sẵn sàng"


class ChuaCoLanChamNao(attempts_uc.AttemptError):
    loi = "Chưa có lần làm nào đã chấm cho practice quiz này"


class KhoaNopBaiKhongHopLe(attempts_uc.AttemptError):
    loi = "Idempotency-Key không hợp lệ (16–128 ký tự A-Z a-z 0-9 _ -)"


class KhoaNopBaiDaDung(attempts_uc.AttemptError):
    """Cùng key, khác quiz hoặc khác đáp án: không phải retry của cùng một lần nộp."""
    loi = "Idempotency-Key đã dùng cho một lần nộp khác"


class NopBaiDangCham(attempts_uc.AttemptError):
    """Retry trong khi request đầu tiên vẫn đang chấm. Thử lại với CÙNG key."""
    loi = "Bài nộp này đang được chấm, thử lại sau ít giây"


# A client key is a random token (the FE sends `crypto.randomUUID()`); in open mode it is
# the only thing that tells two anonymous clients apart, so short guessable keys are refused.
_KHOA_HOP_LE = re.compile(r"[A-Za-z0-9_-]{16,128}")


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
    from app.domains.progress import service as _progress

    return {**quiz,
            "source_review_item_id": meta.get("source_review_item_id"),
            "source_attempt_id": meta.get("source_attempt_id"),
            # The learner's latest graded attempt, provisional or not: after a reload the
            # page shows a provisional result and its regrade offer again (task39).
            "latest_attempt_id": _progress.latest_graded_attempt(
                practice_quiz_id, user_id, complete_only=False)}


def submit(practice_quiz_id: str, user_id: Optional[str], raw: Any, *,
           bat_buoc_chu_so_huu: bool, submit_key: Optional[str] = None) -> Dict[str, Any]:
    """Nộp bài luyện tập trong MỘT lần gọi (FR-11.6, FR-11.7).

    Thứ tự tác dụng phụ là hợp đồng, không phải chi tiết: mở attempt -> ghi nháp ->
    nộp -> chấm, tất cả trong cùng một request. Không hàng đợi, không job nền.

    `submit_key` (Idempotency-Key, tuỳ chọn): một lần nộp logic = một key. Gửi lại cùng
    key + cùng đáp án trả lại ĐÚNG kết quả đã chấm, không chấm lại, không cập nhật
    mastery lần hai; lần làm mới phải có key mới dù đáp án y hệt.
    """
    from app.domains.attempts import repository as _attempts
    from app.domains.attempts import service as _grading_service

    if submit_key is not None and not (isinstance(submit_key, str)
                                       and _KHOA_HOP_LE.fullmatch(submit_key)):
        raise KhoaNopBaiKhongHopLe()
    meta = _load_owned_practice(practice_quiz_id, user_id,
                                bat_buoc_chu_so_huu=bat_buoc_chu_so_huu)
    if meta.get("status") != "ready":
        raise PracticeChuaSanSang()

    raw = attempts_uc._chuan_hoa_dap_an(raw)
    known = set(_attempts.question_ids_of_quiz(practice_quiz_id))
    unknown = [q for q in raw if str(q) not in known]
    if unknown:
        raise attempts_uc.CauHoiLac(f"question_id không thuộc quiz: {unknown}")

    # One transaction under a row lock on the quiz (known-issues 2026-11-14): two
    # identical requests used to open two attempts and grade both.
    try:
        attempt_id, outcome, claimed_at = _attempts.submit_practice(
            practice_quiz_id, user_id, raw, submit_key=submit_key,
            max_retries=attempts_uc.manual_retry_max())
    except _attempts.SubmitKeyMismatch:
        raise KhoaNopBaiDaDung() from None
    if outcome == "replay":
        raise attempts_uc.AttemptKhongConDangLam()
    if outcome == "pending":
        raise NopBaiDangCham()
    if outcome == "exhausted":
        # Retries of one stuck attempt are capped like the diagnostic route (Codex task25).
        raise attempts_uc.HetLuotChamLai(status="submitted")
    if outcome == "grade":
        try:
            _grading_service.grade_attempt(attempt_id, once=True)
        except Exception:
            # The attempt stays `submitted`; free the claim so a retry with the same key
            # grades it now instead of after the lease.
            _attempts.release_grading_claim(attempt_id, claimed_at)
            raise
    elif outcome == "done":
        # Scores commit before gap analysis runs; a process that died in between (or an
        # analysis error, which is swallowed) left a graded attempt with no mastery rows,
        # and the practice comparison never repairs it. Repair here, as the generic
        # concept-mastery route does.
        _repair_mastery(attempt_id)
    # Built from the stored attempt, never from this request's grading, so a retry gets
    # the same fields and values the first success returned. The totals `grade_attempt`
    # returns are exactly the attempt's stored score/counts/ungraded_count.
    return {**attempts_uc.attempt_public(_attempts.get_attempt(attempt_id)),
            "grading": "done"}


def regrade(practice_quiz_id: str, user_id: Optional[str], attempt_id: str, *,
            bat_buoc_chu_so_huu: bool) -> Dict[str, Any]:
    """Regrade the short answers an AI grader outage left without a verdict (#159 item
    17), inside the request like a practice submit (no job). Only answers whose verdict
    is None reach the model; graded answers and every `user_answer` stay as they are.

    #190's rules: the claim and `manual_retries` cap of the attempt, the registered
    regrade token fencing the write, the claim released after the gap analysis.
    200 with the stored attempt (also when nothing is left to grade); 409
    `NopBaiDangCham` while another request regrades it, `HetLuotChamLai` when the
    retries are used up (no model call), `KhongCoCauChoChamLai` when it is not graded;
    404 for another learner's attempt or one of another quiz. The Idempotency-Key of
    the submit is untouched: no attempt is opened and no answer is written here."""
    from app.domains.attempts import repository as _attempts
    from app.domains.attempts import service as _grading_service

    _load_owned_practice(practice_quiz_id, user_id, bat_buoc_chu_so_huu=bat_buoc_chu_so_huu)
    attempt = attempts_uc.load_owned_attempt(attempt_id, user_id,
                                             bat_buoc_chu_so_huu=bat_buoc_chu_so_huu)
    if str(attempt["quiz_id"]) != str(practice_quiz_id):
        raise attempts_uc.AttemptKhongTonTai()
    token = f"practice-regrade-{uuid.uuid4()}"
    outcome, _claimed, _registered = _attempts.reclaim_for_regrade(
        attempt_id, token, job_active=attempts_uc.job_active,
        max_retries=attempts_uc.manual_retry_max())
    if outcome == "refused":
        raise attempts_uc.KhongCoCauChoChamLai(status=attempt["status"])
    if outcome == "pending":
        raise NopBaiDangCham()
    if outcome == "exhausted":
        raise attempts_uc.HetLuotChamLai(status="graded")
    if outcome == "grade":
        role, claimed_at = _attempts.start_grading_job(attempt_id, token)
        if role == "regrade":
            def _heartbeat(_p, _msg):
                # Before each model call, as the grading job does: keeps the claim live
                # past the lease, and stops paying for answers once a later request
                # took the attempt over (task39).
                if not _attempts.renew_claim(attempt_id, token):
                    raise NopBaiDangCham()

            try:
                _grading_service.regrade_ungraded(attempt_id, token, progress_cb=_heartbeat)
            finally:
                # Ends the claim and retires the token, after the gap analysis. A no-op
                # when the claim was taken over: it belongs to the other request.
                _attempts.release_job_claim(attempt_id, token)
    else:
        _repair_mastery(attempt_id)
    return {**attempts_uc.attempt_public(_attempts.get_attempt(attempt_id)),
            "grading": "done"}


def _repair_mastery(attempt_id: Optional[str]) -> None:
    # Shared with the diagnostic route since the recovery work (2026-11-17).
    attempts_uc.repair_mastery(attempt_id)


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
    _repair_mastery(after_attempt)

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
