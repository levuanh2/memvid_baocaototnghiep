"""Use case kế hoạch ôn tập — FR-10.

Ba route, ba đường xác định quyền sở hữu KHÁC NHAU, và đó không phải là thiếu nhất
quán mà là ba quan hệ dữ liệu khác nhau:

- `generate` và `by_attempt` đi qua **attempt** (plan sinh ra từ một bài đã chấm);
- `items` đi qua **chính bản ghi plan** (`plan.user_id`) — vì `review_plan_id` không
  nói gì về attempt cho tới khi đọc được plan.

Hệ quả là thân lỗi khác nhau: hỏng ở cổng attempt trả "Attempt not found", hỏng ở
cổng plan trả "Review plan not found". Gộp hai thứ đó lại là làm mất thông tin mà FE
đang dùng để phân biệt "bài không phải của bạn" với "bài này chưa có kế hoạch ôn".

Lỗi kế thừa `attempts.AttemptError` để route chỉ có MỘT chỗ bắt và MỘT bảng ánh xạ
sang mã HTTP. Không lớp nào ở đây biết con số HTTP.
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from app.application import attempts as attempts_uc


class ThieuAttemptId(attempts_uc.AttemptError):
    loi = "Thiếu attempt_id"


class AttemptChuaCham(attempts_uc.AttemptError):
    """Chưa chấm thì chưa có mastery, mà không có mastery thì không xếp được ưu tiên ôn."""
    loi = "Attempt chưa được chấm"


class ReviewPlanKhongTonTai(attempts_uc.AttemptError):
    loi = "Review plan not found"


class KhongTaoDuocPlan(attempts_uc.AttemptError):
    """`review.generate` trả None. Hiếm — LLM hỏng vẫn ra plan rule-based."""
    loi = "Không tạo được review plan"


def _bo_user_id(plan: Dict[str, Any]) -> Dict[str, Any]:
    plan.pop("user_id", None)
    return plan


def generate(attempt_id: Optional[str], user_id: Optional[str], *, force: bool,
             bat_buoc_chu_so_huu: bool) -> Tuple[Dict[str, Any], bool]:
    """(plan, tao_moi). Chạy ĐỒNG BỘ: đúng một lượt gọi LLM, và model hỏng vẫn ra plan
    rule-based nên không cần job nền như tạo quiz.

    `tao_moi=False` nghĩa là trả bản đã có trong kho — route dịch thành 200 kèm
    `cached: true`; `True` là vừa sinh, route dịch thành 201.
    """
    from app.domains.review import service as _review

    attempt_id = (attempt_id or "").strip()
    if not attempt_id:
        raise ThieuAttemptId()

    attempt = attempts_uc.load_owned_attempt(
        attempt_id, user_id, bat_buoc_chu_so_huu=bat_buoc_chu_so_huu)
    if attempt["status"] != "graded":
        raise AttemptChuaCham(status=attempt["status"])

    if not force:
        existing = _review.get_by_attempt(attempt_id)
        if existing:
            return {**_bo_user_id(existing), "cached": True}, False

    plan = _review.generate(attempt_id)
    if plan is None:
        raise KhongTaoDuocPlan()
    return _bo_user_id(plan), True


def by_attempt(attempt_id: str, user_id: Optional[str], *,
               bat_buoc_chu_so_huu: bool) -> Dict[str, Any]:
    """Đặc tả 7.7: tra theo `attempt_id`, không phải `review_plan_id`."""
    from app.domains.review import service as _review

    attempts_uc.load_owned_attempt(
        attempt_id, user_id, bat_buoc_chu_so_huu=bat_buoc_chu_so_huu)
    plan = _review.get_by_attempt(attempt_id)
    if not plan:
        raise ReviewPlanKhongTonTai()
    return _bo_user_id(plan)


def items(review_plan_id: str, user_id: Optional[str], *,
          bat_buoc_chu_so_huu: bool) -> Dict[str, Any]:
    """Sở hữu tra thẳng trên plan — không có attempt để đi qua."""
    from app.domains.review import service as _review

    plan = _review.get_plan(review_plan_id)
    if not plan or (bat_buoc_chu_so_huu and plan.get("user_id") != user_id):
        raise ReviewPlanKhongTonTai()
    return {"review_plan_id": plan["review_plan_id"],
            "attempt_id": plan["attempt_id"],
            "items": plan["items"]}
