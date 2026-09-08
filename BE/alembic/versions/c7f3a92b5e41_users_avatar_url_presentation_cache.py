"""users.avatar_url: bộ nhớ đệm HIỂN THỊ cho ảnh đại diện của provider ngoài

Revision ID: c7f3a92b5e41
Revises: b1d7a4c9e210
Create Date: 2026-09-08

Vì sao StudyMap lưu MỘT cột này, trong khi luật chung là "provider ngoài là nguồn sự
thật, không sao chép hồ sơ xuống DB":

NKS không có tài khoản máy và không có refresh token. Muốn đọc `user.avatar` phải có
access token của chính người dùng, mà token đó chỉ lấy được từ một lần đăng nhập có
mật khẩu. Nghĩa là sau khi tải lại trang, máy chủ KHÔNG có cách nào biết ảnh đại diện
nữa. Không lưu gì cả thì ảnh chỉ hiện đúng trong tab vừa đặt nó — tính năng coi như
không tồn tại. Hai lựa chọn còn lại đều tệ hơn: hỏi mật khẩu mỗi lần tải trang, hoặc
giữ một token sống 365 ngày.

Cột này lưu **URL công khai**, không phải ảnh:

  * KHÔNG lưu byte ảnh, KHÔNG base64, KHÔNG Supabase Storage. NKS giữ ảnh.
  * URL này vốn đã public không cần xác thực (đo thật: HTTP 200, image/jpeg).
  * Không phải bí mật, nên không cần mã hoá; mất cột này chỉ mất phần hiển thị.
  * Làm mới ở MỌI lần đăng nhập NKS và sau mỗi lần đổi ảnh.

Chỉ nhận URL https tuyệt đối. Đây là giá trị từ hệ thống ngoài sẽ trở thành `src` của
một thẻ trên trang, nên `http:` (nội dung lẫn lộn), `data:` (ảnh nhúng — chiều ĐỌC của
NKS không bao giờ trả về dạng này) và `javascript:` đều bị chặn ở tầng ứng dụng
(`shared/interfaces/profile.py`). DB chỉ giữ độ dài.

500 ký tự: URL thật đo được dài 61 ký tự; 500 là khoảng rộng thoải mái mà vẫn chặn
một chuỗi base64 lọt vào đây do lỗi lập trình (ảnh 60 KB thành ~80 000 ký tự).

CHỈ THÊM MỘT CỘT NULLABLE. Không đụng bảng khác, không đổi ràng buộc nào, không cần
backfill: hàng cũ để NULL và tự điền ở lần đăng nhập kế tiếp.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c7f3a92b5e41'
down_revision: Union[str, Sequence[str], None] = 'b1d7a4c9e210'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('avatar_url', sa.String(length=500), nullable=True))


def downgrade() -> None:
    # Mất cột = mất phần hiển thị, không mất dữ liệu người dùng: ảnh vẫn ở NKS và URL
    # được đọc lại ở lần đăng nhập kế tiếp.
    op.drop_column('users', 'avatar_url')
