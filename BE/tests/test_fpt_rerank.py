"""Backend rerank FPT — `RERANK_BACKEND=fpt`.

Hợp đồng `/rerank` được đo thật ngày 2026-09-04, không chép từ tài liệu:

    POST {base}/rerank {"model", "query", "documents", "top_n"}
    200 -> {"results": [{"index", "relevance_score", "document"}], "object": "rerank"}

Ba thứ file này khoá, vì mỗi thứ đã từng hỏng ở một tích hợp provider trước đó:

1. `results` ánh xạ ngược về `texts` bằng **index**, không bằng `document` (trường ấy
   là null trừ khi gửi `return_documents`). Đọc nhầm trường = đưa sai đoạn văn vào
   ngữ cảnh LLM mà không có lỗi nào nổ ra.
2. `SKIP_MODEL_LOAD=1` KHÔNG được tắt backend từ xa. Cờ đó nghĩa là "đừng nạp weight",
   và production đang chạy nó — nếu nó tắt luôn rerank thì migrate xong vẫn không có
   tầng rerank nào chạy.
3. Mọi thân response hỏng đều thành `RuntimeError` để `rerank_texts` giữ nguyên thứ tự.
   Không nhánh nào được trả rỗng im lặng — rerank hỏng phải làm truy hồi kém đi, không
   được làm nó vỡ, và cũng không được giả vờ là đã chạy.
"""

from __future__ import annotations

import json

import pytest

import app.domains.retrieval.rerank as rk
import shared.config as cfg

KHOA_GIA = "sk-khoa-gia-chi-dung-trong-test"


def _nap_lai(monkeypatch, **env):
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    cfg.reload()
    rk.reset_cache()


class _Resp:
    """Đủ giống `requests.Response` cho đường mã đang thử."""

    def __init__(self, status=200, body=None, text=None):
        self.status_code = status
        self._body = body
        self.text = text if text is not None else json.dumps(body, ensure_ascii=False)

    def json(self):
        if self._body is None:
            raise ValueError("not json")
        return self._body


def _bat_post(monkeypatch, resp):
    """Chặn `requests.post`, ghi lại lời gọi. Trả về dict đã ghi."""
    ghi = {}

    def _post(url, headers=None, json=None, timeout=None):
        ghi.update(url=url, headers=headers, payload=json, timeout=timeout)
        if isinstance(resp, Exception):
            raise resp
        return resp

    import requests
    monkeypatch.setattr(requests, "post", _post)
    return ghi


# ── Chọn backend ───────────────────────────────────────────────────────────
def test_backend_fpt_duoc_chon(monkeypatch):
    _nap_lai(monkeypatch, RERANK_ENABLED="1", RERANK_BACKEND="fpt", SKIP_MODEL_LOAD="0")
    assert isinstance(rk.get_reranker(), rk.FptReranker)


def test_skip_model_load_KHONG_tat_backend_tu_xa(monkeypatch):
    """Luật quan trọng nhất của phase này: production chạy SKIP_MODEL_LOAD=1."""
    _nap_lai(monkeypatch, RERANK_ENABLED="1", RERANK_BACKEND="fpt", SKIP_MODEL_LOAD="1")
    assert isinstance(rk.get_reranker(), rk.FptReranker)


def test_skip_model_load_VAN_tat_backend_cuc_bo(monkeypatch):
    """Hành vi cũ giữ nguyên — cross_encoder vẫn nạp weight nên vẫn bị cờ chặn."""
    _nap_lai(monkeypatch, RERANK_ENABLED="1", RERANK_BACKEND="cross_encoder",
             SKIP_MODEL_LOAD="1")
    assert isinstance(rk.get_reranker(), rk.IdentityReranker)


def test_rerank_tat_van_thang_backend_fpt(monkeypatch):
    _nap_lai(monkeypatch, RERANK_ENABLED="0", RERANK_BACKEND="fpt", SKIP_MODEL_LOAD="0")
    assert isinstance(rk.get_reranker(), rk.IdentityReranker)


def test_model_mac_dinh_va_ghi_de(monkeypatch):
    monkeypatch.delenv("FPT_AI_RERANK_MODEL", raising=False)
    _nap_lai(monkeypatch, RERANK_ENABLED="1", RERANK_BACKEND="fpt", SKIP_MODEL_LOAD="0")
    assert rk.get_reranker().model_name == "bge-reranker-v2-m3"

    _nap_lai(monkeypatch, RERANK_ENABLED="1", RERANK_BACKEND="fpt", SKIP_MODEL_LOAD="0",
             FPT_AI_RERANK_MODEL="model-khac")
    assert rk.get_reranker().model_name == "model-khac"


