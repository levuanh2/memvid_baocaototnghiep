#!/usr/bin/env python3
"""Color-aware raster/PDF verification for the real current-branch export."""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import fitz
from PIL import Image


def rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[index:index + 2], 16) for index in (0, 2, 4))


def luminance(color: tuple[int, int, int]) -> float:
    values = []
    for channel in color:
        component = channel / 255
        values.append(component / 12.92 if component <= 0.04045 else ((component + 0.055) / 1.055) ** 2.4)
    return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2]


def contrast(left: tuple[int, int, int], right: tuple[int, int, int]) -> float:
    light, dark = sorted((luminance(left), luminance(right)), reverse=True)
    return (light + 0.05) / (dark + 0.05)


def count_color(image: Image.Image, box: tuple[int, int, int, int], target: tuple[int, int, int], tolerance: int = 45) -> int:
    x0, y0, x1, y1 = box
    crop = image.crop((max(0, x0), max(0, y0), min(image.width, x1), min(image.height, y1))).convert("RGB")
    return sum(math.dist(pixel, target) <= tolerance for pixel in crop.getdata())


def connector_hits(image: Image.Image, manifest: dict, target: tuple[int, int, int]) -> list[int]:
    hits = []
    for connector in manifest["connectors"]:
        box = (
            math.floor(connector["x"] - 5), math.floor(connector["y"] - 5),
            math.ceil(connector["x"] + connector["width"] + 5),
            math.ceil(connector["y"] + connector["height"] + 5),
        )
        hits.append(count_color(image, box, target))
    return hits


def image_delta(left: Image.Image, right: Image.Image) -> tuple[float, int]:
    if left.size != right.size:
        raise AssertionError(f"capture dimensions diverged: {left.size} != {right.size}")
    deltas = [abs(a - b) for a, b in zip(left.convert("RGB").tobytes(), right.convert("RGB").tobytes())]
    return sum(deltas) / len(deltas), max(deltas)


def embedded_image(document: fitz.Document) -> Image.Image:
    images = document[0].get_images(full=True)
    if not images:
        raise AssertionError("PDF first page contains no embedded map image")
    xref = max(images, key=lambda item: item[2] * item[3])[0]
    pixmap = fitz.Pixmap(document, xref)
    if pixmap.colorspace is None or pixmap.colorspace.n != 3 or pixmap.alpha:
        pixmap = fitz.Pixmap(fitz.csRGB, pixmap)
    return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def verify(root: Path) -> dict:
    expected = json.loads((root / "expectations.json").read_text(encoding="utf-8"))
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    svg_evidence = json.loads((root / "svg-evidence.json").read_text(encoding="utf-8"))
    direct = Image.open(root / expected["directPng"]).convert("RGB")
    source = Image.open(root / "pdf-source.png").convert("RGB")
    expected_size = (manifest["image_width_px"], manifest["image_height_px"])
    failures = []
    if direct.size != expected_size or source.size != expected_size:
        failures.append(f"PNG/PDF source size mismatch: direct={direct.size}, source={source.size}, manifest={expected_size}")

    connector = rgb(expected["connector"])
    canvas = rgb(expected["canvas"])
    ratio = contrast(connector, canvas)
    if ratio < 3:
        failures.append(f"configured connector/background contrast {ratio:.2f} < 3.0")

    direct_hits = connector_hits(direct, manifest, connector)
    source_hits = connector_hits(source, manifest, connector)
    composite = tuple(round(0.6 * foreground + 0.4 * background) for foreground, background in zip(connector, canvas))
    composite_ratio = contrast(composite, canvas)
    direct_composite_hits = connector_hits(direct, manifest, composite)
    source_composite_hits = connector_hits(source, manifest, composite)
    if len(direct_hits) != len(expected["expectedEdges"]) or not all(hit >= 8 for hit in direct_hits):
        failures.append(f"direct PNG does not render every connector in configured color: {direct_hits}")
    if len(source_hits) != len(expected["expectedEdges"]) or not all(hit >= 8 for hit in source_hits):
        failures.append(f"PDF source does not render every connector in configured color: {source_hits}")
    # The real opacity:0.6 defect produced exact-color hits [0,0,0,524],
    # while the fixed opacity:1 render produces [2315,3102,3106,524]. Normal
    # antialias edges still create hundreds of composite-near pixels, so that
    # secondary signal is a failure only for the same connector when its own
    # exact-color count is low; 50 cleanly separates the measured cases.
    diluted_direct = [
        index for index, (exact, blended) in enumerate(zip(direct_hits, direct_composite_hits))
        if exact < 50 and blended >= 8
    ]
    diluted_source = [
        index for index, (exact, blended) in enumerate(zip(source_hits, source_composite_hits))
        if exact < 50 and blended >= 8
    ]
    if (diluted_direct or diluted_source) and composite_ratio < 3:
        failures.append(
            f"connectors are opacity-composited to {composite} with contrast {composite_ratio:.2f} < 3.0 "
            f"(direct indexes={diluted_direct}, PDF-source indexes={diluted_source})"
        )

    capture_mean_delta, capture_max_delta = image_delta(direct, source)
    document = fitz.open(root / "current-branch.pdf")
    try:
        embedded = embedded_image(document)
        embedded_mean_delta, embedded_max_delta = image_delta(source, embedded)
        if embedded_mean_delta > 0.05 or embedded_max_delta > 2:
            failures.append(
                f"PDF embedded map differs from submitted capture: mean={embedded_mean_delta:.4f}, max={embedded_max_delta}"
            )
        page = document[0]
        rendered = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        rendered.save(root / "rendered-pdf-page-1.png")
        page_points = [round(page.rect.width, 2), round(page.rect.height, 2)]
    finally:
        document.close()

    return {
        "status": "FAIL" if failures else "PASS",
        "failures": failures,
        "connector_color": expected["connector"],
        "canvas_color": expected["canvas"],
        "contrast_ratio": round(ratio, 2),
        "opacity_0_6_composite_color": list(composite),
        "opacity_0_6_contrast_ratio": round(composite_ratio, 2),
        "expected_edge_count": len(expected["expectedEdges"]),
        "svg_path_count": len(svg_evidence["paths"]),
        "svg_edge_max_gaps": [round(edge["maxGap"], 3) for edge in svg_evidence["edgeMetrics"]],
        "direct_png_connector_color_hits": direct_hits,
        "direct_png_opacity_composite_hits": direct_composite_hits,
        "pdf_source_connector_color_hits": source_hits,
        "pdf_source_opacity_composite_hits": source_composite_hits,
        "direct_vs_pdf_source_mean_delta": round(capture_mean_delta, 4),
        "direct_vs_pdf_source_max_delta": capture_max_delta,
        "pdf_embedded_mean_delta": round(embedded_mean_delta, 6),
        "pdf_embedded_max_delta": embedded_max_delta,
        "pdf_page_points": page_points,
    }


def main() -> None:
    root = Path(sys.argv[1]).resolve()
    try:
        report = verify(root)
    except Exception as error:  # evidence must survive a RED result
        report = {"status": "FAIL", "error": f"{type(error).__name__}: {error}"}
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
