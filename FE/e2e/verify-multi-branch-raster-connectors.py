#!/usr/bin/env python3
"""Verify that each Chromium PNG connector survives unchanged inside the generated PDF."""
from __future__ import annotations

import json
import math
from pathlib import Path

import fitz
from PIL import Image

from services.mindmap.export.pdf_serializer import serialize_pdf

HERE = Path(__file__).resolve().parent
ARTIFACTS = HERE.parent / "qa-artifacts" / "multi-branch-export-raster-connectors"
SCENARIOS = ("auto-context", "parent-suppressed", "parent-restored", "mixed-left-right")


def parent_id(node_id: str) -> str | None:
    if node_id in {"root", "F"}:
        return None
    if node_id == "E" or node_id == "J":
        return "F"
    if node_id == "A":
        return "E"
    if node_id.startswith("b") and "-" not in node_id:
        return "root"
    if "-d1" in node_id:
        return node_id.split("-d1")[0]
    if "-d2" in node_id:
        return node_id.replace("-d2", "-d1")
    if "-d3" in node_id:
        return node_id.replace("-d3", "-d2")
    if "-leaf" in node_id:
        return node_id.split("-leaf")[0] + "-d3"
    raise AssertionError(f"unknown synthetic node id: {node_id}")


def export_tree(manifest: dict, title: str) -> dict:
    ids = {node["id"] for node in manifest["nodes"]}
    children: dict[str, list[str]] = {node_id: [] for node_id in ids}
    roots: list[str] = []
    for node_id in ids:
        parent = parent_id(node_id)
        if parent not in ids:
            roots.append(node_id)
        else:
            children[parent].append(node_id)

    def build(node_id: str, parent: str | None, depth: int) -> dict:
        return {
            "node_id": node_id,
            "parent_id": parent,
            "topic": node_id,
            "note": "",
            "depth": depth,
            "is_context": False,
            "citations": [],
            "children": [
                build(child, node_id, depth + 1)
                for child in sorted(children[node_id])
            ],
        }

    return {
        "map_id": "connector-raster-regression",
        "title": title,
        "roots": [build(root, None, 0) for root in sorted(roots)],
        "relations": [],
    }


def pixmap_image(document: fitz.Document, xref: int) -> Image.Image:
    pixmap = fitz.Pixmap(document, xref)
    if pixmap.colorspace is None or pixmap.colorspace.n != 3 or pixmap.alpha:
        pixmap = fitz.Pixmap(fitz.csRGB, pixmap)
    return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def count_ink(image: Image.Image, connector: dict, nodes: list[dict]) -> int:
    x0 = max(0, math.floor(connector["x"] - 3))
    y0 = max(0, math.floor(connector["y"] - 3))
    x1 = min(image.width, math.ceil(connector["x"] + connector["width"] + 3))
    y1 = min(image.height, math.ceil(connector["y"] + connector["height"] + 3))
    pixels = image.load()
    total = 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            inside_node = any(
                x >= node["x"] - 1
                and x <= node["x"] + node["width"] + 1
                and y >= node["y"] - 1
                and y <= node["y"] + node["height"] + 1
                for node in nodes
            )
            if inside_node:
                continue
            if min(pixels[x, y][:3]) < 235:
                total += 1
    return total


def pixel_delta(left: Image.Image, right: Image.Image) -> tuple[float, int]:
    assert left.size == right.size
    deltas = [abs(a - b) for a, b in zip(left.convert("RGB").tobytes(), right.convert("RGB").tobytes())]
    return sum(deltas) / len(deltas), max(deltas)


def verify(name: str) -> dict:
    source_path = ARTIFACTS / f"{name}.png"
    manifest = json.loads((ARTIFACTS / f"{name}.manifest.json").read_text(encoding="utf-8"))
    source = Image.open(source_path).convert("RGB")
    assert source.size == (manifest["image_width_px"], manifest["image_height_px"])

    pdf_bytes = serialize_pdf(
        export_tree(manifest, name),
        mode="map",
        page_size="A4",
        map_image_bytes=source_path.read_bytes(),
        geometry_manifest=manifest,
    )
    pdf_path = ARTIFACTS / f"{name}.pdf"
    pdf_path.write_bytes(pdf_bytes)

    document = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        candidates = []
        for page in document:
            for image in page.get_images(full=True):
                xref, width, height = image[0], image[2], image[3]
                if (width, height) == source.size:
                    candidates.append(xref)
        assert candidates, f"{name}: PDF does not contain the original {source.size} map raster"
        embedded = pixmap_image(document, candidates[0])
        mean_delta, max_delta = pixel_delta(source, embedded)
        source_hits = [count_ink(source, connector, manifest["nodes"]) for connector in manifest["connectors"]]
        embedded_hits = [count_ink(embedded, connector, manifest["nodes"]) for connector in manifest["connectors"]]
        assert min(source_hits) > 0, f"{name}: source connector lacks ink: {source_hits}"
        assert embedded_hits == source_hits, f"{name}: PDF connector pixels differ from PNG"
        assert mean_delta <= 0.05 and max_delta <= 2, (
            f"{name}: embedded pixels changed: mean={mean_delta}, max={max_delta}"
        )
        return {
            "scenario": name,
            "pdf_pages": document.page_count,
            "pdf_bytes": len(pdf_bytes),
            "embedded_size": list(embedded.size),
            "connector_count": len(source_hits),
            "minimum_connector_ink_pixels": min(source_hits),
            "embedded_pixel_mean_delta": round(mean_delta, 6),
            "embedded_pixel_max_delta": max_delta,
        }
    finally:
        document.close()


if __name__ == "__main__":
    evidence = [verify(name) for name in SCENARIOS]
    (ARTIFACTS / "pdf-evidence.json").write_text(
        json.dumps(evidence, indent=2),
        encoding="utf-8",
    )
    for row in evidence:
        print(json.dumps(row, ensure_ascii=False))
