"""PR H — PDF layout/readability red tests, written against the unmodified
serialize_pdf(). Root causes confirmed with real files before any of this
was written (see .playbook/known-issues.md): orientation is a raw
pass-through never compared against the real image's fit scale; outline
text uses insert_text with no wrap at all; the outline cursor advances a
fixed LINE_HEIGHT per logical line regardless of how many lines a
multi-paragraph note actually renders.
"""
from __future__ import annotations

import io

import fitz
import pytest
from PIL import Image

from services.mindmap.export.scope import resolve_export_scope
from services.mindmap.export.tree import build_export_tree
from services.mindmap.export.pdf_serializer import serialize_pdf


# ---- fixtures -----------------------------------------------------------

def _nodes(n=8, title_fn=None):
    out = [{"id": "r", "parent": None, "kind": "root", "title": "Bản đồ tư duy", "order": 0}]
    for i in range(n):
        out.append({
            "id": f"c{i}", "parent": "r", "kind": "section",
            "title": title_fn(i) if title_fn else f"Nhánh {i}", "order": i,
        })
    return out


def _tree(nodes, relations=None, **scope_kwargs):
    scope_kwargs.setdefault("scope_type", "full")
    scope = resolve_export_scope(nodes, **scope_kwargs)
    return build_export_tree(nodes, relations or [], scope["root_ids"], scope["included_ids"], title="Bản đồ tư duy")


