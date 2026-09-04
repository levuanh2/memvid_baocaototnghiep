"""Kiểm tra kho object trước khi tin vào nó — `documents/storage_probe.py`.

`is_configured()` chỉ nói "có hai biến env". Nó không nói bucket có tồn tại không,
khoá có quyền ghi không, hay object ghi xong đọc lại có ra đúng byte không. Bật lưu
bền mà chưa trả lời ba câu ấy thì lần dựng lại đầu tiên chạy hết vài nghìn chunk, tốn
tiền embedding, rồi hỏng ở bước upload cuối.

Toàn bộ file chạy với kho giả — KHÔNG cần credential thật.
"""

from __future__ import annotations

import pytest

from app.domains.documents import storage_probe as sp

BI_MAT = "sb-bi-mat-khong-duoc-ro"


class KhoGia:
    """Kho giả cấu hình được từng thao tác hỏng, để kiểm từng nhánh."""

    def __init__(self, *, configured=True, bucket_name="documents",
                 hong: str | None = None, doc_ra: bytes | None = None):
        self.data: dict[str, bytes] = {}
        self.log: list[str] = []
        self._configured = configured
        self._bucket = bucket_name
        self._hong = hong
        self._doc_ra = doc_ra

    def _co_the_hong(self, ten: str) -> None:
        if self._hong == ten:
            raise RuntimeError(f"{ten} that bai voi khoa {BI_MAT}")

    def is_configured(self):
        return self._configured

    def bucket(self):
        self._co_the_hong("bucket")
        return self._bucket

    def ensure_bucket(self):
        self.log.append("ensure_bucket")
        self._co_the_hong("ensure_bucket")

    def upload(self, path, data, *, content_type=None):
        self.log.append(f"upload {path}")
        self._co_the_hong("upload")
        self.data[path] = bytes(data)
        return path

    def download(self, path):
        self.log.append(f"download {path}")
        self._co_the_hong("download")
        return self._doc_ra if self._doc_ra is not None else self.data[path]

    def exists(self, path):
        self.log.append(f"exists {path}")
        self._co_the_hong("exists")
        return path in self.data

    def delete(self, path):
        self.log.append(f"delete {path}")
        if self._hong == "delete":
            return False
        return self.data.pop(path, None) is not None


# ── Chưa cấu hình ──────────────────────────────────────────────────────────
def test_chua_cau_hinh_thi_bao_ro_khong_nem():
    ra = sp.kiem_tra_kho(storage=KhoGia(configured=False))
    assert ra["configured"] is False and ra["ok"] is False
    assert "SUPABASE_URL" in ra["loi"] and "SUPABASE_SECRET_KEY" in ra["loi"]


def test_chua_cau_hinh_thi_KHONG_cham_mang():
    kho = KhoGia(configured=False)
    sp.kiem_tra_kho(storage=kho)
    assert kho.log == [], "chưa cấu hình thì không được gọi thao tác nào"


# ── Đường thành công ───────────────────────────────────────────────────────
def test_duong_thanh_cong_du_bon_buoc():
    kho = KhoGia()
    ra = sp.kiem_tra_kho(storage=kho)
    assert ra["ok"] is True
    assert ra["buoc"] == {"write": "PASS", "exists": "PASS", "read": "PASS",
                          "delete_probe": "PASS"}
    assert ra["bucket"] == "documents"


def test_probe_nam_duoi_tien_to_rieng_va_bi_xoa():
    """Không chạm `index/`, không chạm file tài liệu, không để lại rác."""
    kho = KhoGia()
    sp.kiem_tra_kho(storage=kho)
    duong = [x.split(" ", 1)[1] for x in kho.log if " " in x]
    assert all(p.startswith(sp.TIEN_TO_PROBE + "/") for p in duong), duong
    assert not any(p.startswith("index/") for p in duong)
    assert kho.data == {}, "probe phải bị xoá sau khi kiểm"


def test_moi_lan_chay_dung_probe_KHAC_nhau():
    """Hai lần chạy song song không được giẫm lên nhau."""
    a, b = KhoGia(), KhoGia()
    sp.kiem_tra_kho(storage=a)
    sp.kiem_tra_kho(storage=b)
    assert a.log[0] != b.log[0]


