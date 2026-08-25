"""Bản local chỉ là chỗ đặt tạm — xoá sau ingest, NHƯNG chỉ khi Storage đã giữ bản gốc.

Bản gốc sống trên Supabase Storage. `input_docs/` tồn tại vì pipeline ingest cần
một đường dẫn để đọc; giữ lại sau đó là nhân đôi dung lượng mà không ai đọc tới.

Ca quan trọng nhất KHÔNG phải "có xoá không" mà là **các nhánh không được xoá**:
khi Storage chưa cấu hình hoặc upload lỗi, `documents.file_path` bằng chính đường
dẫn local — lúc đó bản local là kho lưu duy nhất, xoá là mất hẳn file.
"""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture()
def be(client):
    import app.main as main
    return main


def _tao_file(tmp_path: Path, ten: str = "tai-lieu.pdf") -> str:
    p = tmp_path / ten
    p.write_bytes(b"noi dung gia lap")
    return str(p)


def test_xoa_khi_storage_da_giu_ban_goc(be, monkeypatch, tmp_path):
    fp = _tao_file(tmp_path)
    monkeypatch.setattr(be, "_docs_get_for_cleanup", None, raising=False)
    import app.domains.documents.repository as repo
    monkeypatch.setattr(repo, "get", lambda _id: {"file_path": "documents/uid/doc/tai-lieu.pdf"})

    be._don_file_tam("doc-1", fp)
    assert not Path(fp).exists(), "Storage da giu ban goc thi ban tam phai bi xoa"


def test_KHONG_xoa_khi_file_path_trung_duong_local(be, monkeypatch, tmp_path):
    """Storage tắt hoặc upload lỗi: file_path == input_path. Local là kho lưu duy nhất."""
    fp = _tao_file(tmp_path)
    import app.domains.documents.repository as repo
    monkeypatch.setattr(repo, "get", lambda _id: {"file_path": fp})

    be._don_file_tam("doc-1", fp)
    assert Path(fp).exists(), "local dang la kho luu duy nhat — KHONG duoc xoa"


def test_KHONG_xoa_khi_khong_co_file_path(be, monkeypatch, tmp_path):
    fp = _tao_file(tmp_path)
    import app.domains.documents.repository as repo
    monkeypatch.setattr(repo, "get", lambda _id: {"file_path": ""})

    be._don_file_tam("doc-1", fp)
    assert Path(fp).exists()


def test_KHONG_xoa_khi_khong_tim_thay_ban_ghi(be, monkeypatch, tmp_path):
    """Không tra được DB thì phải giữ file — im lặng xoá là mất dữ liệu."""
    fp = _tao_file(tmp_path)
    import app.domains.documents.repository as repo
    monkeypatch.setattr(repo, "get", lambda _id: None)

    be._don_file_tam("doc-1", fp)
    assert Path(fp).exists()


def test_repo_nem_loi_thi_khong_nem_ra_ngoai(be, monkeypatch, tmp_path):
    """Chạy trong `finally` của job — không được làm hỏng đường báo lỗi ingest."""
    fp = _tao_file(tmp_path)
    import app.domains.documents.repository as repo

    def no(_id):
        raise RuntimeError("DB sap")

    monkeypatch.setattr(repo, "get", no)
    be._don_file_tam("doc-1", fp)   # khong duoc nem
    assert Path(fp).exists()


def test_file_da_bien_mat_thi_khong_no(be, monkeypatch, tmp_path):
    import app.domains.documents.repository as repo
    monkeypatch.setattr(repo, "get", lambda _id: {"file_path": "documents/x/y.pdf"})
    be._don_file_tam("doc-1", str(tmp_path / "khong-ton-tai.pdf"))


def test_xoa_ban_tam_chay_trong_finally(be, monkeypatch, tmp_path):
    """Ingest ném lỗi thì vẫn phải dọn — nếu không, mỗi lần hỏng để lại một file."""
    fp = _tao_file(tmp_path)
    import app.domains.documents.repository as repo
    monkeypatch.setattr(repo, "get", lambda _id: {"file_path": "documents/x/y.pdf"})

    def graph_no(*_a, **_kw):
        raise RuntimeError("ingest hong")

    monkeypatch.setattr(be, "_langgraph_invoke", graph_no)
    monkeypatch.setattr(be, "_update_source_status", lambda *a, **kw: None)
    be._run_ingest_job("doc-1", fp, "tai-lieu.pdf")
    assert not Path(fp).exists(), "ingest hong van phai don ban tam"


def test_fetch_to_temp_don_sach_sau_khi_dung(monkeypatch, tmp_path):
    """Lưới an toàn: kéo lại file từ Storage, và không để lại rác."""
    from app.domains.documents import storage

    monkeypatch.setattr(storage, "download", lambda _p: b"du lieu tu bucket")
    with storage.fetch_to_temp("documents/uid/doc/a.pdf") as p:
        duong = Path(p)
        assert duong.is_file() and duong.read_bytes() == b"du lieu tu bucket"
        assert duong.suffix == ".pdf"
    assert not duong.exists(), "file tam phai bi don"


def test_fetch_to_temp_don_ca_khi_than_khoi_nem(monkeypatch):
    from app.domains.documents import storage

    monkeypatch.setattr(storage, "download", lambda _p: b"x")
    duong = None
    with pytest.raises(ValueError):
        with storage.fetch_to_temp("documents/a.bin") as p:
            duong = Path(p)
            raise ValueError("loi giua chung")
    assert duong is not None and not duong.exists()
