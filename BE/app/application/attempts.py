"""Use case cho lượt làm bài (attempt) — FR-07, FR-08, FR-09.

Tầng này điều phối: cổng trạng thái, chuẩn hoá dữ liệu vào, quyết định quyền sở hữu,
chọn nhánh chấm ngay hay chấm nền, và dựng bản công khai để trả ra ngoài. Nó KHÔNG
biết HTTP: không `request`, không `jsonify`, và không có một con số status nào.

Hai quy ước làm nên ranh giới đó:

1. **Lỗi mang NGỮ NGHĨA, không mang mã.** `AttemptKhongTonTai` chứ không phải "404".
   Việc một attempt của người khác trả cùng thân lỗi với attempt không tồn tại là
   quyết định nghiệp vụ (không tạo oracle cho biết id có thật hay không), nên nó nằm
   ở đây; còn con số 404 do tầng route chọn.
2. **Cờ `bat_buoc_chu_so_huu` được TRUYỀN VÀO, không tự đọc env.** Đọc
   `AUTH_PROTECT_APP_APIS` là việc của rìa hệ thống. Truyền vào giữ tầng này thuần,
   và giữ nguyên chỗ test đang thay cờ (`app.main._auth_protect_enabled`).

`dispatch_grading` cũng được tiêm, vì lý do rất cụ thể — xem `submit_attempt`.
"""

from __future__ import annotations

import uuid
from typing import Any, Callable, Dict, List, Optional, Tuple


# ── Lỗi ngữ nghĩa ──────────────────────────────────────────────────────────
class AttemptError(Exception):
    """Gốc chung. `loi` là thân thông báo; `kem` là các trường đi kèm phải giữ
    nguyên trong response (ví dụ `status` của attempt lúc bị từ chối)."""

    loi = "Lỗi không xác định"

    def __init__(self, loi: Optional[str] = None, **kem: Any):
        if loi is not None:
            self.loi = loi
        self.kem: Dict[str, Any] = kem
        super().__init__(self.loi)


class AttemptKhongTonTai(AttemptError):
    """Không có, hoặc có nhưng của người khác — CỐ Ý không phân biệt hai ca."""
    loi = "Attempt not found"


class QuizKhongTonTai(AttemptError):
    loi = "Quiz not found"


class QuizChuaSanSang(AttemptError):
    loi = "Quiz chưa sẵn sàng"


class AttemptDaNop(AttemptError):
    """Đã rời `in_progress` mà còn sửa đáp án."""
    loi = "Attempt đã nộp, không sửa được đáp án"


class AttemptKhongConDangLam(AttemptError):
    """Nộp lần thứ hai."""
    loi = "Attempt không còn ở trạng thái in_progress"


class AttemptChuaNop(AttemptError):
    """Đòi xem kết quả (kèm đáp án đúng) trong khi bài còn đang làm."""
    loi = "Attempt chưa nộp"


class ThieuDapAn(AttemptError):
    loi = "Thiếu answers"


class CauHoiLac(AttemptError):
    """`question_id` không thuộc quiz của attempt."""


class JobChamKhongTonTai(AttemptError):
    loi = "Job not found"


class HetLuotChamLai(AttemptError):
    """The learner used every retry of a stuck attempt (`GRADING_MANUAL_RETRY_MAX`): each
    regrade of short answers costs LLM calls, so retries are capped per attempt."""
    loi = "Đã hết lượt thử chấm lại cho bài này"

    def __init__(self, loi: Optional[str] = None, **kem: Any):
        # A stable machine code next to the message, so a page can end its retry offer
        # without matching the wording (agy task38). Additive field of the 409 body.
        super().__init__(loi, **{"ma": "het_luot_cham_lai", **kem})


class KhongCoCauChoChamLai(AttemptError):
    """Regrade asked for an attempt that is not graded (still in progress, waiting for
    its first grading, cancelled): only a provisional result has answers to regrade."""
    loi = "Bài này không có câu nào chờ chấm lại"


