#!/usr/bin/env python3
"""Independent PyMuPDF and Pillow verification for Round 8.2 4-Tier PDF artifacts."""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

# Force UTF-8 stdout
sys.stdout.reconfigure(encoding="utf-8")

import fitz
from PIL import Image

EVIDENCE_DIR = Path("E:/memvid_NCKH/MemVid_BaoCaoTotNghiep/.worktrees/phase-c-round8-2-release-gate/docs/ui-ux-v4-design/round8-2-qa-evidence/agy")
PDF_DIR = EVIDENCE_DIR / "pdf-artifacts"

TITLES = [
    "Chủ đề chính: Nghiên cứu Khoa học và Chuyển đổi số Nông nghiệp Carbon Thấp TEC2026",
    "Nhánh 1: Cơ sở lý luận và Khung pháp lý Quốc tế về Tín chỉ Carbon Rừng và Nông nghiệp",
    "Nhánh 2: Phương pháp luận MRV và Mô hình Đo đạc Phát thải Khí nhà kính Bền vững",
    "Tiêu chuẩn Verra VM0042 và Phương pháp đo đạc tín chỉ carbon đất nông nghiệp",
    "Hệ thống chính sách phát thải ròng bằng không Net Zero 2050 tại Việt Nam",
    "Cảm biến IoT và Công nghệ Viễn thám Giám sát Mực nước Ruột lúa AWD",
    "Thuật toán Ước lượng Phát thải Mê-tan CH4 và Nitơ Oxit N2O tự động",
    "Dữ liệu lịch sử canh tác ba năm liên tiếp và đối chiếu tọa độ ranh giới thửa ruộng",
    "Cơ chế trao đổi hạn ngạch và thị trường tín chỉ carbon trong nước theo Nghị định 06",
    "Thiết bị đo cảm biến siêu âm truyền dữ liệu qua giao thức LoRaWAN về trạm trung tâm",
    "Mô hình DNDC và IPCC Tier 2 hiệu chỉnh theo đặc thù khí hậu Đồng bằng Sông Cửu Long",
]

def rgb(hex_color: str) -> tuple[int, int, int]:
    value = hex_color.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))

def close(pixel: tuple[int, ...], target: tuple[int, int, int], tolerance: int = 30) -> bool:
    return math.dist(pixel[:3], target) <= tolerance

def count_color(image: Image.Image, box: tuple[int, int, int, int], target: tuple[int, int, int], tolerance: int = 30) -> int:
    x0, y0, x1, y1 = box
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(image.width, x1), min(image.height, y1)
    return sum(close(pixel, target, tolerance) for pixel in image.crop((x0, y0, x1, y1)).getdata())