def test_ten_model_KHAC_ten_huggingface(monkeypatch):
    """`RERANK_MODEL` là tên HuggingFace ('BAAI/bge-reranker-v2-m3'); marketplace dùng
    tên trần. Dùng nhầm biến thì FPT trả 404 model."""
    monkeypatch.delenv("FPT_AI_RERANK_MODEL", raising=False)
    _nap_lai(monkeypatch, RERANK_ENABLED="1", RERANK_BACKEND="fpt", SKIP_MODEL_LOAD="0",
             RERANK_MODEL="BAAI/bge-reranker-v2-m3")
    assert "/" not in rk.get_reranker().model_name


# ── Dựng request ───────────────────────────────────────────────────────────
def test_request_dung_hinh_dang(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    monkeypatch.setenv("FPT_AI_BASE_URL", "https://vi-du.test/v1/")
    ghi = _bat_post(monkeypatch, _Resp(body={"results": [{"index": 0, "relevance_score": 1.0}]}))

    rk.FptReranker("m1").rerank("cau hoi", ["a", "b", "c"], top_n=2)

    assert ghi["url"] == "https://vi-du.test/v1/rerank", "dấu / cuối phải được cắt"
    assert ghi["payload"] == {"model": "m1", "query": "cau hoi",
                              "documents": ["a", "b", "c"], "top_n": 2}
    assert ghi["headers"]["Authorization"] == f"Bearer {KHOA_GIA}"
    assert ghi["timeout"] == cfg.get_settings().rerank_timeout_sec


def test_top_n_rong_thi_gui_ca_danh_sach(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    ghi = _bat_post(monkeypatch, _Resp(body={"results": []}))
    rk.FptReranker("m").rerank("q", ["a", "b", "c"], top_n=None)
    assert ghi["payload"]["top_n"] == 3


def test_texts_rong_KHONG_goi_mang(monkeypatch):
    def _no(*a, **k):
        raise AssertionError("không được gọi HTTP khi không có ứng viên nào")

    import requests
    monkeypatch.setattr(requests, "post", _no)
    assert rk.FptReranker("m").rerank("q", []) == []


def test_thieu_khoa_thi_nem_truoc_khi_goi_mang(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", "")

    def _no(*a, **k):
        raise AssertionError("không được gọi HTTP khi chưa có khoá")

    import requests
    monkeypatch.setattr(requests, "post", _no)
    with pytest.raises(RuntimeError, match="FPT_AI_API_KEY"):
        rk.FptReranker("m").rerank("q", ["a"])


# ── Bóc response ───────────────────────────────────────────────────────────
def test_boc_hinh_dang_phang(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    _bat_post(monkeypatch, _Resp(body={"results": [
        {"index": 1, "relevance_score": 0.9381, "document": None},
        {"index": 0, "relevance_score": 0.0, "document": None},
    ]}))
    ra = rk.FptReranker("m").rerank("q", ["kem", "tot"])
    assert ra == [(1, 0.9381), (0, 0.0)]


def test_boc_ca_hinh_dang_boc_trong_data(monkeypatch):
    """Marketplace không đồng nhất giữa các model — chat đã dính một lần rồi."""
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    _bat_post(monkeypatch, _Resp(body={"data": {"results": [{"index": 0, "relevance_score": 0.5}]}}))
    assert rk.FptReranker("m").rerank("q", ["a"]) == [(0, 0.5)]


def test_giu_thu_tu_server_tra_ve(monkeypatch):
    """Server sắp giảm dần; tầng này KHÔNG sắp lại và cũng không được đảo lộn."""
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    _bat_post(monkeypatch, _Resp(body={"results": [
        {"index": 2, "relevance_score": 0.9},
        {"index": 0, "relevance_score": 0.4},
        {"index": 1, "relevance_score": 0.1},
    ]}))
    assert [i for i, _ in rk.FptReranker("m").rerank("q", ["a", "b", "c"])] == [2, 0, 1]


def test_cat_theo_top_n_ke_ca_khi_server_tra_du(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    _bat_post(monkeypatch, _Resp(body={"results": [
        {"index": 0, "relevance_score": 0.9},
        {"index": 1, "relevance_score": 0.8},
        {"index": 2, "relevance_score": 0.7},
    ]}))
    assert len(rk.FptReranker("m").rerank("q", ["a", "b", "c"], top_n=2)) == 2


def test_thieu_relevance_score_thi_ve_0_khong_no(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    _bat_post(monkeypatch, _Resp(body={"results": [{"index": 0}]}))
    assert rk.FptReranker("m").rerank("q", ["a"]) == [(0, 0.0)]


# ── Lỗi ────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("resp,khop", [
    (_Resp(status=401, text="unauthorized"), "HTTP 401"),
    (_Resp(status=500, text="boom"), "HTTP 500"),
    (_Resp(body=None, text="<html>"), "không phải JSON"),
    (_Resp(body={"khong_co_results": 1}), "thiếu `results`"),
    (_Resp(body={"results": "khong-phai-list"}), "thiếu `results`"),
    (_Resp(body={"results": [{"relevance_score": 1.0}]}), "thiếu `index`"),
    (_Resp(body={"results": [{"index": 99, "relevance_score": 1.0}]}), "ngoài khoảng"),
    (_Resp(body={"results": [{"index": -1, "relevance_score": 1.0}]}), "ngoài khoảng"),
])
def test_moi_than_hong_deu_thanh_RuntimeError(monkeypatch, resp, khop):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    _bat_post(monkeypatch, resp)
    with pytest.raises(RuntimeError, match=khop):
        rk.FptReranker("m").rerank("q", ["a", "b"])


def test_loi_mang_thanh_RuntimeError(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    _bat_post(monkeypatch, TimeoutError("het gio"))
    with pytest.raises(RuntimeError, match="TimeoutError"):
        rk.FptReranker("m").rerank("q", ["a"])


@pytest.mark.parametrize("resp", [
    _Resp(status=401, text="unauthorized"),
    _Resp(body={"khong_co_results": 1}),
    _Resp(body={"results": [{"index": 99}]}),
])
def test_khoa_KHONG_lot_vao_thong_bao_loi(monkeypatch, resp):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    _bat_post(monkeypatch, resp)
    with pytest.raises(RuntimeError) as e:
        rk.FptReranker("m").rerank("q", ["a"])
    assert KHOA_GIA not in str(e.value)
    assert "Bearer" not in str(e.value)


def test_loi_fpt_khong_lam_vo_truy_hoi(monkeypatch):
    """`rerank_texts` phải nuốt và giữ nguyên thứ tự — hợp đồng có sẵn, không đổi."""
    _nap_lai(monkeypatch, RERANK_ENABLED="1", RERANK_BACKEND="fpt", SKIP_MODEL_LOAD="1")
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    _bat_post(monkeypatch, _Resp(status=503, text="down"))
    assert rk.rerank_texts("q", ["a", "b", "c"], top_n=2) == [(0, 0.0), (1, 0.0)]


def test_KHONG_nap_CrossEncoder_khi_backend_la_fpt(monkeypatch):
    """Lý do đổi sang FPT là để KHỎI nạp 568M tham số vào một tiến trình 512MB. Nếu
    đường fpt vẫn chạm `sentence_transformers.CrossEncoder` thì việc migrate không
    những vô ích mà còn tệ hơn: trả tiền API xong vẫn OOM.

    Bắt ở chỗ nhập khẩu, không ở chỗ gọi — `CrossEncoder` nạp weight ngay trong hàm
    dựng, nên chạm tới nó là đã trả giá rồi."""
    import sentence_transformers

    def _no(*a, **k):
        raise AssertionError("backend fpt không được nạp CrossEncoder cục bộ")

    monkeypatch.setattr(sentence_transformers, "CrossEncoder", _no)
    _nap_lai(monkeypatch, RERANK_ENABLED="1", RERANK_BACKEND="fpt", SKIP_MODEL_LOAD="1")
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)

    r = rk.get_reranker()
    assert isinstance(r, rk.FptReranker)
    rk.warmup()
    _bat_post(monkeypatch, _Resp(body={"results": [{"index": 0, "relevance_score": 1.0}]}))
    assert r.rerank("q", ["a"]) == [(0, 1.0)]


def test_cau_hinh_production_dung_nhu_da_dat_tren_render(monkeypatch):
    """Khoá đúng cặp env đang đặt ở production. Đổi tên biến ở một phía mà quên phía
    kia thì rerank âm thầm về Identity — hỏng đúng kiểu không ai thấy."""
    _nap_lai(monkeypatch, RERANK_ENABLED="1", RERANK_BACKEND="fpt", SKIP_MODEL_LOAD="1",
             FPT_AI_RERANK_MODEL="bge-reranker-v2-m3")
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    r = rk.get_reranker()
    assert isinstance(r, rk.FptReranker)
    assert r.model_name == "bge-reranker-v2-m3"


def test_warmup_khong_lam_gi_voi_backend_tu_xa(monkeypatch):
    """Không có weight để nạp; warmup phải là no-op chứ không được ném."""
    _nap_lai(monkeypatch, RERANK_ENABLED="1", RERANK_BACKEND="fpt", SKIP_MODEL_LOAD="0")
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)

    def _no(*a, **k):
        raise AssertionError("warmup không được gọi mạng")

    import requests
    monkeypatch.setattr(requests, "post", _no)
    rk.warmup()
