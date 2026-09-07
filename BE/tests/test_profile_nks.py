"""Đọc/ghi hồ sơ NKS qua chứng từ ghi ngắn hạn.

Không chạm database, không chạm mạng: client HTTP của NKS được thay bằng đồ giả, còn
kho chứng từ là mã THẬT. Ranh giới đang được kiểm là: cái gì tới được provider, cái gì
đi ra được tới trình duyệt, và chứng từ chết lúc nào.
"""

from __future__ import annotations

import json
import logging

import pytest

from app.application import profile as uc
from app.clients.auth_nks import NKSAuthProvider
from app.clients.auth_nks.errors import NksInvalidCredentials, NksUnavailable
from app.domains.auth import grants
from shared.interfaces.profile import TRUONG_SUA_DUOC

TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.KHONG-DUOC-RO-RA.xxx"
UID_A, UID_B = "user-A", "user-B"

#: Thân `/nks/user` THẬT rút gọn (đo 2026-09-07) — giữ cả những trường KHÔNG được
#: phép đi ra ngoài, vì đó chính là thứ cần kiểm.
THAN_THAT = {
    "id": 128, "email": "nks.teacher01@example.com", "name": "Teacher1",
    "firstname": "Nguyễn Hữu", "lastname": "Lực", "phone": "0364967082",
    "gender": 1, "dob": "2004-08-18", "pob": None, "website": None,
    "province": "Thành phố Hồ Chí Minh", "intro": "Là admin SeduAI",
    "avatar": "https://data.nks.vn//storage/users/202607090738597953.jpg",
    "role": {"id": 8, "name": "teacher"}, "role_id": 8,
    # Những thứ TUYỆT ĐỐI không được ra khỏi máy chủ:
    "activation_token": "act-tok-bi-mat", "sms_token": "sms-bi-mat",
    "zalo_key": "zalo-bi-mat", "face_id": "face-bi-mat", "nopass": False,
    "cccd_front": "https://data.nks.vn/cccd/front.jpg",
    "cccd_back": "https://data.nks.vn/cccd/back.jpg",
    "id_number": "079204001234", "id_date": "2021-04-19",
    "id_place": "Cục Cảnh sát QLHC về TTXH",
    "settings": {"a": 1}, "qrcode": "qr-bi-mat", "vcard": "vcard-bi-mat",
}


class ClientGia:
    """Đứng đúng chỗ `auth_nks.client`. Ghi lại mọi lời gọi để khẳng định luồng."""

    def __init__(self, than=None, update_exc=None, user_exc=None, update_body=None):
        self.than = dict(than or THAN_THAT)
        self.update_exc, self.user_exc = update_exc, user_exc
        self.update_body = update_body or {"success": True, "option": None,
                                           "data": True, "message": "User retrieved successfully."}
        self.calls: list[tuple] = []

    def get_user(self, access_token):
        self.calls.append(("get_user", access_token))
        if self.user_exc:
            raise self.user_exc
        return {"success": True, "data": dict(self.than)}

    def update_info(self, access_token, fields):
        self.calls.append(("update_info", access_token, dict(fields)))
        if self.update_exc:
            raise self.update_exc
        self.than.update({k: v for k, v in fields.items() if k in self.than or True})
        return self.update_body


@pytest.fixture(autouse=True)
def _sach():
    grants.reset_for_tests()
    yield
    grants.reset_for_tests()


def _deps(c):
    return {"nks_provider": NKSAuthProvider(client=c, enabled=lambda: True), "grants": grants}


def _grant(uid=UID_A):
    gid, _ = grants.tao(uid, "nks", TOKEN)
    return gid


# ── 1. Chứng từ hợp lệ ⇒ yêu cầu tới được provider ───────────────────────────
def test_grant_hop_le_thi_update_info_toi_duoc_nks():
    c = ClientGia()
    gid = _grant()
    uc.cap_nhat_ho_so(UID_A, gid, {"phone": "0900000001"}, deps=_deps(c))

    ten = [x[0] for x in c.calls]
    assert ten == ["update_info", "get_user"]
    assert c.calls[0][1] == TOKEN                     # đúng token của chứng từ
    assert c.calls[0][2] == {"phone": "0900000001"}


def test_doc_ho_so_tra_ve_ban_hien_tai():
    c = ClientGia()
    hs = uc.doc_ho_so(UID_A, _grant(), deps=_deps(c))
    assert hs.firstname == "Nguyễn Hữu" and hs.lastname == "Lực"
    assert hs.phone == "0364967082" and hs.gender == 1
    assert hs.dob == "2004-08-18"
    assert hs.display_name == "Teacher1"


# ── 2 + 3. Chứng từ sai/thiếu/khác chủ ⇒ từ chối ─────────────────────────────
@pytest.mark.parametrize("gid", ["", "khong-ton-tai", "   "])
def test_khong_co_chung_tu_thi_tu_choi(gid):
    c = ClientGia()
    with pytest.raises(uc.GrantKhongHopLe):
        uc.doc_ho_so(UID_A, gid, deps=_deps(c))
    assert c.calls == []                              # không hề gọi provider


