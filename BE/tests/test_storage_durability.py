"""Bản gốc người dùng tải lên phải nằm ở kho BỀN, không phải `/tmp` của Render.

Đo 2026-09-04: cả hai tài liệu production đều có `file_path == input_path`, tức mọi lượt
upload đã rơi vào nhánh dự phòng ngay từ đầu. `/tmp` trên Render free bị xoá sạch mỗi lần
khởi động lại, nên một tài liệu `completed` mà bản gốc chỉ nằm ở đó là tài liệu SẼ MẤT —
chỉ chưa ai biết. Nguyên nhân im lặng: `is_configured()` False thì mã đi thẳng qua, không
một dòng cảnh báo; còn nhánh upload hỏng thì chỉ `print`.

Hàng rào: production ném `DurableStorageRequired` (503) thay vì giả vờ thành công.
Dev/test giữ nguyên fallback local — ở đó bản local CHÍNH LÀ kho lưu.
"""

from __future__ import annotations

import io as _io

import pytest

from app.domains.documents import storage as st


def _upload(monkeypatch, tmp_path, *, nguon, cau_hinh, upload_no=None):
    """Bắn một request upload THẬT qua Flask, trả (response, kwargs tới repository.create)."""
    import app.main as be
    from app.domains.documents import provenance as prov
    from app.domains.documents import repository as _docs

    ghi: dict = {}

    def create_gia(**kw):
        ghi.update(kw)
        return {"filename": kw.get("filename"), "status": "processing",
                "source_stem": "x", "progress": 0.0, "created_at": "2026-01-01T00:00:00"}

    monkeypatch.setattr(_docs, "create", create_gia)
    monkeypatch.setattr(be, "_trigger_background_ingest", lambda *a, **k: None)
    monkeypatch.setattr(be, "INPUT_DIR", str(tmp_path))
    monkeypatch.setattr(be, "_current_user_id", lambda: "u-1")
    monkeypatch.setattr(be, "_require_app_user", lambda: ("u-1", None))
    monkeypatch.setattr(prov, "nguon_ingest", lambda: nguon)

    monkeypatch.setattr(st, "is_configured", lambda: cau_hinh)
    monkeypatch.setattr(st, "ensure_bucket", lambda: None)
    da_len: list = []

    def upload_gia(path, data, **kw):
        if upload_no is not None:
            raise upload_no
        da_len.append((path, len(data)))
        return path

    monkeypatch.setattr(st, "upload", upload_gia)

    r = be.app.test_client().post(
        "/upload-file",
        data={"file": (_io.BytesIO(b"noi dung tai lieu thu"), "bai giang.txt")},
        content_type="multipart/form-data")
    return r, ghi, da_len


# ── 1. Cấu hình đủ → bản gốc lên kho, DB trỏ object key ───────────────────
def test_production_co_kho_thi_file_path_la_object_key(monkeypatch, tmp_path):
    r, ghi, da_len = _upload(monkeypatch, tmp_path, nguon="production", cau_hinh=True)
    assert r.status_code == 200, r.get_data(as_text=True)[:200]
    assert len(da_len) == 1, "phải đẩy đúng một object"

    khoa, so_byte = da_len[0]
    assert so_byte == len(b"noi dung tai lieu thu")
    assert ghi["file_path"] == khoa
    assert ghi["file_path"] != ghi["input_path"], "object key không được là đường tạm"


# ── 6. Khoá lưu trữ không mang đường tuyệt đối ────────────────────────────
def test_object_key_khong_mang_duong_tuyet_doi(monkeypatch, tmp_path):
    _, ghi, _ = _upload(monkeypatch, tmp_path, nguon="production", cau_hinh=True)
    khoa = ghi["file_path"]
    assert not khoa.startswith("/"), khoa
    assert ":" not in khoa and "\\" not in khoa, khoa
    assert "/tmp/" not in khoa and ".." not in khoa, khoa
    assert khoa.count("/") == 2, f"phải là <user>/<doc>/<file>: {khoa}"