class BaiLuyenTapSaiRoute(AttemptError):
    """A practice attempt on the generic route: it would skip the practice route's
    Idempotency-Key and replay rules (risk D, review of #185)."""
    loi = "Bài luyện tập nộp qua /api/practice/<id>/submit"


# ── Bản công khai ──────────────────────────────────────────────────────────
def attempt_public(attempt: dict) -> dict:
    out = dict(attempt)
    out.pop("user_id", None)
    out["unanswered_count"] = len(out.get("unanswered_question_ids") or [])
    # Số câu LLM chấm hỏng: đọc từ chính attempt, không từ `result` của job (job bị
    # prune sau 7 ngày, còn điểm thì ở lại vĩnh viễn). Không có metadata = 0 câu, không
    # phải "không biết" — trước khi có trường này thì mọi bài đều chấm đủ hoặc mất dấu.
    meta = out.get("metadata") or {}
    try:
        out["ungraded_count"] = int(meta.get("ungraded_count") or 0)
    except (TypeError, ValueError):
        out["ungraded_count"] = 0
    out["grading_complete"] = (
        out.get("status") == "graded" and out["ungraded_count"] == 0
    )
    return out


def load_owned_attempt(attempt_id: str, user_id: Optional[str], *,
                       bat_buoc_chu_so_huu: bool) -> dict:
    """Bản ghi thô (còn `user_id`) sau khi qua cổng sở hữu."""
    from app.domains.attempts import repository as _attempts

    attempt = _attempts.get_attempt(attempt_id)
    if not attempt:
        raise AttemptKhongTonTai()
    if bat_buoc_chu_so_huu and attempt.get("user_id") != user_id:
        raise AttemptKhongTonTai()
    return attempt


# ── Use case ───────────────────────────────────────────────────────────────
def open_attempt(quiz_id: str, user_id: Optional[str], *,
                 bat_buoc_chu_so_huu: bool) -> Tuple[dict, bool]:
    """(bản công khai kèm quiz, có_tạo_mới). Mở lại quiz đang làm dở KHÔNG tạo
    attempt thứ hai — `open_attempt` của repository trả cờ `created` cho việc đó."""
    from app.domains.attempts import repository as _attempts
    from app.domains.quiz import repository as _quiz_repo

    quiz = _quiz_repo.get_quiz(quiz_id, include_answers=False)
    if not quiz or (bat_buoc_chu_so_huu and quiz.get("user_id") != user_id):
        raise QuizKhongTonTai()
    if quiz["status"] != "ready":
        raise QuizChuaSanSang()

    opened = _attempts.open_attempt(quiz_id, user_id)
    attempt = _attempts.get_attempt(opened["attempt_id"])
    quiz.pop("user_id", None)
    return {**attempt_public(attempt), "quiz": quiz}, bool(opened["created"])


def list_attempts(quiz_id: str, user_id: Optional[str], *,
                  bat_buoc_chu_so_huu: bool) -> dict:
    from app.domains.attempts import repository as _attempts
    from app.domains.quiz import repository as _quiz_repo

    owner = _quiz_repo.owner_of(quiz_id)
    if owner is None or (bat_buoc_chu_so_huu and owner != user_id):
        raise QuizKhongTonTai()
    return {
        "quiz_id": quiz_id,
        "attempts": _attempts.list_by_quiz(
            quiz_id, user_id=user_id if bat_buoc_chu_so_huu else None),
    }


def get_attempt(attempt_id: str, user_id: Optional[str], *,
                bat_buoc_chu_so_huu: bool) -> dict:
    return attempt_public(
        load_owned_attempt(attempt_id, user_id, bat_buoc_chu_so_huu=bat_buoc_chu_so_huu))


def _chuan_hoa_dap_an(raw: Any) -> Dict[str, Any]:
    """FE gửi được cả hai hình dạng: `{question_id: user_answer}` và
    `[{question_id, user_answer}]`. Gộp về dict, bỏ phần tử không có `question_id`."""
    if isinstance(raw, list):
        raw = {a.get("question_id"): a.get("user_answer")
               for a in raw if isinstance(a, dict) and a.get("question_id")}
    if not isinstance(raw, dict) or not raw:
        raise ThieuDapAn()
    return raw


