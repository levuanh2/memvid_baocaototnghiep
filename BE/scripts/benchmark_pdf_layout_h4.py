"""Deterministic H4 PDF-layout benchmark.

Run from BE/:
    python -m scripts.benchmark_pdf_layout_h4 --output ../qa-artifacts/h4-pdf-layout/baseline

The fixture raster is the source of truth for topology. Geometry manifests use
the same node rectangles and connector bounds drawn into that raster, so the
serializer's readability planner is measured against real pixels rather than
invented counts.
"""
from __future__ import annotations

import argparse
import io
import json
import statistics
import time
import tracemalloc
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fitz
from PIL import Image, ImageChops, ImageDraw, ImageFont

from services.mindmap.export.pdf_layout import centered_fit_rect, choose_content_fit_page, choose_map_orientation
from services.mindmap.export.pdf_serializer import MARGINS_PT, PAGE_SIZES_PT, serialize_pdf_with_result


@dataclass(frozen=True)
class FixtureSpec:
    key: str
    width: int
    height: int
    node_count: int
    layout: str
    long_vietnamese: bool = False


FIXTURES = (
    FixtureSpec("a_ultra_wide", 2436, 296, 5, "wide"),
    FixtureSpec("b_very_large", 5066, 1350, 57, "grid"),
    FixtureSpec("c_exact_three", 1200, 300, 3, "wide"),
    FixtureSpec("d_balanced", 1800, 1000, 15, "balanced"),
    FixtureSpec("e_tall_narrow", 700, 2400, 14, "tall"),
    FixtureSpec("f_unicode_dense", 3200, 1800, 41, "grid", True),
)


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    font_path = Path(__file__).resolve().parents[1] / "assets" / "fonts" / "DejaVuSans.ttf"
    return ImageFont.truetype(str(font_path), size=size) if font_path.exists() else ImageFont.load_default()


