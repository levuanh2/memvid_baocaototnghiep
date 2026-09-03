"""Provider embedding FPT + danh tính index + hàng rào chống lệch không gian vector.

Hợp đồng `/embeddings` đo thật 2026-09-04:

    POST {base}/embeddings {"model", "input": [...]}
    200 -> {"data": [{"embedding": [...1024...], "index": 0, "object": "embedding"}], ...}
    `Vietnamese_Embedding` 1024 chiều · `multilingual-e5-large` 1024 chiều

Điều nguy hiểm nhất của cả phase nằm ở đây, và nó nguy hiểm vì trông vô hại:
`BAAI/bge-m3` (model cục bộ hiện tại) và `Vietnamese_Embedding` (bản fine-tune từ
chính nó trên marketplace) **đều 1024 chiều**. Hàng rào cũ trong `_load_index` chỉ so
`idx.d`, nên đổi model xong index cũ vẫn nạp trót lọt, truy vấn vẫn chạy, và kết quả
là rác — không một dòng log nào. Đó là ca mà số chiều khớp còn ý nghĩa thì không.

Cùng lý do, chiến lược pool nằm trong danh tính: cùng bge-m3 nhưng `mean_late` và
`encode` cho hai không gian khác nhau (.playbook 2026-09-01).

File này cũng khoá một điều KHÔNG làm: lệch thì TỪ CHỐI, không xoá, không dựng lại.
Index là dữ liệu; dựng lại là quyết định của người vận hành.
"""

from __future__ import annotations

import json

import pytest

import app.clients.llm_factory as lf

KHOA_GIA = "sk-khoa-gia-chi-dung-trong-test"


@pytest.fixture(autouse=True)
def _sach(monkeypatch):
    monkeypatch.delenv("FPT_AI_EMBEDDING_MODEL", raising=False)
    monkeypatch.setenv("FPT_AI_API_KEY", "")
    # Retry ngủ thật thì mỗi ca lỗi 5xx tốn 1+2+4 giây thật. Test đo LUẬT lùi, không
    # đo đồng hồ — ca nào cần biết ngủ bao lâu thì `_bat_day` ghi lại con số.
    monkeypatch.setattr("time.sleep", lambda _s: None)
    lf.clear_embeddings_cache()
    yield
    lf.clear_embeddings_cache()


class _Resp:
    def __init__(self, status=200, body=None, text=None, headers=None):
        self.status_code = status
        self._body = body
        self.headers = headers or {}
        self.text = text if text is not None else json.dumps(body, ensure_ascii=False)

    def json(self):
        if self._body is None:
            raise ValueError("not json")
        return self._body


def _bat_post(monkeypatch, resp):
    ghi = {"lan": []}

    def _post(url, headers=None, json=None, timeout=None):
        ghi["lan"].append({"url": url, "headers": headers, "payload": json, "timeout": timeout})
        ghi.update(url=url, headers=headers, payload=json, timeout=timeout)
        if isinstance(resp, Exception):
            raise resp
        return resp(json) if callable(resp) else resp

    import requests
    monkeypatch.setattr(requests, "post", _post)
    return ghi


def _than(n, dim=4):
    return {"data": [{"embedding": [float(i)] * dim, "index": i, "object": "embedding"}
                     for i in range(n)]}


# ── Cổng bật/tắt: OPT-IN KÉP ───────────────────────────────────────────────
def test_chi_co_khoa_thi_CHUA_bat(monkeypatch):
    """Bật chat KHÔNG được kéo theo đổi không gian vector — đó là tác dụng phụ không
    ai muốn và không ai thấy."""
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    assert lf.fpt_embedding_enabled() is False


def test_chi_co_ten_model_thi_CHUA_bat(monkeypatch):
    monkeypatch.setenv("FPT_AI_EMBEDDING_MODEL", "Vietnamese_Embedding")
    assert lf.fpt_embedding_enabled() is False


