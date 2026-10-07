"""Validation for the client-supplied map image used by PDF/DOCX map exports.

A blank or fully transparent capture must never become a "successful" export,
and a crafted PNG header must never reach the decoder with a huge canvas.
Checks run in order, cheapest first:

1. PNG header: signature, IHDR present, width/height positive and within
   MAX_PIXELS, so a decompression-bomb header is refused before any decode.
2. Decode with PyMuPDF (already a dependency) and sample the pixels.
3. Reject an image whose sampled pixels are all one colour, or all fully
   transparent. Anything with real content passes: a white background with
   black lines, or a transparent canvas with a drawn map.
"""

import struct

import fitz

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_DIMENSION = 12000
MAX_PIXELS = 40_000_000
SAMPLE_BUDGET = 400_000


def _png_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 24 or data[:8] != PNG_SIGNATURE or data[12:16] != b"IHDR":
        raise ValueError("Ảnh sơ đồ không phải PNG hợp lệ.")
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def validate_map_image(data: bytes) -> None:
    if not data:
        raise ValueError("Ảnh sơ đồ rỗng.")
    width, height = _png_dimensions(data)
    if width <= 0 or height <= 0:
        raise ValueError("Kích thước ảnh sơ đồ không hợp lệ.")
    if width > MAX_DIMENSION or height > MAX_DIMENSION or width * height > MAX_PIXELS:
        raise ValueError("Ảnh sơ đồ quá lớn để xuất.")

    try:
        pix = fitz.Pixmap(data)
    except Exception as exc:  # noqa: BLE001 - any decoder failure means "not a usable image"
        raise ValueError("Không đọc được ảnh sơ đồ.") from exc

    samples = pix.samples
    n = pix.n
    if not samples or n < 1:
        raise ValueError("Ảnh sơ đồ không có dữ liệu điểm ảnh.")

    first = samples[:n]
    has_alpha = pix.alpha
    total_pixels = len(samples) // n
    # Every pixel for ordinary maps; a stride only for very large images, so tiny maps are never under-sampled.
    stride = max(1, total_pixels // SAMPLE_BUDGET)
    all_transparent = True
    uniform = True
    for p in range(0, total_pixels, stride):
        px = samples[p * n:(p + 1) * n]
        if has_alpha and px[-1] != 0:
            all_transparent = False
        if px != first:
            uniform = False
        if not uniform and not all_transparent:
            break

    if has_alpha and all_transparent:
        raise ValueError("Ảnh sơ đồ trong suốt hoàn toàn, không có nội dung để xuất.")
    if uniform:
        raise ValueError("Ảnh sơ đồ chỉ có một màu, không có nội dung để xuất.")