def save_answers(attempt_id: str, user_id: Optional[str], raw: Any, *,
                 bat_buoc_chu_so_huu: bool) -> dict:
    """Lưu nháp (FR-07.5, FR-07.11). Gọi lại cho cùng câu thì ghi đè."""
    from app.domains.attempts import repository as _attempts

    attempt = load_owned_attempt(attempt_id, user_id,
                                 bat_buoc_chu_so_huu=bat_buoc_chu_so_huu)
    if attempt["status"] != "in_progress":
        # Đã nộp rồi mà còn sửa đáp án thì điểm không còn nghĩa gì.
        raise AttemptDaNop(status=attempt["status"])

    raw = _chuan_hoa_dap_an(raw)
    known = set(_attempts.question_ids_of_quiz(attempt["quiz_id"]))
    unknown = [q for q in raw if str(q) not in known]
    if unknown:
        raise CauHoiLac(f"question_id không thuộc quiz: {unknown}")

    if _attempts.save_draft_answers(attempt_id, {str(k): v for k, v in raw.items()}) is None:
        # Submitted between the check above and the write (review of #183).
        raise AttemptDaNop(status=(_attempts.get_attempt(attempt_id) or {}).get("status"))
    return attempt_public(_attempts.get_attempt(attempt_id))


def submit_attempt(attempt_id: str, user_id: Optional[str], *,
                   bat_buoc_chu_so_huu: bool,
                   dispatch_grading: Callable[[str, str, Optional[str]], Any],
                   ) -> Tuple[dict, bool]:
    """(bản công khai, có_chấm_nền). Bài toàn trắc nghiệm chấm luôn; có tự luận thì nền.

    `dispatch_grading` được TIÊM, không import thẳng runner. Lý do là hợp đồng của RQ,
    không phải thẩm mỹ: `queue.enqueue_job` đưa hàm cho RQ, RQ lưu chuỗi
    `module.qualname` rồi import lại ở worker. Job đã nằm trong hàng đợi mang đường dẫn
    `app.main.run_short_answer_grading_job`; nếu tầng này import thẳng impl ở
    `app.application.short_answer_grading`, đường dẫn đổi và job cũ chết ở worker — im
    lặng, vì chế độ thread không dùng đường dẫn nên test vẫn xanh.

    Retry contract (diagnostic recovery, owner-approved 2026-11-17), one grader per
    attempt through the claim `submit` takes:
      - `in_progress` -> submitted and graded (200) or queued (202), as before;
      - already `graded` -> 200 with the STORED result, no regrading (a lost response
        used to turn the learner's second click into 409 "Nộp bài thất bại"); missing
        mastery rows are rebuilt (no LLM);
      - `submitted` with a live claim or a queued/running job -> 202 "pending", no grader;
      - `submitted` and nobody grading (crash, grading error) -> regraded (200/202);
      - cancelled -> 409, a practice attempt -> 409 (practice has its own route).
    """
    from app.domains.attempts import repository as _attempts

    attempt = load_owned_attempt(attempt_id, user_id,
                                 bat_buoc_chu_so_huu=bat_buoc_chu_so_huu)
    _tu_choi_bai_luyen_tap(attempt["quiz_id"])
    submitted = _attempts.submit(attempt_id)
    if submitted is not None:
        return _grade_or_dispatch(attempt_id, attempt["quiz_id"], user_id,
                                  submitted["claimed_at"], dispatch_grading, refund=None)

    outcome, claimed_at = _attempts.reclaim_for_retry(
        attempt_id, job_active=job_active, max_retries=manual_retry_max())
    if outcome == "graded":
        repair_mastery(attempt_id)
        return ({**attempt_public(_attempts.get_attempt(attempt_id)),
                 "grading": "done"}, False)
    if outcome == "pending":
        stored = _attempts.get_attempt(attempt_id)
        return ({**attempt_public(stored), "grading": "pending",
                 "job_id": (stored.get("metadata") or {}).get("grading_job_id")}, True)
    if outcome == "grade":
        return _grade_or_dispatch(attempt_id, attempt["quiz_id"], user_id, claimed_at,
                                  dispatch_grading, refund="manual_retries")
    if outcome == "exhausted":
        raise HetLuotChamLai(status="submitted")
    raise AttemptKhongConDangLam(status=attempt["status"])