def _positions(spec: FixtureSpec) -> list[tuple[float, float]]:
    if spec.layout == "wide":
        return [(spec.width * (i + 1) / (spec.node_count + 1), spec.height / 2) for i in range(spec.node_count)]
    if spec.layout == "tall":
        return [(spec.width / 2, spec.height * (i + 1) / (spec.node_count + 1)) for i in range(spec.node_count)]
    if spec.layout == "balanced":
        out = [(spec.width / 2, spec.height / 2)]
        for i in range(1, spec.node_count):
            side = -1 if i % 2 else 1
            rank = (i + 1) // 2
            out.append((spec.width / 2 + side * spec.width * 0.31, spec.height * rank / 8))
        return out
    cols = 9 if spec.node_count > 45 else 7
    rows = (spec.node_count + cols - 1) // cols
    return [
        (spec.width * ((i % cols) + 1) / (cols + 1), spec.height * ((i // cols) + 1) / (rows + 1))
        for i in range(spec.node_count)
    ]


def build_fixture(spec: FixtureSpec) -> tuple[dict[str, Any], dict[str, Any], bytes]:
    positions = _positions(spec)
    nodes: list[dict[str, Any]] = []
    children: list[dict[str, Any]] = []
    manifest_nodes: list[dict[str, Any]] = []
    connectors: list[dict[str, Any]] = []
    image = Image.new("RGB", (spec.width, spec.height), "white")
    draw = ImageDraw.Draw(image)
    node_w = 360 if spec.long_vietnamese else max(130, min(300, spec.width // (10 if spec.layout == "grid" else max(spec.node_count, 3))))
    node_h = 54
    font_px = 18 if spec.long_vietnamese else (24 if spec.key != "b_very_large" else 22)
    font = _font(font_px)
    topics = []
    for i in range(spec.node_count):
        if spec.long_vietnamese:
            topics.append(f"Nhánh {i + 1}: bảo mật dữ liệu, quyền riêng tư và khôi phục hệ thống")
        else:
            topics.append("Chủ đề gốc" if i == 0 else f"Nút {i + 1}")

    for i, (cx, cy) in enumerate(positions):
        node_id = "P" if spec.key == "c_exact_three" and i == 0 else (
            "B" if spec.key == "c_exact_three" and i == 1 else "C" if spec.key == "c_exact_three" else f"n{i}"
        )
        x = max(0.0, min(spec.width - node_w, cx - node_w / 2))
        y = max(0.0, min(spec.height - node_h, cy - node_h / 2))
        parent_id = None if i == 0 else ("P" if spec.key == "c_exact_three" else "n0")
        kind = "root" if i == 0 else "idea"
        node = {"node_id": node_id, "title": topics[i], "kind": kind, "is_context": False, "children": []}
        if i == 0:
            root = node
        else:
            children.append(node)
        manifest_nodes.append({
            "id": node_id, "x": x, "y": y, "width": node_w, "height": node_h,
            "font_size_px": font_px, "parent_id": parent_id,
        })
        draw.rounded_rectangle((x, y, x + node_w, y + node_h), radius=10, fill="#F8FAFC", outline="#2563EB", width=3)
        label = topics[i]
        if spec.long_vietnamese:
            label = f"Nhánh {i + 1}: bảo mật dữ liệu"
        bbox = draw.textbbox((0, 0), label, font=font)
        draw.text((x + (node_w - (bbox[2] - bbox[0])) / 2, y + (node_h - (bbox[3] - bbox[1])) / 2), label, font=font, fill="#172554")
        nodes.append(node)

    root["children"] = children
    root_rect = manifest_nodes[0]
    rx = root_rect["x"] + root_rect["width"] / 2
    ry = root_rect["y"] + root_rect["height"] / 2
    for child in manifest_nodes[1:]:
        cx = child["x"] + child["width"] / 2
        cy = child["y"] + child["height"] / 2
        draw.line((rx, ry, cx, cy), fill="#64748B", width=4)
        x0, y0, x1, y1 = min(rx, cx), min(ry, cy), max(rx, cx), max(ry, cy)
        connectors.append({"from": manifest_nodes[0]["id"], "to": child["id"], "x": x0, "y": y0, "width": max(1, x1 - x0), "height": max(1, y1 - y0)})
    # Redraw nodes over connectors, matching the browser's visual stacking.
    for index, node in enumerate(manifest_nodes):
        draw.rounded_rectangle((node["x"], node["y"], node["x"] + node["width"], node["y"] + node["height"]), radius=10, fill="#F8FAFC", outline="#2563EB", width=3)
        label = topics[index]
        if spec.long_vietnamese:
            label = f"Nhánh {index + 1}: bảo mật dữ liệu"
        bbox = draw.textbbox((0, 0), label, font=font)
        draw.text(
            (
                node["x"] + (node_w - (bbox[2] - bbox[0])) / 2,
                node["y"] + (node_h - (bbox[3] - bbox[1])) / 2,
            ),
            label,
            font=font,
            fill="#172554",
        )

    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    tree = {"title": f"H4 {spec.key}", "roots": [root], "relations": []}
    manifest = {"image_width_px": spec.width, "image_height_px": spec.height, "nodes": manifest_nodes, "connectors": connectors}
    return tree, manifest, buffer.getvalue()


def _content_bbox(page: fitz.Page, scale: float = 1.0) -> tuple[float, float, float, float] | None:
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    background = Image.new("RGB", image.size, image.getpixel((0, 0)))
    bbox = ImageChops.difference(image, background).getbbox()
    if not bbox:
        return None
    return tuple(value / scale for value in bbox)


def benchmark_fixture(spec: FixtureSpec, output: Path, *, page_size: str = "A4") -> dict[str, Any]:
    tree, manifest, png = build_fixture(spec)
    margin = MARGINS_PT["normal"]
    page_pt = PAGE_SIZES_PT.get(page_size, PAGE_SIZES_PT["A4"])
    font_sizes = [node["font_size_px"] for node in manifest["nodes"]]
    choice = (
        choose_content_fit_page(spec.width, spec.height, margin, font_sizes_px=font_sizes)
        if page_size == "content_fit"
        else choose_map_orientation(spec.width, spec.height, page_pt, margin)
    )
    fit_rect = centered_fit_rect(spec.width, spec.height, choice.page_w, choice.page_h, margin)
    effective = sorted(node["font_size_px"] * fit_rect.width / spec.width for node in manifest["nodes"])

    timings = []
    result = None
    tracemalloc.start()
    for _ in range(3):
        started = time.perf_counter()
        result = serialize_pdf_with_result(
            tree, mode="map", page_size=page_size, map_image_bytes=png,
            geometry_manifest=manifest, margins="normal",
        )
        timings.append((time.perf_counter() - started) * 1000)
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert result is not None

    fixture_dir = output / spec.key
    fixture_dir.mkdir(parents=True, exist_ok=True)
    (fixture_dir / "source.png").write_bytes(png)
    (fixture_dir / f"{page_size.lower()}.pdf").write_bytes(result.content)
    doc = fitz.open(stream=result.content, filetype="pdf")
    page = doc[0]
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    pix.save(fixture_dir / f"{page_size.lower()}-page1.png")
    bbox = _content_bbox(page, scale=2.0)
    usable_w, usable_h = page.rect.width - 2 * margin, page.rect.height - 2 * margin
    if bbox:
        content_w, content_h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    else:
        content_w = content_h = 0.0
    metrics = {
        "fixture": spec.key,
        "image_px": [spec.width, spec.height],
        "image_aspect": round(spec.width / spec.height, 4),
        "page_size": page_size,
        "page_pt": [round(page.rect.width, 2), round(page.rect.height, 2)],
        "orientation": "landscape" if page.rect.width > page.rect.height else "portrait",
        "content_rect_pt": [round(v, 2) for v in bbox] if bbox else None,
        "usable_pt": [round(usable_w, 2), round(usable_h, 2)],
        "map_rect_pt": [round(fit_rect.x0, 2), round(fit_rect.y0, 2), round(fit_rect.x1, 2), round(fit_rect.y1, 2)],
        "map_occupancy_width_pct": round(100 * fit_rect.width / usable_w, 2),
        "map_occupancy_height_pct": round(100 * fit_rect.height / usable_h, 2),
        "map_occupancy_area_pct": round(100 * fit_rect.width * fit_rect.height / (usable_w * usable_h), 2),
        "occupancy_width_pct": round(100 * content_w / usable_w, 2),
        "occupancy_height_pct": round(100 * content_h / usable_h, 2),
        "occupancy_area_pct": round(100 * content_w * content_h / (usable_w * usable_h), 2),
        "overview_font_min_pt": round(min(effective), 2),
        "overview_font_median_pt": round(statistics.median(effective), 2),
        "pages": len(doc),
        "detail_pages": result.detail_pages,
        "warning": result.warning,
        "file_bytes": len(result.content),
        "serialize_ms_median": round(statistics.median(timings), 2),
        "python_peak_bytes": peak,
        "embedded_image_xrefs": len({img[0] for p in doc for img in p.get_images(full=True)}),
    }
    doc.close()
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--page-size", choices=("A4", "A3", "content_fit"), default="A4")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    rows = [benchmark_fixture(spec, args.output, page_size=args.page_size) for spec in FIXTURES]
    (args.output / "metrics.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(rows, ensure_ascii=True))


if __name__ == "__main__":
    main()
