"""H4 — RED regressions for the opt-in screen-oriented PDF page size."""
from __future__ import annotations

import io

import fitz
import pytest
from PIL import Image, ImageDraw

from services.mindmap.export.capabilities import get_format_capabilities, validate_options
from services.mindmap.export.pdf_serializer import serialize_pdf_with_result
from services.mindmap.export.scope import resolve_export_scope
from services.mindmap.export.tree import build_export_tree


def _map_png(width: int = 2436, height: int = 296) -> bytes:
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    draw.line((40, height / 2, width - 40, height / 2), fill="#64748b", width=8)
    for label, x in zip(("P", "B", "C"), (150, width * 0.5, width - 150)):
        draw.rounded_rectangle((x - 70, height / 2 - 35, x + 70, height / 2 + 35), radius=10, fill="#dbeafe", outline="#1d4ed8", width=4)
        draw.text((x - 4, height / 2 - 8), label, fill="#172554")
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def _tree() -> dict:
    return {
        "title": "Sơ đồ H4",
        "relations": [],
        "roots": [{
            "node_id": "P", "topic": "Phát hiện", "depth": 0, "kind": "root",
            "is_context": True, "children": [
                {"node_id": "B", "topic": "Phát hiện vi phạm", "depth": 1, "kind": "idea", "is_context": False, "children": []},
                {"node_id": "C", "topic": "Đăng nhập trái phép", "depth": 1, "kind": "idea", "is_context": False, "children": []},
            ],
        }],
    }


def _manifest(width: int = 2436, height: int = 296) -> dict:
    return {
        "image_width_px": width,
        "image_height_px": height,
        "nodes": [
            {"id": "P", "x": 80, "y": 115, "width": 140, "height": 70, "font_size_px": 24, "parent_id": None},
            {"id": "B", "x": width / 2 - 70, "y": 115, "width": 140, "height": 70, "font_size_px": 24, "parent_id": "P"},
            {"id": "C", "x": width - 220, "y": 115, "width": 140, "height": 70, "font_size_px": 24, "parent_id": "P"},
        ],
        "connectors": [
            {"from": "P", "to": "B", "x": 150, "y": 148, "width": width / 2 - 150, "height": 4},
            {"from": "P", "to": "C", "x": 150, "y": 148, "width": width - 300, "height": 4},
        ],
    }


def _image_rect(page: fitz.Page) -> fitz.Rect:
    images = page.get_images(full=True)
    assert images
    return page.get_image_rects(images[0][0])[0]


def test_content_fit_is_an_explicit_valid_pdf_page_size_but_default_stays_a4():
    caps = get_format_capabilities("pdf")
    assert caps["defaults"]["pageSize"] == "A4"
    assert caps["controls"]["pageSize"] == ["A4", "A3", "content_fit"]
    validate_options("pdf", {"pageSize": "content_fit"})
    with pytest.raises(ValueError):
        validate_options("pdf", {"pageSize": "unbounded_custom"})


def test_ultra_wide_content_fit_uses_a_bounded_content_shaped_page_and_preserves_aspect():
    png = _map_png()
    result = serialize_pdf_with_result(
        _tree(), mode="map", page_size="content_fit", map_image_bytes=png,
        geometry_manifest=_manifest(), margins="normal",
    )
    doc = fitz.open(stream=result.content, filetype="pdf")
    page = doc[0]
    image_rect = _image_rect(page)
    usable_w = page.rect.width - 80
    usable_h = page.rect.height - 80

    assert 180 <= min(page.rect.width, page.rect.height)
    assert max(page.rect.width, page.rect.height) <= 1440
    assert image_rect.width / image_rect.height == pytest.approx(2436 / 296, rel=0.005)
    assert image_rect.width / usable_w >= 0.99
    assert image_rect.height / usable_h >= 0.99
    assert 24 * image_rect.width / 2436 >= 11.9
    assert result.detail_pages == 0
    doc.close()


def test_content_fit_improves_ultra_wide_page_utilization_without_reducing_font_size():
    png = _map_png()
    manifest = _manifest()
    docs = {}
    for page_size in ("A4", "content_fit"):
        result = serialize_pdf_with_result(
            _tree(), mode="map", page_size=page_size, map_image_bytes=png,
            geometry_manifest=manifest, margins="normal",
        )
        docs[page_size] = fitz.open(stream=result.content, filetype="pdf")

    def metrics(doc: fitz.Document) -> tuple[float, float]:
        page = doc[0]
        rect = _image_rect(page)
        usable_area = (page.rect.width - 80) * (page.rect.height - 80)
        return rect.get_area() / usable_area, 24 * rect.width / 2436

    a4_occupancy, a4_font = metrics(docs["A4"])
    fit_occupancy, fit_font = metrics(docs["content_fit"])
    assert fit_occupancy >= 0.98
    assert fit_occupancy >= a4_occupancy * 4
    assert fit_font >= a4_font
    for doc in docs.values():
        doc.close()


