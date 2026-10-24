#!/usr/bin/env python3
"""Artifact-level checks for real-backend-pdf-export.spec.js.

The browser test owns creation/download. This verifier independently opens
the resulting PDFs with PyMuPDF and compares their embedded map pixels with
the exact Chromium capture submitted to the real Flask export endpoint.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import fitz
from PIL import Image


def rgb(hex_color: str) -> tuple[int, int, int]:
    value = hex_color.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def luminance(color: tuple[int, int, int]) -> float:
    channels = []
    for value in color:
        component = value / 255
        channels.append(component / 12.92 if component <= 0.04045 else ((component + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def contrast(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    light, dark = sorted((luminance(a), luminance(b)), reverse=True)
    return (light + 0.05) / (dark + 0.05)


def close(pixel: tuple[int, ...], target: tuple[int, int, int], tolerance: int = 24) -> bool:
    return math.dist(pixel[:3], target) <= tolerance


def count_color(image: Image.Image, box: tuple[int, int, int, int], target: tuple[int, int, int], tolerance: int = 24) -> int:
    x0, y0, x1, y1 = box
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(image.width, x1), min(image.height, y1)
    return sum(close(pixel, target, tolerance) for pixel in image.crop((x0, y0, x1, y1)).getdata())


def count_ink(image: Image.Image, box: tuple[int, int, int, int]) -> int:
    x0, y0, x1, y1 = box
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(image.width, x1), min(image.height, y1)
    return sum(min(pixel[:3]) < 235 for pixel in image.crop((x0, y0, x1, y1)).getdata())


def pixmap_image(doc: fitz.Document, xref: int) -> Image.Image:
    pix = fitz.Pixmap(doc, xref)
    if pix.colorspace is None or pix.colorspace.n != 3 or pix.alpha:
        pix = fitz.Pixmap(fitz.csRGB, pix)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def pixel_delta(a: Image.Image, b: Image.Image) -> tuple[float, int]:
    if a.size != b.size:
        raise AssertionError(f"embedded image size {b.size} != source {a.size}")
    total = 0
    maximum = 0
    samples = a.width * a.height * 3
    for left, right in zip(a.convert("RGB").tobytes(), b.convert("RGB").tobytes()):
        delta = abs(left - right)
        total += delta
        maximum = max(maximum, delta)
    return total / samples, maximum


def verify_scenario(folder: Path) -> dict:
    expected = json.loads((folder / "expectations.json").read_text(encoding="utf-8"))
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    source = Image.open(folder / "source.png").convert("RGB")
    assert source.size == (manifest["image_width_px"], manifest["image_height_px"])

    nodes = {node["id"]: node for node in manifest["nodes"]}
    color_metrics = {}
    for node_id in ("ROOT", "P"):
        node = nodes[node_id]
        box = (
            round(node["x"]), round(node["y"]),
            round(node["x"] + node["width"]), round(node["y"] + node["height"]),
        )
        fill = rgb(expected["colors"][node_id]["fill"])
        text = rgb(expected["colors"][node_id]["text"])
        fill_pixels = count_color(source, box, fill)
        text_pixels = count_color(source, box, text, tolerance=30)
        assert fill_pixels >= 20, f"{folder.name}: {node_id} fill color missing"
        assert text_pixels >= 8, f"{folder.name}: {node_id} text color/glyphs missing"
        ratio = contrast(fill, text)
        assert ratio >= 4.5, f"{folder.name}: {node_id} contrast {ratio:.2f} < 4.5"

        # Look for role-specific text-colored pixels just outside the measured
        # node. A wrapped glyph escaping the box was the production failure;
        # the one-pixel allowance covers raster anti-aliasing/rounding only.
        expanded = (box[0] - 8, box[1] - 8, box[2] + 8, box[3] + 8)
        escaped = count_color(source, expanded, text, tolerance=18) - count_color(source, box, text, tolerance=18)
        color_metrics[node_id] = {
            "fill_pixels": fill_pixels,
            "text_pixels": text_pixels,
            "escaped_text_pixels": escaped,
            "text_clipping_pass": escaped <= 2,
            "contrast_ratio": round(ratio, 2),
        }

    connector_hits = []
    assert len(manifest["connectors"]) >= 4
    for connector in manifest["connectors"]:
        box = (
            math.floor(connector["x"] - 3), math.floor(connector["y"] - 3),
            math.ceil(connector["x"] + connector["width"] + 3),
            math.ceil(connector["y"] + connector["height"] + 3),
        )
        connector_hits.append(count_ink(source, box))
    assert all(hits > 0 for hits in connector_hits), f"{folder.name}: connector geometry has no rendered ink {connector_hits}"

    doc = fitz.open(folder / "artifact.pdf")
    try:
        assert doc.page_count >= 1
        first = doc[0]
        images = first.get_images(full=True)
        assert images, f"{folder.name}: first PDF page contains no map image"
        xref = max(images, key=lambda item: item[2] * item[3])[0]
        embedded = pixmap_image(doc, xref)
        mean_delta, max_delta = pixel_delta(source, embedded)
        assert mean_delta <= 0.05 and max_delta <= 2, (
            f"{folder.name}: PDF map pixels diverged from submitted Chromium capture "
            f"(mean={mean_delta:.4f}, max={max_delta})"
        )

        placements = first.get_image_rects(xref)
        assert placements, f"{folder.name}: embedded map has no page placement"
        placement = max(placements, key=lambda rect: rect.width * rect.height)
        assert placement.x0 >= -0.1 and placement.y0 >= -0.1
        assert placement.x1 <= first.rect.width + 0.1 and placement.y1 <= first.rect.height + 0.1
        source_ratio = source.width / source.height
        assert abs((placement.width / placement.height) - source_ratio) <= source_ratio * 0.005

        a4 = ((595.0, 842.0), (842.0, 595.0))
        page_dims = (first.rect.width, first.rect.height)
        if expected["pageSize"] == "A4":
            assert any(abs(page_dims[0] - w) <= 0.2 and abs(page_dims[1] - h) <= 0.2 for w, h in a4), page_dims
        else:
            assert max(page_dims) <= 1440.1
            assert not any(abs(page_dims[0] - w) <= 0.2 and abs(page_dims[1] - h) <= 0.2 for w, h in a4), page_dims

        extracted = "\n".join(page.get_text() for page in doc)
        page_count = doc.page_count
        if expected["mode"] == "map_and_outline":
            assert doc.page_count >= 2
            for title in expected["titles"].values():
                assert title in extracted, f"{folder.name}: Unicode outline text missing: {title!r}"
    finally:
        doc.close()

    return {
        "name": folder.name,
        "pdf_bytes": (folder / "artifact.pdf").stat().st_size,
        "source_size": list(source.size),
        "page_count": page_count,
        "first_page_points": [round(page_dims[0], 2), round(page_dims[1], 2)],
        "embedded_pixel_mean_delta": round(mean_delta, 6),
        "embedded_pixel_max_delta": max_delta,
        "connector_color_hits": connector_hits,
        "nodes": color_metrics,
        "unicode_outline_verified": expected["mode"] == "map_and_outline",
    }
def main() -> None:
    root = Path(sys.argv[1]).resolve()
    scenarios = [verify_scenario(folder) for folder in sorted(root.iterdir()) if folder.is_dir()]
    assert len(scenarios) == 3, f"expected three real PDF scenarios, found {len(scenarios)}"
    clipping_failures = [
        f"{scenario['name']}:{node_id} escaped={node['escaped_text_pixels']}"
        for scenario in scenarios
        for node_id, node in scenario["nodes"].items()
        if not node["text_clipping_pass"]
    ]
    print(json.dumps({
        "status": "FAIL" if clipping_failures else "PASS",
        "failures": clipping_failures,
        "scenarios": scenarios,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
