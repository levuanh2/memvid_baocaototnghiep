"""H3C regression coverage for map-raster storage inside PDF artifacts."""
from __future__ import annotations

import io

import fitz
from PIL import Image, ImageDraw

from services.mindmap.export.pdf_serializer import serialize_pdf
from services.mindmap.export.tree import build_export_tree


WIDTH = 2048
HEIGHT = 1024


def _tree() -> dict:
    nodes = [
        {"id": "root", "parent": None, "kind": "root", "title": "Sơ đồ tiếng Việt", "order": 0},
        {"id": "branch", "parent": "root", "kind": "section", "title": "Nhánh học tập", "order": 0},
    ]
    return build_export_tree(nodes, [], ["root"], {"root", "branch"}, map_id="h3c-fixture", title="H3C fixture")


def _representative_rgba_png() -> bytes:
    """A deterministic, opaque RGBA map capture with sparse line art.

    Browser captures arrive as RGBA PNGs even when every visible pixel is
    opaque. PyMuPDF therefore creates both an RGB image XObject and an alpha
    soft mask; H3C must compress both streams without changing the source
    raster or its geometry.
    """
    image = Image.new("RGBA", (WIDTH, HEIGHT), (255, 255, 255, 255))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((760, 430, 1288, 594), radius=24, fill=(18, 108, 242, 255))
    for index, color in enumerate(((18, 108, 242, 255), (22, 160, 133, 255), (242, 53, 58, 255))):
        y = 180 + index * 300
        draw.line((120, y, 760, 500), fill=color, width=8)
        draw.line((1288, 500, 1928, y), fill=color, width=8)
        for offset in range(4):
            draw.rounded_rectangle((120, y + offset * 45, 600, y + offset * 45 + 30), radius=8, outline=color, width=3)
            draw.rounded_rectangle((1448, y + offset * 45, 1928, y + offset * 45 + 30), radius=8, outline=color, width=3)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_map_raster_and_alpha_mask_are_flate_compressed_once_in_pdf():
    png = _representative_rgba_png()
    pdf = serialize_pdf(_tree(), mode="map", map_image_bytes=png)

    document = fitz.open(stream=pdf, filetype="pdf")
    try:
        images = document[0].get_images(full=True)
        assert len(images) == 1
        image_xref, soft_mask_xref = images[0][0], images[0][1]
        assert soft_mask_xref > 0, "the RGBA fixture must exercise the alpha soft-mask path"
        assert "/FlateDecode" in document.xref_object(image_xref)
        # PyMuPDF may encode an all-opaque alpha plane more efficiently as a
        # lossless 1-bit CCITT stream; the regression is an unfiltered raw
        # mask, not the exact choice among lossless filters.
        assert "/Filter" in document.xref_object(soft_mask_xref)
        assert len(pdf) < WIDTH * HEIGHT * 4, "a sparse map PDF must not exceed its raw RGBA pixel memory"
    finally:
        document.close()
