"""identities: liên kết danh tính provider ngoài với users

Revision ID: b1d7a4c9e210
Revises: ea56c24b17bb
Create Date: 2026-09-05

Vì sao cần bảng riêng thay vì thêm cột `provider` vào `users`:

Không có chỗ ghi "hàng users này thuộc danh tính ngoài X" thì cách duy nhất nhận ra
người quay lại là **so email** — và đó chính là lỗ hổng chiếm tài khoản: ai đăng ký
được email đó ở provider ngoài sẽ nuốt luôn tài khoản StudyMap sẵn có. `UNIQUE(provider,
provider_user_id)` là thứ biến "nhận ra người quay lại" thành một phép tra khoá chính
xác, không phải một phép đoán.

Bảng riêng (không phải cột trên `users`) còn để một user sau này gắn được NHIỀU danh
tính, và để gỡ provider ra mà không phải sửa lược đồ `users`.

CHỈ THÊM. Không đụng `users`, không đổi `role`, không đổi ngữ nghĩa `password_hash`.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'b1d7a4c9e210'
down_revision: Union[str, Sequence[str], None] = 'ea56c24b17bb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'identities',
        sa.Column('id', postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column('provider', sa.String(length=50), nullable=False),
        sa.Column('provider_user_id', sa.String(length=255), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        # Xoá user thì liên kết đi theo — không để lại hàng mồ côi trỏ vào user_id chết.
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        # Khoá của toàn bộ thiết kế: một danh tính provider ⇒ đúng một user.
        sa.UniqueConstraint('provider', 'provider_user_id',
                            name='uq_identities_provider_user'),
    )
    # Tra ngược "user này có những danh tính nào" (trang hồ sơ, gỡ liên kết).
    op.create_index('ix_identities_user_id', 'identities', ['user_id'])

    # RLS bật + KHÔNG policy nào = deny-all cho publishable key, đúng đặc tả Phase 1
    # mà 19 bảng kia đã theo. Bảng này lưu liên kết danh tính — ai đọc được nó thì
    # biết tài khoản StudyMap nào ứng với người nào ở provider ngoài; bỏ sót RLS ở
    # đây là để hở đúng thứ đáng giấu nhất trong lược đồ.
    #
    # CHỈ ENABLE, KHÔNG FORCE: FORCE áp cả lên owner, và BE chạy bằng role owner
    # (postgres) sẽ tự khoá chính mình vì không có policy nào.
    op.execute('ALTER TABLE public."identities" ENABLE ROW LEVEL SECURITY')


def downgrade() -> None:
    op.execute('ALTER TABLE public."identities" DISABLE ROW LEVEL SECURITY')
    op.drop_index('ix_identities_user_id', table_name='identities')
    op.drop_table('identities')
