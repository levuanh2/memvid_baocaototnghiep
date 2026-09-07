"""Chứng từ ghi ngắn hạn cho provider ngoài — CHỈ nằm trong bộ nhớ tiến trình.

Vì sao tồn tại: NKS không có tài khoản máy, không có refresh, và token của họ sống
**365 ngày** với `scopes: []` (đo 2026-09-07). Muốn ghi hộ người dùng thì phải cầm
token của chính họ; cầm lâu là cầm một chìa khoá vạn năng, một năm, không thu hồi
được. Nên chỗ này đổi "lưu lâu" lấy "hỏi lại mật khẩu": giữ đúng 10 phút trong RAM,
không đĩa, không DB, không Redis, không bao giờ ra tới trình duyệt.

Cái duy nhất đi ra ngoài là `grant_id` — 256 bit ngẫu nhiên, không mang thông tin,
tự nó không mở được gì nếu không kèm token StudyMap của đúng chủ nhân.

Hạn là TUYỆT ĐỐI: không gia hạn trượt. Người dùng thao tác lâu hơn 10 phút thì nhập
lại mật khẩu — chi phí đó là có chủ đích, vì thứ đang giữ đáng giá một năm truy cập.

Mất khi tiến trình chết là ĐÚNG, không phải khiếm khuyết: Render Free ngủ sau ~15
phút rảnh và deploy lại mỗi lần đẩy `main`, nên "kho rỗng" là trạng thái THƯỜNG GẶP.
Mọi đường gọi phải đúng khi không có chứng từ nào — hỏi lại mật khẩu, không phải lỗi.

Module này KHÔNG biết NKS: nó chỉ giữ một chuỗi `bi_mat` gắn nhãn `provider`.
"""

from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass
from typing import Optional

#: Hạn tuyệt đối. Đủ cho một lượt sửa hồ sơ, ngắn hơn mọi thứ khác trong hệ thống.
TTL_SEC = 600

#: Trần cứng để kho không phình vô hạn. Mỗi người dùng giữ TỐI ĐA MỘT chứng từ (xem
#: `tao`), nên trần này chỉ chạm tới khi có >512 người cùng mở trình sửa trong 10
#: phút — xa hơn nhiều so với những gì một instance Free phục vụ nổi.
TRAN_SO_LUONG = 512


@dataclass
class _ChungTu:
    user_id: str
    provider: str
    bi_mat: str
    het_han: float

    def con_han(self, bay_gio: float) -> bool:
        return bay_gio < self.het_han


#: `RLock` chứ không phải `Lock`: `tao` gọi `_don_het_han` khi đang giữ khoá.
_khoa = threading.RLock()
_kho: dict[str, _ChungTu] = {}


def _don_het_han(bay_gio: float) -> int:
    """Xoá các chứng từ đã hết hạn. Gọi khi ĐANG giữ `_khoa`."""
    het = [k for k, v in _kho.items() if not v.con_han(bay_gio)]
    for k in het:
        _kho.pop(k, None)
    return len(het)


def tao(user_id: str, provider: str, bi_mat: str, *, ttl_sec: int = TTL_SEC) -> tuple[str, float]:
    """Cấp chứng từ mới. Trả `(grant_id, het_han_epoch)`.

    **Mỗi người dùng chỉ giữ MỘT chứng từ.** Cấp cái mới sẽ huỷ ngay cái cũ: mở lại
    trình sửa là bắt đầu một lượt mới, và để hai lượt cùng sống chỉ nhân đôi thời
    gian một token nằm trong RAM mà không cho thêm khả năng gì.
    """
    if not user_id or not provider or not bi_mat:
        raise ValueError("thiếu user_id/provider/bí mật")
    bay_gio = time.time()
    grant_id = secrets.token_urlsafe(32)
    het_han = bay_gio + max(1, int(ttl_sec))
    with _khoa:
        _don_het_han(bay_gio)
        for k in [k for k, v in _kho.items() if v.user_id == user_id]:
            _kho.pop(k, None)
        if len(_kho) >= TRAN_SO_LUONG:
            # Kho đầy dù vừa dọn: bỏ cái sắp hết hạn nhất để đường ghi không chết hẳn.
            cu_nhat = min(_kho.items(), key=lambda kv: kv[1].het_han)[0]
            _kho.pop(cu_nhat, None)
        _kho[grant_id] = _ChungTu(user_id=user_id, provider=provider,
                                  bi_mat=bi_mat, het_han=het_han)
    return grant_id, het_han


def lay(grant_id: str, user_id: str, *, provider: Optional[str] = None) -> Optional[str]:
    """Bí mật của chứng từ, hoặc `None`.

    `None` cho MỌI lý do — không có, hết hạn, sai chủ, sai provider. Người gọi không
    phân biệt được các ca đó, và không cần: phản ứng luôn giống nhau (hỏi lại mật
    khẩu). Chứng từ hết hạn bị xoá luôn tại đây.
    """
    if not grant_id or not user_id:
        return None
    with _khoa:
        ct = _kho.get(grant_id)
        if ct is None:
            return None
        if not ct.con_han(time.time()):
            _kho.pop(grant_id, None)
            return None
        # So sánh chủ sở hữu bằng `compare_digest`: user_id không phải bí mật, nhưng
        # đây là chốt phân quyền duy nhất của chứng từ nên không so bằng `==`.
        if not secrets.compare_digest(str(ct.user_id), str(user_id)):
            return None
        if provider is not None and ct.provider != provider:
            return None
        return ct.bi_mat


def xoa(grant_id: str, user_id: str) -> bool:
    """Chủ nhân tự thu hồi. Idempotent: trả `False` khi không có gì để xoá.

    KHÔNG xoá được chứng từ của người khác — sai chủ thì coi như không tồn tại.
    """
    if not grant_id or not user_id:
        return False
    with _khoa:
        ct = _kho.get(grant_id)
        if ct is None or not secrets.compare_digest(str(ct.user_id), str(user_id)):
            return False
        _kho.pop(grant_id, None)
        return True


def xoa_cua_user(user_id: str) -> int:
    """Xoá mọi chứng từ của một người. Dùng ở đăng xuất."""
    if not user_id:
        return 0
    with _khoa:
        can_xoa = [k for k, v in _kho.items() if v.user_id == user_id]
        for k in can_xoa:
            _kho.pop(k, None)
        return len(can_xoa)


def huy(grant_id: str) -> bool:
    """Huỷ KHÔNG kiểm chủ — dành cho một chỗ duy nhất: provider vừa từ chối bí mật này.

    Lúc đó bí mật đã chết ở phía provider, giữ lại chỉ là một token vô dụng nằm trong
    RAM. Đây không phải đường người dùng gọi được.
    """
    if not grant_id:
        return False
    with _khoa:
        return _kho.pop(grant_id, None) is not None


def so_luong() -> int:
    with _khoa:
        _don_het_han(time.time())
        return len(_kho)


def reset_for_tests() -> None:
    with _khoa:
        _kho.clear()
