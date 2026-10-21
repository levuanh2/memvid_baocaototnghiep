"""Turn the real Chromium H4 request capture into verified PDF artifacts."""
from __future__ import annotations

import argparse
import base64
import json
import math
from pathlib import Path

import fitz

from services.mindmap.export.pdf_serializer import serialize_pdf_with_result


EXPECTED_IDS = {
    "fixture-map-a-m0",
    "fixture-map-a-m0-s0",
    "fixture-map-a-m0-s0-l0",
    "fixture-map-a-m0-s1",
}


def _tree() -> dict:
    return {
        "title": "H4 exact Chromium capture",
        "relations": [],
        "roots": [{
            "node_id": "fixture-map-a-m0",
            "parent_id": None,
            "topic": "Kiến trúc hệ thống",
            "note": "",
            "depth": 0,
            "is_context": True,
            "citations": [],
            "children": [
                {
                    "node_id": "fixture-map-a-m0-s0",
                    "parent_id": "fixture-map-a-m0",
                    "topic": "Nguyên lý — Kiến trúc hệ thống",
                    "note": "",
                    "depth": 1,
                    "is_context": False,
                    "citations": [],
                    "children": [{
                        "node_id": "fixture-map-a-m0-s0-l0",
                        "parent_id": "fixture-map-a-m0-s0",
                        "topic": "Định nghĩa: nguyên lý",
                        "note": "",
                        "depth": 2,
                        "is_context": False,
                        "citations": [],
                        "children": [],
                    }],
                },
                {
                    "node_id": "fixture-map-a-m0-s1",
                    "parent_id": "fixture-map-a-m0",
                    "topic": "Triển khai thực tế — Kiến trúc hệ thống",
                    "note": "",
                    "depth": 1,
                    "is_context": False,
                    "citations": [],
                    "children": [],
                },
            ],
        }],
    }


def verify(request_path: Path, output: Path) -> dict:
    request = json.loads(request_path.read_text(encoding="utf-8"))
    assert request["options"]["pageSize"] == "content_fit"
    assert request["scope"]["include_descendants"] is False
    manifest = request["map_geometry_manifest"]
    manifest_ids = {node["id"] for node in manifest["nodes"]}
    assert manifest_ids == EXPECTED_IDS
    image_bytes = base64.b64decode(request["map_image_base64"], validate=True)

    output.mkdir(parents=True, exist_ok=True)
    (output / "chromium-source.png").write_bytes(image_bytes)
    rows = {}
    for mode in ("map", "map_and_outline"):
        result = serialize_pdf_with_result(
            _tree(),
            mode=mode,
            page_size="content_fit",
            map_image_bytes=image_bytes,
            geometry_manifest=manifest,
            margins=request["options"]["margins"],
            content=request["options"]["content"],
        )
        pdf_path = output / f"chromium-{mode}.pdf"
        pdf_path.write_bytes(result.content)
        doc = fitz.open(stream=result.content, filetype="pdf")
        page = doc[0]
        image_xref = page.get_images(full=True)[0][0]
        image_rect = page.get_image_rects(image_xref)[0]
        assert max(page.rect.width, page.rect.height) <= 1440
        assert image_rect.x0 >= 39.5 and image_rect.y0 >= 39.5
        assert page.rect.width - image_rect.x1 >= 39.5
        assert page.rect.height - image_rect.y1 >= 39.5
        assert math.isclose(
            image_rect.width / image_rect.height,
            manifest["image_width_px"] / manifest["image_height_px"],
            rel_tol=0.005,
        )
        xrefs = {image[0] for pdf_page in doc for image in pdf_page.get_images(full=True)}
        assert len(xrefs) == 1
        if mode == "map_and_outline":
            assert doc.page_count >= 2
            assert (round(doc[-1].rect.width), round(doc[-1].rect.height)) == (595, 842)
            outline = "".join(pdf_page.get_text() for pdf_page in doc[1:])
            for title in (
                "Kiến trúc hệ thống",
                "Nguyên lý — Kiến trúc hệ thống",
                "Định nghĩa: nguyên lý",
                "Triển khai thực tế — Kiến trúc hệ thống",
            ):
                assert title in outline
            assert "Bản đồ tư duy: Hệ thống StudyMap" not in outline
            assert "Bảo mật & xác thực" not in outline
        for index, pdf_page in enumerate(doc):
            pix = pdf_page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            pix.save(output / f"chromium-{mode}-page-{index + 1}.png")
        rows[mode] = {
            "page_count": doc.page_count,
            "detail_pages": result.detail_pages,
            "page_1_pt": [round(page.rect.width, 2), round(page.rect.height, 2)],
            "image_rect_pt": [round(value, 2) for value in image_rect],
            "effective_font_pts": sorted(round(node["font_size_px"] * image_rect.width / manifest["image_width_px"], 2) for node in manifest["nodes"]),
            "manifest_ids": sorted(manifest_ids),
            "embedded_image_xrefs": len(xrefs),
            "file_bytes": len(result.content),
        }
        doc.close()
    (output / "metrics.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(verify(args.request, args.output), ensure_ascii=False))


if __name__ == "__main__":
    main()
