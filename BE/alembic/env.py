"""Alembic env — lấy URL từ .env (shared.env_loader) và metadata từ app.db.models.

Chạy migration:
    cd BE && python -m alembic upgrade head

Dùng session pooler Supabase (port 5432). Transaction pooler (6543) KHÔNG chạy
được DDL nhiều câu trong một transaction.
"""

from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

BE_ROOT = Path(__file__).resolve().parents[1]
if str(BE_ROOT) not in sys.path:
    sys.path.insert(0, str(BE_ROOT))

from shared.env_loader import load_project_env  # noqa: E402

load_project_env()

from app.db.models import Base  # noqa: E402
from shared.migration_guard import (  # noqa: E402
    chon_dich,
    kiem_tra_dich,
    sanitize,
)

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ── Chốt chặn đích ───────────────────────────────────────────────────────────
# KHÔNG dùng `app.db.database_url()` nữa. Hàm đó chỉ đọc `TEST_DATABASE_URL` khi
# đang chạy dưới pytest; ngoài pytest nó rơi về `DATABASE_URL` = production. Đúng
# đường đó đã xoá nội dung `documents.metadata_json` trên production ngày 2026-09-05.
#
# `chon_dich` mặc định chọn database TEST và ném khi thiếu cấu hình — không có
# đường rơi ngầm về production. Kiểm hai lần: lần này trên chuỗi URL, lần sau trên
# kết nối SỐNG (`current_database()`), vì chuỗi kết nối có thể nói dối.
DB_URL, CHE_DO = chon_dich()
kiem_tra_dich(DB_URL, CHE_DO)
print(f"[alembic] đích: {sanitize(DB_URL)}  (chế độ {CHE_DO})")

# URL không nằm trong alembic.ini — mật khẩu chỉ sống trong .env (gitignore).
config.set_main_option("sqlalchemy.url", DB_URL.replace("%", "%%"))

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=DB_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    # Kiểm lần HAI, trên kết nối sống. Chuỗi URL có thể nói dối: pooler định tuyến đi
    # nơi khác, `PGDATABASE` ghi đè, DNS trỏ lại. Hỏi chính máy chủ trước khi chạy DDL.
    #
    # Phải là một kết nối RIÊNG, đóng lại trước khi alembic mở kết nối của nó. Bản đầu
    # chạy câu SELECT này trên chính `connection` của alembic: SQLAlchemy 2.0 mở
    # transaction ngầm ngay từ câu lệnh đầu tiên, `connect()` lúc thoát thì ROLLBACK,
    # và toàn bộ migration bị cuốn theo — `Running downgrade` vẫn in ra, `alembic_version`
    # không đổi, bảng không mất. Một hàng rào biến mọi migration thành no-op trong im
    # lặng còn tệ hơn không có hàng rào.
    from sqlalchemy import text as _text

    with connectable.connect() as _check:
        live = _check.execute(_text("SELECT current_database()")).scalar_one()
    kiem_tra_dich(DB_URL, CHE_DO, live_db_name=live)

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