def test_ghi_TRUOC_khi_kiem_ton_tai():
    """`exists()` trên bucket chưa có và trên bucket rỗng trả cùng câu trả lời — không
    phân biệt được 'không có quyền' với 'chưa có file'. Ghi thật thì lỗi nói đúng."""
    kho = KhoGia()
    sp.kiem_tra_kho(storage=kho)
    thu_tu = [x.split(" ")[0] for x in kho.log]
    assert thu_tu.index("upload") < thu_tu.index("exists")


# ── ensure_bucket phải tường minh ──────────────────────────────────────────
def test_mac_dinh_KHONG_tao_bucket():
    """Tạo bucket trên production là thay đổi hạ tầng, không phải tác dụng phụ của
    một lệnh kiểm tra."""
    kho = KhoGia()
    sp.kiem_tra_kho(storage=kho)
    assert "ensure_bucket" not in kho.log


def test_co_co_thi_moi_tao_bucket():
    kho = KhoGia()
    ra = sp.kiem_tra_kho(storage=kho, ensure_bucket=True)
    assert kho.log[0] == "ensure_bucket"
    assert ra["buoc"]["ensure_bucket"] == "PASS"


def test_ensure_bucket_hong_thi_dung_ngay():
    kho = KhoGia(hong="ensure_bucket")
    ra = sp.kiem_tra_kho(storage=kho, ensure_bucket=True)
    assert ra["ok"] is False and ra["buoc"]["ensure_bucket"] == "FAIL"
    assert "upload" not in " ".join(kho.log), "hỏng ở bucket thì đừng thử ghi"


# ── Từng thao tác hỏng ─────────────────────────────────────────────────────
def test_khong_doc_duoc_ten_bucket():
    ra = sp.kiem_tra_kho(storage=KhoGia(hong="bucket"))
    assert ra["ok"] is False and "bucket" in ra["loi"]


def test_ghi_hong():
    kho = KhoGia(hong="upload")
    ra = sp.kiem_tra_kho(storage=kho)
    assert ra["ok"] is False and ra["buoc"]["write"] == "FAIL"
    assert "read" not in ra["buoc"], "ghi hỏng thì không cần thử đọc"


def test_doc_hong():
    ra = sp.kiem_tra_kho(storage=KhoGia(hong="download"))
    assert ra["ok"] is False and ra["buoc"]["read"] == "FAIL"


def test_kiem_ton_tai_hong():
    ra = sp.kiem_tra_kho(storage=KhoGia(hong="exists"))
    assert ra["ok"] is False and ra["buoc"]["exists"] == "FAIL"


def test_doc_lai_KHAC_byte_da_ghi():
    """Kho ghi được nhưng đọc ra khác thì tệ hơn kho không ghi được — một proxy trả
    200 kèm trang lỗi vẫn là 200."""
    ra = sp.kiem_tra_kho(storage=KhoGia(doc_ra=b"noi dung khac han"))
    assert ra["ok"] is False and ra["buoc"]["read"] == "FAIL"
    assert "khác byte" in ra["loi"]


def test_xoa_probe_hong_van_bao_cao():
    ra = sp.kiem_tra_kho(storage=KhoGia(hong="delete"))
    assert ra["buoc"]["delete_probe"] == "FAIL" and ra["ok"] is False


def test_doc_hong_thi_VAN_xoa_probe():
    """Không để lại rác trong bucket của người ta, kể cả khi bước trên hỏng."""
    kho = KhoGia(hong="download")
    sp.kiem_tra_kho(storage=kho)
    assert any(x.startswith("delete ") for x in kho.log)


# ── Không rò bí mật ────────────────────────────────────────────────────────
@pytest.mark.parametrize("hong", ["bucket", "upload", "download", "exists"])
def test_bi_mat_KHONG_lot_vao_bao_cao(hong):
    """Kho giả nhét khoá vào thông báo lỗi. Báo cáo chỉ được mang TÊN LOẠI lỗi."""
    ra = sp.kiem_tra_kho(storage=KhoGia(hong=hong))
    assert BI_MAT not in str(ra), str(ra)


@pytest.mark.parametrize("hong", [None, "upload", "download"])
def test_bi_mat_KHONG_lot_ra_stdout(capsys, hong):
    ra = sp.kiem_tra_kho(storage=KhoGia(hong=hong))
    sp.in_bao_cao(ra)
    out = capsys.readouterr().out
    assert BI_MAT not in out
    assert "Bearer" not in out and "apikey" not in out


def test_bao_cao_chua_cau_hinh_in_ro():
    ra = sp.kiem_tra_kho(storage=KhoGia(configured=False))
    sp.in_bao_cao(ra)
