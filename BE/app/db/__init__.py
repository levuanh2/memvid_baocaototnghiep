"""Kết nối PostgreSQL (Supabase) — engine + session cho tầng nghiệp vụ StudyMap.

`DATABASE_URL` đọc từ .env (BE/.env > ../.env qua shared.env_loader). Mật khẩu
PHẢI percent-encode: ký tự '#' để nguyên làm URL bị cắt tại đó (fragment).

Engine tạo LAZY ở lần gọi đầu — import module này không mở kết nối, nên test
không có DB vẫn import được. Đổi env trong test thì gọi reset_engine().
"""

from __future__ import annotations

import os
import sys
import threading
from contextlib import contextmanager
from typing import Iterator, Optional

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

_lock = threading.Lock()
_engine: Optional[Engine] = None
_SessionFactory: Optional[sessionmaker] = None


class DatabaseNotConfigured(RuntimeError):
    """DATABASE_URL chưa được cấu hình."""


def dang_chay_pytest() -> bool:
    """Tiến trình này có phải một lượt pytest không.

    `sys.modules` chứ không phải một biến env do conftest đặt: conftest chạy SAU khi
    pytest đã import vài thứ, nên có cửa sổ mà một import sớm mở kết nối trước khi cờ
    kịp được đặt. Không module nào trong `app/`, `shared/`, `services/`, `scripts/`
    import pytest (đã kiểm), nên dấu hiệu này không dương tính giả ở production.
    """
    return "pytest" in sys.modules or bool(os.getenv("PYTEST_CURRENT_TEST"))


def _danh_tinh_dich(url: str) -> tuple:
    """Nhận diện MỘT database: chỉ host + tên database.

    CỐ Ý bỏ cổng: Supabase mở cùng một database ở 5432 (session pooler) và 6543
    (transaction pooler). Đúng chỗ này đã che mắt một lần rồi — `BE/.env` và
    production trông "khác nhau" vì lệch cổng, trong khi chúng là cùng một database,
    và bộ test đã ghi/xoá dữ liệu production suốt nhiều tuần.

    CỐ Ý bỏ user và mật khẩu: chúng nói AI kết nối, không nói kết nối tới ĐÂU. Đưa
    user vào thì hai tài khoản khác nhau trỏ vào cùng một database sẽ bị coi là hai
    đích khác nhau, và hàng rào im lặng không nổ — đúng thứ nó sinh ra để chặn.
    """
    from urllib.parse import urlsplit

    p = urlsplit(url)
    return ((p.hostname or "").lower(), (p.path or "").rstrip("/").lower())


def database_url() -> str:
    if dang_chay_pytest():
        url = (os.getenv("TEST_DATABASE_URL") or "").strip()
        if not url:
            # KHÔNG rơi về `DATABASE_URL`. Rơi về chính là cách bộ test đã chạy vào
            # database production: `BE/.env` có `DATABASE_URL`, conftest không ghi đè,
            # và fixture tạo/xoá dòng thật. Thà hỏng ồn còn hơn sửa dữ liệu người dùng.
            raise DatabaseNotConfigured(
                "TEST_DATABASE_URL chưa được đặt. Test KHÔNG được dùng DATABASE_URL — "
                "đó là database production. Dựng một database test riêng rồi đặt biến "
                "này: xem `python -m scripts.setup_test_db --help`."
            )
        prod = (os.getenv("DATABASE_URL") or "").strip()
        if prod and _danh_tinh_dich(url) == _danh_tinh_dich(prod):
            raise DatabaseNotConfigured(
                "TEST_DATABASE_URL trỏ vào CÙNG database với DATABASE_URL "
                f"(host={_danh_tinh_dich(url)[0]}, db={_danh_tinh_dich(url)[1]}). "
                "Khác cổng KHÔNG phải khác database — Supabase mở cùng một database "
                "ở cả 5432 lẫn 6543. Dùng một database riêng cho test."
            )
    else:
        url = (os.getenv("DATABASE_URL") or "").strip()
        if not url:
            raise DatabaseNotConfigured(
                "DATABASE_URL chưa được đặt. Lấy connection string ở Supabase > Settings > "
                "Database và percent-encode mật khẩu (ví dụ '#' → '%23')."
            )
    # SQLAlchemy cần driver tường minh; 'postgresql://' mặc định là psycopg2 (chưa cài).
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def get_engine() -> Engine:
    global _engine, _SessionFactory
    with _lock:
        if _engine is None:
            url = database_url()

            # Pooler Supabase ở chế độ TRANSACTION (cổng 6543) tái dùng connection
            # backend giữa các client, nên prepared statement phía server đụng tên
            # nhau: `DuplicatePreparedStatement: prepared statement "_pg3_0" already
            # exists`. psycopg3 tự dùng prepared statement sau vài lần lặp câu lệnh,
            # nên lỗi chỉ nổ ra khi tải tăng — dễ qua mặt smoke test rồi chết ở thật.
            #
            # `prepare_threshold=None` tắt hẳn prepared statement phía server. Chỉ
            # bật cho cổng 6543: session pooler (5432) và kết nối trực tiếp giữ một
            # connection cho mỗi client nên không đụng, và giữ được prepared statement.
            connect_args: dict = {}
            if ":6543/" in url:
                connect_args["prepare_threshold"] = None

            _engine = create_engine(
                url,
                pool_pre_ping=True,   # pooler Supabase có thể cắt connection nhàn rỗi
                pool_size=5,
                max_overflow=5,
                pool_recycle=1800,
                future=True,
                connect_args=connect_args,
            )
            _SessionFactory = sessionmaker(bind=_engine, expire_on_commit=False, future=True)
        return _engine


def get_session_factory() -> sessionmaker:
    get_engine()
    assert _SessionFactory is not None
    return _SessionFactory


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transaction scope: commit khi thoát sạch, rollback khi có exception."""
    s = get_session_factory()()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def reset_engine() -> None:
    """Bỏ engine hiện tại (test đổi DATABASE_URL, hoặc rotate credential)."""
    global _engine, _SessionFactory
    with _lock:
        if _engine is not None:
            try:
                _engine.dispose()
            except Exception:
                pass
        _engine = None
        _SessionFactory = None
