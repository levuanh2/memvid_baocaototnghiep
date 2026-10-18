"""Reproducible H3C benchmark for PDF map-raster stream compression.

The baseline and candidate run the same production serializer.  The baseline
only patches ``Document.tobytes`` to ignore the new final ``deflate`` flag,
which recreates the pre-H3C behavior without maintaining a second serializer.
Each variant runs in a fresh subprocess so native PyMuPDF RSS is comparable.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import patch

import fitz
import psutil
from PIL import Image, ImageDraw, ImageFont

BE_ROOT = Path(__file__).resolve().parents[1]
if str(BE_ROOT) not in sys.path:
    sys.path.insert(0, str(BE_ROOT))

from services.mindmap.export.pdf_layout import centered_fit_rect, choose_map_orientation  # noqa: E402
from services.mindmap.export.pdf_serializer import PAGE_SIZES_PT, serialize_pdf  # noqa: E402
from services.mindmap.export.tree import build_export_tree  # noqa: E402


@dataclass(frozen=True)
class Case:
    name: str
    width: int
    height: int
    nodes: int
    font_px: int = 30
    dark: bool = False
    dense: bool = False
    scope: str = "full"


CASES = (
    Case("small", 1400, 900, 12),
    Case("medium", 2600, 1400, 36),
    Case("large_57", 5066, 1350, 57, 32),
    Case("very_large", 6000, 4000, 110, 28, dense=True),
    Case("wide", 6000, 1200, 40, 30),
    Case("tall", 1600, 6000, 40, 30),
    Case("dense_text", 4200, 2400, 80, 22, dense=True),
    Case("long_vietnamese", 3600, 1800, 35, 30),
    Case("dark", 3600, 1800, 35, 30, dark=True),
    Case("selected_single_branch", 2200, 1400, 14, 30, scope="current_branch"),
    Case("selected_multiple_branches", 3400, 1600, 28, 30, scope="selected_branches"),
)


def _font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(BE_ROOT / "assets" / "fonts" / "DejaVuSans.ttf"), size=size)


def _png(case: Case) -> tuple[bytes, float]:
    started = time.perf_counter()
    background = (20, 23, 29, 255) if case.dark else (255, 255, 255, 255)
    foreground = (232, 237, 245, 255) if case.dark else (76, 91, 117, 255)
    image = Image.new("RGBA", (case.width, case.height), background)
    draw = ImageDraw.Draw(image)
    font = _font(case.font_px)
    root_w, root_h = max(260, case.width // 7), max(80, case.height // 15)
    root = (
        case.width // 2 - root_w // 2,
        case.height // 2 - root_h // 2,
        case.width // 2 + root_w // 2,
        case.height // 2 + root_h // 2,
    )
    draw.rounded_rectangle(root, radius=18, fill=(18, 108, 242, 255))
    label = "Học tập hiệu quả — ă â ê ô ơ ư đ Á Ế Ổ Ờ Ữ"
    draw.text((root[0] + 18, root[1] + 18), label, font=font, fill=(255, 255, 255, 255))
    rows = max(2, (case.nodes - 1) // 2)
    spacing = max(28, (case.height - 120) // rows)
    for index in range(case.nodes - 1):
        side = -1 if index % 2 == 0 else 1
        row = index // 2
        y = 60 + row * spacing
        x0 = 60 if side < 0 else case.width * 3 // 4
        x1 = case.width // 4 if side < 0 else case.width - 60
        anchor_x = root[0] if side < 0 else root[2]
        color = ((18 + index * 37) % 220, (90 + index * 29) % 210, (130 + index * 17) % 230, 255)
        draw.line((anchor_x, case.height // 2, x1 if side < 0 else x0, y + case.font_px), fill=color, width=4)
        text = f"Khái niệm {index + 1}: dữ liệu tiếng Việt — {label}"
        if case.dense:
            text += " — phân tích, liên hệ và tự kiểm tra kiến thức"
        draw.text((x0, y), text, font=font, fill=foreground)
        draw.line((x0, y + case.font_px + 8, x1, y + case.font_px + 8), fill=color, width=3)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue(), (time.perf_counter() - started) * 1000


def _tree(case: Case) -> dict:
    nodes = [{"id": "root", "parent": None, "kind": "root", "title": f"{case.name} — Tiếng Việt", "order": 0}]
    for index in range(case.nodes - 1):
        nodes.append({
            "id": f"n{index}",
            "parent": "root",
            "kind": "section",
            "title": f"Khái niệm {index + 1}: ă â ê ô ơ ư đ",
            "order": index,
        })
    included = {node["id"] for node in nodes}
    return build_export_tree(nodes, [], ["root"], included, map_id=f"h3c-{case.name}", title=nodes[0]["title"])


def _render_digest(pdf: bytes) -> str:
    digest = hashlib.sha256()
    document = fitz.open(stream=pdf, filetype="pdf")
    try:
        for page in document:
            pixmap = page.get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False)
            digest.update(pixmap.samples)
    finally:
        document.close()
    return digest.hexdigest()


def _inspect(pdf: bytes) -> dict:
    document = fitz.open(stream=pdf, filetype="pdf")
    try:
        xrefs = {image[0] for page in document for image in page.get_images(full=True)}
        return {
            "pdf_bytes": len(pdf),
            "page_count": document.page_count,
            "image_xref_count": len(xrefs),
            "blank_pages": sum(not page.get_text().strip() and not page.get_images() for page in document),
            "render_sha256": _render_digest(pdf),
        }
    finally:
        document.close()


def _serialize(case: Case, variant: str) -> dict:
    png, encode_ms = _png(case)
    tree = _tree(case)
    process = psutil.Process()
    base_rss = process.memory_info().rss
    peak_rss = base_rss
    stop = threading.Event()

    def sample() -> None:
        nonlocal peak_rss
        while not stop.wait(0.002):
            peak_rss = max(peak_rss, process.memory_info().rss)

    sampler = threading.Thread(target=sample, daemon=True)
    sampler.start()
    started = time.perf_counter()
    if variant == "baseline":
        original = fitz.Document.tobytes

        def without_deflate(document, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003
            return original(document)

        with patch.object(fitz.Document, "tobytes", without_deflate):
            pdf = serialize_pdf(tree, mode="map_and_outline", map_image_bytes=png)
    else:
        pdf = serialize_pdf(tree, mode="map_and_outline", map_image_bytes=png)
    elapsed_ms = (time.perf_counter() - started) * 1000
    stop.set()
    sampler.join()
    peak_rss = max(peak_rss, process.memory_info().rss)

    choice = choose_map_orientation(case.width, case.height, PAGE_SIZES_PT["A4"], 40.0)
    rect = centered_fit_rect(case.width, case.height, choice.page_w, choice.page_h, 40.0)
    result = {
        "case": case.name,
        "variant": variant,
        "scope": case.scope,
        "node_count": case.nodes,
        "dimensions": [case.width, case.height],
        "raw_pixel_bytes": case.width * case.height * 4,
        "image_bytes": len(png),
        "raster_encode_ms": round(encode_ms, 1),
        "serialize_ms": round(elapsed_ms, 1),
        "peak_rss_delta_bytes": max(0, peak_rss - base_rss),
        "minimum_effective_font_pt": round(case.font_px * rect.width / case.width, 2),
    }
    result.update(_inspect(pdf))
    return result


def _parent(output: Path | None) -> int:
    rows: list[dict] = []
    for case in CASES:
        variants = {}
        for variant in ("baseline", "candidate"):
            command = [sys.executable, str(Path(__file__).resolve()), "--worker", case.name, "--variant", variant]
            completed = subprocess.run(command, check=True, capture_output=True, text=True, encoding="utf-8")
            variants[variant] = json.loads(completed.stdout)
        baseline, candidate = variants["baseline"], variants["candidate"]
        rows.append({
            "case": case.name,
            "scope": case.scope,
            "node_count": case.nodes,
            "dimensions": [case.width, case.height],
            "image_bytes": candidate["image_bytes"],
            "raw_pixel_bytes": candidate["raw_pixel_bytes"],
            "baseline_pdf_bytes": baseline["pdf_bytes"],
            "candidate_pdf_bytes": candidate["pdf_bytes"],
            "compression_ratio": round(baseline["pdf_bytes"] / candidate["pdf_bytes"], 2),
            "page_count": candidate["page_count"],
            "minimum_effective_font_pt": candidate["minimum_effective_font_pt"],
            "baseline_peak_rss_delta_bytes": baseline["peak_rss_delta_bytes"],
            "candidate_peak_rss_delta_bytes": candidate["peak_rss_delta_bytes"],
            "baseline_serialize_ms": baseline["serialize_ms"],
            "candidate_serialize_ms": candidate["serialize_ms"],
            "image_xref_count": candidate["image_xref_count"],
            "blank_pages": candidate["blank_pages"],
            "render_identical": baseline["render_sha256"] == candidate["render_sha256"],
            "raster_encode_ms": candidate["raster_encode_ms"],
        })
    payload = {"schema": 1, "cases": rows}
    rendered = json.dumps(payload, ensure_ascii=False, indent=2)
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", choices=[case.name for case in CASES])
    parser.add_argument("--variant", choices=("baseline", "candidate"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.worker:
        case = next(case for case in CASES if case.name == args.worker)
        print(json.dumps(_serialize(case, args.variant), ensure_ascii=False))
        return 0
    return _parent(args.output)


if __name__ == "__main__":
    raise SystemExit(main())
