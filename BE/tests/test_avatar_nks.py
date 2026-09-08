"""Đổi ảnh đại diện NKS — pipeline ảnh, ghi-rồi-đọc-lại, và cột `avatar_url`.

Không chạm mạng, không chạm database: client HTTP và `users_store` đều là đồ giả; kho
chứng từ và toàn bộ pipeline ảnh là mã THẬT — chúng chính là thứ đang được kiểm.

Trọng tâm: đây là bề mặt duy nhất trong tính năng hồ sơ nhận **byte tuỳ ý từ Internet**.
"""

from __future__ import annotations

import base64
import io
import logging

import pytest

from app.application import profile as uc
from app.clients.auth_nks import NKSAuthProvider
from app.clients.auth_nks.errors import NksInvalidCredentials, NksUnavailable
from app.domains.auth import grants
from app.domains.media import anh_dai_dien as media
from shared.interfaces.profile import avatar_hop_le

TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.KHONG-DUOC-RO-RA.xxx"
UID_A, UID_B = "user-A", "user-B"
URL_CU = "https://data.nks.vn/storage/users/cu.jpg"
URL_MOI = "https://data.nks.vn/storage/users/moi.jpg"


def _anh(rong=800, cao=600, fmt="JPEG", mau=(200, 30, 40)):
    """Ảnh thật, dựng bằng Pillow — không phải byte giả."""
    from PIL import Image
    ra = io.BytesIO()
    Image.new("RGB", (rong, cao), mau).save(ra, format=fmt)
    return ra.getvalue()


class ClientGia:
    def __init__(self, avatar=URL_MOI, update_exc=None, user_exc=None, ok=True):
        self.avatar, self.update_exc, self.user_exc, self.ok = avatar, update_exc, user_exc, ok
        self.calls: list[tuple] = []

    def get_user(self, access_token):
        self.calls.append(("get_user", access_token))
        if self.user_exc:
            raise self.user_exc
        return {"success": True, "data": {"id": 128, "email": "a@example.com",
                                          "name": "T", "avatar": self.avatar,
                                          "role": {"id": 8, "name": "teacher"}}}

    def update_avatar(self, access_token, data_uri):
        self.calls.append(("update_avatar", access_token, data_uri))
        if self.update_exc:
            raise self.update_exc
        return {"success": self.ok, "data": self.ok}


class UsersGia:
    def __init__(self, avatar_url=URL_CU):
        self.rows = {UID_A: {"user_id": UID_A, "avatar_url": avatar_url, "role": "learner"}}
        self.set_calls: list[tuple] = []

    def get_by_id(self, uid):
        r = self.rows.get(str(uid))
        return dict(r) if r else None

    def set_avatar_url(self, uid, url):
        self.set_calls.append((str(uid), url))
        self.rows.setdefault(str(uid), {"user_id": str(uid)})["avatar_url"] = avatar_hop_le(url)


@pytest.fixture(autouse=True)
def _sach():
    grants.reset_for_tests()
    yield
    grants.reset_for_tests()


def _deps(c, users=None):
    return {"nks_provider": NKSAuthProvider(client=c, enabled=lambda: True),
            "grants": grants, "users_store": users or UsersGia()}


def _grant(uid=UID_A):
    gid, _ = grants.tao(uid, "nks", TOKEN)
    return gid


# ── 1. Chứng từ hợp lệ + ảnh hợp lệ ⇒ gửi data-URI ──────────────────────────
def test_gui_dung_data_uri_day_du():
    """Hợp đồng thật là data-URI ĐẦY ĐỦ, không phải base64 trần — xem docs/nks-api.md."""
    c = ClientGia()
    uc.cap_nhat_anh_dai_dien(UID_A, _grant(), _anh(), deps=_deps(c))

    assert [x[0] for x in c.calls] == ["update_avatar", "get_user"]
    gui = c.calls[0][2]
    assert gui.startswith("data:image/jpeg;base64,")
    assert c.calls[0][1] == TOKEN
    # Phần base64 giải mã ra được, và là JPEG thật (magic FFD8FF).
    than = base64.b64decode(gui.split(",", 1)[1])
    assert than[:3] == b"\xff\xd8\xff"


