"""Chuẩn hoá chuỗi tiếng Việt để SO SÁNH (không phải để hiển thị).

Dùng chung cho AI Validation (bắt câu hỏi trùng) và Grading (so đáp án trắc nghiệm) —
hai chỗ này phải khớp nhau, tách ra hai bản là mời gọi lệch.

`đ` phải thay tay: NFKD KHÔNG tách nó (U+0111 là chữ cái riêng, không phải d + dấu), nên
bỏ dấu kiểu thông thường sẽ nuốt luôn `đ` và biến "đúng" thành "ung".
"""

from __future__ import annotations

import re
import unicodedata

_NON_ALNUM = re.compile(r"[^a-z0-9\s]+")
_SPACES = re.compile(r"\s+")


def norm_text(text: object) -> str:
    """Chữ thường, bỏ dấu, bỏ ký tự không chữ-số, gộp khoảng trắng."""
    s = str(text or "").lower().replace("đ", "d")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return _SPACES.sub(" ", _NON_ALNUM.sub(" ", s)).strip()


def demo() -> None:
    """Self-check: `python -m shared.text_norm`."""
    assert norm_text("Đúng") == "dung"
    assert norm_text("ĐẠO HÀM của X^2 là gì?") == "dao ham cua x 2 la gi"
    assert norm_text("Đúng") == norm_text("đúng") == norm_text(" ĐÚNG ")
    assert norm_text(None) == "" and norm_text("   ") == ""
    # bỏ dấu KHÔNG được gộp hai từ khác nghĩa thành một cách vô tình
    assert norm_text("đủ") != norm_text("ủ")
    print("text_norm demo OK")


if __name__ == "__main__":
    demo()
