"""Hợp đồng HTTP của `PUT /me/nks/avatar` — không cần database.

Phiên StudyMap và use case đều được thay bằng đồ giả; thứ đang đo là hợp đồng ROUTE:
mã trạng thái, khoá đi ra, và hàng rào byte đọc từ chính dữ liệu chứ không từ
`Content-Length` do client khai.
"""

from __future__ import annotations

import io

import pytest

from app.domains.auth import grants
from app.domains.media import anh_dai_dien as media
from shared.interfaces.profile import ExternalProfile

UID_A = "user-A"
GID = "grant-id-gia"
TOKEN = "eyJ0eXAiOiJKV1Q.KHONG-DUOC-RO-RA.xxx"

HO_SO = ExternalProfile(
    provider="nks", provider_user_id="128", email="a@example.com",
    display_name="T", avatar="https://data.nks.vn/storage/users/moi.jpg", role="teacher",
    firstname="A", lastname="B", phone="0900", gender=1, dob="2004-08-18",
    website=None, pob=None, province="TP.HCM", intro="x",
)


def _anh(rong=300, cao=300):
    from PIL import Image
    ra = io.BytesIO()
    Image.new("RGB", (rong, cao), (10, 20, 30)).save(ra, format="JPEG")
    return ra.getvalue()


@pytest.fixture(autouse=True)
def _sach():
    grants.reset_for_tests()
    yield
    grants.reset_for_tests()


def _dang_nhap_la(monkeypatch, uid=UID_A):
    from app.domains.auth import service
    monkeypatch.setattr(service, "current_user_from_request",
                        lambda: {"user_id": uid, "email": "a@example.com",
                                 "display_name": uid, "role": "learner",
                                 "avatar_url": None, "token_version": 1})


def _uc_gia(monkeypatch, fn):
    from app.application import profile as p
    monkeypatch.setattr(p, "cap_nhat_anh_dai_dien", fn)


def _gui(client, data=None, headers=None):
    return client.put("/me/nks/avatar",
                      data={"avatar": (io.BytesIO(data if data is not None else _anh()), "a.jpg")},
                      headers=headers or {"X-Grant-Id": GID},
                      content_type="multipart/form-data")


# ── Xác thực + chứng từ ─────────────────────────────────────────────────────
def test_chua_dang_nhap_thi_401(client, monkeypatch):
    from app.domains.auth import service
    monkeypatch.setattr(service, "current_user_from_request", lambda: None)
    assert _gui(client).status_code == 401


def test_thieu_chung_tu_thi_409(client, monkeypatch):
    _dang_nhap_la(monkeypatch)
    r = _gui(client, headers={})
    assert r.status_code == 409
    assert r.get_json() == {"error": "grant_required"}


def test_chung_tu_chet_tra_409_grant_required(client, monkeypatch):
    from app.application import profile as p
    _dang_nhap_la(monkeypatch)

    def ghi(uid, gid, raw, **kw):
        raise p.GrantKhongHopLe("nks")
    _uc_gia(monkeypatch, ghi)

    r = _gui(client)
    assert r.status_code == 409
    assert r.get_json() == {"error": "grant_required"}


# ── Thành công ──────────────────────────────────────────────────────────────
def test_thanh_cong_tra_ho_so_moi_voi_url_moi(client, monkeypatch):
    _dang_nhap_la(monkeypatch)
    nhan = {}

    def ghi(uid, gid, raw, **kw):
        nhan.update(uid=uid, gid=gid, so_byte=len(raw))
        return HO_SO
    _uc_gia(monkeypatch, ghi)

    r = _gui(client)
    assert r.status_code == 200
    ho_so = r.get_json()["profile"]
    assert ho_so["avatar"] == "https://data.nks.vn/storage/users/moi.jpg"
    assert nhan["uid"] == UID_A and nhan["gid"] == GID and nhan["so_byte"] > 0
    # Danh sách trắng vẫn đúng 15 khoá — route chỉ serialize `to_dict()`.
    assert set(ho_so) == {
        "provider", "provider_user_id", "email", "display_name", "avatar", "role",
        "firstname", "lastname", "phone", "gender", "dob", "website", "pob",
        "province", "intro"}
    assert TOKEN not in r.get_data(as_text=True)


# ── Hàng rào byte ở ROUTE ───────────────────────────────────────────────────
def test_qua_tran_byte_tra_413_va_KHONG_goi_use_case(client, monkeypatch):
    """Route tự đo dữ liệu THẬT — không tin `Content-Length` client khai."""
    _dang_nhap_la(monkeypatch)
    goi = []
    _uc_gia(monkeypatch, lambda *a, **k: goi.append(1) or HO_SO)

    r = _gui(client, data=b"\x00" * (media.GIOI_HAN_BYTE + 1024))
    assert r.status_code == 413
    assert r.get_json() == {"error": "image_too_large"}
    assert goi == [], "phải chặn TRƯỚC khi vào use case"


def test_thieu_tep_thi_400(client, monkeypatch):
    _dang_nhap_la(monkeypatch)
    r = client.put("/me/nks/avatar", data={}, headers={"X-Grant-Id": GID},
                   content_type="multipart/form-data")
    assert r.status_code == 400
    assert r.get_json() == {"error": "invalid_image"}


@pytest.mark.parametrize("loi,ma_http,ma", [
    ("AnhQuaLon", 413, "image_too_large"),
    ("AnhKhongHopLe", 400, "invalid_image"),
])
def test_loi_pipeline_anh_thanh_dung_ma(client, monkeypatch, loi, ma_http, ma):
    _dang_nhap_la(monkeypatch)
    lop = getattr(media, loi)

    def ghi(uid, gid, raw, **kw):
        raise lop("chi tiet noi bo")
    _uc_gia(monkeypatch, ghi)

    r = _gui(client)
    assert r.status_code == ma_http
    assert r.get_json() == {"error": ma}
    # Thông điệp nội bộ KHÔNG được ra ngoài.
    assert "chi tiet noi bo" not in r.get_data(as_text=True)


def test_anh_rac_that_bi_tu_choi_400(client, monkeypatch):
    """Đi qua pipeline THẬT, không giả use case."""
    _dang_nhap_la(monkeypatch)
    grants.reset_for_tests()
    gid, _ = grants.tao(UID_A, "nks", TOKEN)
    r = _gui(client, data=b"day khong phai anh", headers={"X-Grant-Id": gid})
    assert r.status_code == 400
    assert r.get_json() == {"error": "invalid_image"}


def test_nks_sap_tra_503(client, monkeypatch):
    from app.application import profile as p
    _dang_nhap_la(monkeypatch)

    def ghi(uid, gid, raw, **kw):
        raise p.ProviderUnavailable("x")
    _uc_gia(monkeypatch, ghi)
    assert _gui(client).status_code == 503