# ── 2 + 3. Ghi xong PHẢI đọc lại; URL mới được lưu ──────────────────────────
def test_ghi_xong_thi_doc_lai_va_luu_url_moi():
    c, users = ClientGia(avatar=URL_MOI), UsersGia(avatar_url=URL_CU)
    ho_so = uc.cap_nhat_anh_dai_dien(UID_A, _grant(), _anh(), deps=_deps(c, users))

    assert [x[0] for x in c.calls] == ["update_avatar", "get_user"]
    assert ho_so.avatar == URL_MOI
    assert users.set_calls == [(UID_A, URL_MOI)]
    assert users.rows[UID_A]["avatar_url"] == URL_MOI


# ── 4. Thất bại KHÔNG được xoá ảnh cũ ───────────────────────────────────────
@pytest.mark.parametrize("kw,loi", [
    ({"update_exc": NksUnavailable("503")}, uc.ProviderUnavailable),
    ({"ok": False}, uc.ProviderProtocolError),
])
def test_ghi_that_bai_thi_giu_nguyen_anh_cu(kw, loi):
    c, users = ClientGia(**kw), UsersGia(avatar_url=URL_CU)
    with pytest.raises(loi):
        uc.cap_nhat_anh_dai_dien(UID_A, _grant(), _anh(), deps=_deps(c, users))

    assert users.set_calls == []                       # không ghi gì
    assert users.rows[UID_A]["avatar_url"] == URL_CU   # ảnh cũ nguyên vẹn


def test_provider_tra_url_rac_thi_giu_anh_cu_chu_khong_xoa():
    """Mất ảnh đang hiển thị vì một phản hồi lạ tệ hơn hiển thị ảnh cũ thêm một lúc."""
    for rac in ("http://data.nks.vn/x.jpg", "javascript:alert(1)", "/x.jpg", None, ""):
        c, users = ClientGia(avatar=rac), UsersGia(avatar_url=URL_CU)
        uc.cap_nhat_anh_dai_dien(UID_A, _grant(), _anh(), deps=_deps(c, users))
        assert users.set_calls == [], rac
        assert users.rows[UID_A]["avatar_url"] == URL_CU, rac


# ── 5. Quá khổ bị chặn TRƯỚC khi giải mã ────────────────────────────────────
def test_qua_tran_byte_bi_chan_truoc_khi_giai_ma():
    to = b"\xff\xd8\xff" + b"\x00" * (media.GIOI_HAN_BYTE + 10)
    with pytest.raises(media.AnhQuaLon):
        media.chuan_hoa(to)


def test_qua_kho_khong_ton_mot_luot_goi_provider_nao():
    """Ảnh rác là lỗi người dùng — không được tiêu tốn lượt gọi ra provider, và không
    được có cơ hội làm chết một chứng từ đang tốt."""
    c = ClientGia()
    gid = _grant()
    with pytest.raises(media.AnhQuaLon):
        uc.cap_nhat_anh_dai_dien(UID_A, gid, b"\x00" * (media.GIOI_HAN_BYTE + 1), deps=_deps(c))
    assert c.calls == []
    assert grants.lay(gid, UID_A) == TOKEN             # chứng từ vẫn sống


# ── 6 + 7. Không phải ảnh / ảnh hỏng ────────────────────────────────────────
@pytest.mark.parametrize("rac", [
    b"", b"khong phai anh",
    b"#!/bin/sh\nrm -rf /",                                   # script trần
    b"\xff\xd8\xff" + b"rac",                                 # magic JPEG nhưng thân hỏng
    b"<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>",  # SVG: KHÔNG hỗ trợ
    b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n",                         # PDF đội lốt
])
def test_khong_phai_anh_thi_tu_choi(rac):
    with pytest.raises(media.AnhKhongHopLe):
        media.chuan_hoa(rac)