def manual_retry_max() -> int:
    """Learner retries per stuck attempt (`GRADING_MANUAL_RETRY_MAX`, default 3), applied
    by the repository only to quizzes with short answers (an objective regrade costs no
    LLM call). The first submit is not a retry; the recovery sweep has its own cap."""
    return max(0, _env_int("GRADING_MANUAL_RETRY_MAX", 3))


def _tu_choi_bai_luyen_tap(quiz_id: str) -> None:
    from app.domains.quiz import repository as _quiz_repo

    if (_quiz_repo.get_quiz(quiz_id, include_answers=False) or {}).get("quiz_type") == "practice":
        raise BaiLuyenTapSaiRoute()


def _grade_or_dispatch(attempt_id: str, quiz_id: str, user_id: Optional[str],
                       claimed_at, dispatch_grading, *, refund: Optional[str]
                       ) -> Tuple[dict, bool]:
    """Grade under OUR claim: objective-only inline (no LLM), short answers in a job.

    On any failure the claim is released (only ours, by timestamp), so the next retry
    grades at once instead of after the lease."""
    from app.domains.attempts import repository as _attempts
    from app.domains.attempts import service as _grading_service

    if not _grading_service.has_short_answer(quiz_id):
        try:
            result = _grading_service.grade_attempt(attempt_id, once=True)
        except Exception:
            _attempts.release_grading_claim(attempt_id, claimed_at)
            raise
        # None: another grader saved first; its stored result is the answer.
        return ({**attempt_public(_attempts.get_attempt(attempt_id)),
                 "grading": "done", **(result or {})}, False)

    job_id = str(uuid.uuid4())
    from app.domains.jobs.jobs_store import create_job, update_job
    create_job(job_id, job_type="short_answer_grading", status="pending", progress=0,
               current_node="Queued", user_id=user_id)
    if not _attempts.set_grading_job(attempt_id, job_id, claimed_at):
        # Our claim was lost (lease ran out, another grader took over): that grader
        # stands, the retry we counted is given back, and the answer is what is stored.
        update_job(job_id, status="error", error_text="superseded before dispatch")
        _attempts.abandon_job(attempt_id, job_id, None, refund=refund)
        stored = _attempts.get_attempt(attempt_id)
        if stored["status"] == "graded":
            return ({**attempt_public(stored), "grading": "done"}, False)
        return ({**attempt_public(stored), "grading": "pending",
                 "job_id": (stored.get("metadata") or {}).get("grading_job_id")}, True)
    try:
        dispatch_grading(job_id, attempt_id, user_id)
    except Exception:
        # Nothing was accepted: no ghost pending job, our claim and retry given back.
        update_job(job_id, status="error", error_text="enqueue failed")
        _attempts.abandon_job(attempt_id, job_id, claimed_at, refund=refund)
        raise
    return ({**attempt_public(_attempts.get_attempt(attempt_id)),
             "grading": "pending", "job_id": job_id}, True)


