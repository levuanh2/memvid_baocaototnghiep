"""Helper dùng chung cho tầng Application — không biết HTTP, không biết Flask.

Bốn thứ ở đây trước nằm trong `app/main.py` vì đó là nơi duy nhất có sẵn. Chúng không
phải mối bận tâm của tầng API: chúng nói về **vòng đời một job nền** — huỷ, dịch lỗi cho
người đọc, giữ nhịp tim, và gọi LangGraph. `main.py` import ngược lại dưới tên private
cũ (`_job_error_text`…) để mọi chỗ gọi hiện có và test đang tham chiếu không phải đổi.

Ràng buộc tầng: file này KHÔNG được import flask, faiss, hay ollama.
"""

from __future__ import annotations

import contextlib
import threading
import uuid
from typing import Any

class _JobCancelled(Exception):
    """Người dùng bấm huỷ — không phải lỗi, không ghi error_text."""

_LOI_AI_DE_HIEU = (
    ("LLM busy (in-process)",
     "Hệ thống đang bận: máy này chỉ chạy được một yêu cầu AI mỗi lúc và hàng đợi "
     "chờ quá lâu. Thử lại sau ít phút."),
    ("LLM gateway busy",
     "Hệ thống đang bận: hàng đợi AI đã đầy. Thử lại sau ít phút."),
    ("timed out",
     "Máy không sinh xong trong thời gian cho phép. Thử giảm số câu, thu hẹp phạm vi "
     "tài liệu, hoặc dùng model nhẹ hơn."),
)

def _job_error_text(exc: BaseException) -> str:
    """Nhiều built-in (TimeoutError, RuntimeError…) có str(exc)==''; không bao giờ trả chuỗi rỗng."""
    msg = str(exc).strip()
    if msg:
        for dau_hieu, cau in _LOI_AI_DE_HIEU:
            if dau_hieu in msg:
                return f"{cau} (chi tiết: {msg})"
        return msg
    name = getattr(type(exc), "__name__", None) or type(exc).__qualname__ or "Exception"
    return f"{name}: không có nội dung chi tiết (xem traceback trong log server)."

def _langgraph_invoke(graph: Any, state: dict, *, thread_id: str, command: Any = None) -> dict:
    """Graph compile với SqliteSaver yêu cầu configurable.thread_id.

    command != None → resume một interrupt (HITL): truyền Command(resume=...) thay cho state.
    """
    tid = (thread_id or "").strip() or str(uuid.uuid4())
    try:
        return graph.invoke(command if command is not None else state, config={"configurable": {"thread_id": tid}})
    except Exception as e:
        # LangGraph / thư viện đôi khi ném exception str() rỗng — bọc để job/SSE có nội dung.
        if not str(e).strip():
            raise RuntimeError(_job_error_text(e)) from e
        raise

@contextlib.contextmanager
def _nhip_tim_job(job_id: str, moi_giay: float = 120.0):
    """Báo "còn sống" đều đặn trong lúc một bước dài không có tiến trình để báo.

    `sweep_stuck_jobs` quét job `running` không chạm `updated_at` quá
    `JOB_STUCK_AFTER_SECONDS` (mặc định 900) thành `interrupted`. Bước gọi model của
    quiz nằm trọn giữa `progress=30` và `progress=70`: `QUIZ_LLM_TIMEOUT_SEC=900` nhân
    `MAX_ATTEMPTS=2` là tối đa 1800s im lặng. Job đang chạy tử tế bị quét, người dùng
    bấm lại, và job thứ hai tranh 1 slot LLM — đúng lỗi vòng 7 quay lại bằng cửa khác.

    Việc phụ: hỏng thì im, không được ném vào luồng job.
    """
    dung = threading.Event()

    def _chay() -> None:
        from app.domains.jobs import jobs_store as _js
        while not dung.wait(moi_giay):
            try:
                _js.touch_job(job_id)
            except Exception:
                pass

    t = threading.Thread(target=_chay, daemon=True)
    t.start()
    try:
        yield
    finally:
        dung.set()