def test_tep_thuc_thi_doi_ten_thanh_jpg_van_bi_tu_choi():
    """Pillow nhận dạng bằng NỘI DUNG, nên đổi phần mở rộng không lừa được gì."""
    with pytest.raises(media.AnhKhongHopLe):
        media.chuan_hoa(b"MZ\x90\x00\x03" + b"\x00" * 500)     # header PE của Windows


# ── 8. Bom giải nén / kích thước khổng lồ ───────────────────────────────────
def test_bom_giai_nen_bi_chan_bang_TRAN_DIEM_ANH_khong_phai_tran_byte():
    """Ca kinh điển: file rất NHỎ, khai kích thước khổng lồ. Trần byte vô dụng ở đây —
    chỉ trần điểm ảnh, đọc từ header TRƯỚC khi giải mã, mới cứu được 512 MB RAM."""
    from PIL import Image
    ra = io.BytesIO()
    # Ảnh 1 màu 12000x12000 = 144 triệu điểm ảnh, nén PNG xuống rất nhỏ.
    Image.new("L", (12000, 12000), 0).save(ra, format="PNG")
    bom = ra.getvalue()

    assert len(bom) < media.GIOI_HAN_BYTE, "phải LỌT trần byte thì test mới có nghĩa"
    with pytest.raises(media.AnhQuaLon):
        media.chuan_hoa(bom)


def test_anh_lon_nhung_hop_le_duoc_thu_nho_chu_khong_bi_tu_choi():
    ra = media.chuan_hoa(_anh(3000, 2000))
    assert max(ra.rong, ra.cao) == media.CANH_TOI_DA
    assert ra.rong == 512 and ra.cao == 341            # giữ đúng tỉ lệ


# ── Chuẩn hoá: định dạng, EXIF, kích thước ──────────────────────────────────
@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP", "BMP"])
def test_nhieu_dinh_dang_vao_deu_ra_JPEG(fmt):
    ra = media.chuan_hoa(_anh(300, 300, fmt=fmt))
    assert ra.data_uri.startswith("data:image/jpeg;base64,")


def test_anh_nho_hon_512_khong_bi_phong_to():
    ra = media.chuan_hoa(_anh(100, 80))
    assert (ra.rong, ra.cao) == (100, 80)


def test_EXIF_bi_bo_khi_ma_hoa_lai():
    """EXIF mang toạ độ GPS. Mã hoá lại vẽ pixel ra rồi ghi lại nên mọi thứ không
    phải pixel đều biến mất — đó là lý do luôn re-encode, kể cả ảnh đã đủ nhỏ."""
    from PIL import Image
    ra = io.BytesIO()
    im = Image.new("RGB", (200, 200), (1, 2, 3))
    exif = im.getexif()
    exif[0x010F] = "BiMatCuaToi"                       # Make
    exif[0x0110] = "ModelBiMat"                        # Model
    im.save(ra, format="JPEG", exif=exif)
    goc = ra.getvalue()
    assert b"BiMatCuaToi" in goc                       # có thật trong ảnh gốc

    sach = base64.b64decode(media.chuan_hoa(goc).data_uri.split(",", 1)[1])
    assert b"BiMatCuaToi" not in sach
    assert b"ModelBiMat" not in sach


def test_du_lieu_nhet_sau_phan_anh_khong_song_sot():
    goc = _anh(120, 120) + b"PAYLOAD-NHET-THEM-0xDEADBEEF"
    sach = base64.b64decode(media.chuan_hoa(goc).data_uri.split(",", 1)[1])
    assert b"PAYLOAD-NHET-THEM" not in sach


# ── 9. URL trả về phải là https tuyệt đối ───────────────────────────────────
@pytest.mark.parametrize("url,mong", [
    ("https://data.nks.vn/a.jpg", "https://data.nks.vn/a.jpg"),
    ("  https://data.nks.vn/a.jpg  ", "https://data.nks.vn/a.jpg"),
    ("https://data.nks.vn//storage/users/1.jpg", "https://data.nks.vn//storage/users/1.jpg"),
    ("http://data.nks.vn/a.jpg", None),
    ("data:image/png;base64,iVBOR", None),
    ("javascript:alert(1)", None),
    ("//data.nks.vn/a.jpg", None),
    ("/storage/a.jpg", None),
    ("https://a.vn/x.jpg\" onerror=alert(1)", None),
    ("", None), (None, None), (123, None),
    ("https://" + "a" * 600, None),                    # vượt VARCHAR(500)
])
def test_chi_nhan_https_tuyet_doi(url, mong):
    assert avatar_hop_le(url) == mong