def regrade_provisional(attempt_id: str, user_id: Optional[str], *,
                        bat_buoc_chu_so_huu: bool, dispatch_grading) -> Tuple[dict, bool]:
    """Regrade the short answers a model outage left ungraded (owner-approved
    2026-11-17). Returns (body, accepted): 202 with the regrade job while one is queued
    or running (never a second job), 200 with the stored result once nothing is left to
    grade; 409 `HetLuotChamLai` when the learner's retries are used up (the provisional
    result stays as it is). Same claim, retry cap and job fencing as a stuck attempt."""
    from app.domains.attempts import repository as _attempts

    attempt = load_owned_attempt(attempt_id, user_id, bat_buoc_chu_so_huu=bat_buoc_chu_so_huu)
    # Practice attempts too (task A): a regrade opens no attempt and writes no answer, so
    # the practice Idempotency-Key is not involved, and grading runs in the same job,
    # never inside the request (one sync worker with a 120 s timeout in production).
    job_id = str(uuid.uuid4())
    outcome, claimed_at, registered = _attempts.reclaim_for_regrade(
        attempt_id, job_id, job_active=job_active, job_never_started=job_never_started,
        max_retries=manual_retry_max())
    if outcome == "refused":
        raise KhongCoCauChoChamLai(status=attempt["status"])
    if outcome == "graded":
        repair_mastery(attempt_id)
        return ({**attempt_public(_attempts.get_attempt(attempt_id)), "grading": "done"},
                False)
    if outcome == "exhausted":
        raise HetLuotChamLai(status="graded")
    if outcome == "pending":
        return ({**attempt_public(_attempts.get_attempt(attempt_id)), "grading": "pending",
                 "job_id": registered}, True)
    from app.domains.jobs.jobs_store import create_job, update_job
    create_job(job_id, job_type="short_answer_grading", status="pending", progress=0,
               current_node="Queued", user_id=user_id)
    try:
        dispatch_grading(job_id, attempt_id, user_id)
    except Exception:
        # Nothing was accepted: no ghost job, our claim and the retry given back.
        update_job(job_id, status="error", error_text="enqueue failed")
        _attempts.abandon_job(attempt_id, job_id, claimed_at, refund="manual_retries")
        raise
    return ({**attempt_public(_attempts.get_attempt(attempt_id)), "grading": "pending",
             "job_id": job_id}, True)


def job_never_started(job_id: Optional[str]) -> bool:
    """The job row exists and is still `pending`: no worker ever took it, so it made no
    model call. A missing row or any other status counts as started (no refund)."""
    if not job_id:
        return False
    from app.domains.jobs.jobs_store import get_job

    try:
        return (get_job(job_id) or {}).get("status") == "pending"
    except Exception:
        return False


def job_active(job_id: Optional[str]) -> bool:
    """A grading job still queued or running that reported within the grading lease
    (`GRADING_LEASE_S`). A running job reports at every answer (progress + claim
    heartbeat); a killed worker or a queue that lost the job goes silent, and after the
    lease (not the 15-minute stuck-job threshold, agy task27) the attempt can be retried.
    A late start of such a job is harmless: it is no longer registered, so it ends as a
    no-op before any model call."""
    if not job_id:
        return False
    from datetime import datetime, timezone

    from app.domains.jobs.jobs_store import get_job

    try:
        j = get_job(job_id)
    except Exception:
        return False
    if not j or j.get("status") not in ("pending", "running", "processing"):
        return False
    try:
        updated = datetime.fromisoformat(str(j.get("updated_at")))
        if updated.tzinfo is None:
            updated = updated.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return False
    from app.domains.attempts.repository import grading_lease_s

    return (datetime.now(timezone.utc) - updated).total_seconds() < grading_lease_s()


def repair_mastery(attempt_id: Optional[str]) -> bool:
    """Rebuild a graded attempt's concept-mastery snapshot when it is missing (scores
    were saved, then the process died or analysis failed). Deterministic, no LLM;
    fail-open like grading-time analysis. Shared with the practice route.

    True when nothing is left to do (rows exist, or analysis ran without error: a quiz
    without concept tags legitimately has none); False when analysis failed."""
    from app.domains.attempts import repository as _attempts
    from app.domains.gap_analysis import service as _gap

    if not attempt_id or _gap.list_for_attempt(attempt_id):
        return True
    if (_attempts.get_attempt(attempt_id) or {}).get("status") != "graded":
        return True
    try:
        _gap.analyze_attempt(attempt_id)
        return True
    except Exception as exc:
        print(f"[grading] mastery repair failed: {exc}", flush=True)
        return False


