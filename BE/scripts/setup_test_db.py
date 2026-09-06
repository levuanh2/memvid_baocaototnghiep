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

    # Nạp .env TRƯỚC khi so sánh. Không nạp thì `DATABASE_URL` rỗng, phép so bên dưới
    # bị bỏ qua trong im lặng, và một URL production đặt vào TEST_DATABASE_URL sẽ đi
    # lọt — đã đo 2026-09-05: `--kiem-tra` in ra "Đích test: <host production>".
    # Hàng rào so với một giá trị chưa nạp là hàng rào không tồn tại.
    from shared.env_loader import load_project_env
    load_project_env()

    test_url = (os.getenv("TEST_DATABASE_URL") or "").strip()
    if not test_url:
        return False, ("TEST_DATABASE_URL chưa được đặt. Đây là biến DUY NHẤT script "
                       "này đọc — nó không bao giờ lấy đích từ DATABASE_URL.")
    prod = (os.getenv("DATABASE_URL") or "").strip()
    if prod and _danh_tinh_dich(test_url) == _danh_tinh_dich(prod):
        return False, ("TEST_DATABASE_URL trỏ vào CÙNG database với DATABASE_URL. "
                       "Khác cổng KHÔNG phải khác database — Supabase mở cùng một "
                       "database ở cả 5432 lẫn 6543.")

    # Cùng một chốt mà `alembic/env.py` dùng, áp ngay ở đây để `--kiem-tra` trả lời
    # đúng câu hỏi "đích này có hợp lệ không" thay vì chỉ in nó ra.
    from shared.migration_guard import (
        CHE_DO_TEST,
        MigrationTargetRejected,
        kiem_tra_dich,
    )
    try:
        kiem_tra_dich(test_url, CHE_DO_TEST)
    except MigrationTargetRejected as exc:
        return False, str(exc)

    return True, _mo_ta(test_url)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--kiem-tra", action="store_true",
                   help="chỉ kiểm hàng rào và in đích đến, không chạy migration")
    # Downgrade cũng phải đi qua ĐÚNG hàng rào này. Không có cờ ở đây thì người ta sẽ
    # quay lại gõ `python -c "from alembic import command..."` — chính là lệnh đã trỏ
    # nhầm vào production ngày 2026-09-05.
    p.add_argument("--go-lui", metavar="REVISION", default=None,
                   help="hạ về REVISION (ví dụ ea56c24b17bb) trên DB test, qua cùng hàng rào")
    args = p.parse_args()

    ok, thong_diep = kiem_hang_rao()
    if not ok:
        print(f"DỪNG: {thong_diep}", file=sys.stderr)
        return 2
    print(f"Đích test: {thong_diep}")
    if args.kiem_tra:
        print("(chỉ kiểm tra — không chạy migration)")
        return 0

    # KHÔNG còn ghi đè `DATABASE_URL` bằng `TEST_DATABASE_URL` nữa.
    #
    # Dòng đó từng cần vì `alembic/env.py` gọi `app.db.database_url()`, vốn ngoài
    # pytest chỉ đọc `DATABASE_URL`. Từ 2026-09-05 env.py tự chọn đích qua
    # `shared.migration_guard.chon_dich()`, nên việc ghi đè vừa thừa vừa NGUY HIỂM:
    # nó xoá mất chính giá trị mà chốt dùng để trả lời câu hỏi "đích test này có
    # trùng production không", khiến hàng rào mạnh nhất tự vô hiệu hoá.
    from alembic import command
    from alembic.config import Config

    from shared.paths import BE_ROOT

    cfg = Config(str(BE_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BE_ROOT / "alembic"))
    if args.go_lui:
        command.downgrade(cfg, args.go_lui)
        print(f"alembic downgrade {args.go_lui}: xong")
        return 0
    command.upgrade(cfg, "head")
    print("alembic upgrade head: xong")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