def test_content_fit_map_and_outline_keeps_outline_on_standard_a4_portrait_pages():
    result = serialize_pdf_with_result(
        _tree(), mode="map_and_outline", page_size="content_fit", map_image_bytes=_map_png(),
        geometry_manifest=_manifest(), margins="normal",
    )
    doc = fitz.open(stream=result.content, filetype="pdf")
    assert doc.page_count >= 2
    assert doc[0].rect.width / doc[0].rect.height > 4
    assert (doc[-1].rect.width, doc[-1].rect.height) == pytest.approx((595, 842), abs=0.1)
    assert "Phát hiện" in doc[-1].get_text()
    doc.close()


def test_content_fit_keeps_h2_detail_pages_between_overview_and_a4_outline():
    manifest = _manifest()
    for node in manifest["nodes"]:
        node["font_size_px"] = 4
    result = serialize_pdf_with_result(
        _tree(), mode="map_and_outline", page_size="content_fit", map_image_bytes=_map_png(),
        geometry_manifest=manifest, margins="normal",
    )
    doc = fitz.open(stream=result.content, filetype="pdf")
    assert result.detail_pages > 0
    assert doc.page_count == result.detail_pages + 2
    assert doc[0].rect.width / doc[0].rect.height > 4
    for page in doc[1:1 + result.detail_pages]:
        assert {round(page.rect.width), round(page.rect.height)} == {595, 842}
        assert "Chi tiết" in page.get_text()
    assert (round(doc[-1].rect.width), round(doc[-1].rect.height)) == (595, 842)
    assert "Sơ đồ H4" in doc[-1].get_text()
    assert len({image[0] for page in doc for image in page.get_images(full=True)}) == 1
    doc.close()


@pytest.mark.parametrize("page_size,expected", [("A4", (842, 595)), ("A3", (1191, 842))])
def test_standard_print_page_dimensions_are_unchanged(page_size: str, expected: tuple[int, int]):
    result = serialize_pdf_with_result(_tree(), mode="map", page_size=page_size, map_image_bytes=_map_png())
    doc = fitz.open(stream=result.content, filetype="pdf")
    assert (doc[0].rect.width, doc[0].rect.height) == pytest.approx(expected, abs=0.1)
    doc.close()


def test_content_fit_does_not_change_exact_selected_branch_membership():
    nodes = [
        {"id": "ROOT", "parent": None, "kind": "root", "title": "An ninh mạng và quyền riêng tư", "order": 0},
        {"id": "P", "parent": "ROOT", "kind": "section", "title": "Phát hiện và xử lý vi phạm mạng", "order": 0},
        {"id": "A", "parent": "P", "kind": "idea", "title": "Dung File Tập Trung Vào", "order": 0},
        {"id": "B", "parent": "P", "kind": "idea", "title": "Phát hiện & xử lý vi phạm", "order": 1},
        {"id": "C", "parent": "P", "kind": "idea", "title": "Đăng nhập trái phép", "order": 2},
        {"id": "D", "parent": "P", "kind": "idea", "title": "Lắp đặt camera giám sát", "order": 3},
    ]
    scope = resolve_export_scope(
        nodes, scope_type="selected_branches", selected_branch_root_ids=["B", "C"], include_descendants=False,
    )
    assert scope["explicit_selected_ids"] == ["B", "C"]
    assert scope["included_ids"] == {"B", "C"}
    assert scope["context_ids"] == {"P"}
    assert scope["render_ids"] == {"P", "B", "C"}
    tree = build_export_tree(
        nodes, [], scope["root_ids"], scope["included_ids"], title="Exact H4",
        context_ids=scope["context_ids"], presentation_root_id=scope["presentation_root_id"],
    )

    result = serialize_pdf_with_result(
        tree, mode="map_and_outline", page_size="content_fit", map_image_bytes=_map_png(1200, 300),
        geometry_manifest=_manifest(1200, 300),
    )
    doc = fitz.open(stream=result.content, filetype="pdf")
    outline = "".join(page.get_text() for page in doc[1:])
    assert "Phát hiện và xử lý vi phạm mạng" in outline
    assert "Phát hiện & xử lý vi phạm" in outline
    assert "Đăng nhập trái phép" in outline
    assert "An ninh mạng và quyền riêng tư" not in outline
    assert "Dung File Tập Trung Vào" not in outline
    assert "Lắp đặt camera giám sát" not in outline
    doc.close()