def grading_job(job_id: str, user_id: Optional[str], *,
                bat_buoc_chu_so_huu: bool) -> dict:
    """Job loại khác, hoặc job của người khác, đều là "không tồn tại"."""
    from app.domains.jobs.jobs_store import get_job as _js_get

    j = _js_get(job_id)
    if not j or j.get("job_type") != "short_answer_grading":
        raise JobChamKhongTonTai()
    if bat_buoc_chu_so_huu and j.get("user_id") != user_id:
        raise JobChamKhongTonTai()
    return {
        "job_id": job_id,
        "status": j.get("status"),
        "progress": j.get("progress", 0),
        "result": j.get("result"),
        "error": j.get("error"),
    }


def results(attempt_id: str, user_id: Optional[str], *,
            bat_buoc_chu_so_huu: bool) -> dict:
    """Kết quả sau khi nộp — CHỖ DUY NHẤT lộ đáp án đúng + giải thích (FR-08.8).

    Chưa nộp thì từ chối: trả đáp án lúc bài còn `in_progress` là đưa bài giải cho
    người đang làm.
    """
    from app.domains.quiz import repository as _quiz_repo

    attempt = load_owned_attempt(attempt_id, user_id,
                                 bat_buoc_chu_so_huu=bat_buoc_chu_so_huu)
    if attempt["status"] == "in_progress":
        raise AttemptChuaNop(status=attempt["status"])

    quiz = _quiz_repo.get_quiz(attempt["quiz_id"], include_answers=True) or {}
    by_question = {a["question_id"]: a for a in attempt["answers"]}
    questions: List[dict] = []
    for q in quiz.get("questions") or []:
        answer = by_question.get(q["question_id"]) or {}
        questions.append({
            **q,
            "user_answer": answer.get("user_answer"),
            "verdict": answer.get("verdict"),
            "is_correct": answer.get("is_correct"),
            "score": answer.get("score"),
            "feedback": answer.get("feedback"),
        })
    from app.domains.attempts import repository as _attempts

    return {
        **attempt_public(attempt),
        # "grading" | "stalled" | "graded" | "cancelled". The result page offers
        # "Thử chấm lại" only on "stalled": nobody holds a live claim and no job is
        # queued or running, so a retry starts exactly one grader.
        "grading_state": _attempts.grading_state(attempt_id, job_active=job_active,
                                                 max_retries=manual_retry_max()),
        # Provisional result (`grading_complete` false): None | "available" |
        # "running" | "exhausted". The page offers "Chấm lại câu còn thiếu" on
        # "available" only.
        "regrade_state": _attempts.regrade_state(attempt_id, job_active=job_active,
                                                 max_retries=manual_retry_max()),
        "quiz_id": attempt["quiz_id"],
        "quiz_title": quiz.get("title"),
        "questions": questions,
    }


def concept_masteries(attempt_id: str, user_id: Optional[str], *,
                      weak_only: bool, bat_buoc_chu_so_huu: bool) -> dict:
    """Mức nắm từng concept của bài làm (FR-09.8)."""
    from app.domains.gap_analysis import service as _gap

    attempt = load_owned_attempt(attempt_id, user_id,
                                 bat_buoc_chu_so_huu=bat_buoc_chu_so_huu)
    rows = _gap.list_for_attempt(attempt_id, weak_only=weak_only)
    if not rows and attempt["status"] == "graded" and not weak_only:
        # Bài đã chấm mà chưa có snapshot (hook lúc chấm hỏng) → tính bù, đừng trả rỗng.
        _gap.analyze_attempt(attempt_id)
        rows = _gap.list_for_attempt(attempt_id)
    return {"attempt_id": attempt_id, "status": attempt["status"],
            "concept_masteries": rows}


# ── Recovery sweep (owner-approved 2026-11-17: implemented, DISABLED by default) ──
def _env_flag(name: str, default: bool) -> bool:
    import os

    raw = (os.getenv(name) or "").strip().lower()
    return default if not raw else raw in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    import os

    try:
        return int((os.getenv(name) or "").strip() or default)
    except ValueError:
        return default


