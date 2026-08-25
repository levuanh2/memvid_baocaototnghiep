"""`content_hash` phải nuốt được thư mục con trong thư mục index.

Hồi quy: `--build-memory-tree` tạo `memory/` ngay trong thư mục index. Bản cũ gọi
thẳng `path.open("rb")` cho mọi mục của `glob("*")` nên gặp thư mục là ném
`PermissionError` (Windows) / `IsADirectoryError` (Linux) — mọi thí nghiệm dùng
index có cây nhớ đều chết TRƯỚC khi chạy truy vấn nào.
"""

from __future__ import annotations

from pathlib import Path

from evaluation.reproducibility import content_hash, sha256_path


def _dung_index(goc: Path) -> Path:
    d = goc / "R2_late"
    (d / "memory").mkdir(parents=True)
    (d / "index.faiss").write_bytes(b"vector")
    (d / "index.json").write_text('{"0":{}}', encoding="utf-8")
    (d / "memory" / "tree.sqlite").write_bytes(b"cay nho")
    (d / "memory" / "sub").mkdir()
    (d / "memory" / "sub" / "them.bin").write_bytes(b"sau hon")
    return d


def test_khong_no_khi_co_thu_muc_con(tmp_path: Path):
    d = _dung_index(tmp_path)
    h = content_hash(list(d.glob("*")))
    assert isinstance(h, str) and len(h) == 64


def test_doi_file_trong_thu_muc_con_thi_hash_doi(tmp_path: Path):
    """Nội dung cây nhớ phải THỰC SỰ đi vào hash, không phải bị bỏ qua."""
    d = _dung_index(tmp_path)
    truoc = content_hash(list(d.glob("*")))
    (d / "memory" / "tree.sqlite").write_bytes(b"cay nho DA DOI")
    assert content_hash(list(d.glob("*"))) != truoc


def test_on_dinh_giua_hai_lan_goi(tmp_path: Path):
    d = _dung_index(tmp_path)
    assert content_hash(list(d.glob("*"))) == content_hash(list(d.glob("*")))


def test_khong_phu_thuoc_thu_tu_glob(tmp_path: Path):
    d = _dung_index(tmp_path)
    xuoi = list(d.glob("*"))
    assert content_hash(xuoi) == content_hash(list(reversed(xuoi)))


def test_file_thieu_van_hash_duoc(tmp_path: Path):
    d = _dung_index(tmp_path)
    assert sha256_path(d / "khong-ton-tai.bin") is None
    h = content_hash([d / "index.faiss", d / "khong-ton-tai.bin"])
    assert isinstance(h, str) and len(h) == 64


def test_thu_muc_rong_khac_thu_muc_co_file(tmp_path: Path):
    a = tmp_path / "a"; (a / "memory").mkdir(parents=True)
    b = tmp_path / "b"; (b / "memory").mkdir(parents=True)
    (b / "memory" / "x.bin").write_bytes(b"x")
    assert content_hash(list(a.glob("*"))) != content_hash(list(b.glob("*")))
