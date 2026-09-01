"""Nhãn nguồn dán trước mỗi chunk khi đưa vào prompt — và cách gỡ nó ra.

Hai chiều phải nằm cùng một chỗ. Trước audit vòng 8, chiều dán nằm trong
`query_graph.RetrieveFAISS` còn chiều gỡ **không tồn tại**: `state["retrieved_chunks"]`
mang nguyên nhãn đi thẳng vào `grade_documents`, và `_relevance` tokenize cả nhãn.

Hậu quả đo được (`CRAG_RELEVANCE_THRESHOLD=0.25`):

    câu hỏi: "đoạn nào trong nguồn nói về tích phân"
    chunk  : một đoạn hoàn toàn lạc đề
    không nhãn -> 0.0   -> wrong        (đúng)
    có nhãn    -> 0.25  -> correct      (sai, và vừa đúng ngưỡng)

"nguồn" và "đoạn" là hai từ cực phổ biến trong câu hỏi tiếng Việt, nên chunk lạc đề ăn
điểm chỉ nhờ cái nhãn do CHÍNH HỆ THỐNG dán vào. Grade luôn ra "correct" thì nhánh sửa
sai của CRAG (RewriteQuery / CRAGFallback) không bao giờ chạy — cả tầng CRAG thành trang
trí, và câu hỏi lạc đề vẫn được trả lời từ ngữ liệu không liên quan.
"""

from __future__ import annotations

import re

# Đúng hình dạng `nhan_nguon` sinh ra, neo ở ĐẦU chuỗi: nhãn nằm giữa thân bài là nội
# dung của tài liệu, không phải thứ ta dán vào, và không được đụng tới.
_NHAN_DAU_RE = re.compile(r"^\[Nguồn: .*?, đoạn \d+\]\n")


def nhan_nguon(video_stem: str, chunk_id: object) -> str:
    """Nhãn trích dẫn cho một chunk. Dùng khi dựng ngữ liệu đưa vào prompt."""
    return f"[Nguồn: {video_stem}, đoạn {chunk_id}]"


def bo_nhan_nguon(text: str | None) -> str:
    """Gỡ nhãn ở đầu chunk. Dùng ở MỌI chỗ chấm điểm nội dung.

    Chấm điểm trên chuỗi còn nhãn là chấm cả phần do hệ thống thêm vào — thước đo tự
    cộng điểm cho chính nó.
    """
    return _NHAN_DAU_RE.sub("", text or "", count=1)
