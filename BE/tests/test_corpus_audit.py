"""Kiểm kê ngữ liệu và ước lượng chi phí — `vectorstore/corpus_audit.py`.

Module này tồn tại để trả lời "tốn bao nhiêu" TRƯỚC khi tiêu tiền, nên hai thứ nó
tuyệt đối không được làm: đếm bằng một luật lọc khác với luật rebuild thật dùng, và
bịa ra một con số tiền khi chưa biết giá. Một con số bịa trông giống hệt một con số
thật, và người đọc không có cách nào phân biệt.

Không gọi API embedding lần nào, không cần credential.
"""

from __future__ import annotations

import math

import pytest

from app.domains.vectorstore import corpus_audit as ca


def _kho(docs, chunks):
    """Trả về (liet_ke_tai_lieu, liet_ke_chunk) khớp chữ ký của rebuild."""
    def _tl():
        return docs

    def _ch(did, limit=500, offset=0):
        return chunks.get(did, [])[offset:offset + limit]

    return _tl, _ch


# ── Đếm ngữ liệu ───────────────────────────────────────────────────────────
def test_ngu_lieu_rong():
    tl, ch = _kho({}, {})
    n = ca.thong_ke_ngu_lieu(liet_ke_tai_lieu=tl, liet_ke_chunk=ch)
    assert n["chunks"] == 0 and n["documents"] == 0 and n["tong_ky_tu"] == 0
    # Không được chia cho 0 ở bất kỳ thống kê nào.
    assert n["ky_tu_trung_binh"] == 0 and n["chunk_moi_doc_trung_binh"] == 0


def test_dem_dung_va_thong_ke_dung():
    docs = {"d1": {"status": "ready"}, "d2": {"status": "ready"}}
    chunks = {"d1": [{"chunk_id": "a", "text": "x" * 100},
                     {"chunk_id": "b", "text": "y" * 300}],
              "d2": [{"chunk_id": "c", "text": "z" * 50}]}
    tl, ch = _kho(docs, chunks)
    n = ca.thong_ke_ngu_lieu(liet_ke_tai_lieu=tl, liet_ke_chunk=ch)
    assert n["chunks"] == 3 and n["documents"] == 2
    assert n["tong_ky_tu"] == 450
    assert n["ky_tu_ngan_nhat"] == 50 and n["ky_tu_dai_nhat"] == 300
    assert n["chunk_moi_doc_it_nhat"] == 1 and n["chunk_moi_doc_nhieu_nhat"] == 2


def test_tai_lieu_da_xoa_bi_loai_KHONG_tinh_vao():
    """Cùng luật với rebuild: `status == deleted` thì bỏ. Đếm lệch ở đây là con số
    kiểm kê và con số thực tế nói khác nhau mà không ai đối chiếu."""
    docs = {"d1": {"status": "deleted"}, "d2": {"status": "ready"}}
    chunks = {"d1": [{"chunk_id": "a", "text": "khong tinh"}],
              "d2": [{"chunk_id": "b", "text": "co tinh"}]}
    tl, ch = _kho(docs, chunks)
    n = ca.thong_ke_ngu_lieu(liet_ke_tai_lieu=tl, liet_ke_chunk=ch)
    assert n["chunks"] == 1 and n["documents"] == 1


def test_dung_CHINH_luat_loc_cua_rebuild():
    """Bằng chứng cụ thể: kiểm kê và rebuild đọc ra CÙNG một danh sách."""
    from app.domains.vectorstore.rebuild import doc_chunks_tu_db

    docs = {"d2": {"status": "ready", "source_stem": "s2"},
            "d1": {"status": "ready", "source_stem": "s1"},
            "d3": {"status": "deleted", "source_stem": "s3"}}
    chunks = {"d1": [{"chunk_id": "a", "text": "mot"}],
              "d2": [{"chunk_id": "b", "text": "hai"}, {"chunk_id": "c", "text": "ba"}],
              "d3": [{"chunk_id": "d", "text": "bon"}]}
    tl, ch = _kho(docs, chunks)
    bg = doc_chunks_tu_db(liet_ke_tai_lieu=tl, liet_ke_chunk=ch)
    n = ca.thong_ke_ngu_lieu(liet_ke_tai_lieu=tl, liet_ke_chunk=ch)
    assert n["chunks"] == len(bg) == 3


