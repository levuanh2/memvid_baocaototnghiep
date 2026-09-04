"""Kiểm tra kết nối và QUYỀN của kho object, trước khi tin vào nó.

`storage.is_configured()` chỉ nói "có hai biến env". Nó không nói bucket có tồn tại
không, khoá có quyền ghi không, hay object ghi xong có đọc lại được không. Ba câu hỏi
ấy chỉ trả lời được bằng cách làm thật.

Bật lưu bền index mà chưa trả lời chúng thì lần dựng lại đầu tiên sẽ chạy hết vài
nghìn chunk, tốn tiền embedding, rồi hỏng ở bước upload cuối. Rẻ hơn nhiều nếu hỏi
trước bằng một file rác vài chục byte.

KHÔNG chạm gì thuộc về dữ liệu thật: probe nằm dưới tiền tố riêng, tên ngẫu nhiên,
và bị xoá ngay sau khi đọc lại. Không đụng `index/`, không đụng file tài liệu.

KHÔNG tự tạo bucket. Tạo bucket trên production là thay đổi hạ tầng, phải nêu tường
minh (`ensure_bucket=True`), không phải tác dụng phụ của một lệnh kiểm tra.
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, Optional

TIEN_TO_PROBE = "_index_persistence_probe"


def _khoa_probe() -> str:
    """Tên tất định về HÌNH DẠNG, ngẫu nhiên về giá trị — hai lần chạy song song
    không giẫm lên nhau, và không bao giờ trùng một object thật."""
    return f"{TIEN_TO_PROBE}/{uuid.uuid4().hex}.txt"


def kiem_tra_kho(*, storage: Any = None, ensure_bucket: bool = False,
                 ) -> Dict[str, Any]:
    """Trả về báo cáo từng bước. KHÔNG ném — thiếu cấu hình là một kết quả, không
    phải một sự cố.

    Các bước, dừng ở bước đầu tiên hỏng:
        cấu hình → bucket → ghi → đọc lại → so byte → xoá probe

    So BYTE chứ không chỉ kiểm HTTP 200: một proxy trả 200 kèm trang lỗi vẫn là 200,
    và một kho ghi được nhưng đọc ra khác thì tệ hơn kho không ghi được.
    """
    ra: Dict[str, Any] = {"configured": False, "bucket": None, "buoc": {},
                          "ok": False, "loi": None}
    if storage is None:
        from app.domains.documents import storage as _s
        storage = _s

    if not storage.is_configured():
        ra["loi"] = ("chưa cấu hình: cần SUPABASE_URL và SUPABASE_SECRET_KEY")
        return ra
    ra["configured"] = True
    try:
        ra["bucket"] = storage.bucket()
    except Exception as exc:
        ra["loi"] = f"không đọc được tên bucket: {type(exc).__name__}"
        return ra

    khoa = _khoa_probe()
    noi_dung = f"probe {uuid.uuid4().hex}".encode("utf-8")

    if ensure_bucket:
        try:
            storage.ensure_bucket()
            ra["buoc"]["ensure_bucket"] = "PASS"
        except Exception as exc:
            ra["buoc"]["ensure_bucket"] = "FAIL"
            ra["loi"] = f"ensure_bucket: {type(exc).__name__}"
            return ra

    # GHI trước, vì `exists()` trên một bucket chưa tồn tại và trên một bucket rỗng
    # trả về cùng một câu trả lời — không phân biệt được "không có quyền" với
    # "chưa có file". Ghi thật thì lỗi nói đúng chuyện.
    try:
        storage.upload(khoa, noi_dung, content_type="text/plain")
        ra["buoc"]["write"] = "PASS"
    except Exception as exc:
        ra["buoc"]["write"] = "FAIL"
        ra["loi"] = f"ghi thất bại: {type(exc).__name__}"
        return ra

    try:
        ra["buoc"]["exists"] = "PASS" if storage.exists(khoa) else "FAIL"
    except Exception as exc:
        ra["buoc"]["exists"] = "FAIL"
        ra["loi"] = f"kiểm tồn tại thất bại: {type(exc).__name__}"

    try:
        doc_lai = storage.download(khoa)
        ra["buoc"]["read"] = "PASS" if doc_lai == noi_dung else "FAIL"
        if doc_lai != noi_dung:
            ra["loi"] = "đọc lại khác byte đã ghi"
    except Exception as exc:
        ra["buoc"]["read"] = "FAIL"
        ra["loi"] = f"đọc thất bại: {type(exc).__name__}"

    # Xoá LUÔN CHẠY, kể cả khi bước trên hỏng — không để lại rác trong bucket của
    # người ta. `storage.delete` là best-effort, không ném.
    try:
        ra["buoc"]["delete_probe"] = "PASS" if storage.delete(khoa) else "FAIL"
    except Exception as exc:  # pragma: no cover - delete đã tự nuốt lỗi
        ra["buoc"]["delete_probe"] = "FAIL"
        ra.setdefault("loi", f"xoá probe thất bại: {type(exc).__name__}")

    ra["ok"] = ra["loi"] is None and all(v == "PASS" for v in ra["buoc"].values())
    return ra


def in_bao_cao(ra: Dict[str, Any]) -> None:
    """In kết quả. KHÔNG in khoá, header, hay URL có token."""
    if not ra.get("configured"):
        print("SUPABASE: NOT CONFIGURED")
        print(f"  lý do: {ra.get('loi')}")
        return
    print("SUPABASE CONFIGURED")
    print(f"  BUCKET: {ra.get('bucket')!r}")
    ten = {"ensure_bucket": "ENSURE BUCKET", "write": "WRITE", "exists": "BUCKET ACCESS",
           "read": "READ", "delete_probe": "DELETE PROBE"}
    for k, v in ra.get("buoc", {}).items():
        print(f"  {ten.get(k, k.upper()):14}: {v}")
    if ra.get("loi"):
        print(f"  LỖI: {ra['loi']}")
    print(f"  KẾT LUẬN: {'PASS' if ra.get('ok') else 'FAIL'}")
