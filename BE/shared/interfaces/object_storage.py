"""
Seam cho kho object (lưu file nhị phân ngoài tiến trình).

Khớp với API công khai đã có của `app/domains/documents/storage.py` (Supabase Storage
qua REST): `upload(path, data)` / `download(path)` / `exists(path)`.

Vì sao có Protocol này thay vì gọi thẳng module Supabase: vòng đời index cần một kho
bền, nhưng nó không cần biết kho đó là Supabase. Tách ra để (a) test chạy với kho
trong bộ nhớ, không cần credential thật, và (b) đổi sang S3/GCS sau này không phải sửa
tầng index. Cùng lý do và cùng cách làm với `VectorStore`/`Retriever` trong thư mục này.

Dùng `typing.Protocol` nên module `storage` hiện có khớp mà KHÔNG cần kế thừa gì.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class ObjectStorage(Protocol):
    def upload(self, path: str, data: bytes, *, content_type: str | None = None) -> str:
        """Ghi `data` vào `path`, ghi đè nếu đã có. Trả về path đã lưu.

        Ném khi hỏng — im lặng nuốt lỗi ở tầng này là cách để một artifact thiếu file
        trở thành một index hỏng mà không ai biết."""
        ...

    def download(self, path: str) -> bytes:
        """Đọc toàn bộ object. Ném khi không có hoặc không đọc được."""
        ...

    def exists(self, path: str) -> bool:
        """Có object ở `path` không. KHÔNG ném khi thiếu — thiếu là câu trả lời."""
        ...
