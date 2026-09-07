"""User store trên PostgreSQL (Supabase) — bảng `users` theo đặc tả mục 5.1.

Trước Phase 1 store này chạy trên `users.sqlite`. Giờ dùng chung DB nghiệp vụ với
19 bảng StudyMap; schema do Alembic quản lý (`BE/alembic`), store KHÔNG tự tạo bảng.

Auth vẫn là JWT tự viết (không dùng Supabase Auth) nên `password_hash` nằm ngay
trong bảng `users`, đúng đặc tả 8.2. Mật khẩu hash bằng Werkzeug — không bao giờ
lưu plaintext. Dict trả về giữ nguyên các khoá cũ (`user_id`, `display_name`) để
tầng route/token không phải đổi; `display_name` map vào cột `full_name`.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from werkzeug.security import check_password_hash, generate_password_hash

from app.db import session_scope
from app.db.models import User

DEFAULT_ROLE = "learner"
#: Phải khớp `ck_users_role` trong `db/models.py`. Để ở đây vì đây là tầng CHẠM cột
#: `users.role`; adapter provider ngoài có bảng riêng của nó và không được nhập vào lõi.
VAI_TRO_HOP_LE = ("learner", "teacher", "admin")


class EmailExistsError(Exception):
    """create_user gọi khi email đã được đăng ký."""


def init_db() -> None:
    """No-op: schema do Alembic tạo (`python -m alembic upgrade head`).

    Giữ hàm để các caller cũ không phải đổi.
    """
    return None


def _norm_email(email: str) -> str:
    return (email or "").strip().lower()


def _fallback_name(email: str) -> str:
    """`users.full_name` NOT NULL — không nhập tên thì lấy phần trước '@'."""
    return (email.split("@", 1)[0] or "user").strip() or "user"


def _to_dict(u: Optional[User]) -> Optional[dict]:
    if u is None:
        return None
    return {
        "user_id": u.id,
        "email": u.email,
        "password_hash": u.password_hash,
        "display_name": u.full_name,
        "full_name": u.full_name,
        "role": u.role,
        "token_version": int(u.token_version),
        "created_at": u.created_at,
    }


def create_user(email: str, password: str, display_name: Optional[str] = None,
                role: str = DEFAULT_ROLE) -> dict:
    """Tạo user (password đã hash). Ném EmailExistsError khi email trùng."""
    em = _norm_email(email)
    name = (display_name or "").strip() or _fallback_name(em)
    user = User(
        email=em,
        full_name=name,
        password_hash=generate_password_hash(password),
        role=role,
        token_version=1,
    )
    try:
        with session_scope() as s:
            s.add(user)
            s.flush()
            s.refresh(user)   # lấy created_at/updated_at do server_default sinh
            return _to_dict(user)
    except IntegrityError as exc:
        raise EmailExistsError(em) from exc


def get_by_email(email: str) -> Optional[dict]:
    em = _norm_email(email)
    if not em:
        return None
    with session_scope() as s:
        # So khớp không phân biệt hoa/thường: email lưu đã lower, vẫn lower() cột
        # để dữ liệu nhập tay từ SQL console cũng khớp.
        u = s.execute(select(User).where(func.lower(User.email) == em)).scalar_one_or_none()
        return _to_dict(u)


def get_by_id(user_id: str) -> Optional[dict]:
    if not user_id:
        return None
    with session_scope() as s:
        return _to_dict(s.get(User, str(user_id)))


def verify_password(email: str, password: str) -> Optional[dict]:
    """Trả user dict khi mật khẩu đúng, None khi sai (không lộ user tồn tại hay không)."""
    user = get_by_email(email)
    if not user:
        return None
    if not check_password_hash(user["password_hash"], password or ""):
        return None
    return user


def set_role(user_id: str, role: str) -> None:
    """Đặt lại `users.role`.

    Ném `ValueError` với giá trị ngoài `VAI_TRO_HOP_LE` — kể cả `"ADMIN"` hay
    `"admin "`. Không chuẩn hoá giúp: một giá trị sai chính tả tới được đây nghĩa là
    tầng trên đọc sai, và "hiểu ý" sẽ giấu mất lỗi đó. Chặn ở Python để hỏng ngay tại
    chỗ gọi thay vì thành `IntegrityError` của `ck_users_role` giữa một transaction.

    KHÔNG đụng `token_version`: token chỉ mang `{uid, tv}` và
    `service.current_user_from_request` đọc lại hàng users ở MỖI request, nên vai trò
    mới có hiệu lực ngay ở request kế tiếp. Bump ở đây chỉ đá người dùng ra ngoài mà
    không thêm được gì về an toàn.
    """
    if not user_id:
        return
    if role not in VAI_TRO_HOP_LE:
        raise ValueError(f"vai trò không hợp lệ: {role!r}")
    with session_scope() as s:
        u = s.get(User, str(user_id))
        if u is not None:
            u.role = role


def bump_token_version(user_id: str) -> None:
    """Vô hiệu mọi token đang phát cho user (logout-all / đổi mật khẩu)."""
    if not user_id:
        return
    with session_scope() as s:
        u = s.get(User, str(user_id))
        if u is not None:
            u.token_version = int(u.token_version) + 1