# ── 5. Khoá không phụ thuộc đường Windows ─────────────────────────────────
@pytest.mark.parametrize("ten", [
    r"C:\Users\Ai Do\Desktop\bao cao.pdf",
    "/tmp/studymap/input_docs/bao cao.pdf",
    "..\\..\\etc\\passwd",
    "tài liệu (bản sao).docx",
])
def test_object_path_chi_lay_basename_va_fold_ky_tu_la(ten):
    khoa = st.object_path("u-1", "d-1", ten)
    assert khoa.count("/") == 2, khoa
    phan = khoa.split("/")[-1]
    assert "\\" not in phan and ":" not in phan and ".." not in phan, phan
    assert all(c.isalnum() or c in "._-" for c in phan), phan


# ── 2. Production KHÔNG được giả vờ thành công ────────────────────────────
def test_production_thieu_cau_hinh_thi_TU_CHOI_chu_khong_am_tham(monkeypatch, tmp_path):
    """Ca đã xảy ra thật ở production. Bản cũ trả 200 và ghi `file_path` là đường
    `/tmp` — tài liệu trông như xong, bản gốc chết ở lần khởi động sau."""
    r, ghi, _ = _upload(monkeypatch, tmp_path, nguon="production", cau_hinh=False)
    assert r.status_code == 503, r.get_data(as_text=True)[:200]
    assert not ghi, "không được tạo hàng documents khi kho chưa sẵn sàng"
    than = r.get_json()
    assert "SUPABASE_URL" in than["hint"]


def test_production_upload_hong_cung_TU_CHOI(monkeypatch, tmp_path):
    r, ghi, _ = _upload(monkeypatch, tmp_path, nguon="production", cau_hinh=True,
                        upload_no=RuntimeError("bucket 500"))
    assert r.status_code == 503
    assert not ghi


def test_khong_de_lai_file_tam_khi_tu_choi(monkeypatch, tmp_path):
    _upload(monkeypatch, tmp_path, nguon="production", cau_hinh=False)
    assert list(tmp_path.iterdir()) == [], "lượt đã hỏng không được để lại rác"


# ── 3. Dev/test giữ nguyên fallback ───────────────────────────────────────
@pytest.mark.parametrize("nguon", ["local", "test"])
def test_dev_va_test_van_duoc_dung_ban_local(monkeypatch, tmp_path, nguon):
    """Ở đây bản local CHÍNH LÀ kho lưu, nên `file_path == input_path` là ĐÚNG.
    Siết luôn cả hai môi trường này là phá mọi lượt chạy không có Supabase."""
    r, ghi, _ = _upload(monkeypatch, tmp_path, nguon=nguon, cau_hinh=False)
    assert r.status_code == 200
    assert ghi["file_path"] == ghi["input_path"]


# ── 4. Không rò bí mật ────────────────────────────────────────────────────
def test_thong_bao_503_khong_mang_bi_mat(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb-bi-mat-khong-duoc-ro")
    monkeypatch.setenv("SUPABASE_URL", "https://vi-du.supabase.co")
    r, _, _ = _upload(monkeypatch, tmp_path, nguon="production", cau_hinh=True,
                      upload_no=RuntimeError("401 apikey sai"))
    van = r.get_data(as_text=True)
    assert "sb-bi-mat-khong-duoc-ro" not in van
    assert "Bearer" not in van and "apikey" not in van


def test_storage_khong_dua_khoa_vao_thong_bao_loi(monkeypatch):
    """`_raise` dựng thông báo từ response — không được kèm header xác thực."""
    import inspect

    src = inspect.getsource(st._raise) + inspect.getsource(st._headers)
    assert "print" not in src, "không log header"


# ── 7. Không phá persistence sẵn có ───────────────────────────────────────
def test_persistence_van_dung_chung_mot_client_storage():
    """`persistence.get_storage()` KHÔNG được dựng client Supabase thứ hai — hai
    client là hai chỗ đọc credential, và chúng sẽ lệch nhau đúng vào ngày xấu nhất."""
    from app.domains.vectorstore import persistence as ps

    assert ps.get_storage() is st