def test_co_ca_hai_moi_bat(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    monkeypatch.setenv("FPT_AI_EMBEDDING_MODEL", "Vietnamese_Embedding")
    assert lf.fpt_embedding_enabled() is True


def test_chua_bat_thi_SKIP_MODEL_LOAD_van_ra_FakeEmbeddings(monkeypatch):
    monkeypatch.setenv("SKIP_MODEL_LOAD", "1")
    assert type(lf.get_embeddings()).__name__ == "FakeEmbeddings"
    assert lf.get_embedding_model() is None


def test_bat_thi_SKIP_MODEL_LOAD_KHONG_chan(monkeypatch):
    """Luật giống rerank: cờ đó nghĩa là 'đừng nạp weight', mà HTTP không nạp gì.
    Production chạy cờ này — chặn ở đây thì migrate xong vẫn vô tác dụng."""
    monkeypatch.setenv("SKIP_MODEL_LOAD", "1")
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    monkeypatch.setenv("FPT_AI_EMBEDDING_MODEL", "Vietnamese_Embedding")
    assert isinstance(lf.get_embeddings(), lf.FptEmbeddings)
    assert lf.get_embedding_model() is not None


# ── Dựng request / bóc response ────────────────────────────────────────────
def _emb(monkeypatch, model="Vietnamese_Embedding"):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    monkeypatch.setenv("FPT_AI_EMBEDDING_MODEL", model)
    monkeypatch.setenv("FPT_AI_BASE_URL", "https://vi-du.test/v1/")
    return lf.FptEmbeddings(model)


def test_embed_query_dung_request(monkeypatch):
    e = _emb(monkeypatch)
    ghi = _bat_post(monkeypatch, _Resp(body=_than(1)))
    v = e.embed_query("cau hoi")
    assert ghi["url"] == "https://vi-du.test/v1/embeddings"
    assert ghi["payload"] == {"model": "Vietnamese_Embedding", "input": ["cau hoi"]}
    assert ghi["headers"]["Authorization"] == f"Bearer {KHOA_GIA}"
    assert v == [0.0, 0.0, 0.0, 0.0]


def test_embed_documents_chia_lo(monkeypatch):
    monkeypatch.setenv("EMBED_BATCH_SIZE", "2")
    e = _emb(monkeypatch)
    ghi = _bat_post(monkeypatch, lambda p: _Resp(body=_than(len(p["input"]))))
    ra = e.embed_documents(["a", "b", "c", "d", "e"])
    assert len(ra) == 5
    assert [len(x["payload"]["input"]) for x in ghi["lan"]] == [2, 2, 1]


def test_sap_lai_theo_index_KHONG_tin_thu_tu(monkeypatch):
    """Gán vector theo `index`, không theo vị trí trong mảng. Tin thứ tự là cách lặng
    lẽ gán vector của đoạn này cho đoạn kia."""
    e = _emb(monkeypatch)
    _bat_post(monkeypatch, _Resp(body={"data": [
        {"embedding": [2.0], "index": 2},
        {"embedding": [0.0], "index": 0},
        {"embedding": [1.0], "index": 1},
    ]}))
    assert e.embed_documents(["a", "b", "c"]) == [[0.0], [1.0], [2.0]]


@pytest.mark.parametrize("resp,khop", [
    (_Resp(status=401, text="unauthorized"), "HTTP 401"),
    (_Resp(status=500, text="boom"), "HTTP 500"),
    (_Resp(body=None, text="<html>"), "không phải JSON"),
    (_Resp(body={"khong_co_data": 1}), "vector"),
    (_Resp(body={"data": [{"embedding": [1.0], "index": 0}]}), "vector"),   # thiếu 1 so với 2 input
    (_Resp(body={"data": [{"index": 0}, {"embedding": [1.0], "index": 1}]}), "thiếu `embedding`"),
    (_Resp(body={"data": [{"embedding": [1.0], "index": 0},
                          {"embedding": [1.0], "index": 5}]}), "lệch `index`"),
])
def test_moi_than_hong_deu_thanh_RuntimeError(monkeypatch, resp, khop):
    e = _emb(monkeypatch)
    _bat_post(monkeypatch, resp)
    with pytest.raises(RuntimeError, match=khop):
        e.embed_documents(["a", "b"])


def test_thieu_vector_KHONG_duoc_tra_ve_it_hon(monkeypatch):
    """Trả thiếu vector mà không kêu = chunk không có vector, index lệch ID."""
    e = _emb(monkeypatch)
    _bat_post(monkeypatch, _Resp(body=_than(2)))
    with pytest.raises(RuntimeError):
        e.embed_documents(["a", "b", "c"])


@pytest.mark.parametrize("resp", [_Resp(status=401, text="unauthorized"),
                                  _Resp(body={"khong_co_data": 1})])
def test_khoa_KHONG_lot_vao_thong_bao_loi(monkeypatch, resp):
    e = _emb(monkeypatch)
    _bat_post(monkeypatch, resp)
    with pytest.raises(RuntimeError) as ex:
        e.embed_query("a")
    assert KHOA_GIA not in str(ex.value)
    assert "Bearer" not in str(ex.value)


# ── Thử lại khi bị giới hạn tần suất / server lỗi tạm ──────────────────────
def _bat_day(monkeypatch, resps):
    """Trả lần lượt từng response trong `resps`; ghi lại số lần gọi và số giây ngủ."""
    ghi = {"goi": 0, "ngu": []}
    it = iter(resps)

    def _post(url, headers=None, json=None, timeout=None):
        ghi["goi"] += 1
        r = next(it)
        if isinstance(r, Exception):
            raise r
        return r

    import requests
    monkeypatch.setattr(requests, "post", _post)
    monkeypatch.setattr("time.sleep", lambda s: ghi["ngu"].append(s))
    return ghi


@pytest.mark.parametrize("ma", [429, 500, 502, 503])
def test_thu_lai_khi_429_va_5xx(monkeypatch, ma):
    """Dựng lại index là hàng trăm lô. Một lượt 429 giữa chừng mà bỏ cuộc thì lần
    chạy lại phải trả tiền lại từ đầu cho những lô đã xong."""
    e = _emb(monkeypatch)
    ghi = _bat_day(monkeypatch, [_Resp(status=ma, text="ban"), _Resp(body=_than(1))])
    assert e.embed_query("a") == [0.0, 0.0, 0.0, 0.0]
    assert ghi["goi"] == 2


@pytest.mark.parametrize("ma", [400, 401, 403, 404, 422])
def test_KHONG_thu_lai_loi_cua_phia_minh(monkeypatch, ma):
    """400 sai payload, 401 sai khoá, 404 sai tên model — thử lại bao nhiêu lần cũng
    thế, chỉ tốn thời gian trước khi báo đúng lỗi đó."""
    e = _emb(monkeypatch)
    ghi = _bat_day(monkeypatch, [_Resp(status=ma, text="hong")])
    with pytest.raises(RuntimeError, match=f"HTTP {ma}"):
        e.embed_query("a")
    assert ghi["goi"] == 1


def test_ton_trong_Retry_After_cua_server(monkeypatch):
    e = _emb(monkeypatch)
    ghi = _bat_day(monkeypatch, [_Resp(status=429, text="ban", headers={"Retry-After": "7"}),
                                 _Resp(body=_than(1))])
    e.embed_query("a")
    assert ghi["ngu"] == [7.0]


def test_Retry_After_bi_chan_tran(monkeypatch):
    """Server bảo chờ một giờ thì cũng không được treo một giờ."""
    monkeypatch.setenv("FPT_AI_EMBED_RETRY_MAX_WAIT", "5")
    e = _emb(monkeypatch)
    ghi = _bat_day(monkeypatch, [_Resp(status=429, headers={"Retry-After": "3600"}, text="x"),
                                 _Resp(body=_than(1))])
    e.embed_query("a")
    assert ghi["ngu"] == [5.0]


def test_khong_co_Retry_After_thi_lui_theo_luy_thua(monkeypatch):
    monkeypatch.setenv("FPT_AI_EMBED_RETRIES", "3")
    e = _emb(monkeypatch)
    ghi = _bat_day(monkeypatch, [_Resp(status=503, text="x")] * 3 + [_Resp(body=_than(1))])
    e.embed_query("a")
    assert ghi["ngu"] == [1.0, 2.0, 4.0]


def test_het_luot_thi_bao_dung_ma_loi_cuoi(monkeypatch):
    monkeypatch.setenv("FPT_AI_EMBED_RETRIES", "2")
    e = _emb(monkeypatch)
    ghi = _bat_day(monkeypatch, [_Resp(status=429, text="ban")] * 3)
    with pytest.raises(RuntimeError, match="HTTP 429"):
        e.embed_query("a")
    assert ghi["goi"] == 3, "1 lần đầu + 2 lần thử lại"


def test_loi_mang_cung_duoc_thu_lai(monkeypatch):
    e = _emb(monkeypatch)
    ghi = _bat_day(monkeypatch, [TimeoutError("het gio"), _Resp(body=_than(1))])
    e.embed_query("a")
    assert ghi["goi"] == 2


def test_loi_mang_het_luot_thanh_RuntimeError_khong_lo_khoa(monkeypatch):
    monkeypatch.setenv("FPT_AI_EMBED_RETRIES", "1")
    e = _emb(monkeypatch)
    _bat_day(monkeypatch, [TimeoutError("het gio")] * 2)
    with pytest.raises(RuntimeError) as ex:
        e.embed_query("a")
    assert "TimeoutError" in str(ex.value)
    assert KHOA_GIA not in str(ex.value)


def test_tat_retry_duoc(monkeypatch):
    monkeypatch.setenv("FPT_AI_EMBED_RETRIES", "0")
    e = _emb(monkeypatch)
    ghi = _bat_day(monkeypatch, [_Resp(status=429, text="ban")])
    with pytest.raises(RuntimeError, match="HTTP 429"):
        e.embed_query("a")
    assert ghi["goi"] == 1 and ghi["ngu"] == []


# ── Danh tính không gian vector ────────────────────────────────────────────
def test_danh_tinh_fpt(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    monkeypatch.setenv("FPT_AI_EMBEDDING_MODEL", "Vietnamese_Embedding")
    assert lf.embedding_identity() == {
        "embedding_provider": "fpt",
        "embedding_model_name": "Vietnamese_Embedding",
        "embedding_strategy": "api_pooled",
    }


def test_danh_tinh_ghi_ro_KHONG_phai_late_chunking(monkeypatch):
    """Late chunking cần hidden state MỨC TOKEN để mean-pool theo span; API chỉ trả
    vector đã pool. Không thể làm qua HTTP — nên chiến lược phải mang tên khác, và
    khác tên nghĩa là index cũ bị từ chối thay vì dùng nhầm."""
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    monkeypatch.setenv("FPT_AI_EMBEDDING_MODEL", "Vietnamese_Embedding")
    monkeypatch.setenv("LATE_CHUNKING", "1")
    assert lf.embedding_identity()["embedding_strategy"] == "api_pooled"


def test_danh_tinh_khi_skip_model_load(monkeypatch):
    monkeypatch.setenv("SKIP_MODEL_LOAD", "1")
    d = lf.embedding_identity()
    assert d["embedding_provider"] == "fake"


def test_danh_tinh_local_encode(monkeypatch):
    monkeypatch.setenv("SKIP_MODEL_LOAD", "0")
    monkeypatch.setenv("LATE_CHUNKING", "0")
    monkeypatch.setenv("EMBEDDING_MODEL_NAME", "BAAI/bge-m3")
    assert lf.embedding_identity() == {
        "embedding_provider": "local",
        "embedding_model_name": "BAAI/bge-m3",
        "embedding_strategy": "encode",
    }


# ── Hàng rào index ─────────────────────────────────────────────────────────
def _meta(**m):
    return {"__meta__": m, "0": {"source_stem": "x"}}


def test_hop_le_khi_khop(monkeypatch):
    from app.domains.vectorstore import store as st

    monkeypatch.setenv("SKIP_MODEL_LOAD", "0")
    monkeypatch.setenv("LATE_CHUNKING", "0")
    monkeypatch.setenv("EMBEDDING_MODEL_NAME", "BAAI/bge-m3")
    assert st.check_index_identity(_meta(
        embedding_provider="local", embedding_model_name="BAAI/bge-m3",
        embedding_strategy="encode")) is None


def test_BAT_duoc_ca_cung_so_chieu_khac_model(monkeypatch):
    """Ca nguy hiểm nhất: bge-m3 và Vietnamese_Embedding ĐỀU 1024 chiều."""
    from app.domains.vectorstore import store as st

    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    monkeypatch.setenv("FPT_AI_EMBEDDING_MODEL", "Vietnamese_Embedding")
    lech = st.check_index_identity(_meta(
        version="1.1", embedding_model_name="BAAI/bge-m3", embedding_dim=1024,
        pooling="mean_late"))
    assert lech is not None
    assert "BAAI/bge-m3" in lech and "Vietnamese_Embedding" in lech


def test_BAT_duoc_doi_chien_luoc_du_cung_model(monkeypatch):
    from app.domains.vectorstore import store as st

    monkeypatch.setenv("SKIP_MODEL_LOAD", "0")
    monkeypatch.setenv("LATE_CHUNKING", "0")
    monkeypatch.setenv("EMBEDDING_MODEL_NAME", "BAAI/bge-m3")
    lech = st.check_index_identity(_meta(
        embedding_provider="local", embedding_model_name="BAAI/bge-m3",
        embedding_strategy="mean_late"))
    assert lech is not None and "strategy" in lech


def test_index_cu_khong_danh_tinh_van_bi_chan_khi_dung_fpt(monkeypatch):
    """Thiếu metadata KHÔNG được mặc nhiên coi là tương thích.

    Index 1.0 không ghi gì để so, nhưng vẫn kết luận được một điều chắc chắn:
    provider `fpt` chưa tồn tại trong mã cho tới hôm nay, nên index ấy không thể do
    nó dựng. Đây là suy luận, không phải phỏng đoán."""
    from app.domains.vectorstore import store as st

    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    monkeypatch.setenv("FPT_AI_EMBEDDING_MODEL", "Vietnamese_Embedding")
    for m in (_meta(version="1.0", num_chunks=5), {}):
        lech = st.check_index_identity(m)
        assert lech is not None and "fpt" in lech


def test_index_cu_khong_danh_tinh_van_cho_qua_voi_provider_cuc_bo(monkeypatch):
    """Không có thông tin để so, và chặn hết thì mọi cài đặt cũ chết oan."""
    from app.domains.vectorstore import store as st

    monkeypatch.setenv("SKIP_MODEL_LOAD", "0")
    monkeypatch.setenv("LATE_CHUNKING", "0")
    monkeypatch.setenv("EMBEDDING_MODEL_NAME", "BAAI/bge-m3")
    assert st.check_index_identity(_meta(version="1.0", num_chunks=5)) is None
    assert st.check_index_identity({}) is None


def test_cache_vectorstore_KHONG_song_sot_qua_doi_danh_tinh(monkeypatch, tmp_path):
    """Khoá cache phải mang danh tính, nếu không cache trả lời trước và hàng rào
    không bao giờ chạy."""
    from app.domains.vectorstore import store as st

    (tmp_path / "index.faiss").write_bytes(b"x")
    (tmp_path / "index.pkl").write_bytes(b"y")
    monkeypatch.setattr(st, "INDEX_DIR", tmp_path)
    monkeypatch.setenv("SKIP_MODEL_LOAD", "0")
    monkeypatch.setenv("LATE_CHUNKING", "0")
    monkeypatch.setenv("EMBEDDING_MODEL_NAME", "BAAI/bge-m3")
    k1 = st._vs_cache_key()
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    monkeypatch.setenv("FPT_AI_EMBEDDING_MODEL", "Vietnamese_Embedding")
    assert st._vs_cache_key() != k1


def test_chi_so_khoa_thuc_su_co(monkeypatch):
    """Index 1.1 chỉ có `embedding_model_name`; thiếu provider/strategy không tính là
    lệch — riêng tên model đã đủ bắt ca nguy hiểm."""
    from app.domains.vectorstore import store as st

    monkeypatch.setenv("SKIP_MODEL_LOAD", "0")
    monkeypatch.setenv("LATE_CHUNKING", "0")
    monkeypatch.setenv("EMBEDDING_MODEL_NAME", "BAAI/bge-m3")
    assert st.check_index_identity(_meta(
        version="1.1", embedding_model_name="BAAI/bge-m3", embedding_dim=1024)) is None


def test_lech_thi_KHONG_xoa_file_nao(monkeypatch, tmp_path):
    """Từ chối, không dựng lại. Index là dữ liệu; dựng lại là quyết định của người
    vận hành, không phải tác dụng phụ của một lần khởi động."""
    from app.domains.vectorstore import store as st

    gia = tmp_path / "index.faiss"
    gia.write_bytes(b"khong-phai-index-that")
    monkeypatch.setattr(st, "INDEX_DIR", tmp_path)
    monkeypatch.setenv("SKIP_MODEL_LOAD", "0")
    monkeypatch.setattr(st, "check_index_identity", lambda *a, **k: "provider: khac")

    def _no(*a, **k):
        raise AssertionError("không được nạp index lệch")

    monkeypatch.setattr(st.FAISS, "load_local", _no)
    assert st.load_vectorstore(use_cache=False) is None
    assert gia.exists(), "index KHÔNG được xoá"


def test_append_lech_thi_nem_chu_khong_tron_hai_khong_gian(monkeypatch):
    from app.domains.vectorstore import store as st

    assert issubclass(st.IndexIdentityMismatch, RuntimeError)
