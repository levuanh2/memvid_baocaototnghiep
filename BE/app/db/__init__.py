"""Kết nối PostgreSQL (Supabase) — engine + session cho tầng nghiệp vụ StudyMap.

`DATABASE_URL` đọc từ .env (BE/.env > ../.env qua shared.env_loader). Mật khẩu
PHẢI percent-encode: ký tự '#' để nguyên làm URL bị cắt tại đó (fragment).

Engine tạo LAZY ở lần gọi đầu — import module này không mở kết nối, nên test
không có DB vẫn import được. Đổi env trong test thì gọi reset_engine().
"""

from __future__ import annotations

import os
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


def database_url() -> str:
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