def test_chung_tu_cua_nguoi_khac_khong_dung_duoc():
    c = ClientGia()
    gid = _grant(UID_A)
    with pytest.raises(uc.GrantKhongHopLe):
        uc.cap_nhat_ho_so(UID_B, gid, {"phone": "0900000002"}, deps=_deps(c))
    assert c.calls == []
    assert grants.lay(gid, UID_A) == TOKEN            # của A vẫn nguyên


def test_chung_tu_het_han_thi_tu_choi():
    import time
    c = ClientGia()
    gid, _ = grants.tao(UID_A, "nks", TOKEN, ttl_sec=1)
    time.sleep(1.05)
    with pytest.raises(uc.GrantKhongHopLe):
        uc.doc_ho_so(UID_A, gid, deps=_deps(c))
    assert c.calls == []


# ── 4. Ánh xạ đủ trường ──────────────────────────────────────────────────────
def test_moi_truong_sua_duoc_deu_toi_dung_ten_o_nks():
    c = ClientGia()
    thay_doi = {
        "firstname": "Tên", "lastname": "Họ", "phone": "0900000003", "gender": 0,
        "dob": "1999-12-31", "website": "https://vidu.com", "pob": "Hà Nội",
        "province": "Hà Nội", "intro": "giới thiệu",
    }
    assert set(thay_doi) == set(TRUONG_SUA_DUOC), "test phải phủ đúng danh sách trắng"
    uc.cap_nhat_ho_so(UID_A, _grant(), thay_doi, deps=_deps(c))

    gui = c.calls[0][2]
    assert gui == {k: str(v) for k, v in thay_doi.items()}


def test_xoa_trang_mot_o_thi_gui_chuoi_rong():
    c = ClientGia()
    uc.cap_nhat_ho_so(UID_A, _grant(), {"website": None}, deps=_deps(c))
    assert c.calls[0][2] == {"website": ""}


def test_gender_ngoai_0_1_doc_ve_None():
    c = ClientGia(than={**THAN_THAT, "gender": 7})
    assert uc.doc_ho_so(UID_A, _grant(), deps=_deps(c)).gender is None


# ── 5. `name` và CCCD không gửi được ─────────────────────────────────────────
@pytest.mark.parametrize("khoa", ["name", "display_name", "id_number", "id_date",
                                  "id_place", "email", "avatar", "role", "access_token"])
def test_truong_ngoai_danh_sach_trang_bi_tu_choi(khoa):
    """`name` KHÔNG sửa được: đo thật cho thấy nó độc lập với firstname/lastname và
    endpoint ghi không có tham số nào đặt nó. Cho gõ rồi lặng lẽ không lưu là đúng
    lỗi "nút bấm không gọi gì cả"."""
    c = ClientGia()
    with pytest.raises(uc.TruongKhongSuaDuoc):
        uc.cap_nhat_ho_so(UID_A, _grant(), {khoa: "x"}, deps=_deps(c))
    assert c.calls == []                              # không gửi đi một phần nào


def test_tron_truong_hop_le_va_truong_cam_thi_KHONG_ghi_gi_ca():
    c = ClientGia()
    with pytest.raises(uc.TruongKhongSuaDuoc):
        uc.cap_nhat_ho_so(UID_A, _grant(), {"phone": "0900", "name": "X"}, deps=_deps(c))
    assert c.calls == []


def test_khong_co_gi_de_ghi_thi_tu_choi():
    c = ClientGia()
    for rong in ({}, None, []):
        with pytest.raises(uc.TruongKhongSuaDuoc):
            uc.cap_nhat_ho_so(UID_A, _grant(), rong, deps=_deps(c))
    assert c.calls == []


# ── 6 + 7. Ghi xong PHẢI đọc lại ─────────────────────────────────────────────
def test_ghi_xong_thi_hoi_lai_nks_va_tra_ban_moi():
    """`updateInfo` trả `data: true`, không trả hồ sơ. Nên bản đi ra phải là bản ĐỌC
    LẠI, không phải thứ vừa gửi lên."""
    c = ClientGia()
    hs = uc.cap_nhat_ho_so(UID_A, _grant(), {"phone": "0911222333"}, deps=_deps(c))

    assert [x[0] for x in c.calls] == ["update_info", "get_user"]
    assert hs.phone == "0911222333"                   # lấy từ lượt đọc lại


def test_provider_chuan_hoa_lai_thi_lay_theo_provider():
    """Provider có quyền sửa giá trị. Bản hiển thị phải theo họ, không theo form."""
    c = ClientGia()
    c.than["phone"] = "+84 900 111 222"               # ~ provider chuẩn hoá lại

    def update_info(access_token, fields):
        c.calls.append(("update_info", access_token, dict(fields)))
        return {"success": True, "data": True}
    c.update_info = update_info

    hs = uc.cap_nhat_ho_so(UID_A, _grant(), {"phone": "0900111222"}, deps=_deps(c))
    assert hs.phone == "+84 900 111 222"


