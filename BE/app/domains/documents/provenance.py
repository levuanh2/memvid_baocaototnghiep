"""Tiến trình nào đã nạp tài liệu này: production, test, hay máy dev.

Vì sao cần một trường riêng thay vì suy ra từ dữ liệu sẵn có: cả bốn manh mối từng
được dùng đều hỏng theo một kiểu khác nhau.

- Tên file và email chủ sở hữu do NGƯỜI DÙNG đặt. `demo@local.test` có thể là người
  thật; `bao_cao_quy_3.pdf` có thể là fixture.
- `metadata_json.input_path` do server ghi nên tin được, nhưng nó trả lời "chạy trên
  máy nào", không phải "chạy với vai trò gì". Một container Linux ở CI và container
  Linux của production cho đường dẫn giống hệt nhau.
- Dấu thời gian chỉ nói "gần nhau", không nói "vì nhau".
- Suy từ việc hàng còn hay mất thì vô nghĩa ở kho này: khoảng 1.397 tài liệu đã bị
  xoá cứng trong vòng đời DB (xem .playbook 2026-09-04). Vắng mặt không là bằng chứng.

Nên trường này được ghi MỘT lần, lúc tạo hàng, bởi tiến trình đang chạy, từ cấu hình
của chính tiến trình đó. Nó không đi qua request body, header, query string hay
form field — `repository.create()` không nhận nó làm tham số, mà tự gọi hàm ở đây.
Một client không có đường nào chạm tới.

MẶC ĐỊNH LÀ KHÔNG PHẢI PRODUCTION. Thiếu cấu hình, cấu hình sai chính tả, biến rỗng
— tất cả ra `local`. Chỉ đúng chuỗi `production` mới ra production, và ngay cả thế
cũng thua cờ pytest.
"""

from __future__ import annotations

import os

NGUON_PRODUCTION = "production"
NGUON_TEST = "test"
NGUON_LOCAL = "local"

BIEN_MOI_TRUONG = "INGEST_ORIGIN"


def nguon_ingest() -> str:
    """Vai trò của tiến trình đang chạy. Một trong `production` / `test` / `local`.

    Thứ tự kiểm KHÔNG đổi được: pytest thắng cấu hình. Một biến `INGEST_ORIGIN` còn
    sót trong shell, hay một file `.env` bê nhầm từ production về, sẽ khiến bộ test
    sinh ra tài liệu mang nhãn production — mà nhãn đó là thứ duy nhất cho phép một
    tài liệu vào index. Đặt pytest trước là để cái nhầm ấy không tồn tại được.
    """
    from app.db import dang_chay_pytest

    if dang_chay_pytest():
        return NGUON_TEST
    cau_hinh = (os.getenv(BIEN_MOI_TRUONG) or "").strip().lower()
    return NGUON_PRODUCTION if cau_hinh == NGUON_PRODUCTION else NGUON_LOCAL


def la_production(nguon: object) -> bool:
    """Giá trị này có phải nhãn production không.

    Nhận `object` chứ không phải `str` vì đầu vào thật là `metadata_json` đọc từ DB —
    JSON có thể cho lại `None`, số, hay dict nếu ai đó ghi bậy. So sánh thẳng `==`
    với một giá trị lạ vẫn đúng, nhưng hàm này nói rõ ý định và là chỗ DUY NHẤT
    định nghĩa "thế nào là production" cho cả allowlist lẫn CLI kiểm kê.
    """
    return nguon == NGUON_PRODUCTION
