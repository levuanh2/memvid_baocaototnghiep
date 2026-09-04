"""Chuẩn bị database TEST (chạy alembic lên đó). Không bao giờ chạm production.

    TEST_DATABASE_URL=postgresql://... python -m scripts.setup_test_db
    TEST_DATABASE_URL=postgresql://... python -m scripts.setup_test_db --kiem-tra

Vì sao script này tồn tại: `tests/conftest.py` KHÔNG ghi đè `DATABASE_URL`, nên trước
2026-09-04 mọi lượt `pytest` cục bộ đọc `BE/.env` và chạy thẳng vào database
PRODUCTION — fixture tạo user/tài liệu thật, và bước dọn dẹp `sa_delete(Document)`
xoá thật. `app/db.database_url()` giờ đòi `TEST_DATABASE_URL` khi đang chạy dưới
pytest và KHÔNG rơi về `DATABASE_URL`; script này dựng cái database ấy.

Dựng nhanh một Postgres cục bộ:

    docker run --rm -d --name studymap-test-db -p 55432:5432 \
        -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=studymap_test postgres:16-alpine

    TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/studymap_test

HAI hàng rào, không phải một — tên database "trông giống test" là dấu hiệu yếu nhất
có thể có, nên nó không được đứng một mình:

  1. Chỉ đọc `TEST_DATABASE_URL`; script này KHÔNG BAO GIỜ đọc `DATABASE_URL` để lấy
     đích đến.
  2. Nếu `DATABASE_URL` có mặt và trỏ vào CÙNG database (host + tên db + user, bỏ qua
     cổng), script từ chối chạy.

Không in mật khẩu, không in URL đầy đủ.
"""

from __future__ import annotations

import argparse
import os
import sys
from urllib.parse import urlsplit


def _mo_ta(url: str) -> str:
    """Mô tả đích đến mà KHÔNG lộ credential."""
    p = urlsplit(url)
    return f"{p.hostname}:{p.port or 5432}{p.path}"


def kiem_hang_rao() -> tuple[bool, str]:
    from app.db import _danh_tinh_dich

    test_url = (os.getenv("TEST_DATABASE_URL") or "").strip()
    if not test_url:
        return False, ("TEST_DATABASE_URL chưa được đặt. Đây là biến DUY NHẤT script "
                       "này đọc — nó không bao giờ lấy đích từ DATABASE_URL.")
    prod = (os.getenv("DATABASE_URL") or "").strip()
    if prod and _danh_tinh_dich(test_url) == _danh_tinh_dich(prod):
        return False, ("TEST_DATABASE_URL trỏ vào CÙNG database với DATABASE_URL. "
                       "Khác cổng KHÔNG phải khác database — Supabase mở cùng một "
                       "database ở cả 5432 lẫn 6543.")
    return True, _mo_ta(test_url)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--kiem-tra", action="store_true",
                   help="chỉ kiểm hàng rào và in đích đến, không chạy migration")
    args = p.parse_args()

    ok, thong_diep = kiem_hang_rao()
    if not ok:
        print(f"DỪNG: {thong_diep}", file=sys.stderr)
        return 2
    print(f"Đích test: {thong_diep}")
    if args.kiem_tra:
        print("(chỉ kiểm tra — không chạy migration)")
        return 0

    # Alembic đi qua `app.db.database_url()`, và hàm ấy trả về TEST_DATABASE_URL khi
    # đang chạy dưới pytest. Script này KHÔNG chạy dưới pytest, nên phải ép tường minh.
    os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]

    from alembic import command
    from alembic.config import Config

    from shared.paths import BE_ROOT

    cfg = Config(str(BE_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BE_ROOT / "alembic"))
    command.upgrade(cfg, "head")
    print("alembic upgrade head: xong")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
