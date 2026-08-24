"""Định dạng tài liệu nhận được — NGUỒN SỰ THẬT DUY NHẤT.

Trước đây có BA danh sách rời nhau và chúng lệch nhau thật:
  - `FE/src/pages/study/DocumentList.jsx` cho chọn 4 đuôi
  - `document_loader.SUPPORTED_LC_EXTENSIONS` nhận 8 đuôi
  - `markdown_convert.to_markdown` xử lý 9 đuôi, lại là tập khác
Hậu quả: `.csv`/`.json` đọc tốt nhưng FE giấu, còn `.html` lọt vào loader mà
không có thư viện đọc nên chết lặng. Mọi chỗ kiểm đuôi file phải import từ đây.

Module này cố ý KHÔNG import gì nặng (không langchain, không fitz) để
`app/main.py` nạp được mà không kéo theo cả stack model.
"""

from __future__ import annotations

# Nhóm theo BỘ ĐỌC, không theo cảm tính — thêm đuôi mới thì thêm vào đúng nhóm
# và hàm đọc tương ứng đã có sẵn, không phải viết nhánh mới.

# Đọc thẳng bằng open()
TEXT = {".txt", ".md"}

# PyMuPDF (fitz) mở native, cùng một hàm đọc theo trang
PYMUPDF = {".pdf", ".epub", ".mobi", ".fb2", ".xps"}

# python-docx / LibreOffice
WORD = {".docx", ".doc"}

# Office Open XML khác
PPTX = {".pptx"}
XLSX = {".xlsx"}

# OpenDocument — đi qua LibreOffice (soffice) rồi đọc như OOXML
OPENDOCUMENT = {".odt", ".odp"}

WEB = {".html", ".htm"}
DATA = {".csv", ".json"}
RICH_TEXT = {".rtf"}

# OCR qua Tesseract — cần nhị phân ngoài, thiếu thì trả chuỗi rỗng
IMAGE = {".png", ".jpg", ".jpeg", ".gif", ".bmp"}

SUPPORTED_EXTENSIONS = (
    TEXT | PYMUPDF | WORD | PPTX | XLSX | OPENDOCUMENT | WEB | DATA | RICH_TEXT | IMAGE
)


def is_supported(filename: str) -> bool:
    """Đuôi file có đọc được không. So khớp không phân biệt hoa thường."""
    import os

    return os.path.splitext(filename or "")[1].lower() in SUPPORTED_EXTENSIONS


def accept_attribute() -> str:
    """Chuỗi cho `<input type="file" accept=...>` của FE, sắp xếp ổn định.

    Test `BE/tests/test_upload_formats.py` khoá chuỗi này khớp với FE để ba
    danh sách không lệch nhau lần nữa.
    """
    return ",".join(sorted(SUPPORTED_EXTENSIONS))
