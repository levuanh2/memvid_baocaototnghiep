"""Chạy Alembic có kiểm soát — điểm vào DUY NHẤT cho mọi migration, kể cả lúc deploy.

    python -m scripts.run_migrations                        # mặc định: TEST
    python -m scripts.run_migrations --moi-truong test
    python -m scripts.run_migrations --moi-truong production
    python -m scripts.run_migrations --kiem-tra             # chỉ in đích, không chạy

Vì sao là script chứ không phải một dòng shell dài trong `render.yaml`:

  * Logic quyết định "được phép chạm database nào" phải nằm ở nơi **test được**.
    Một chuỗi `VAR=1 VAR2=x alembic upgrade head` trong YAML thì không ai chạy thử
    được cho tới lúc deploy thật — và lúc đó nó chạm production.
  * `render.yaml` không được chứa credential; ở đây cũng vậy. Đích production được
    khai báo bằng TÊN (host + tên database), còn mật khẩu đi riêng qua `DATABASE_URL`
    do Render tiêm vào. Khai báo và bí mật tách đôi thì file cấu hình vẫn review được.

Script này KHÔNG nới lỏng chốt trong `alembic/env.py`. Nó thêm một tầng nữa:

    render.yaml → run_migrations (chọn chế độ, chặn nhầm lớp) → env.py (chốt gốc) → Alembic

Hai tầng chặn hai nhầm lẫn khác nhau. `env.py` chặn "đích này có hợp lệ không".
Script này chặn "đích này có đúng LỚP mà người gọi tuyên bố không" — deploy production
mà lại trỏ vào database test cũng là một sự cố, chỉ là im lặng hơn.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

BE_ROOT = Path(__file__).resolve().parents[1]
if str(BE_ROOT) not in sys.path:
    sys.path.insert(0, str(BE_ROOT))

MOI_TRUONG_TEST = "test"
MOI_TRUONG_PRODUCTION = "production"


def _in(nhan: str, gia_tri: str) -> None:
    print(f"  {nhan:<22}{gia_tri}")


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--moi-truong", choices=[MOI_TRUONG_TEST, MOI_TRUONG_PRODUCTION],
                   default=MOI_TRUONG_TEST,
                   help="lớp môi trường NGƯỜI GỌI tuyên bố (mặc định: test)")
    p.add_argument("--kiem-tra", action="store_true",
                   help="chỉ kiểm và in đích đã sanitize, không chạy migration")
    p.add_argument("--go-lui", metavar="REVISION", default=None,
                   help="hạ về REVISION thay vì upgrade head")
    args = p.parse_args()

    from shared.env_loader import load_project_env
    load_project_env()

    from shared.migration_guard import (
        ALLOWED_TEST_HOSTS,
        CHE_DO_PRODUCTION,
        TEST_DB_SUFFIX,
        MigrationTargetRejected,
        chon_dich,
        danh_tinh,
        kiem_tra_dich,
        sanitize,
    )

    muon_production = args.moi_truong == MOI_TRUONG_PRODUCTION

    # ── Tầng 1: lớp tuyên bố phải khớp cờ môi trường ─────────────────────────
    # Kiểm TRƯỚC khi gọi `chon_dich`, để thông điệp nói về ý định của người gọi chứ
    # không phải về biến môi trường nào đó thiếu.
    co_bat = (os.getenv("ALEMBIC_ALLOW_PRODUCTION") or "").strip().lower() in (
        "1", "true", "yes", "on")
    if muon_production and not co_bat:
        print("DỪNG: --moi-truong production nhưng ALEMBIC_ALLOW_PRODUCTION chưa bật.",
              file=sys.stderr)
        return 2
    if not muon_production and co_bat:
        # Cờ production còn sót trong môi trường mà người gọi lại xin chạy test:
        # `chon_dich` sẽ chọn production. Chặn ở đây, đừng để nó trôi qua.
        print("DỪNG: đang chạy chế độ test nhưng ALEMBIC_ALLOW_PRODUCTION đang bật. "
              "Gỡ biến đó, hoặc gọi với --moi-truong production nếu thật sự muốn.",
              file=sys.stderr)
        return 2

    try:
        url, che_do = chon_dich()
        kiem_tra_dich(url, che_do)
    except MigrationTargetRejected as exc:
        print(f"DỪNG: {exc}", file=sys.stderr)
        return 2

    host, db = danh_tinh(url)

    # ── Tầng 2: đích thật phải đúng LỚP mà người gọi tuyên bố ────────────────
    # Yêu cầu 11: deploy production mà trỏ vào database test là hỏng theo hướng
    # ngược lại — migration chạy đúng nhưng production không hề được nâng cấp, và
    # không có gì kêu lên.
    if muon_production:
        if host in ALLOWED_TEST_HOSTS or db.endswith(TEST_DB_SUFFIX):
            print(f"DỪNG: khai là production nhưng đích trông như database test "
                  f"({sanitize(url)}).", file=sys.stderr)
            return 2
        if che_do != CHE_DO_PRODUCTION:
            print("DỪNG: khai là production nhưng chốt phân loại đích là test.",
                  file=sys.stderr)
            return 2

    print(f"[migration] lớp môi trường: {args.moi_truong}")
    _in("chế độ chốt", che_do)
    p_url = urlsplit(url)
    _in("host", p_url.hostname or "?")
    _in("port", str(p_url.port or "?"))
    _in("database", db or "?")

    from alembic import command
    from alembic.config import Config

    cfg = Config(str(BE_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BE_ROOT / "alembic"))

    from alembic.script import ScriptDirectory
    _in("revision đích", args.go_lui or ScriptDirectory.from_config(cfg).get_current_head())

    if args.kiem_tra:
        print("[migration] chỉ kiểm tra — không chạy.")
        return 0

    # `env.py` chạy lại toàn bộ chốt lần nữa, kèm đối chiếu `current_database()` trên
    # kết nối sống. Trùng lặp là CỐ Ý: script này có thể bị bỏ qua, `env.py` thì không.
    if args.go_lui:
        command.downgrade(cfg, args.go_lui)
        print(f"[migration] downgrade {args.go_lui}: xong")
    else:
        command.upgrade(cfg, "head")
        print("[migration] upgrade head: xong")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
