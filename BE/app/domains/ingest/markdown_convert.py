from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

import mammoth
import pymupdf4llm
from markdownify import markdownify as html_to_markdown

from app.domains.ingest.ingest_utils import extract_text
from shared.paths import BE_ROOT


def _docx_to_markdown(file_path: Path) -> str:
    with file_path.open("rb") as handle:
        return mammoth.convert_to_markdown(handle).value


def _doc_to_markdown(file_path: Path) -> str:
    with tempfile.TemporaryDirectory() as temp_dir:
        subprocess.run(
            [
                "soffice",
                "--headless",
                "--convert-to",
                "docx",
                str(file_path),
                "--outdir",
                temp_dir,
            ],
            check=False,
            capture_output=True,
        )
        converted = Path(temp_dir) / f"{file_path.stem}.docx"
        if not converted.exists():
            raise FileNotFoundError(f"Failed to convert {file_path} to docx")
        return _docx_to_markdown(converted)


def to_markdown(file_path: str) -> str:
    path = Path(file_path)
    ext = path.suffix.lower()

    if ext == ".pdf":
        return pymupdf4llm.to_markdown(str(path))
    if ext == ".docx":
        return _docx_to_markdown(path)
    if ext == ".doc":
        try:
            return _doc_to_markdown(path)
        except Exception:
            return extract_text(str(path))
    if ext in {".html", ".htm"}:
        return html_to_markdown(path.read_text(encoding="utf-8", errors="ignore"))
    if ext in {".txt", ".md"}:
        return path.read_text(encoding="utf-8", errors="ignore")
    if ext in {".png", ".jpg", ".jpeg"}:
        return extract_text(str(path))

    # Định dạng còn lại (.pptx .xlsx .epub .rtf .odt .odp .csv .json ...) dùng lại
    # chính loader của bước ExtractText: nó đã trả nội dung dạng Markdown (bảng
    # xlsx, heading html) nên bước chunk theo heading dùng được ngay. Trước đây
    # mọi đuôi lạ rơi thẳng vào extract_text — hàm chỉ biết pdf/docx/txt/ảnh nên
    # trả rỗng, Normalize im lặng bỏ qua và chunk tụt về text thô.
    from app.domains.ingest.document_loader import load_document

    docs = load_document(str(path))
    if docs:
        return "\n\n".join(d.page_content for d in docs)
    return extract_text(str(path))


def convert_and_save(file_path: str, md_dir: str | None = None) -> tuple[str, str]:
    markdown = to_markdown(file_path)
    output_dir = Path(md_dir or os.environ.get("MD_DIR") or (BE_ROOT / "cleaned_md"))
    output_dir.mkdir(parents=True, exist_ok=True)

    saved_path = output_dir / f"{Path(file_path).stem}.md"
    saved_path.write_text(markdown, encoding="utf-8")
    return markdown, str(saved_path)