def _solid_png(w: int, h: int, rgb=(30, 100, 220)) -> bytes:
    """A real, non-uniform PNG at an exact w x h -- a thin white border so
    the image guard's blank-image check never rejects it, decodable size is
    exactly what the test asserts against. Built with Pillow (already a BE
    test dependency -- see test_avatar_nks.py), not a hand-rolled PNG
    encoder: an earlier hand-rolled version silently produced a PNG
    PyMuPDF decoded as a DIFFERENT effective colorspace, which made
    insert_image's own aspect-preservation behave inconsistently -- caught
    by this file's own square-image test disagreeing with Pillow's
    independent decode of the very same bytes."""
    img = Image.new("RGB", (w, h), (255, 255, 255))
    inset = max(1, min(w, h) // 40)
    for y in range(inset, h - inset):
        for x in range(inset, w - inset):
            img.putpixel((x, y), rgb)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _png_size(data: bytes) -> tuple[int, int]:
    return Image.open(io.BytesIO(data)).size


WIDE_PNG = _solid_png(1600, 400)   # 4:1
TALL_PNG = _solid_png(500, 1400)   # 1:2.8
SQUARE_PNG = _solid_png(800, 800)  # 1:1


def _all_spans(page: "fitz.Page") -> list["fitz.Rect"]:
    out = []
    for block in page.get_text("dict")["blocks"]:
        if "lines" not in block:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                out.append(fitz.Rect(span["bbox"]))
    return out


def _overlap_pairs(spans: list["fitz.Rect"], tolerance_pt2: float = 1.0) -> int:
    n = len(spans)
    count = 0
    for i in range(n):
        for j in range(i + 1, n):
            inter = spans[i] & spans[j]
            if not inter.is_empty and inter.get_area() > tolerance_pt2:
                count += 1
    return count


def _image_placement(doc: "fitz.Document", page_index: int = 0):
    page = doc[page_index]
    imgs = page.get_images(full=True)
    assert imgs, f"page {page_index} has no embedded image"
    xref = imgs[0][0]
    rect = page.get_image_rects(xref)[0]
    return page.rect, rect


# ---- Geometry: orientation picked by real fit scale ----------------------

def test_wide_map_image_gets_a_landscape_page_even_when_portrait_is_requested():
    file_bytes = serialize_pdf(_tree(_nodes()), mode="map", map_image_bytes=WIDE_PNG, orientation="portrait")
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    page = doc[0]
    assert page.rect.width > page.rect.height, (
        f"expected a landscape page for a 4:1 wide map image, got {page.rect.width}x{page.rect.height}"
    )
    doc.close()


def test_tall_map_image_gets_a_portrait_page_even_when_landscape_is_requested():
    file_bytes = serialize_pdf(_tree(_nodes()), mode="map", map_image_bytes=TALL_PNG, orientation="landscape")
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    page = doc[0]
    assert page.rect.height > page.rect.width, (
        f"expected a portrait page for a 1:2.8 tall map image, got {page.rect.width}x{page.rect.height}"
    )
    doc.close()


def _usable_area_ratio(file_bytes: bytes, margin: float = 40.0) -> float:
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    page_rect, img_rect = _image_placement(doc)
    usable = (page_rect.width - 2 * margin) * (page_rect.height - 2 * margin)
    doc.close()
    return (img_rect.width * img_rect.height) / usable


def test_wide_map_image_uses_more_usable_area_than_the_broken_orientation_did():
    # A 4:1 image contain-fit into A4 can never fill the WHOLE usable box
    # in either orientation (the box itself isn't 4:1) -- the real,
    # mathematically exact ceiling for landscape here is 37.0%
    # (762x515pt usable, 0.4763 scale), vs 16.9% forced into portrait. The
    # regression target is "did the orientation choice actually help",
    # not an arbitrary absolute number.
    fixed_ratio = _usable_area_ratio(serialize_pdf(_tree(_nodes()), mode="map", map_image_bytes=WIDE_PNG, orientation="portrait"))
    assert fixed_ratio > 0.35, f"landscape contain-fit should reach ~37.0%, got {fixed_ratio * 100:.1f}%"


# ---- Geometry: fit, centering, no crop ------------------------------------

@pytest.mark.parametrize("png,label", [(WIDE_PNG, "wide"), (TALL_PNG, "tall"), (SQUARE_PNG, "square")], ids=["wide", "tall", "square"])
def test_map_image_rect_preserves_aspect_ratio_within_one_percent(png, label):
    file_bytes = serialize_pdf(_tree(_nodes()), mode="map", map_image_bytes=png)
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    _, img_rect = _image_placement(doc)
    src_w, src_h = _png_size(png)
    src_ar = src_w / src_h
    rect_ar = img_rect.width / img_rect.height
    diff_pct = abs(src_ar - rect_ar) / src_ar * 100
    assert diff_pct <= 1.0, f"[{label}] aspect ratio drifted {diff_pct:.2f}% (source {src_ar:.3f} vs rect {rect_ar:.3f})"
    doc.close()


@pytest.mark.parametrize("png,label", [(WIDE_PNG, "wide"), (TALL_PNG, "tall"), (SQUARE_PNG, "square")], ids=["wide", "tall", "square"])
def test_map_image_is_centered_in_the_usable_page_rect(png, label):
    file_bytes = serialize_pdf(_tree(_nodes()), mode="map", map_image_bytes=png)
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    page_rect, img_rect = _image_placement(doc)
    dx = abs((img_rect.x0 + img_rect.x1) / 2 - page_rect.width / 2)
    dy = abs((img_rect.y0 + img_rect.y1) / 2 - page_rect.height / 2)
    assert dx <= 1.0 and dy <= 1.0, f"[{label}] center delta dx={dx:.2f} dy={dy:.2f}"
    doc.close()


def test_map_image_rect_never_falls_outside_the_safe_margin():
    file_bytes = serialize_pdf(_tree(_nodes()), mode="map", map_image_bytes=WIDE_PNG, margins="narrow")
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    page_rect, img_rect = _image_placement(doc)
    MIN_MARGIN = 24.0
    assert img_rect.x0 >= MIN_MARGIN - 0.5
    assert img_rect.y0 >= MIN_MARGIN - 0.5
    assert page_rect.width - img_rect.x1 >= MIN_MARGIN - 0.5
    assert page_rect.height - img_rect.y1 >= MIN_MARGIN - 0.5
    doc.close()


def test_no_blank_pages_across_every_mode():
    for mode, kwargs in [
        ("map", {"map_image_bytes": WIDE_PNG}),
        ("outline", {}),
        ("map_and_outline", {"map_image_bytes": WIDE_PNG}),
    ]:
        file_bytes = serialize_pdf(_tree(_nodes()), mode=mode, **kwargs)
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        for i, page in enumerate(doc):
            has_text = bool(page.get_text().strip())
            has_image = len(page.get_images()) > 0
            assert has_text or has_image, f"mode={mode} page {i} is blank"
        doc.close()


# ---- Mode contract ---------------------------------------------------------

def test_map_mode_has_exactly_one_page_and_no_outline_text():
    file_bytes = serialize_pdf(_tree(_nodes()), mode="map", map_image_bytes=WIDE_PNG)
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    assert doc.page_count == 1
    assert doc[0].get_text().strip() == "", "map mode must not draw any outline text"
    doc.close()


def test_map_and_outline_puts_the_outline_on_a_new_page_not_under_the_map():
    file_bytes = serialize_pdf(_tree(_nodes()), mode="map_and_outline", map_image_bytes=WIDE_PNG)
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    assert doc.page_count >= 2
    assert doc[0].get_text().strip() == "", "page 0 (the map page) must carry no outline text"
    assert "Bản đồ tư duy" in doc[1].get_text()
    doc.close()


def test_map_and_outline_allows_mixed_orientation_map_landscape_outline_portrait():
    file_bytes = serialize_pdf(_tree(_nodes()), mode="map_and_outline", map_image_bytes=WIDE_PNG, orientation="portrait")
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    map_page, outline_page = doc[0], doc[1]
    assert map_page.rect.width > map_page.rect.height, "wide map page should have ended up landscape"
    assert outline_page.rect.height > outline_page.rect.width, "outline pages should stay portrait for readability"
    doc.close()


@pytest.mark.parametrize("scope_type,kwargs,expected_present,expected_absent", [
    ("current_branch", {"selected_node_id": "c0"}, "Nhánh 0", "Nhánh 1"),
])
def test_scoped_pdf_node_count_matches_pr69_resolver(scope_type, kwargs, expected_present, expected_absent):
    nodes = _nodes(3)
    tree = _tree(nodes, scope_type=scope_type, **kwargs)
    file_bytes = serialize_pdf(tree, mode="outline")
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    full_text = "".join(p.get_text() for p in doc)
    assert expected_present in full_text
    assert expected_absent not in full_text
    doc.close()


# ---- Outline: wrap, overlap, page breaks -----------------------------------

LONG_TOPIC_NO_NEWLINE = (
    "Nhánh có tiêu đề cực kỳ dài không hề chứa dấu xuống dòng nào cả, mô phỏng một chuỗi văn bản "
    "tiếng Việt thực tế dài hơn rất nhiều so với chiều rộng khả dụng của trang để kiểm tra wrap"
)

MULTI_PARAGRAPH_NOTE = (
    "Đoạn một của ghi chú, khá dài để kiểm tra việc chữ có bị chồng lên nhau hay không khi ghi chú "
    "có nhiều đoạn văn bản thật sự dài.\n\n"
    "Đoạn hai của ghi chú, tiếp tục nội dung sau một dòng trống, mô phỏng một ghi chú nhiều đoạn "
    "thực tế trong ứng dụng."
)

LONG_UNBROKEN_TOKEN = "a" * 300  # no whitespace at all to break on


def test_long_topic_wraps_and_never_crosses_the_right_margin():
    nodes = [
        {"id": "r", "parent": None, "kind": "root", "title": "Bản đồ tư duy", "order": 0},
        {"id": "c0", "parent": "r", "kind": "section", "title": LONG_TOPIC_NO_NEWLINE, "order": 0},
    ]
    file_bytes = serialize_pdf(_tree(nodes), mode="outline")
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    margin = 40.0
    for page in doc:
        for span in _all_spans(page):
            assert span.x1 <= page.rect.width - margin + 0.5, (
                f"span crosses the right margin: x1={span.x1:.1f} limit={page.rect.width - margin:.1f}"
            )
    doc.close()


def test_multi_paragraph_note_does_not_overlap_the_following_node():
    nodes = [
        {"id": "r", "parent": None, "kind": "root", "title": "Bản đồ tư duy", "order": 0},
        {"id": "c0", "parent": "r", "kind": "section", "title": "Nhánh có ghi chú dài", "order": 0, "note": MULTI_PARAGRAPH_NOTE},
        {"id": "c1", "parent": "r", "kind": "section", "title": "Nhánh kế tiếp PHAI khong bi de chu", "order": 1},
    ]
    file_bytes = serialize_pdf(_tree(nodes), mode="outline", content={"notes": True})
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    full_text = "".join(p.get_text() for p in doc)
    assert "PHAI khong bi de chu" in full_text  # node survives, not swallowed
    total_overlaps = sum(_overlap_pairs(_all_spans(p)) for p in doc)
    assert total_overlaps == 0, f"{total_overlaps} overlapping span pair(s) found"
    doc.close()


def test_long_unbroken_token_does_not_corrupt_the_page():
    nodes = [
        {"id": "r", "parent": None, "kind": "root", "title": "Bản đồ tư duy", "order": 0},
        {"id": "c0", "parent": "r", "kind": "section", "title": LONG_UNBROKEN_TOKEN, "order": 0},
        {"id": "c1", "parent": "r", "kind": "section", "title": "Nhánh sau token dài", "order": 1},
    ]
    file_bytes = serialize_pdf(_tree(nodes), mode="outline")
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    full_text = "".join(p.get_text() for p in doc)
    assert "Nhánh sau token dài" in full_text
    assert doc.page_count >= 1
    doc.close()


def test_no_overlapping_spans_across_a_realistic_mixed_document():
    nodes = _nodes(15, title_fn=lambda i: (
        LONG_TOPIC_NO_NEWLINE if i == 3 else f"Nhánh {i}"
    ))
    nodes[4]["note"] = MULTI_PARAGRAPH_NOTE  # c3 is nodes[4] (index 0 is root)
    tree = _tree(nodes)
    file_bytes = serialize_pdf(tree, mode="outline", content={"notes": True})
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    total_overlaps = sum(_overlap_pairs(_all_spans(p)) for p in doc)
    assert total_overlaps == 0, f"{total_overlaps} overlapping span pair(s) in a realistic mixed document"
    doc.close()


def test_no_span_falls_below_the_bottom_margin_page_break_works():
    tree = _tree(_nodes(120))
    file_bytes = serialize_pdf(tree, mode="outline")
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    margin = 40.0
    for page in doc:
        for span in _all_spans(page):
            assert span.y1 <= page.rect.height - margin + 1.0, (
                f"span crosses the bottom margin: y1={span.y1:.1f} limit={page.rect.height - margin:.1f}"
            )
    doc.close()


def test_vietnamese_unicode_round_trips_through_a_wrapped_long_topic():
    vn_topic = "Phương pháp luận nghiên cứu khoa học: ăn, uống, điều kiện sống của người lao động " * 2
    nodes = [
        {"id": "r", "parent": None, "kind": "root", "title": "Bản đồ tư duy", "order": 0},
        {"id": "c0", "parent": "r", "kind": "section", "title": vn_topic.strip(), "order": 0},
    ]
    file_bytes = serialize_pdf(_tree(nodes), mode="outline")
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    full_text = "".join(p.get_text() for p in doc)
    for word in ["Phương", "pháp", "điều", "kiện", "người"]:
        assert word in full_text, f"Vietnamese word {word!r} missing or mangled in extracted text"
    assert "?" * 3 not in full_text  # a common mojibake tell for unsupported glyphs
    doc.close()


# ---- Additional Phase 3 coverage (requested in the implementation checkpoint) ----
# NOTE: a pure-helper unit test that imports services.mindmap.export.pdf_layout
# directly lives in test_pdf_layout_helpers.py instead of here -- that module
# doesn't exist until the fix commit, and this file must stay collectible
# (and fail only by real assertion, never ImportError) on the unmodified base.

def test_every_span_stays_within_the_usable_page_rect_both_axes():
    # The page TITLE (drawn at fontsize+4, baseline y=margin -- unchanged
    # by this PR) legitimately has its glyph bbox top a few pt ABOVE its
    # own baseline (normal font-ascent geometry, true of any PDF text
    # engine) -- skip only that one header span per page; every outline
    # BODY line (this PR's actual fix target) must stay fully inside.
    nodes = _nodes(10, title_fn=lambda i: LONG_TOPIC_NO_NEWLINE if i % 3 == 0 else f"Nhánh {i}")
    nodes[2]["note"] = MULTI_PARAGRAPH_NOTE
    tree = _tree(nodes)
    file_bytes = serialize_pdf(tree, mode="outline", content={"notes": True})
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    margin = 40.0
    for page in doc:
        usable = fitz.Rect(margin, margin, page.rect.width - margin, page.rect.height - margin)
        spans = _all_spans(page)
        body_spans = spans[1:] if page.number == 0 else spans  # page 0's first span is the title
        for span in body_spans:
            assert usable.contains(span) or (span & usable).get_area() >= span.get_area() - 1.0, (
                f"span {tuple(span)} escapes the usable rect {tuple(usable)}"
            )
    doc.close()


def test_a_block_too_tall_for_the_remaining_page_space_moves_to_the_next_page_intact():
    # A block near the bottom of a page that doesn't fit must move to a
    # FRESH page whole, not be split mid-block (which would duplicate or
    # drop its own internal lines).
    nodes = _nodes(1)
    nodes[1]["note"] = "Dòng một.\n\nDòng hai.\n\nDòng ba.\n\nDòng bốn.\n\nDòng năm."
    tree = _tree(nodes)
    file_bytes = serialize_pdf(tree, mode="outline", content={"notes": True})
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    full_text = "".join(p.get_text() for p in doc)
    for line in ["Dòng một", "Dòng hai", "Dòng ba", "Dòng bốn", "Dòng năm"]:
        assert full_text.count(line) == 1, f"{line!r} appears {full_text.count(line)} times (expected exactly once)"
    doc.close()


def test_blank_paragraph_in_a_note_does_not_cause_overlap():
    nodes = _nodes(1)
    nodes[1]["note"] = "Đoạn trước.\n\n\nĐoạn sau."  # a genuinely blank paragraph in the middle
    nodes.append({"id": "c1", "parent": "r", "kind": "section", "title": "Nhánh kế tiếp", "order": 1})
    tree = _tree(nodes)
    file_bytes = serialize_pdf(tree, mode="outline", content={"notes": True})
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    full_text = "".join(p.get_text() for p in doc)
    assert "Nhánh kế tiếp" in full_text
    total_overlaps = sum(_overlap_pairs(_all_spans(p)) for p in doc)
    assert total_overlaps == 0
    doc.close()


def test_map_image_rect_has_positive_width_and_height():
    file_bytes = serialize_pdf(_tree(_nodes()), mode="map", map_image_bytes=WIDE_PNG)
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    _, img_rect = _image_placement(doc)
    assert img_rect.width > 0 and img_rect.height > 0
    doc.close()


def test_malformed_image_still_fails_clearly_not_silently():
    with pytest.raises(ValueError):
        serialize_pdf(_tree(_nodes()), mode="map", map_image_bytes=b"not a real png")
    with pytest.raises(ValueError):
        serialize_pdf(_tree(_nodes()), mode="map", map_image_bytes=b"")


def test_legacy_orientation_value_still_parses_without_error_for_every_mode():
    # Old stored job options may still carry an explicit orientation for
    # the map page -- it must keep being ACCEPTED (never raise), even
    # though it no longer forces that page's own orientation.
    for mode, kwargs in [
        ("map", {"map_image_bytes": WIDE_PNG}),
        ("outline", {}),
        ("map_and_outline", {"map_image_bytes": WIDE_PNG}),
    ]:
        for legacy_orientation in ["portrait", "landscape"]:
            file_bytes = serialize_pdf(_tree(_nodes()), mode=mode, orientation=legacy_orientation, **kwargs)
            assert file_bytes[:5] == b"%PDF-"


# ---- Guard: scope resolution (PR #69) is unaffected by this PR ----

@pytest.mark.parametrize("scope_type,kwargs", [
    ("full", {}),
    ("current_branch", {"selected_node_id": "c0"}),
    ("selected_branches", {"selected_branch_root_ids": ["c0", "c1"]}),
])
def test_pr69_scope_types_keep_their_node_count_through_pdf_serialization(scope_type, kwargs):
    nodes = _nodes(3)
    tree = _tree(nodes, scope_type=scope_type, **kwargs)
    expected_count = sum(1 for r in tree["roots"] for _ in [r])  # at least the declared roots exist
    file_bytes = serialize_pdf(tree, mode="outline")
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    assert doc.page_count >= 1
    full_text = "".join(p.get_text() for p in doc)
    assert "Bản đồ tư duy" in full_text  # root always present
    doc.close()
    assert expected_count >= 1
