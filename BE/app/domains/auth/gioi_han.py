"""Đếm lần THẤT BẠI trong tiến trình — hàng rào cho các đường có nhận mật khẩu.

Vì sao không dùng `_rate_limit_check` sẵn có: nó chạy trên Redis, mà production Free
đặt `REDIS_URL=""` nên nó fail-open, và `RATE_LIMIT_ENABLED` cũng không được bật ở
`render.yaml`. Nghĩa là hôm nay các đường nhận mật khẩu KHÔNG được chặn gì cả. Một
endpoint nhận mật khẩu NKS mà không có trần thì thành máy dò mật khẩu cho một hệ
thống của người khác — nên hàng rào phải chạy được mà không cần Redis.

Chỉ đếm THẤT BẠI. Người gõ đúng ngay lần đầu không bao giờ chạm tới trần, dù họ có
mở trình sửa bao nhiêu lần.

Cửa sổ CỐ ĐỊNH, không trượt: đủ tốt cho việc chặn dò mật khẩu, và đọc được bằng mắt.

Bộ nhớ có trần: mỗi lần ghi đều dọn khoá hết hạn, và khi chạm `TRAN_SO_KHOA` thì bỏ
mục cũ nhất. Một dict khoá theo IP mà không có trần chính là một đường làm cạn RAM.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

#: Số lần thất bại cho phép trong một cửa sổ, trước khi khoá.
SO_LAN_TOI_DA = 5
#: Độ dài cửa sổ.
CUA_SO_SEC = 600
#: Trần số khoá theo dõi cùng lúc.
TRAN_SO_KHOA = 4096


@dataclass
class _Dem:
    so_lan: int
    mo_luc: float          # thời điểm mở cửa sổ

    def het_han(self, bay_gio: float) -> bool:
        return bay_gio - self.mo_luc >= CUA_SO_SEC


_khoa = threading.RLock()
_bang: dict[str, _Dem] = {}


def _don(bay_gio: float) -> None:
    """Dọn khoá hết hạn. Gọi khi ĐANG giữ `_khoa`."""
    for k in [k for k, v in _bang.items() if v.het_han(bay_gio)]:
        _bang.pop(k, None)


def cho_phep(khoa: str) -> tuple[bool, int]:
    """`(được_phép, giây_chờ)`. Không đếm gì — chỉ hỏi."""
    if not khoa:
        return True, 0
    bay_gio = time.time()
    with _khoa:
        d = _bang.get(khoa)
        if d is None or d.het_han(bay_gio):
            if d is not None:
                _bang.pop(khoa, None)
            return True, 0
        if d.so_lan < SO_LAN_TOI_DA:
            return True, 0
        return False, max(1, int(CUA_SO_SEC - (bay_gio - d.mo_luc)))


def ghi_that_bai(khoa: str) -> None:
    """Đếm một lần thất bại. Cửa sổ mở ở lần thất bại ĐẦU TIÊN."""
    if not khoa:
        return
    bay_gio = time.time()
    with _khoa:
        _don(bay_gio)
        d = _bang.get(khoa)
        if d is None or d.het_han(bay_gio):
            if len(_bang) >= TRAN_SO_KHOA:
                cu_nhat = min(_bang.items(), key=lambda kv: kv[1].mo_luc)[0]
                _bang.pop(cu_nhat, None)
            _bang[khoa] = _Dem(so_lan=1, mo_luc=bay_gio)
            return
        d.so_lan += 1


def xoa(khoa: str) -> None:
    """Xoá bộ đếm — gọi sau một lần THÀNH CÔNG, để người gõ đúng không bị phạt oan."""
    if not khoa:
        return
    with _khoa:
        _bang.pop(khoa, None)


def so_khoa() -> int:
    with _khoa:
        _don(time.time())
        return len(_bang)


def reset_for_tests() -> None:
    with _khoa:
        _bang.clear()