def test_nks_khong_xac_nhan_ghi_thi_bao_loi_giao_thuc():
    c = ClientGia(update_body={"success": False, "data": None})
    with pytest.raises(uc.ProviderProtocolError):
        uc.cap_nhat_ho_so(UID_A, _grant(), {"phone": "0900"}, deps=_deps(c))


# ── 8. Provider từ chối token ⇒ huỷ chứng từ ─────────────────────────────────
def test_nks_tu_choi_token_thi_chung_tu_bi_huy():
    c = ClientGia(update_exc=NksInvalidCredentials("Token is invalid"))
    gid = _grant()
    with pytest.raises(uc.GrantKhongHopLe):
        uc.cap_nhat_ho_so(UID_A, gid, {"phone": "0900"}, deps=_deps(c))

    assert grants.lay(gid, UID_A) is None
    assert grants.so_luong() == 0


def test_nks_tu_choi_o_duong_DOC_cung_huy_chung_tu():
    c = ClientGia(user_exc=NksInvalidCredentials("Token is invalid"))
    gid = _grant()
    with pytest.raises(uc.GrantKhongHopLe):
        uc.doc_ho_so(UID_A, gid, deps=_deps(c))
    assert grants.so_luong() == 0


def test_nks_sap_thi_GIU_chung_tu():
    """Sự cố hạ tầng không phải là "token chết". Huỷ chứng từ lúc đó bắt người dùng
    gõ lại mật khẩu vì một lỗi không phải của họ."""
    c = ClientGia(update_exc=NksUnavailable("503"))
    gid = _grant()
    with pytest.raises(uc.ProviderUnavailable):
        uc.cap_nhat_ho_so(UID_A, gid, {"phone": "0900"}, deps=_deps(c))
    assert grants.lay(gid, UID_A) == TOKEN


# ── 9. Không rò bí mật ───────────────────────────────────────────────────────
def test_khong_truong_nhay_cam_nao_ra_khoi_may_chu():
    """56 trường vào, đúng 15 trường ra. `to_dict` là danh sách trắng."""
    c = ClientGia()
    ra = json.dumps(uc.doc_ho_so(UID_A, _grant(), deps=_deps(c)).to_dict(), ensure_ascii=False)

    for cam in ("act-tok-bi-mat", "sms-bi-mat", "zalo-bi-mat", "face-bi-mat",
                "079204001234", "cccd/front.jpg", "cccd/back.jpg",
                "qr-bi-mat", "vcard-bi-mat", "Cục Cảnh sát"):
        assert cam not in ra, cam
    assert TOKEN not in ra


def test_hop_dong_khoa_ra_ngoai_la_co_dinh():
    c = ClientGia()
    d = uc.doc_ho_so(UID_A, _grant(), deps=_deps(c)).to_dict()
    assert set(d) == {
        "provider", "provider_user_id", "email", "display_name", "avatar", "role",
        "firstname", "lastname", "phone", "gender", "dob", "website", "pob",
        "province", "intro",
    }


def test_khong_co_token_trong_log(caplog):
    c = ClientGia()
    with caplog.at_level(logging.DEBUG):
        uc.cap_nhat_ho_so(UID_A, _grant(), {"phone": "0900"}, deps=_deps(c))
    assert TOKEN not in " ".join(r.getMessage() for r in caplog.records)


def test_khong_co_token_trong_exception():
    c = ClientGia(update_exc=NksInvalidCredentials(TOKEN))
    gid = _grant()
    try:
        uc.cap_nhat_ho_so(UID_A, gid, {"phone": "0900"}, deps=_deps(c))
    except uc.GrantKhongHopLe as exc:
        assert TOKEN not in str(exc)


# ── 10. Local không có đường vào ─────────────────────────────────────────────
def test_local_khong_co_chung_tu_nen_khong_vao_duoc():
    """LocalAuth không bao giờ có chứng từ NKS (`grants.tao` chỉ được gọi sau khi
    danh tính NKS khớp), nên đường này đóng với họ ở ngay hàng rào đầu tiên."""
    c = ClientGia()
    gid, _ = grants.tao(UID_A, "local", "bi-mat-local")
    with pytest.raises(uc.GrantKhongHopLe):
        uc.doc_ho_so(UID_A, gid, deps=_deps(c))       # provider không khớp
    assert c.calls == []


def test_provider_tat_thi_bao_chua_bat():
    c = ClientGia()
    deps = {"nks_provider": NKSAuthProvider(client=c, enabled=lambda: False), "grants": grants}
    with pytest.raises(uc.ProviderNotEnabled):
        uc.doc_ho_so(UID_A, _grant(), deps=deps)


# ── Ranh giới: lõi không mang từ vựng NKS ────────────────────────────────────
def test_tang_ung_dung_khong_nhac_ten_truong_cua_provider():
    from pathlib import Path
    ma = Path(uc.__file__).read_text(encoding="utf-8")
    assert "nks.vn" not in ma.lower()
    assert "updateInfo" not in ma
    assert "access_token" not in ma
