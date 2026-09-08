"""Liên kết danh tính provider ngoài ↔ `users`.

Không biết NKS: `provider` chỉ là một chuỗi. Đây là lý do gỡ một provider không phải
đụng tới lược đồ hay tầng này.

Hai luật an toàn nằm ở đây, không nằm ở adapter:
  1. **Không bao giờ nhận ra người dùng bằng email.** Chỉ tra
     `(provider, provider_user_id)`. Xem docstring `Identity` trong models.py.
  2. **Tài khoản sinh cho danh tính ngoài không đăng nhập local được.** Mật khẩu là
     một chuỗi ngẫu nhiên 64 byte KHÔNG ai giữ và không đi đâu cả — băm bằng đúng cơ
     chế sẵn có (Werkzeug), nên `check_password_hash` vẫn chạy bình thường và luôn sai.
"""

from __future__ import annotations

import secrets
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.db import session_scope
from app.db.models import Identity, User
from app.domains.auth.users_store import _to_dict


class EmailRequiredForProvisioning(Exception):
    """Provider không trả email mà `users.email` là NOT NULL.

    KHÔNG bịa email thay thế: một địa chỉ tự chế sẽ hiện ra ở `/auth/me` như email
    thật của người dùng, và có thể đụng vào một tài khoản có thật sau này.
    """


class EmailBelongsToAnotherAccount(Exception):
    """Email của danh tính ngoài đã thuộc một `users` row CHƯA liên kết.

    Đây chính là ca chiếm tài khoản. Gộp vào là auto-link theo email; ở đây từ chối.
    """


def _rand_password() -> str:
    """Mật khẩu không dùng được: sinh ngẫu nhiên, không lưu, không trả ra."""
    return secrets.token_urlsafe(64)


def find(provider: str, provider_user_id: str) -> Optional[dict]:
    """Tra danh tính. Trả `{identity_id, user_id}` hoặc None."""
    if not provider or not provider_user_id:
        return None
    with session_scope() as s:
        row = s.execute(
            select(Identity).where(
                Identity.provider == provider,
                Identity.provider_user_id == str(provider_user_id),
            )
        ).scalar_one_or_none()
        if row is None:
            return None
        return {"identity_id": row.id, "user_id": row.user_id,
                "provider": row.provider, "provider_user_id": row.provider_user_id}


def find_by_user(provider: str, user_id: str) -> Optional[dict]:
    """Người dùng StudyMap này có liên kết với `provider` không?

    Chiều tra NGƯỢC với `find`: ở đây đã biết user StudyMap, cần biết họ có phải người
    của provider ngoài hay không. Dùng để TỪ CHỐI SỚM — trước khi bất kỳ mật khẩu nào
    được chuyển tiếp sang hệ thống của người khác. Một tài khoản local không có hàng
    nào ở đây, nên đường ghi của provider đóng lại với họ ngay từ hàng rào đầu tiên.

    Vẫn KHÔNG bao giờ tra bằng email — xem docstring `Identity` trong models.py.
    """
    if not provider or not user_id:
        return None
    with session_scope() as s:
        row = s.execute(
            select(Identity).where(
                Identity.provider == provider,
                Identity.user_id == str(user_id),
            )
        ).scalar_one_or_none()
        if row is None:
            return None
        return {"identity_id": row.id, "user_id": row.user_id,
                "provider": row.provider, "provider_user_id": row.provider_user_id}


def touch_last_login(identity_id: str) -> None:
    if not identity_id:
        return
    with session_scope() as s:
        row = s.get(Identity, str(identity_id))
        if row is not None:
            row.last_login_at = func.now()


def link_new_user(*, provider: str, provider_user_id: str, email: Optional[str],
                  display_name: Optional[str], role: str = "learner") -> dict:
    """Tạo `users` + `identities` cho một danh tính ngoài CHƯA từng thấy.

    Ném `EmailRequiredForProvisioning` khi thiếu email, `EmailBelongsToAnotherAccount`
    khi email đã có chủ. Cả hai đều KHÔNG được lặng lẽ biến thành "đăng nhập thành công".
    """
    em = (email or "").strip().lower()
    if not em:
        raise EmailRequiredForProvisioning(provider)

    with session_scope() as s:
        trung = s.execute(
            select(User).where(func.lower(User.email) == em)
        ).scalar_one_or_none()
        if trung is not None:
            # Có user trùng email nhưng KHÔNG có liên kết tới danh tính này (đã tra ở
            # `find` trước khi gọi vào đây) ⇒ đây là tài khoản của người khác.
            raise EmailBelongsToAnotherAccount(em)

        user = User(
            email=em,
            full_name=(display_name or "").strip() or em.split("@", 1)[0] or "user",
            password_hash=_bam_mat_khau_khong_dung_duoc(),
            role=role,
            token_version=1,
        )
        s.add(user)
        s.flush()

        s.add(Identity(provider=provider, provider_user_id=str(provider_user_id),
                       user_id=user.id, last_login_at=func.now()))
        try:
            s.flush()
        except IntegrityError as exc:
            # Hai request cùng lúc cho cùng một danh tính: `uq_identities_provider_user`
            # chặn ở tầng DB. Kiểm-rồi-ghi không nguyên tử được ở tầng ứng dụng.
            raise EmailBelongsToAnotherAccount(em) from exc
        s.refresh(user)
        return _to_dict(user)


def _bam_mat_khau_khong_dung_duoc() -> str:
    from werkzeug.security import generate_password_hash

    return generate_password_hash(_rand_password())
