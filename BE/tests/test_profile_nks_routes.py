"""Hợp đồng HTTP của `/me/nks/profile` — không cần database.

Phiên StudyMap được thay bằng cách patch `service.current_user_from_request`, use case
được thay bằng đồ giả. Thứ đang đo là hợp đồng của ROUTE: mã trạng thái, khoá đi ra,
và chứng từ được đọc từ đâu.
"""

from __future__ import annotations

import pytest

from app.domains.auth import grants
from shared.interfaces.profile import ExternalProfile

UID_A = "user-A"
GID = "grant-id-gia"
TOKEN = "eyJ0eXAiOiJKV1Q.KHONG-DUOC-RO-RA.xxx"

HO_SO = ExternalProfile(
    provider="nks", provider_user_id="128", email="a@example.com",
    display_name="Teacher1", avatar="https://data.nks.vn/a.jpg", role="teacher",
    firstname="Nguyễn Hữu", lastname="Lực", phone="0364967082", gender=1,
    dob="2004-08-18", website=None, pob=None, province="TP.HCM", intro="xin chào",
)


@pytest.fixture(autouse=True)
def _sach():
    grants.reset_for_tests()
    yield
    grants.reset_for_tests()


def _dang_nhap_la(monkeypatch, uid=UID_A):
    from app.domains.auth import service
    monkeypatch.setattr(service, "current_user_from_request",
                        lambda: {"user_id": uid, "email": f"{uid}@example.com",
                                 "display_name": uid, "role": "learner", "token_version": 1})


def _uc_gia(monkeypatch, *, doc=None, ghi=None):
    from app.application import profile as p
    if doc is not None:
        monkeypatch.setattr(p, "doc_ho_so", doc)
    if ghi is not None:
        monkeypatch.setattr(p, "cap_nhat_ho_so", ghi)


# ── Phải đăng nhập ───────────────────────────────────────────────────────────
def test_chua_dang_nhap_thi_401(client, monkeypatch):
    from app.domains.auth import service
    monkeypatch.setattr(service, "current_user_from_request", lambda: None)
    assert client.get("/me/nks/profile", headers={"X-Grant-Id": GID}).status_code == 401
    assert client.patch("/me/nks/profile", json={"phone": "0900"},
                        headers={"X-Grant-Id": GID}).status_code == 401


def test_thieu_chung_tu_thi_409_grant_required(client, monkeypatch):
    _dang_nhap_la(monkeypatch)
    r = client.get("/me/nks/profile")
    assert r.status_code == 409
    assert r.get_json() == {"error": "grant_required"}


# ── Đọc ──────────────────────────────────────────────────────────────────────
def test_doc_tra_dung_danh_sach_trang(client, monkeypatch):
    _dang_nhap_la(monkeypatch)
    _uc_gia(monkeypatch, doc=lambda uid, gid, **kw: HO_SO)

    r = client.get("/me/nks/profile", headers={"X-Grant-Id": GID})
    assert r.status_code == 200
    ho_so = r.get_json()["profile"]
    assert set(ho_so) == {
        "provider", "provider_user_id", "email", "display_name", "avatar", "role",
        "firstname", "lastname", "phone", "gender", "dob", "website", "pob",
        "province", "intro"}
    assert ho_so["dob"] == "2004-08-18"
    assert TOKEN not in r.get_data(as_text=True)


def test_chung_tu_doc_tu_HEADER_khong_phai_query(client, monkeypatch):
    """Query string nằm trong log truy cập của proxy; header thì không."""
    _dang_nhap_la(monkeypatch)
    nhan = {}
    _uc_gia(monkeypatch, doc=lambda uid, gid, **kw: nhan.setdefault("gid", gid) and HO_SO or HO_SO)

    client.get("/me/nks/profile", headers={"X-Grant-Id": GID})
    assert nhan["gid"] == GID
    # Đưa qua query thì route không thấy ⇒ 409.
    assert client.get(f"/me/nks/profile?grant_id={GID}").status_code == 409


# ── Ghi ──────────────────────────────────────────────────────────────────────
def test_ghi_thanh_cong_tra_ho_so_moi(client, monkeypatch):
    _dang_nhap_la(monkeypatch)
    nhan = {}

    def ghi(uid, gid, thay_doi, **kw):
        nhan.update(uid=uid, gid=gid, thay_doi=dict(thay_doi))
        return HO_SO
    _uc_gia(monkeypatch, ghi=ghi)

    r = client.patch("/me/nks/profile", json={"phone": "0911222333"},
                     headers={"X-Grant-Id": GID})
    assert r.status_code == 200
    assert nhan["uid"] == UID_A and nhan["gid"] == GID
    assert nhan["thay_doi"] == {"phone": "0911222333"}
    assert r.get_json()["profile"]["display_name"] == "Teacher1"


def test_than_khong_phai_object_thi_400(client, monkeypatch):
    _dang_nhap_la(monkeypatch)
    r = client.patch("/me/nks/profile", json=["khong", "phai", "object"],
                     headers={"X-Grant-Id": GID})
    assert r.status_code == 400
    assert r.get_json() == {"error": "invalid_field"}


def test_truong_cam_thi_400_invalid_field(client, monkeypatch):
    from app.application import profile as p
    _dang_nhap_la(monkeypatch)

    def ghi(uid, gid, thay_doi, **kw):
        raise p.TruongKhongSuaDuoc("name")
    _uc_gia(monkeypatch, ghi=ghi)

    r = client.patch("/me/nks/profile", json={"name": "X"}, headers={"X-Grant-Id": GID})
    assert r.status_code == 400
    assert r.get_json() == {"error": "invalid_field"}


# ── Chứng từ chết ────────────────────────────────────────────────────────────
def test_chung_tu_chet_tra_409_grant_required(client, monkeypatch):
    """FE dựa vào đúng mã này để bật lại hộp thoại xác minh mà GIỮ NGUYÊN phần đang
    gõ dở — nên nó phải khác 401 (hết phiên StudyMap) và khác 400 (lỗi nhập liệu)."""
    from app.application import profile as p
    _dang_nhap_la(monkeypatch)

    def ghi(uid, gid, thay_doi, **kw):
        raise p.GrantKhongHopLe("nks")
    _uc_gia(monkeypatch, ghi=ghi)

    r = client.patch("/me/nks/profile", json={"phone": "0900"}, headers={"X-Grant-Id": GID})
    assert r.status_code == 409
    assert r.get_json() == {"error": "grant_required"}


def test_nks_sap_tra_503(client, monkeypatch):
    from app.application import profile as p
    _dang_nhap_la(monkeypatch)

    def doc(uid, gid, **kw):
        raise p.ProviderUnavailable("x")
    _uc_gia(monkeypatch, doc=doc)

    assert client.get("/me/nks/profile", headers={"X-Grant-Id": GID}).status_code == 503


def test_khong_bao_gio_tra_token_du_use_case_lo_nhet_vao(client, monkeypatch):
    """Hàng rào cuối: route chỉ serialize `to_dict()`, không phải object thô."""
    _dang_nhap_la(monkeypatch)
    _uc_gia(monkeypatch, doc=lambda uid, gid, **kw: HO_SO)
    r = client.get("/me/nks/profile", headers={"X-Grant-Id": GID})
    assert "access_token" not in r.get_data(as_text=True)
    assert TOKEN not in r.get_data(as_text=True)
