"""
Định danh source DUY NHẤT (canonical) — nguồn sự thật cho việc khớp file giữa
upload → ingest → index metadata → registry → query-selection → delete.

Vì sao cần: trước đây "stem" được suy ra ở nhiều nơi với quy tắc khác nhau
(upload giữ khoảng trắng; lớp lưu trữ sanitize khoảng trắng → '_'; retrieval dùng
NFKD...). Tên file có khoảng trắng/ký tự đặc biệt/dấu tiếng Việt làm hai phía lệch
nhau → chọn file để hỏi bị "Không tìm thấy dữ liệu phù hợp". Module này gom về MỘT
quy tắc để mọi tầng luôn suy ra cùng một stem.

Quy tắc `canonical_source_stem`:
    1. basename (bỏ path);
    2. NFC normalize (ổn định, miễn nhiễm lệch NFC/NFKD; GIỮ dấu tiếng Việt);
    3. bỏ '.mp4' CHỈ khi có hậu tố timestamp — di sản lớp lưu trữ QR đã gỡ ở
       Phase 0; giữ lại để index/registry cũ vẫn canonical hoá được;
    4. sanitize char-by-char (non [alnum/_/-] → '_'); bước này tự fold mọi '.'
       (đuôi tài liệu) và khoảng trắng (kể cả no-break) → '_';
    5. bỏ hậu tố timestamp '_YYYYMMDD_HHMMSS';
    6. lower + strip('_').

Ví dụ (đều ra "my_report_pdf"):
  "My Report.pdf", "my report_pdf", "videos/My_Report_pdf_20250228_143022.mp4"
"""

from __future__ import annotations

import re
import unicodedata

# Hậu tố timestamp ingest gắn vào video (giống hybrid._STEM_TS_SUFFIX, tree.py).
_TS_SUFFIX = re.compile(r"_\d{8}_\d{6}$")
# ".mp4" CHỈ là container do ta tạo khi đứng ngay sau timestamp.
_GENERATED_MP4 = re.compile(r"_\d{8}_\d{6}\.mp4$", re.IGNORECASE)


def _sanitize_char(c: str) -> str:
    # Sanitize: giữ alnum (kể cả ký tự có dấu
    # unicode vì str.isalnum() True), '_' và '-'; còn lại (gồm '.', space,  ) → '_'.
    return c if (c.isalnum() or c in ("_", "-")) else "_"


def canonical_source_stem(name: str) -> str:
    """Chuẩn hoá tên file / video_path / stem về MỘT định danh khớp duy nhất."""
    s = (name or "").strip()
    if not s:
        return ""
    # 1) basename — tách thủ công, KHÔNG dùng `os.path.basename`: trên Linux nó không
    #    coi '\' là dấu phân cách, nên một đường dẫn Windows đi nguyên vào bước
    #    sanitize và ra stem khác hẳn (`c___users__a__my_report_pdf`). Điều kiện ngay
    #    trên đã nói rõ ý định là xử lý CẢ HAI dấu phân cách, bất kể hệ điều hành.
    if "/" in s or "\\" in s:
        s = re.split(r"[\\/]", s)[-1]
    # 2) NFC (ổn định, giữ dấu)
    s = unicodedata.normalize("NFC", s)
    # 3) chỉ bỏ '.mp4' khi là container ta tạo (có timestamp) — giữ '.mp4' của
    #    file tài liệu tên '*.mp4' để bước sanitize fold thành '_mp4' (khớp chunk).
    if _GENERATED_MP4.search(s):
        s = s[:-4]  # bỏ đúng ".mp4"
    # 4) sanitize (fold mọi '.' còn lại + khoảng trắng/ký tự lạ → '_')
    s = "".join(_sanitize_char(c) for c in s)
    # 5) bỏ hậu tố timestamp
    s = _TS_SUFFIX.sub("", s)
    # 6) chuẩn hoá cuối
    return s.strip("_").lower()


