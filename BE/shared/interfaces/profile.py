"""Hồ sơ ở provider ngoài — thứ DUY NHẤT lõi nhìn thấy.

Cùng khuôn với `interfaces/auth.py`: lõi không biết provider nào, không biết tên
trường của họ. Adapter dịch hai chiều.

**Không có trường nào ở đây được lưu vào database StudyMap.** Provider ngoài là nguồn
sự thật; StudyMap chỉ giữ bảng liên kết danh tính (`identities`) và ba cột định danh
tối thiểu trong `users`. Hồ sơ này sống đúng trong một request.

`TRUONG_SUA_DUOC` là danh sách TRẮNG — cả chiều đọc lẫn chiều ghi đều đi qua nó, nên
một trường mới ở phía provider không tự chảy ra ngoài, và một trường không sửa được
không thể bị gửi đi.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any, Mapping, Optional

#: Trường người dùng sửa được. Thứ tự = thứ tự hiển thị mặc định.
#:
#: `name` (tên hiển thị) CỐ Ý vắng mặt: đo thật 2026-09-07 cho thấy `name` độc lập với
#: `firstname`/`lastname` (tài khoản có `name="Teacher1"` trong khi firstname/lastname
#: là "Nguyễn Hữu"/"Lực"), và endpoint ghi KHÔNG có tham số nào đặt được nó. Cho sửa
#: một ô rồi lặng lẽ không lưu chính là "nút bấm không gọi gì cả" trong `.playbook`.
#:
#: CCCD (`id_number`/`id_date`/`id_place`) cũng vắng mặt: ghi được ở phía provider
#: nhưng ngoài phạm vi, và không có trong danh sách trắng thì không có đường nào tới.
TRUONG_SUA_DUOC = (
    "firstname", "lastname", "phone", "gender",
    "dob", "website", "pob", "province", "intro",
)

#: Trường chỉ đọc, đi kèm để giao diện vẽ được phần đầu hồ sơ.
TRUONG_CHI_DOC = ("provider", "provider_user_id", "email", "display_name", "avatar", "role")


@dataclass(frozen=True)
class ExternalProfile:
    """Hồ sơ đã chuẩn hoá. `None` = provider không có giá trị cho trường đó."""

    provider: str
    provider_user_id: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    avatar: Optional[str] = None
    role: Optional[str] = None

    firstname: Optional[str] = None
    lastname: Optional[str] = None
    phone: Optional[str] = None
    gender: Optional[int] = None
    dob: Optional[str] = None            # yyyy-mm-dd, KHÔNG theo locale
    website: Optional[str] = None
    pob: Optional[str] = None
    province: Optional[str] = None
    intro: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        """Dạng gửi ra API. Chỉ những khoá đã khai báo — không bao giờ có gì khác."""
        return {k: getattr(self, k) for k in (*TRUONG_CHI_DOC, *TRUONG_SUA_DUOC)}

    def merge(self, thay_doi: Mapping[str, Any]) -> "ExternalProfile":
        """Bản sao đã áp thay đổi. Khoá lạ bị bỏ qua, không ném."""
        sach = {k: v for k, v in (thay_doi or {}).items() if k in TRUONG_SUA_DUOC}
        return replace(self, **sach) if sach else self
