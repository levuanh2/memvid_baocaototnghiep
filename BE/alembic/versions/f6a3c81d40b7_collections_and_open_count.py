"""collections + documents.collection_id + documents.open_count (Phase 1B)

Revision ID: f6a3c81d40b7
Revises: d4e8b1c67a92
Create Date: 2026-09-09

Ba thứ, và chỉ ba thứ. Mỗi thứ đều qua đúng một bài kiểm tra: **dữ liệu này có suy
ra được từ thứ đang có không?** Suy ra được thì không lưu.

1. Bảng `collections` — bộ sưu tập là ĐỐI TƯỢNG có danh tính riêng: tên đổi được
   mà không đụng tài liệu, có màu, có biểu tượng, có thứ tự người dùng tự sắp, và
   tồn tại cả khi chưa có tài liệu nào bên trong. Không thứ nào trong số đó suy ra
   được từ tài liệu.

2. `documents.collection_id` — quan hệ 0..1. CỐ Ý không phải bảng nối: một tài liệu
   thuộc **nhiều nhất một** bộ sưu tập, nên bảng nối chỉ thêm một lượt JOIN cho một
   quan hệ mà khoá ngoại đã diễn tả đủ.

3. `documents.open_count` — TẦN SUẤT mở. `last_opened_at` (Phase 1A) chỉ trả lời
   "lần cuối là khi nào", không trả lời "mở bao nhiêu lần". Xếp hạng "Học gần đây"
   cần cả hai: một tài liệu mở 20 lần tuần trước có liên quan hơn một tài liệu mở
   đúng một lần hôm qua. Không bảng nào đang đếm việc này.

CỐ Ý KHÔNG thêm — `tags` và `tag_relation`:

    `documents.tags JSONB` đã có từ Phase 1A, đã được tìm kiếm, lọc và test. Chuẩn
    hoá nó thành hai bảng là THAY THẾ một trừu tượng đang chạy, kèm một lần di trú
    dữ liệu — trái với nguyên tắc chỉ-thêm. Danh sách thẻ ở thanh bên là một phép
    gộp trên chính cột JSONB ấy (một truy vấn), không cần bảng riêng. Chỉ nên chuẩn
    hoá khi thẻ cần danh tính riêng (đổi tên hàng loạt, màu, mô tả) — chưa phải bây giờ.

`archived_at` chứ không phải `archived` bool: giống hệt `documents.archived_at` của
Phase 1A, và nó trả lời thêm "lưu trữ từ bao giờ" mà một bool thì không.

Index: `ix_documents_collection_id` là BẮT BUỘC chứ không phải tối ưu hoá sớm —
Postgres KHÔNG tự đánh chỉ mục khoá ngoại, nên `ON DELETE SET NULL` lúc xoá một bộ
sưu tập sẽ quét toàn bảng `documents` nếu thiếu nó.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f6a3c81d40b7'
down_revision: Union[str, Sequence[str], None] = 'd4e8b1c67a92'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'collections',
        sa.Column('id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('user_id', sa.UUID(as_uuid=False), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('color', sa.String(length=20), nullable=True),
        sa.Column('icon', sa.String(length=40), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("length(trim(name)) > 0", name='ck_collections_name_nonempty'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_collections_user_id', 'collections', ['user_id'], unique=False)

    # SET NULL, KHÔNG phải CASCADE: xoá một bộ sưu tập là việc dọn dẹp, không phải
    # lệnh xoá tài liệu. Tài liệu rơi về "chưa phân loại" và vẫn nguyên vẹn.
    op.add_column('documents', sa.Column('collection_id', sa.UUID(as_uuid=False),
                                         nullable=True))
    op.create_foreign_key('fk_documents_collection', 'documents', 'collections',
                          ['collection_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_documents_collection_id', 'documents', ['collection_id'],
                    unique=False)

    op.add_column('documents', sa.Column('open_count', sa.Integer(), nullable=False,
                                         server_default='0'))


def downgrade() -> None:
    op.drop_column('documents', 'open_count')
    op.drop_index('ix_documents_collection_id', table_name='documents')
    op.drop_constraint('fk_documents_collection', 'documents', type_='foreignkey')
    op.drop_column('documents', 'collection_id')
    op.drop_index('ix_collections_user_id', table_name='collections')
    op.drop_table('collections')