def test_dem_TAT_DINH():
    docs = {"d1": {"status": "ready"}}
    chunks = {"d1": [{"chunk_id": str(i), "text": f"doan {i}"} for i in range(7)]}
    tl, ch = _kho(docs, chunks)
    a = ca.thong_ke_ngu_lieu(liet_ke_tai_lieu=tl, liet_ke_chunk=ch)
    b = ca.thong_ke_ngu_lieu(liet_ke_tai_lieu=tl, liet_ke_chunk=ch)
    assert a == b


def test_dem_chunk_co_the_vuot_ctx():
    """Chunk dài hơn trần ngữ cảnh bị model tự cắt — vector chỉ phản ánh phần đầu.
    Không phải lỗi, nhưng phải biết có bao nhiêu cái như thế."""
    docs = {"d1": {"status": "ready"}}
    dai = "x" * (ca.CTX_TOI_DA * 3)          # chắc chắn vượt kể cả ước lượng lạc quan
    chunks = {"d1": [{"chunk_id": "a", "text": "ngan"}, {"chunk_id": "b", "text": dai}]}
    tl, ch = _kho(docs, chunks)
    n = ca.thong_ke_ngu_lieu(liet_ke_tai_lieu=tl, liet_ke_chunk=ch)
    assert n["chunk_vuot_ctx_uoc_luong"] == 1


# ── Ước lượng token ────────────────────────────────────────────────────────
def test_token_rong_ra_khong():
    assert ca.uoc_luong_token(0) == {"thap": 0, "cao": 0}


def test_token_la_KHOANG_khong_phai_mot_so():
    """Marketplace không công bố tokenizer, nên phía client không tính đúng được.
    Trả khoảng để người đọc thấy độ bất định."""
    t = ca.uoc_luong_token(10_000)
    assert t["thap"] < t["cao"], "phải là khoảng, không phải một con số"
    assert t["thap"] == math.ceil(10_000 / ca.KY_TU_MOI_TOKEN_CAO)
    assert t["cao"] == math.ceil(10_000 / ca.KY_TU_MOI_TOKEN_THAP)


def test_token_khong_am():
    assert ca.uoc_luong_token(-5) == {"thap": 0, "cao": 0}


# ── Kế hoạch request ───────────────────────────────────────────────────────
@pytest.mark.parametrize("n,b,so_request", [
    (0, 32, 0),
    (1, 32, 1),
    (32, 32, 1),      # chia hết
    (33, 32, 2),      # dư một
    (64, 32, 2),
    (189, 32, 6),     # số thật của kho hôm nay
    (189, 64, 3),
])
def test_so_request(n, b, so_request):
    assert ca.ke_hoach_request(n, b)["so_request"] == so_request


def test_lo_cuoi():
    assert ca.ke_hoach_request(33, 32)["lo_cuoi"] == 1
    assert ca.ke_hoach_request(64, 32)["lo_cuoi"] == 32, "chia hết thì lô cuối đầy"
    assert ca.ke_hoach_request(0, 32)["lo_cuoi"] == 0


@pytest.mark.parametrize("b", [0, -1])
def test_batch_size_khong_hop_le(b):
    with pytest.raises(ValueError):
        ca.ke_hoach_request(10, b)


def test_so_chunk_am():
    with pytest.raises(ValueError):
        ca.ke_hoach_request(-1, 32)


# ── Chi phí ────────────────────────────────────────────────────────────────
def test_chua_biet_gia_thi_KHONG_bia_so():
    c = ca.uoc_luong_chi_phi(1_000_000, None)
    assert c["pricing_verified"] is False and c["chi_phi"] is None
    assert "chưa xác minh" in c["ghi_chu"]


def test_co_gia_thi_tinh_dung():
    c = ca.uoc_luong_chi_phi(1_000_000, 0.01)
    assert c["pricing_verified"] is True and c["chi_phi"] == 0.01
    assert ca.uoc_luong_chi_phi(500_000, 0.01)["chi_phi"] == 0.005


def test_khong_token_thi_khong_ton_tien():
    assert ca.uoc_luong_chi_phi(0, 0.01)["chi_phi"] == 0.0


@pytest.mark.parametrize("token,gia", [(-1, 0.01), (10, -0.01)])
def test_gia_tri_am_bi_tu_choi(token, gia):
    with pytest.raises(ValueError):
        ca.uoc_luong_chi_phi(token, gia)