def recover_grading(*, dispatch_grading: Callable[[str, str, Optional[str]], Any],
                    enabled: Optional[bool] = None, dry_run: Optional[bool] = None,
                    older_than_s: Optional[int] = None, limit: Optional[int] = None,
                    max_attempts: Optional[int] = None, max_inflight: Optional[int] = None,
                    ) -> dict:
    """Regrade stuck `submitted` attempts and rebuild missing mastery. Bounded, logged.

    OFF unless `GRADING_RECOVERY_ENABLED=1`; even then a dry run (picks and logs, changes
    nothing) unless `GRADING_RECOVERY_DRY_RUN=0`. Each regrade is a background grading
    job (`dispatch_grading`), never on the calling request thread; an attempt with short
    answers costs one LLM call per short answer, so the knobs are the budget:
    GRADING_RECOVERY_OLDER_THAN_S (900), GRADING_RECOVERY_BATCH (5 per call),
    GRADING_RECOVERY_MAX_ATTEMPTS (3 per attempt), GRADING_RECOVERY_MAX_INFLIGHT (5).
    Called from the throttled jobs maintenance (`app.main._run_jobs_maintenance`).
    Mastery repair is deterministic (no LLM).
    """
    import json

    from app.domains.attempts import repository as _attempts

    enabled = _env_flag("GRADING_RECOVERY_ENABLED", False) if enabled is None else enabled
    if not enabled:
        return {"enabled": False}
    dry_run = _env_flag("GRADING_RECOVERY_DRY_RUN", True) if dry_run is None else dry_run
    older_than_s = _env_int("GRADING_RECOVERY_OLDER_THAN_S", 900) if older_than_s is None else older_than_s
    limit = _env_int("GRADING_RECOVERY_BATCH", 5) if limit is None else limit
    max_attempts = _env_int("GRADING_RECOVERY_MAX_ATTEMPTS", 3) if max_attempts is None else max_attempts
    max_inflight = _env_int("GRADING_RECOVERY_MAX_INFLIGHT", 5) if max_inflight is None else max_inflight

    claim = _attempts.claim_stuck_for_recovery(
        older_than_s=older_than_s, limit=limit, max_attempts=max_attempts,
        max_inflight=max_inflight, dry_run=dry_run, job_active=job_active)
    dispatched, failed = [], []
    if not dry_run:
        from app.domains.jobs.jobs_store import create_job, update_job

        for c in claim["picked"]:
            job_id = str(uuid.uuid4())
            create_job(job_id, job_type="short_answer_grading", status="pending",
                       progress=0, current_node="Recovery", user_id=c["user_id"])
            if not _attempts.set_grading_job(c["attempt_id"], job_id, claim["claimed_at"]):
                update_job(job_id, status="error", error_text="superseded before dispatch")
                continue
            try:
                dispatch_grading(job_id, c["attempt_id"], c["user_id"])
                dispatched.append(c["attempt_id"])
            except Exception as exc:
                update_job(job_id, status="error", error_text="enqueue failed")
                _attempts.abandon_job(c["attempt_id"], job_id, claim["claimed_at"],
                                      refund="recovery_attempts")
                failed.append({"attempt_id": c["attempt_id"], "error": type(exc).__name__})

    mastery = _attempts.graded_without_mastery(limit=limit)
    repaired = 0
    if not dry_run:
        from app.domains.gap_analysis import service as _gap

        for attempt_id in mastery:
            if not repair_mastery(attempt_id):
                continue  # analysis failed: try again next sweep (Codex task25)
            repaired += bool(_gap.list_for_attempt(attempt_id))
            _attempts.mark_mastery_checked(attempt_id)

    report = {
        "enabled": True, "dry_run": dry_run,
        "candidates": [c["attempt_id"] for c in claim["picked"]],
        "regraded": len(dispatched), "dispatch_failed": failed,
        "mastery_candidates": len(mastery), "mastery_repaired": repaired,
        "inflight": claim["inflight"], "gave_up": claim["gave_up"],
        "skipped_active_job": claim["skipped_active_job"],
        "limits": {"older_than_s": older_than_s, "batch": limit,
                   "max_attempts": max_attempts, "max_inflight": max_inflight},
    }
    print(json.dumps({"event": "grading_recovery", **report}, ensure_ascii=False), flush=True)
    return report
