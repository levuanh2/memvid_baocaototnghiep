"""Hàng rào chống chạy thang đo trên index có không gian vector sụp.

Số thật (2026-09-01): R0 0.5970 · R1 0.6246 · production 0.7820 · R2_late 0.9950
(cosine trung bình của các chunk cạnh nhau). Ngưỡng 0.90 nằm giữa khoảng trống rộng.
"""

import numpy as np
import pytest

from evaluation import suc_khoe_index as sk


def _index_gia(vecs):
    """Ghi một IndexFlatL2 thật ra đĩa rồi trả thư mục — không mock faiss."""
    import faiss

    v = np.asarray(vecs, dtype="float32")
    idx = faiss.IndexFlatL2(v.shape[1])
    idx.add(v)
    return idx


@pytest.fixture()
def thu_muc(tmp_path):
    return tmp_path


def _ghi(thu_muc, vecs):
    import faiss

    faiss.write_index(_index_gia(vecs), str(thu_muc / "index.faiss"))
    return thu_muc


def test_khong_gian_sup_bi_bat(thu_muc):
    """Mọi vector gần như trùng nhau — đúng hình dạng của R2_late."""
    goc = np.random.RandomState(0).randn(1, 32)
    vecs = np.repeat(goc, 40, axis=0) + np.random.RandomState(1).randn(40, 32) * 0.001
    kq = sk.do_suc_khoe(_ghi(thu_muc, vecs))
    assert kq["canh_nhau"] > 0.99
    assert sk.sup_khong_gian(kq) is True


def test_khong_gian_lanh_khong_bi_bao_dong(thu_muc):
    """Vector phân tán — đúng hình dạng của R0/R1/production."""
    vecs = np.random.RandomState(2).randn(40, 32)
    kq = sk.do_suc_khoe(_ghi(thu_muc, vecs))
    assert sk.sup_khong_gian(kq) is False


def test_khong_co_index_thi_khong_doan(thu_muc):
    assert sk.do_suc_khoe(thu_muc) is None
    assert sk.sup_khong_gian(None) is False, "khong do duoc KHONG phai la sup"


def test_index_qua_nho_thi_bo_qua(thu_muc):
    kq = sk.do_suc_khoe(_ghi(thu_muc, np.random.RandomState(3).randn(2, 8)))
    assert kq is None, "2 vector khong noi len duoc dieu gi"


def test_nguong_nam_giua_khoang_trong_do_duoc():
    """Ngưỡng phải tách được số THẬT của R1 và R2, không phải một con số đẹp."""
    assert sk.NGUONG_CANH_NHAU > 0.7820, "phai cao hon production (0.7820)"
    assert sk.NGUONG_CANH_NHAU < 0.9950, "phai thap hon R2_late (0.9950)"