def test_gia_tu_marketplace_khong_co_khoa_thi_None(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", "")
    assert ca.gia_tu_marketplace() is None


def test_gia_tu_marketplace_khong_goi_mang_khi_thieu_khoa(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", "")
    import requests
    monkeypatch.setattr(requests, "get",
                        lambda *a, **k: pytest.fail("thiếu khoá thì đừng gọi mạng"))
    assert ca.gia_tu_marketplace() is None


def test_gia_tu_marketplace_doc_dung_truong(monkeypatch):
    """Giá lấy từ `GET /v1/models` của chính FPT — nguồn chính thức duy nhất, vì
    trang marketplace công khai không hiện giá (đã kiểm 2026-09-04)."""
    monkeypatch.setenv("FPT_AI_API_KEY", "sk-khoa-gia-chi-dung-trong-test")
    monkeypatch.setenv("FPT_AI_EMBEDDING_MODEL", "Vietnamese_Embedding")

    class _R:
        status_code = 200

        def json(self):
            return {"data": [{"id": "khac", "pricing": {"prompt": "0.99"}},
                             {"id": "Vietnamese_Embedding",
                              "pricing": {"prompt": "0.00000001"}}]}

    import requests
    monkeypatch.setattr(requests, "get", lambda *a, **k: _R())
    assert ca.gia_tu_marketplace() == pytest.approx(0.01)


@pytest.mark.parametrize("resp", ["loi_http", "khong_thay_model", "no"])
def test_gia_tu_marketplace_hong_thi_None_khong_nem(monkeypatch, resp):
    monkeypatch.setenv("FPT_AI_API_KEY", "sk-khoa-gia-chi-dung-trong-test")
    monkeypatch.setenv("FPT_AI_EMBEDDING_MODEL", "Vietnamese_Embedding")

    class _R:
        status_code = 500 if resp == "loi_http" else 200

        def json(self):
            return {"data": []}

    import requests
    if resp == "no":
        monkeypatch.setattr(requests, "get",
                            lambda *a, **k: (_ for _ in ()).throw(TimeoutError("het gio")))
    else:
        monkeypatch.setattr(requests, "get", lambda *a, **k: _R())
    assert ca.gia_tu_marketplace() is None


# ── Phóng chiếu thời gian ──────────────────────────────────────────────────
def test_thoi_gian_la_PHONG_CHIEU_co_du_thu_lai():
    t = ca.uoc_luong_thoi_gian(6, 0.86, ti_le_thu_lai=0.1)
    assert t["giay_khong_thu_lai"] == pytest.approx(5.2, abs=0.1)
    assert t["giay_co_thu_lai"] > t["giay_khong_thu_lai"]


def test_thoi_gian_khong_request_thi_khong_ton_giay():
    assert ca.uoc_luong_thoi_gian(0, 0.86)["giay_khong_thu_lai"] == 0.0


@pytest.mark.parametrize("a,b,c", [(-1, 1, 0), (1, -1, 0), (1, 1, -0.1)])
def test_thoi_gian_tham_so_am(a, b, c):
    with pytest.raises(ValueError):
        ca.uoc_luong_thoi_gian(a, b, ti_le_thu_lai=c)


# ── Báo cáo gộp ────────────────────────────────────────────────────────────
def test_bao_cao_gop_du_phan():
    bg = [{"chunk_id": f"c{i}", "document_id": "d1", "source_stem": "s",
           "text": "x" * 100} for i in range(50)]
    r = ca.bao_cao(bg, batch_sizes=(16, 32), gia_moi_trieu_token=0.01,
                   giay_moi_request=0.86)
    assert r["ngu_lieu"]["chunks"] == 50
    assert [k["so_request"] for k in r["ke_hoach_request"]] == [4, 2]
    assert r["chi_phi_thap"]["pricing_verified"] is True
    assert set(r["thoi_gian"]) == {16, 32}


def test_bao_cao_khong_co_gia_thi_khong_co_tien():
    bg = [{"chunk_id": "c0", "document_id": "d1", "source_stem": "s", "text": "x"}]
    r = ca.bao_cao(bg, gia_moi_trieu_token=None)
    assert r["chi_phi_thap"]["chi_phi"] is None
    assert "thoi_gian" not in r, "không có số đo thì đừng phóng chiếu"
