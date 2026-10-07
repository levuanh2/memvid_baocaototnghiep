import struct
import zlib

import fitz
import pytest

from services.mindmap.export.scope import resolve_export_scope
from services.mindmap.export.tree import build_export_tree
from services.mindmap.export.pdf_serializer import serialize_pdf


def _tree():
    nodes = [
        {"id": "r", "parent": None, "kind": "root", "title": "Bản đồ tư duy", "order": 0},
        {"id": "c0", "parent": "r", "kind": "section", "title": "Nhánh 0", "order": 0},
    ]
    scope = resolve_export_scope(nodes, scope_type="full")
    return build_export_tree(nodes, [], scope["root_ids"], scope["included_ids"], title="Bản đồ tư duy")


def _chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def _rgb_png(width: int, height: int, pixel) -> bytes:
    """RGB PNG; pixel(x, y) returns a 3-byte colour."""
    rows = []
    for y in range(height):
        row = bytearray([0])
        for x in range(width):
            row += pixel(x, y)
        rows.append(bytes(row))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    return sig + ihdr + _chunk(b"IDAT", zlib.compress(b"".join(rows))) + _chunk(b"IEND", b"")


def _rgba_png(width: int, height: int, pixel) -> bytes:
    """RGBA PNG; pixel(x, y) returns a 4-byte RGBA value."""
    rows = []
    for y in range(height):
        row = bytearray([0])
        for x in range(width):
            row += pixel(x, y)
        rows.append(bytes(row))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    return sig + ihdr + _chunk(b"IDAT", zlib.compress(b"".join(rows))) + _chunk(b"IEND", b"")


def _blank_white_png(width: int = 200, height: int = 120) -> bytes:
    return _rgb_png(width, height, lambda x, y: b"\xff\xff\xff")


def _dark_block_png(width: int = 400, height: int = 300) -> bytes:
    def px(x, y):
        inside = width // 4 <= x < 3 * width // 4 and height // 4 <= y < 3 * height // 4
        return b"\x20\x40\x90" if inside else b"\xff\xff\xff"
    return _rgb_png(width, height, px)


def _white_with_black_lines_png(width: int = 300, height: int = 160) -> bytes:
    def px(x, y):
        on_line = y in (height // 3, 2 * height // 3) and width // 6 <= x < 5 * width // 6
        return b"\x00\x00\x00" if on_line else b"\xff\xff\xff"
    return _rgb_png(width, height, px)


def _transparent_png(width: int = 200, height: int = 120) -> bytes:
    return _rgba_png(width, height, lambda x, y: b"\x00\x00\x00\x00")


def _transparent_with_content_png(width: int = 200, height: int = 120) -> bytes:
    def px(x, y):
        inside = width // 4 <= x < 3 * width // 4 and height // 4 <= y < 3 * height // 4
        return b"\x20\x40\x90\xff" if inside else b"\x00\x00\x00\x00"
    return _rgba_png(width, height, px)


def _header_only_bomb(width: int = 40000, height: int = 40000) -> bytes:
    sig = b"\x89PNG\r\n\x1a\n"
    return sig + _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + _chunk(b"IDAT", zlib.compress(b"\x00")) + _chunk(b"IEND", b"")


# --- Red on origin/main: a blank or transparent capture must not become a successful PDF.

def test_blank_white_map_image_fails_instead_of_producing_empty_pdf():
    with pytest.raises(ValueError):
        serialize_pdf(_tree(), mode="map", map_image_bytes=_blank_white_png())


def test_fully_transparent_map_image_is_rejected():
    with pytest.raises(ValueError):
        serialize_pdf(_tree(), mode="map", map_image_bytes=_transparent_png())


def test_decompression_bomb_header_is_rejected_before_decode():
    with pytest.raises(ValueError):
        serialize_pdf(_tree(), mode="map", map_image_bytes=_header_only_bomb())


# --- Guards that PASS on main and must keep passing (legitimate minimal maps).

def test_white_background_with_black_lines_is_accepted():
    file_bytes = serialize_pdf(_tree(), mode="map", map_image_bytes=_white_with_black_lines_png())
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    assert len(doc[0].get_images()) == 1
    doc.close()


def test_transparent_image_with_content_is_accepted():
    file_bytes = serialize_pdf(_tree(), mode="map", map_image_bytes=_transparent_with_content_png())
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    assert len(doc[0].get_images()) == 1
    doc.close()


# --- Placement and render guards (PASS on main: NOT REPRODUCED).

def test_map_image_is_fit_inside_margins_and_centred_with_aspect_ratio():
    file_bytes = serialize_pdf(_tree(), mode="map", map_image_bytes=_dark_block_png(800, 400), page_size="A4", orientation="portrait")
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    page = doc[0]
    info = page.get_image_info()
    assert len(info) == 1
    bbox = fitz.Rect(info[0]["bbox"])
    pw, ph = page.rect.width, page.rect.height
    assert bbox.x0 >= 0 and bbox.y0 >= 0 and bbox.x1 <= pw and bbox.y1 <= ph
    assert abs(bbox.width / bbox.height - 2.0) < 0.02
    assert abs((bbox.x0 + bbox.x1) / 2 - pw / 2) < 2.0
    assert abs((bbox.y0 + bbox.y1) / 2 - ph / 2) < 2.0
    doc.close()


def test_rendered_map_page_has_visible_content_not_background_only():
    file_bytes = serialize_pdf(_tree(), mode="map", map_image_bytes=_dark_block_png(400, 300), page_size="A4", orientation="landscape")
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    pix = doc[0].get_pixmap(dpi=60)
    samples = pix.samples
    non_white = sum(1 for i in range(0, len(samples), pix.n) if samples[i:i + 3] != b"\xff\xff\xff")
    assert non_white > 200
    doc.close()
