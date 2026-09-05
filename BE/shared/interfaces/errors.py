"""Phân loại lỗi truy hồi: hỏng ở CHỈ MỤC hay hỏng ở NHÀ CUNG CẤP embedding.

Vì sao cần: `query_graph` từng phân loại bằng cách dò chuỗi —

    if "embedding" in err_str.lower():   -> "chỉ mục không tương thích, hãy rebuild"

`RuntimeError("FPT embeddings HTTP 401: Invalid API Key")` có chữ "embedding", nên một
lỗi XÁC THỰC bị báo cho người dùng thành một lỗi CHỈ MỤC. Đo trên production 2026-09-05.
Hậu quả không chỉ là chữ nghĩa: nó đẩy người đọc đi dựng lại một index hoàn toàn lành
lặn — vài nghìn lượt gọi embedding trả tiền — trong khi việc cần làm là sửa một biến
môi trường.

Chữa bằng KIỂU, không bằng chuỗi. Mỗi lỗi mang sẵn mã của nó ở `MA_LOI`, và người phân
loại chỉ việc đọc thuộc tính ấy.

Vị trí file: `shared/interfaces/` là tầng port — không import gì từ `app/`. Nhờ vậy
adapter (`app/clients/llm_factory.py`) NÉM được các lớp này, còn domain và graph BẮT
được chúng, mà không ai phải biết FPT là gì. Lớp lỗi phía chỉ mục nằm lại ở
`app/domains/vectorstore/store.py` (nơi vốn sở hữu khái niệm index) và chỉ cần khai
`MA_LOI` là hàm phân loại ở đây nhận ra — nên `shared` không phải import ngược lên `app`.
"""

from __future__ import annotations

from typing import Any, Optional

# ── Mã lỗi (ổn định, đọc được bằng máy) ────────────────────────────────────
INDEX_INCOMPATIBLE = "INDEX_INCOMPATIBLE"
INDEX_MISSING = "INDEX_MISSING"
EMBEDDING_PROVIDER_AUTH_FAILED = "EMBEDDING_PROVIDER_AUTH_FAILED"
EMBEDDING_PROVIDER_UNAVAILABLE = "EMBEDDING_PROVIDER_UNAVAILABLE"
EMBEDDING_REQUEST_FAILED = "EMBEDDING_REQUEST_FAILED"

# Thông điệp cho người dùng. CHỈ `INDEX_INCOMPATIBLE` được phép khuyên dựng lại index —
# đó là lớp lỗi duy nhất mà dựng lại thật sự chữa được.
THONG_DIEP = {
    INDEX_INCOMPATIBLE:
        "Chỉ mục tài liệu không tương thích với embedding model hiện tại. "
        "Vui lòng rebuild index hoặc upload lại tài liệu.",
    INDEX_MISSING:
        "Không tìm thấy chỉ mục tài liệu cần thiết. "
        "Vui lòng kiểm tra lại dữ liệu hoặc index.",
    EMBEDDING_PROVIDER_AUTH_FAILED:
        "Dịch vụ embedding hiện không xác thực được. "
        "Vui lòng kiểm tra cấu hình API hoặc thử lại sau.",
    EMBEDDING_PROVIDER_UNAVAILABLE:
        "Dịch vụ embedding hiện không khả dụng hoặc đang quá tải. Vui lòng thử lại sau.",
    EMBEDDING_REQUEST_FAILED:
        "Yêu cầu embedding thất bại. Vui lòng thử lại sau.",
}


# ── Lỗi phía nhà cung cấp embedding ───────────────────────────────────────
class EmbeddingError(RuntimeError):
    """Gốc chung. Bắt lớp này là bắt mọi hỏng hóc của tầng embedding."""

    MA_LOI = EMBEDDING_REQUEST_FAILED


class EmbeddingProviderAuthFailed(EmbeddingError):
    """401/403 — khoá sai, hết hạn, hoặc không có quyền với model đang gọi.

    Thử lại KHÔNG chữa được, và dựng lại index càng không. Cố ý KHÔNG kèm thân phản
    hồi của nhà cung cấp: đó là chỗ dễ lọt thông tin nhạy cảm nhất trong cả nhóm này.
    """

    MA_LOI = EMBEDDING_PROVIDER_AUTH_FAILED


class EmbeddingProviderUnavailable(EmbeddingError):
    """Không gọi tới nơi, hoặc tới nơi mà bên kia bảo "thử lại sau".

    Gồm: hết thời gian chờ, lỗi kết nối/DNS, 429, và 5xx còn sót sau khi đã thử lại.
    Tất cả đều là "lát nữa có thể chạy", khác hẳn hai lớp còn lại.
    """

    MA_LOI = EMBEDDING_PROVIDER_UNAVAILABLE


class EmbeddingRequestFailed(EmbeddingError):
    """Tới được nhà cung cấp, nhưng yêu cầu sai về NGỮ NGHĨA.

    Ví dụ: 400 sai payload, 404 sai tên model, thân trả về không phải JSON, hoặc số
    vector trả về không khớp số đầu vào. Thử lại không đổi kết quả.
    """

    MA_LOI = EMBEDDING_REQUEST_FAILED


# ── Phân loại ─────────────────────────────────────────────────────────────
def ma_loi(exc: Any) -> Optional[str]:
    """Mã lỗi của một ngoại lệ, hoặc None nếu nó không tự khai.

    Đọc thuộc tính chứ không so kiểu: nhờ vậy lớp lỗi phía chỉ mục ở
    `app/domains/vectorstore` cũng được nhận ra mà `shared` không phải import `app`.
    None nghĩa là "chưa phân loại được" — người gọi phải xử lý như lỗi chung, KHÔNG
    được đoán bừa sang một lớp cụ thể.
    """
    ma = getattr(exc, "MA_LOI", None)
    return ma if ma in THONG_DIEP else None


def thong_diep(ma: Optional[str]) -> Optional[str]:
    """Thông điệp cho người dùng ứng với mã. Mã lạ → None, không bịa."""
    return THONG_DIEP.get(ma or "")