def verify_scenario_1(folder: Path) -> dict:
    pdf_path = folder / "artifact-map-and-outline.pdf"
    assert pdf_path.exists(), f"Missing {pdf_path}"

    # Verify %PDF magic header
    with open(pdf_path, "rb") as f:
        header = f.read(5)
        assert header.startswith(b"%PDF"), f"Invalid PDF header: {header}"

    doc = fitz.open(pdf_path)
    page_count = len(doc)
    assert page_count >= 2, f"Expected >= 2 pages, got {page_count}"

    # Render all pages to PNG
    rendered_pages = []
    for i, page in enumerate(doc):
        pix = page.get_pixmap(dpi=150)
        out_png = folder / f"rendered-page-{i+1}.png"
        pix.save(str(out_png))
        rendered_pages.append(str(out_png))

    # All text across the document (specifically outline is on the last page)
    full_text = "\n".join(page.get_text() for page in doc)

    missing_titles = []
    found_titles = []
    for title in TITLES:
        key_words = title.split()[:4]
        key_segment = " ".join(key_words)
        if key_segment in full_text or title[:25] in full_text:
            found_titles.append(title)
        else:
            missing_titles.append(title)

    # Page 1: Verify embedded map raster
    page1 = doc[0]
    img_list = page1.get_images()
    assert len(img_list) >= 1, "Page 1 has no embedded images"
    xref = img_list[0][0]
    base_image = doc.extract_image(xref)
    image_bytes = base_image["image"]
    image_ext = base_image["ext"]

    embedded_img_path = folder / f"extracted-embedded.{image_ext}"
    with open(embedded_img_path, "wb") as f:
        f.write(image_bytes)

    source_img_path = folder / "source.png"
    manifest_path = folder / "manifest.json"

    embedded_img = Image.open(embedded_img_path).convert("RGB")
    source_img = Image.open(source_img_path).convert("RGB")

    # Compute pixel delta if sizes match
    pixel_delta_avg = 0.0
    pixel_delta_max = 0
    if embedded_img.size == source_img.size:
        total = 0
        samples = embedded_img.width * embedded_img.height * 3
        for l, r in zip(embedded_img.tobytes(), source_img.tobytes()):
            d = abs(l - r)
            total += d
            pixel_delta_max = max(pixel_delta_max, d)
        pixel_delta_avg = total / samples

    # Check color counts in source image for Root (#111827), Section (#FEF3C7), Leaf (#DCFCE7), Connector (#E11D48)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in manifest["nodes"]}

    root_node = nodes.get("ROOT")
    root_box = (round(root_node["x"]), round(root_node["y"]), round(root_node["x"] + root_node["width"]), round(root_node["y"] + root_node["height"]))
    root_fill_count = count_color(source_img, root_box, rgb("#111827"))

    connector_pixels = count_color(source_img, (0, 0, source_img.width, source_img.height), rgb("#E11D48"), tolerance=35)

    doc.close()

    return {
        "scenario": "map_and_outline",
        "pdfPath": str(pdf_path),
        "headerValid": True,
        "pageCount": page_count,
        "renderedPages": rendered_pages,
        "outlineTextFound": len(found_titles),
        "outlineTextTotal": len(TITLES),
        "allTitlesPresent": len(missing_titles) == 0,
        "missingTitles": missing_titles,
        "foundTitles": found_titles,
        "embeddedImage": {
            "width": embedded_img.width,
            "height": embedded_img.height,
            "format": image_ext,
            "pixelDeltaAvg": round(pixel_delta_avg, 4),
            "pixelDeltaMax": pixel_delta_max,
        },
        "colorVerification": {
            "rootFillPixels": root_fill_count,
            "connectorPixels": connector_pixels,
            "colorsPreserved": root_fill_count > 50 and connector_pixels > 20,
        },
        "status": "PASS" if len(missing_titles) == 0 and page_count >= 2 else "FAIL",
    }

def verify_scenario_2(folder: Path) -> dict:
    pdf_path = folder / "artifact-content-fit.pdf"
    assert pdf_path.exists(), f"Missing {pdf_path}"

    with open(pdf_path, "rb") as f:
        header = f.read(5)
        assert header.startswith(b"%PDF"), f"Invalid PDF header: {header}"

    doc = fitz.open(pdf_path)
    page_count = len(doc)
    assert page_count == 1, f"Expected exactly 1 page for content_fit, got {page_count}"

    pix = doc[0].get_pixmap(dpi=150)
    out_png = folder / "rendered-page-1.png"
    pix.save(str(out_png))

    img_list = doc[0].get_images()
    assert len(img_list) >= 1, "Page 1 has no embedded images"
    xref = img_list[0][0]
    base_image = doc.extract_image(xref)
    embedded_img_path = folder / f"extracted-embedded.{base_image['ext']}"
    with open(embedded_img_path, "wb") as f:
        f.write(base_image["image"])

    embedded_img = Image.open(embedded_img_path).convert("RGB")
    source_img = Image.open(folder / "source.png").convert("RGB")

    # Ensure not blank (ink count)
    non_white_pixels = sum(min(p[:3]) < 240 for p in embedded_img.getdata())
    assert non_white_pixels > 500, "Embedded image is nearly blank"

    doc.close()

    return {
        "scenario": "map_content_fit",
        "pdfPath": str(pdf_path),
        "headerValid": True,
        "pageCount": page_count,
        "renderedPage": str(out_png),
        "embeddedImage": {
            "width": embedded_img.width,
            "height": embedded_img.height,
            "nonWhitePixels": non_white_pixels,
            "notBlank": non_white_pixels > 500,
        },
        "status": "PASS",
    }

def main():
    s1_folder = PDF_DIR / "scenario-1-map-and-outline"
    s2_folder = PDF_DIR / "scenario-2-content-fit"

    report = {
        "scenario1": verify_scenario_1(s1_folder),
        "scenario2": verify_scenario_2(s2_folder),
    }

    out_json = PDF_DIR / "verification-results.json"
    out_json.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print("Python PDF verification finished successfully!")
    print(f"Scenario 1: {report['scenario1']['status']}, PageCount: {report['scenario1']['pageCount']}, OutlineText: {report['scenario1']['outlineTextFound']}/{report['scenario1']['outlineTextTotal']}")
    print(f"Scenario 2: {report['scenario2']['status']}, PageCount: {report['scenario2']['pageCount']}, NotBlank: {report['scenario2']['embeddedImage']['notBlank']}")

if __name__ == "__main__":
    main()
