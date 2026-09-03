"""Use case đọc trạng thái và huỷ job nền — đặc tả 7.10, Phase 0 observability.

Trước Phase 2D, cùng một chính sách được chép ở bốn chỗ trong `main.py`: tra job, gác
loại, gác chủ sở hữu (404 để không tạo oracle), rồi dựng bản công khai. Khác biệt giữa
bốn bản ấy chỉ là một hai trường, và đó là loại khác biệt biến mất trong lúc gộp. Ở đây
chúng thành **tham số tường minh**:

    xem(..., kem_job_type=True)   -> 7 trường  (route /api/jobs/<id>)
    xem(..., kem_job_type=False)  -> 6 trường  (route theo domain, loại đã nằm trong URL)

Hai luật HUỶ thì KHÔNG gộp được, và cố ý để hai hàm riêng:

- `huy_chung` (route `/api/jobs/<id>/cancel`) luôn tra job, rồi gác bằng
  `LOAI_HUY_DUOC`; loại không nằm trong tập đó bị từ chối thẳng.
- `huy_theo_loai` (route quiz / study-map) **chỉ gác khi bắt buộc chủ sở hữu**. Khi
  `AUTH_PROTECT_APP_APIS` tắt, đường này không kiểm gì cả — kể cả job có tồn tại hay
  không. Đó là hành vi ĐANG CÓ; viết chung một hàm với `huy_chung` sẽ âm thầm thêm một
  cổng vào chế độ mở.

Tầng này không biết HTTP: không `request`, không `jsonify`, không một con số status nào.
Lỗi kế thừa `attempts.AttemptError` để `main.py` giữ đúng MỘT chỗ bắt và MỘT bảng ánh xạ.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

from app.application import attempts as attempts_uc

# Job_type mà executor THẬT SỰ gọi `is_cancel_requested` giữa các bước.
# Kiểm bằng: grep -rn "is_cancel_requested" BE/app BE/services --include=*.py
# Thêm loại vào đây CHỈ SAU KHI executor của nó thật sự đọc cờ — nếu không, FE hiện
# "Đang huỷ…" rồi treo tới hết TTL (đúng lớp lỗi known-issues 2026-07-17).
LOAI_HUY_DUOC = {"mindmap", "summary", "quiz_generation", "study_map_generation", "query"}


class JobKhongTonTai(attempts_uc.AttemptError):
    """Không có, của người khác, hoặc sai loại — CỐ Ý cùng một thân lỗi.

    Ba ca phân biệt được là ba mẩu thông tin về dữ liệu của người khác."""
    loi = "Job not found"


class JobKhongHoTroHuy(attempts_uc.AttemptError):
    """Loại job không có điểm kiểm huỷ trong executor. Từ chối thẳng, không hứa suông."""

    def __init__(self, job_id: str, job_type: Optional[str]):
        super().__init__(f"Loại job '{job_type}' không hỗ trợ huỷ giữa chừng.",
                         job_id=job_id, cancel_requested=False)


def _load_owned_job(job_id: str, user_id: Optional[str], *,
                    loai_cho_phep: Optional[Iterable[str]],
                    bat_buoc_chu_so_huu: bool) -> Dict[str, Any]:
    from app.domains.jobs.jobs_store import get_job as _js_get

    j = _js_get(job_id)
    if not j:
        raise JobKhongTonTai()
    if loai_cho_phep is not None and j.get("job_type") not in loai_cho_phep:
        raise JobKhongTonTai()
    if bat_buoc_chu_so_huu and j.get("user_id") != user_id:
        raise JobKhongTonTai()
    return j


def chu_so_huu_hop_le(job_id: str, user_id: Optional[str],
                      loai_cho_phep: Iterable[str]) -> Optional[bool]:
    """Tri-state cho các route CHƯA chuyển (summary/mindmap cancel).

    `None` = không biết job, hoặc job thuộc loại khác; `True` = đúng chủ; `False` = chủ
    khác. Caller hiện tại coi cả `None` lẫn `False` là 404, nhưng ba giá trị vẫn phải
    phân biệt được vì đó là chữ ký đang có.

    Lỗi khi đọc kho job cũng cho `None` — đọc hỏng không được biến thành "cho qua".
    """
    try:
        from app.domains.jobs.jobs_store import get_job as _js_get
        row = _js_get(job_id)
    except Exception:
        row = None
    if row is None or row.get("job_type") not in loai_cho_phep:
        return None
    return row.get("user_id") == user_id


def xem(job_id: str, user_id: Optional[str], *,
        loai_cho_phep: Optional[Iterable[str]] = None,
        kem_job_type: bool = True,
        bat_buoc_chu_so_huu: bool) -> Dict[str, Any]:
    """Bản công khai của một job.

    `kem_job_type=False` cho route đã mang loại trong đường dẫn — thêm `job_type` vào
    đó là đổi hợp đồng của một API đang chạy, dù trông có vẻ vô hại.
    """
    j = _load_owned_job(job_id, user_id, loai_cho_phep=loai_cho_phep,
                        bat_buoc_chu_so_huu=bat_buoc_chu_so_huu)
    out: Dict[str, Any] = {"job_id": job_id}
    if kem_job_type:
        out["job_type"] = j.get("job_type")
    out.update({
        "status": j.get("status"),
        "progress": j.get("progress", 0),
        "current_step": j.get("current_node") or "",
        "result": j.get("result"),
        "error": j.get("error"),
    })
    return out


def huy_chung(job_id: str, user_id: Optional[str], *,
              bat_buoc_chu_so_huu: bool) -> Dict[str, Any]:
    """Huỷ bất kể loại — nhưng chỉ những loại executor thật sự đọc cờ."""
    from app.domains.jobs.jobs_store import request_cancel

    j = _load_owned_job(job_id, user_id, loai_cho_phep=None,
                        bat_buoc_chu_so_huu=bat_buoc_chu_so_huu)
    if (j.get("job_type") or "") not in LOAI_HUY_DUOC:
        raise JobKhongHoTroHuy(job_id, j.get("job_type"))
    request_cancel(job_id)
    return {"job_id": job_id, "cancel_requested": True}


def huy_theo_loai(job_id: str, user_id: Optional[str], *,
                  loai_cho_phep: Iterable[str],
                  bat_buoc_chu_so_huu: bool) -> Dict[str, Any]:
    """Huỷ job của một domain cụ thể.

    Cổng CHỈ chạy khi `bat_buoc_chu_so_huu` — giữ nguyên hành vi đang có ở chế độ mở,
    nơi đường này không kiểm tồn tại lẫn loại. Đừng "sửa" ở đây: nó là thay đổi hành vi,
    không phải dọn dẹp.
    """
    from app.domains.jobs.jobs_store import request_cancel

    if bat_buoc_chu_so_huu and chu_so_huu_hop_le(job_id, user_id, loai_cho_phep) is not True:
        raise JobKhongTonTai()
    request_cancel(job_id)
    return {"job_id": job_id, "cancel_requested": True}


def _tong_ket(events: List[dict], created_at: Any) -> Dict[str, Any]:
    """(total_ms, llm_calls, queue_wait_ms). `None` nghĩa là KHÔNG ĐO ĐƯỢC, khác 0."""
    total_ms = 0.0
    llm_calls = None
    for e in events:
        try:
            total_ms += float(e.get("duration_ms") or 0.0)
        except Exception:
            pass
        md = e.get("metadata") or {}
        if "llm_calls" in md:
            try:
                llm_calls = int(md["llm_calls"])
            except Exception:
                pass

    # queue_wait_ms best-effort: created_at (isoformat UTC) → ts event đầu tiên
    # (sqlite datetime('now'), UTC). Parse lỗi → None, không bao giờ ném lên route.
    queue_wait_ms = None
    try:
        if events and created_at:
            from datetime import datetime, timezone
            t0 = datetime.fromisoformat(str(created_at))
            if t0.tzinfo is None:
                t0 = t0.replace(tzinfo=timezone.utc)
            t1 = datetime.strptime(str(events[0]["ts"]), "%Y-%m-%d %H:%M:%S").replace(
                tzinfo=timezone.utc)
            qw = (t1 - t0).total_seconds() * 1000.0
            if qw >= 0:
                queue_wait_ms = round(qw, 1)
    except Exception:
        pass

    return {"total_ms": total_ms, "llm_calls": llm_calls, "queue_wait_ms": queue_wait_ms}


def dong_thoi_gian(job_id: str, user_id: Optional[str], *,
                   bat_buoc_chu_so_huu: bool) -> Dict[str, Any]:
    """Timeline read-only của MỘT job từ `node_logs`.

    Cùng hợp đồng quyền như `xem`. Kho log vắng hoặc hỏng thì `events` thành `[]` —
    `read_job_events` đã nuốt lỗi, và ở đây không dựng lại lớp bảo vệ thứ hai.
    """
    from app.graphs.logger import read_job_events

    j = _load_owned_job(job_id, user_id, loai_cho_phep=None,
                        bat_buoc_chu_so_huu=bat_buoc_chu_so_huu)
    events = read_job_events(job_id)
    return {
        "job_id": job_id,
        "job_type": j.get("job_type"),
        "status": j.get("status"),
        "progress": j.get("progress", 0),
        "events": events,
        "totals": _tong_ket(events, j.get("created_at")),
    }
