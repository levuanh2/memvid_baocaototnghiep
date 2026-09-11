"""collections: bật Row Level Security (bỏ sót ở f6a3c81d40b7)

Revision ID: 08eb199dc5e0
Revises: f6a3c81d40b7
Create Date: 2026-09-11

Mọi migration tạo bảng mới trong kho này đều bật RLS ngay sau `create_table`
(xem `102c36a01548` cho 19 bảng gốc, `b1d7a4c9e210` cho `identities`) — RLS bật
+ không policy nào = deny-all cho publishable key (đặc tả Phase 1). Migration
tạo `collections` (`f6a3c81d40b7`, Phase 1B, 84895d7) là chỗ DUY NHẤT lệch quy
ước này: bảng được tạo nhưng không dòng nào bật RLS, nên với publishable key,
`collections` không có deny-all — khác mọi bảng còn lại trong schema.

KHÔNG sửa `f6a3c81d40b7` tại chỗ: file đó đã lên `main`, migration có thể đã
chạy trên production. Sửa một migration đã áp dụng rồi là để lệch giữa những
gì `alembic_version` production ghi nhận và những gì file trên đĩa nói — thêm
migration mới, đúng nguyên tắc chỉ-thêm của alembic.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '08eb199dc5e0'
down_revision: Union[str, Sequence[str], None] = 'f6a3c81d40b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('ALTER TABLE public."collections" ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    op.execute('ALTER TABLE public."collections" DISABLE ROW LEVEL SECURITY')
