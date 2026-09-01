from __future__ import annotations

from typing import Any

from app.domains.retrieval.citation import bo_nhan_nguon
from app.domains.retrieval.hybrid import _tokenize


def _chunk_text(chunk: Any) -> str:
    """Nội dung để CHẤM ĐIỂM — đã gỡ nhãn nguồn do chính hệ thống dán vào.

    RetrieveFAISS dán `[Nguồn: <stem>, đoạn <id>]` lên đầu mỗi chunk cho prompt, và
    chuỗi đó đi thẳng vào đây. Tokenize cả nhãn thì thước đo tự cộng điểm cho chính
    nó: "nguồn"/"đoạn" khớp với câu hỏi tiếng Việt bất kỳ. Xem `citation.py` để biết
    con số đo được.
    """
    if isinstance(chunk, str):
        return bo_nhan_nguon(chunk)
    return bo_nhan_nguon(str(getattr(chunk, "text", "") or ""))


def _relevance(query: str, chunk: Any) -> float:
    query_tokens = set(_tokenize(query))
    if not query_tokens:
        return 0.0

    chunk_tokens = set(_tokenize(_chunk_text(chunk)))
    # Chỉ lexical. Audit vòng 8 đã gỡ nhánh gộp `vector_score`/`bm25_score`: nhánh đó
    # có 0 caller production (query_graph luôn truyền list[str]) và là một cái bẫy —
    # `hybrid` gán `vector_score=dist` từ `IndexFlatL2`, tức KHOẢNG CÁCH (nhỏ = tốt),
    # trong khi chỗ này gộp bằng `max(...)` (lớn = tốt). Nối lại là mọi chunk thành
    # "correct", vì `min(1.0, ...)` kẹp mọi khoảng cách > 1 thành liên quan tuyệt đối.
    # Muốn dùng điểm vector thật thì phải đổi dấu và chuẩn hoá trước, không phải kẹp.
    return len(query_tokens & chunk_tokens) / len(query_tokens)


def grade_documents(
    query: str,
    chunks: list,
    *,
    relevance_threshold: float = 0.25,
    wrong_floor: float = 0.1,
    rerank_scores: list | None = None,
) -> str:
    if not chunks:
        return "wrong"

    rels = [_relevance(query, chunk) for chunk in chunks]
    # `query_graph` truyền list[str] ở MỌI đường (trước và sau rerank), nên grade luôn
    # là lexical thuần. Cross-encoder là tín hiệu liên quan tốt hơn: fold vào nếu khớp
    # độ dài. Đây là tín hiệu số DUY NHẤT được tin ở đây — nó vốn đã là điểm liên quan
    # 0-1, không phải khoảng cách.
    if rerank_scores and len(rerank_scores) == len(rels):
        rels = [
            max(r, min(1.0, max(0.0, float(s))))
            for r, s in zip(rels, rerank_scores)
        ]

    best = max(rels, default=0.0)
    if best >= relevance_threshold:
        return "correct"
    if best <= wrong_floor:
        return "wrong"
    return "ambiguous"
