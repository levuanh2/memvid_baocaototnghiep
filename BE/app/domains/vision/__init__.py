"""Đọc chữ và mô tả nội dung ảnh bằng mô hình thị giác cục bộ."""

from app.domains.vision.transcribe import (
    VisionUnavailable,
    is_available,
    reset_availability_cache,
    transcribe_image,
    vision_model,
)

__all__ = [
    "VisionUnavailable",
    "is_available",
    "reset_availability_cache",
    "transcribe_image",
    "vision_model",
]
