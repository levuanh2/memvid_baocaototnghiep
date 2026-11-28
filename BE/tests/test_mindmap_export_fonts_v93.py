"""V9.3 typography (owner decision 2026-11-26): backend document exports use Be Vietnam Pro.

PDF embeds the official OFL TTF (assets/fonts/BeVietnamPro-Regular.ttf) for the "sans" choice and
must keep every Vietnamese diacritic extractable; DOCX names and EMBEDS Be Vietnam Pro for "sans"
(owner decision 2026-11-28); XLSX keeps Calibri because Excel cannot embed fonts. "serif" keeps
DejaVu Serif / Times New Roman.
"""
import io

import docx
import fitz
from openpyxl import load_workbook

from services.mindmap.export.docx_serializer import serialize_docx
from services.mindmap.export.pdf_serializer import FONT_FILES, serialize_pdf
from services.mindmap.export.scope import resolve_export_scope
from services.mindmap.export.tree import build_export_tree
from services.mindmap.export.xlsx_serializer import serialize_xlsx

VIETNAMESE = "Tiếng Việt có dấu: ắ ặ ẫ ữ ỡ ự ệ ộ ơ ư đ Đ Ấ Ỳ ỹ ỵ"


def _tree():
    nodes = [
        {"id": "r", "parent": None, "kind": "root", "title": "Bản đồ tư duy", "order": 0},
        {"id": "c1", "parent": "r", "kind": "section", "title": VIETNAMESE, "order": 0},
        {"id": "c2", "parent": "r", "kind": "section", "title": "Kiến trúc hệ thống", "order": 1},
    ]
    scope = resolve_export_scope(nodes, scope_type="full")
    return build_export_tree(nodes, [], scope["root_ids"], scope["included_ids"], map_id="m1", title="Bản đồ tư duy")


def _embedded_font_names(pdf_bytes: bytes) -> set[str]:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    names = set()
    for page in doc:
        for font in page.get_fonts(full=True):
            names.add(font[3].replace(" ", ""))  # basefont, e.g. "Be Vietnam Pro Regular" -> no spaces
    return names


def test_bundled_be_vietnam_pro_is_the_official_ofl_file_with_every_vietnamese_glyph():
    path = FONT_FILES["sans"]
    assert path.name == "BeVietnamPro-Regular.ttf"
    assert (path.parent / "OFL_BEVIETNAMPRO.txt").read_text(encoding="utf-8").find("SIL Open Font License") >= 0
    font = fitz.Font(fontfile=str(path))
    missing = [ch for ch in VIETNAMESE if ch.strip() and not font.has_glyph(ord(ch))]
    assert missing == []


def test_pdf_sans_embeds_be_vietnam_pro_and_keeps_vietnamese_text_extractable():
    pdf_bytes = serialize_pdf(_tree(), mode="outline", font="sans", content={})
    assert any("BeVietnamPro" in name for name in _embedded_font_names(pdf_bytes))
    text = "".join(page.get_text() for page in fitz.open(stream=pdf_bytes, filetype="pdf"))
    assert VIETNAMESE in text  # copy/paste and search keep every diacritic


def test_pdf_serif_still_embeds_dejavu_serif():
    pdf_bytes = serialize_pdf(_tree(), mode="outline", font="serif", content={})
    names = _embedded_font_names(pdf_bytes)
    assert any("DejaVuSerif" in name for name in names)
    assert not any("BeVietnamPro" in name for name in names)


def _deobfuscate(data: bytes, font_key: str) -> bytes:
    # ECMA-376 Part 2 / [MS-OFFCRYPTO] obfuscated font: XOR the first 32 bytes with the GUID key read
    # in reverse byte order.
    key = bytes.fromhex(font_key.strip("{}").replace("-", ""))[::-1]
    head = bytes(b ^ key[i % 16] for i, b in enumerate(data[:32]))
    return head + data[32:]


def test_docx_sans_names_and_embeds_be_vietnam_pro():
    """Owner decision (2026-11-28): DOCX embeds the font so Word shows it on machines without it."""
    import re
    import zipfile

    raw = serialize_docx(_tree(), font="sans")
    assert docx.Document(io.BytesIO(raw)).styles["Normal"].font.name == "Be Vietnam Pro"
    z = zipfile.ZipFile(io.BytesIO(raw))
    names = z.namelist()
    odttf = [n for n in names if n.startswith("word/fonts/") and n.endswith(".odttf")]
    assert len(odttf) == 1
    ctypes = z.read("[Content_Types].xml").decode("utf-8")
    assert "application/vnd.openxmlformats-officedocument.obfuscatedFont" in ctypes
    font_table = z.read("word/fontTable.xml").decode("utf-8")
    m = re.search(r'<w:font w:name="Be Vietnam Pro">.*?<w:embedRegular r:id="(rId\d+)" w:fontKey="(\{[0-9A-F-]{36}\})"', font_table, re.S)
    assert m, "fontTable declares an embedded regular face with a font key"
    rels = z.read("word/_rels/fontTable.xml.rels").decode("utf-8")
    assert f'Id="{m.group(1)}"' in rels and odttf[0].split("/", 1)[1] in rels
    assert "<w:embedTrueTypeFonts/>" in z.read("word/settings.xml").decode("utf-8")
    original = FONT_FILES["sans"].read_bytes()
    assert _deobfuscate(z.read(odttf[0]), m.group(2)) == original


def test_docx_serif_embeds_nothing_and_xlsx_keeps_calibri():
    import zipfile

    z = zipfile.ZipFile(io.BytesIO(serialize_docx(_tree(), font="serif")))
    assert not [n for n in z.namelist() if n.endswith(".odttf")]
    # Excel cannot embed fonts, so XLSX keeps a font every Office install has (owner decision).
    ws = load_workbook(io.BytesIO(serialize_xlsx(_tree(), font="sans")))["Nodes"]
    assert ws["A1"].font.name == "Calibri"
    assert ws["A2"].font.name == "Calibri"
