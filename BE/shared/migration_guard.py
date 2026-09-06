"""Chốt chặn đích của Alembic. Mặc định TỪ CHỐI.

Vì sao có file này: ngày 2026-09-05 một lệnh Alembic chạy ngoài pytest đã trỏ vào
Supabase PRODUCTION và xoá/dựng lại `documents.metadata_json` — mất sạch nội dung cột
đó trên 22 hàng thật. Cơ chế: `app.db.database_url()` chỉ đọc `TEST_DATABASE_URL` khi
`dang_chay_pytest()` đúng; ngoài pytest nó rơi về `DATABASE_URL`. Đặt
`TEST_DATABASE_URL` ở shell KHÔNG cứu được — đã đo:

    dang_chay_pytest() = False
    có TEST_DATABASE_URL  ->  vẫn resolve ra production

Bài học: chốt phải nằm ở CHOKEPOINT mà mọi đường Alembic đều đi qua (`alembic/env.py`),
không phải ở script mà chỉ người cẩn thận mới gọi. Chốt trong `scripts/setup_test_db`
chỉ bảo vệ đúng những người đã làm đúng — chính là nhóm không gây ra sự cố.

Ba nguyên tắc:
  1. **Fail closed.** Không cấu hình = từ chối. Im lặng không bao giờ là cho phép.
  2. **Hai điều kiện độc lập**, không phải một. Hậu tố `_test` là dấu hiệu YẾU NHẤT
     có thể có; nó không được đứng một mình.
  3. **Đối chiếu với kết nối SỐNG**, không chỉ với chuỗi URL. Pooler hay `PGDATABASE`
     có thể làm chuỗi nói dối.
"""

from __future__ import annotations

import os
from typing import Mapping, Optional, Tuple
from urllib.parse import urlsplit

#: Host được phép cho migration TEST. Allowlist chứ không phải blocklist: chặn theo
#: danh sách đen thì thêm một nhà cung cấp DB mới là thủng ngay.
#: `db`/`postgres` là tên service container trong CI (docker compose / GH Actions).
ALLOWED_TEST_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "db", "postgres"})

#: Hậu tố bắt buộc của tên database test.
TEST_DB_SUFFIX = "_test"

CHE_DO_TEST = "test"
CHE_DO_PRODUCTION = "production"


class MigrationTargetRejected(RuntimeError):
    """Đích migration không đạt điều kiện. Thông điệp nói RÕ vì sao, không kèm credential."""


def danh_tinh(url: str) -> Tuple[str, str]:
    """Nhận diện MỘT database: (host, tên_db). CỐ Ý bỏ cổng, user và mật khẩu.

    Bỏ cổng vì Supabase mở cùng một database ở 5432 (session pooler) và 6543
    (transaction pooler) — production đang chạy 6543 còn tài liệu khuyên 5432. Đúng
    chỗ lệch cổng này từng che mắt một lần rồi. Bỏ user vì nó nói AI kết nối, không
    nói kết nối tới ĐÂU.
    """
    p = urlsplit(url or "")
    return ((p.hostname or "").lower(), (p.path or "").lstrip("/").rstrip("/").lower())


def sanitize(url: str) -> str:
    """host:port/db — KHÔNG BAO GIỜ có user hay mật khẩu."""
    p = urlsplit(url or "")
    return f"{p.hostname or '?'}:{p.port or '?'}/{(p.path or '').lstrip('/') or '?'}"


def chuan_hoa_driver(url: str) -> str:
    """`postgresql://` → `postgresql+psycopg://`.

    Cùng luật với `app.db.database_url()`: SQLAlchemy mặc định `postgresql://` là
    psycopg2, gói KHÔNG được cài trong dự án này. Chốt tự chọn URL nên phải mang
    theo luôn phép chuẩn hoá đó, nếu không mọi migration chết ở `ModuleNotFoundError:
    psycopg2` — một lỗi nói về driver, không nói gì về đích đến.
    """
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def _s(env: Mapping[str, str], name: str) -> str:
    return (env.get(name) or "").strip()


def _truthy(env: Mapping[str, str], name: str) -> bool:
    return _s(env, name).lower() in ("1", "true", "yes", "on")


