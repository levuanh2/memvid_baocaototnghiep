"""documents: user library fields for the AI Study Library (Phase 1A)

Revision ID: d4e8b1c67a92
Revises: c7f3a92b5e41
Create Date: 2026-09-09

Bảy cột NGƯỜI DÙNG tự đặt — không cột nào suy ra được từ dữ liệu đã có, đó là
tiêu chí duy nhất để một cột được thêm ở phase này.

CỐ Ý KHÔNG thêm (đều suy ra được, thêm là tạo hai nguồn sự thật):
  reading_time      <- documents.char_count
  language          <- document_chunks.metadata_json->>'language'
  ai_overview       <- record tóm tắt: sections[].key_points[]
  summary_preview   <- record tóm tắt: overview
  mindmap_layout    <- knowledge_nodes(parent_node_id, level, order_index) +
                       knowledge_edges.relation_type đã đủ cho 9/10 layout
  last_workspace_ref<- quiz/review mới nhất tra được từ bảng sẵn có
  study_category    <- cùng hình dạng với Collections (Phase 1B); ship cả hai là
                       hai phân loại chồng nhau + một migration để hoà giải

`last_opened_at` KHÔNG suy ra được: mọi mốc thời gian hiện có (`quiz_attempts
.started_at`, `review_plans.created_at`, `knowledge_maps.created_at`, record tóm
tắt `created_at`) ghi lúc TẠO artifact, không ghi lúc người dùng MỞ nó. Mở một
bản tóm tắt ba lần không sinh ra dòng nào ở đâu cả.

Không index: lọc/sắp/tìm đều ở client trên một payload `/api/library` duy nhất.
Index không ai truy vấn là chi phí ghi không đổi lấy gì.

Không backfill: `display_name` NULL nghĩa là "chưa từng đổi tên, dùng `title`".
Backfill xoá mất chính sự phân biệt đó.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'd4e8b1c67a92'
down_revision: Union[str, Sequence[str], None] = 'c7f3a92b5e41'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Bảy cột additive. Default hằng → Postgres 11+ chỉ sửa metadata, không rewrite
    bảng, không khoá dài. Không cột nào đang có bị đổi tên/kiểu/ý nghĩa."""
    op.add_column('documents', sa.Column('display_name', sa.String(length=200), nullable=True))
    op.add_column('documents', sa.Column('favorite', sa.Boolean(), nullable=False,
                                         server_default=sa.text('false')))
    op.add_column('documents', sa.Column('pinned', sa.Boolean(), nullable=False,
                                         server_default=sa.text('false')))
    op.add_column('documents', sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('documents', sa.Column('tags', postgresql.JSONB(astext_type=sa.Text()),
                                         nullable=True))
    op.add_column('documents', sa.Column('last_opened_at', sa.DateTime(timezone=True),
                                         nullable=True))
    op.add_column('documents', sa.Column('last_workspace', sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column('documents', 'last_workspace')
    op.drop_column('documents', 'last_opened_at')
    op.drop_column('documents', 'tags')
    op.drop_column('documents', 'archived_at')
    op.drop_column('documents', 'pinned')
    op.drop_column('documents', 'favorite')
    op.drop_column('documents', 'display_name')