# ── 10 + 11. Vòng đời chứng từ ──────────────────────────────────────────────
def test_nks_tu_choi_token_thi_huy_chung_tu():
    c = ClientGia(update_exc=NksInvalidCredentials("Token is invalid"))
    gid = _grant()
    with pytest.raises(uc.GrantKhongHopLe):
        uc.cap_nhat_anh_dai_dien(UID_A, gid, _anh(), deps=_deps(c))
    assert grants.lay(gid, UID_A) is None
    assert grants.so_luong() == 0


def test_nks_sap_thi_GIU_chung_tu():
    """Sự cố hạ tầng không phải "token chết" — huỷ lúc đó bắt người dùng gõ lại mật
    khẩu vì một lỗi không phải của họ."""
    c = ClientGia(update_exc=NksUnavailable("503"))
    gid = _grant()
    with pytest.raises(uc.ProviderUnavailable):
        uc.cap_nhat_anh_dai_dien(UID_A, gid, _anh(), deps=_deps(c))
    assert grants.lay(gid, UID_A) == TOKEN


# ── 12 + 13. Không rò bí mật ────────────────────────────────────────────────
def test_khong_luu_base64_hay_byte_anh_o_bat_ky_dau():
    c, users = ClientGia(), UsersGia()
    uc.cap_nhat_anh_dai_dien(UID_A, _grant(), _anh(), deps=_deps(c, users))

    # Thứ DUY NHẤT được ghi xuống là một URL.
    assert users.set_calls == [(UID_A, URL_MOI)]
    for _uid, gia_tri in users.set_calls:
        assert "base64" not in str(gia_tri)
        assert len(str(gia_tri)) < 500


def test_khong_co_token_hay_base64_trong_log(caplog):
    c = ClientGia()
    with caplog.at_level(logging.DEBUG):
        uc.cap_nhat_anh_dai_dien(UID_A, _grant(), _anh(), deps=_deps(c))
    ban_ghi = " ".join(r.getMessage() for r in caplog.records)
    assert TOKEN not in ban_ghi
    assert "base64" not in ban_ghi


def test_ngoai_le_cua_pipeline_anh_khong_mang_noi_dung_anh():
    goc = _anh(50, 50) + b"CHUOI-NHAN-DANG-TRONG-ANH"
    try:
        media.chuan_hoa(b"rac" + goc)
    except media.AnhKhongHopLe as exc:
        assert "CHUOI-NHAN-DANG" not in str(exc)


# ── 14. Cách ly chủ sở hữu ──────────────────────────────────────────────────
def test_nguoi_khac_khong_dung_duoc_chung_tu():
    c = ClientGia()
    gid = _grant(UID_A)
    with pytest.raises(uc.GrantKhongHopLe):
        uc.cap_nhat_anh_dai_dien(UID_B, gid, _anh(), deps=_deps(c))
    assert c.calls == []
    assert grants.lay(gid, UID_A) == TOKEN


@pytest.mark.parametrize("gid", ["", "khong-ton-tai"])
def test_thieu_chung_tu_thi_tu_choi(gid):
    c = ClientGia()
    with pytest.raises(uc.GrantKhongHopLe):
        uc.cap_nhat_anh_dai_dien(UID_A, gid, _anh(), deps=_deps(c))
    assert c.calls == []


# ── 15. LocalAuth không có đường vào ────────────────────────────────────────
def test_chung_tu_provider_local_khong_dung_duoc_cho_anh_nks():
    c = ClientGia()
    gid, _ = grants.tao(UID_A, "local", "bi-mat-local")
    with pytest.raises(uc.GrantKhongHopLe):
        uc.cap_nhat_anh_dai_dien(UID_A, gid, _anh(), deps=_deps(c))
    assert c.calls == []