def chon_dich(env: Optional[Mapping[str, str]] = None) -> Tuple[str, str]:
    """Chọn URL đích + chế độ, TRƯỚC khi kết nối.

    Mặc định là TEST. Production chỉ tới được bằng một lựa chọn tường minh, và
    ngay cả khi đó vẫn còn phải qua `kiem_tra_dich`.
    """
    env = os.environ if env is None else env
    if _truthy(env, "ALEMBIC_ALLOW_PRODUCTION"):
        url = _s(env, "DATABASE_URL")
        if not url:
            raise MigrationTargetRejected(
                "ALEMBIC_ALLOW_PRODUCTION=1 nhưng DATABASE_URL trống.")
        return chuan_hoa_driver(url), CHE_DO_PRODUCTION

    url = _s(env, "TEST_DATABASE_URL")
    if not url:
        raise MigrationTargetRejected(
            "TEST_DATABASE_URL chưa đặt. Migration mặc định CHỈ chạy trên database "
            "test. KHÔNG rơi về DATABASE_URL — đó là production, và rơi về chính là "
            "cách sự cố 2026-09-05 xảy ra. Dựng DB test: "
            "`python -m scripts.setup_test_db --help`.")
    return chuan_hoa_driver(url), CHE_DO_TEST


def kiem_tra_dich(url: str, che_do: str, *, live_db_name: Optional[str] = None,
                  env: Optional[Mapping[str, str]] = None) -> None:
    """Chặn nếu đích không hợp lệ. `live_db_name` = `SELECT current_database()`.

    Gọi hai lần trong `env.py`: một lần trước khi kết nối (chưa có `live_db_name`),
    một lần sau khi kết nối (có) — chuỗi URL có thể nói dối, kết nối sống thì không.
    """
    env = os.environ if env is None else env
    host, db = danh_tinh(url)

    if not host or not db:
        raise MigrationTargetRejected(f"URL đích không phân giải được host/database: {sanitize(url)}")

    if che_do == CHE_DO_PRODUCTION:
        # Cờ ĐƠN LẺ không đủ (yêu cầu 3): phải khai báo TRƯỚC đích production là gì,
        # rồi đích thật phải khớp. Bật cờ mà trỏ nhầm database vẫn bị chặn.
        mong_host = _s(env, "ALEMBIC_PRODUCTION_HOST").lower()
        mong_db = _s(env, "ALEMBIC_PRODUCTION_DB").lower()
        if not mong_host or not mong_db:
            raise MigrationTargetRejected(
                "Migration production cần khai báo tường minh ALEMBIC_PRODUCTION_HOST "
                "và ALEMBIC_PRODUCTION_DB. Chỉ bật ALEMBIC_ALLOW_PRODUCTION là CHƯA đủ.")
        if (host, db) != (mong_host, mong_db):
            raise MigrationTargetRejected(
                f"Đích production không khớp khai báo: thấy {host}/{db}, "
                f"khai báo {mong_host}/{mong_db}.")
        if live_db_name is not None and live_db_name.lower() != mong_db:
            raise MigrationTargetRejected(
                f"current_database() = {live_db_name!r} khác database production đã "
                f"khai báo {mong_db!r}.")
        return

    # ── chế độ TEST ──────────────────────────────────────────────────────────
    if host not in ALLOWED_TEST_HOSTS:
        raise MigrationTargetRejected(
            f"Host {host!r} không nằm trong danh sách host test cho phép "
            f"({sorted(ALLOWED_TEST_HOSTS)}). Đích: {sanitize(url)}")

    if not db.endswith(TEST_DB_SUFFIX):
        raise MigrationTargetRejected(
            f"Tên database {db!r} không kết thúc bằng {TEST_DB_SUFFIX!r}. Đích: {sanitize(url)}")

    prod = _s(env, "DATABASE_URL")
    if prod and danh_tinh(prod) == (host, db):
        # Điều kiện độc lập thứ hai: tên "trông giống test" không cứu được nếu nó
        # CHÍNH LÀ database mà production đang dùng.
        raise MigrationTargetRejected(
            "Đích test trùng danh tính với DATABASE_URL (so host + tên database, bỏ "
            "qua cổng). Đây chính là cùng một database.")

    if live_db_name is not None and live_db_name.lower() != db:
        raise MigrationTargetRejected(
            f"current_database() = {live_db_name!r} khác database trong URL {db!r}. "
            "Chuỗi kết nối đang nói dối (pooler hoặc PGDATABASE ghi đè).")
