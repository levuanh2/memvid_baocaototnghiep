"""Lỗi NHÀ CUNG CẤP embedding không phải lỗi CHỈ MỤC.

Production 2026-09-05: khoá FPT sai, `/query` trả về cho người dùng

    "Chỉ mục tài liệu đang không tương thích với embedding model hiện tại.
     Vui lòng rebuild index hoặc upload lại tài liệu."

Sai, và sai đắt: nó đẩy người đọc đi dựng lại một index hoàn toàn lành lặn — vài nghìn
lượt gọi embedding trả tiền — trong khi việc cần làm là sửa một biến môi trường.

Nguyên nhân là một phép dò chuỗi: `if "embedding" in err_str.lower()`. Chuỗi
`"FPT embeddings HTTP 401"` có chữ "embedding". Nay phân loại bằng KIỂU.
"""

from __future__ import annotations

import json

import pytest

from app.clients import llm_factory as lf
from app.domains.vectorstore import store as vs
from app.graphs import query_graph as qg
from shared.interfaces import errors as loi

KHOA_GIA = "sk-khoa-gia-chi-dung-trong-test"


class _Resp:
    """Phản hồi HTTP giả, đúng những thuộc tính mà `_goi` đọc."""

    def __init__(self, status_code: int, text: str = "", body=None):
        self.status_code = status_code
        self.text = text
        self.headers = {}
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("không phải JSON")
        return self._body


def _emb(monkeypatch, resp=None, nem=None, so_lan_thu="0"):
    """`FptEmbeddings` với tầng HTTP bị thay. `so_lan_thu=0` để test chạy nhanh —
    hành vi retry có test riêng ở `test_fpt_embedding.py`, ở đây đo PHÂN LOẠI."""
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    monkeypatch.setenv("FPT_AI_EMBED_RETRIES", so_lan_thu)
    e = lf.FptEmbeddings("Vietnamese_Embedding")

    def gia(texts):
        if nem is not None:
            raise nem
        return resp

    monkeypatch.setattr(e, "_goi_mot_lan", gia)
    return e


# ── A, B: xác thực hỏng → KHÔNG phải lỗi chỉ mục ──────────────────────────
@pytest.mark.parametrize("ma_http", [401, 403])
def test_xac_thuc_hong_thi_ra_AUTH_FAILED(monkeypatch, ma_http):
    e = _emb(monkeypatch, resp=_Resp(ma_http, '{"description":"Invalid API Key"}'))
    with pytest.raises(loi.EmbeddingProviderAuthFailed) as ex:
        e.embed_query("câu hỏi")
    assert loi.ma_loi(ex.value) == loi.EMBEDDING_PROVIDER_AUTH_FAILED
    assert loi.ma_loi(ex.value) != loi.INDEX_INCOMPATIBLE


def test_401_KHONG_kem_than_phan_hoi(monkeypatch):
    """Thân phản hồi của tầng xác thực là chỗ dễ lọt thông tin nhạy cảm nhất."""
    e = _emb(monkeypatch, resp=_Resp(401, '{"apikey":"sk-that-khong-duoc-lo"}'))
    with pytest.raises(loi.EmbeddingProviderAuthFailed) as ex:
        e.embed_query("q")
    assert "sk-that-khong-duoc-lo" not in str(ex.value)
    assert "apikey" not in str(ex.value)


# ── C, D, E: không gọi tới nơi / bên kia bảo thử lại sau ──────────────────
@pytest.mark.parametrize("ma_http", [429, 500, 502, 503])
def test_qua_tai_va_5xx_thi_ra_UNAVAILABLE(monkeypatch, ma_http):
    e = _emb(monkeypatch, resp=_Resp(ma_http, "server busy"))
    with pytest.raises(loi.EmbeddingProviderUnavailable) as ex:
        e.embed_query("q")
    assert loi.ma_loi(ex.value) == loi.EMBEDDING_PROVIDER_UNAVAILABLE


@pytest.mark.parametrize("loi_mang", [
    TimeoutError("hết giờ"),
    ConnectionError("đứt kết nối"),
    OSError("DNS hỏng"),
])
def test_khong_goi_toi_noi_thi_ra_UNAVAILABLE(monkeypatch, loi_mang):
    e = _emb(monkeypatch, nem=loi_mang)
    with pytest.raises(loi.EmbeddingProviderUnavailable) as ex:
        e.embed_query("q")
    assert loi.ma_loi(ex.value) == loi.EMBEDDING_PROVIDER_UNAVAILABLE


def test_loi_mang_KHONG_kem_chuoi_goc(monkeypatch):
    """Chuỗi lỗi của `requests` hay mang cả URL kèm tham số."""
    e = _emb(monkeypatch, nem=ConnectionError(
        "HTTPSConnectionPool(host='mkp-api...', port=443): token=bi-mat"))
    with pytest.raises(loi.EmbeddingProviderUnavailable) as ex:
        e.embed_query("q")
    assert "bi-mat" not in str(ex.value)


# ── Lỗi ngữ nghĩa: tới nơi nhưng yêu cầu sai ──────────────────────────────
@pytest.mark.parametrize("ma_http", [400, 404, 422])
def test_4xx_khac_thi_ra_REQUEST_FAILED(monkeypatch, ma_http):
    e = _emb(monkeypatch, resp=_Resp(ma_http, "model not found"))
    with pytest.raises(loi.EmbeddingRequestFailed) as ex:
        e.embed_query("q")
    assert loi.ma_loi(ex.value) == loi.EMBEDDING_REQUEST_FAILED
    assert "model not found" in str(ex.value), "giữ lại thông điệp upstream hữu ích"


def test_than_khong_phai_json_thi_ra_REQUEST_FAILED(monkeypatch):
    e = _emb(monkeypatch, resp=_Resp(200, "<html>502 bad gateway</html>"))
    with pytest.raises(loi.EmbeddingRequestFailed):
        e.embed_query("q")


def test_so_vector_khong_khop_thi_ra_REQUEST_FAILED(monkeypatch):
    e = _emb(monkeypatch, resp=_Resp(200, "", {"data": [{"embedding": [0.1], "index": 0}]}))
    with pytest.raises(loi.EmbeddingRequestFailed):
        e.embed_documents(["a", "b"])


# ── H: đường thành công KHÔNG đổi ─────────────────────────────────────────
def test_duong_thanh_cong_giu_nguyen(monkeypatch):
    """Ràng buộc cứng của phase: query/upload đang chạy được phải chạy y như cũ."""
    than = {"data": [{"embedding": [0.1, 0.2, 0.3], "index": 0}]}
    e = _emb(monkeypatch, resp=_Resp(200, "", than))
    assert e.embed_query("câu hỏi") == [0.1, 0.2, 0.3]


# ── F, G: lỗi phía chỉ mục vẫn là lỗi chỉ mục ─────────────────────────────
def test_danh_tinh_lech_thi_ra_INDEX_INCOMPATIBLE():
    assert qg._phan_loai_loi(vs.IndexIdentityMismatch("fpt != local")) == loi.INDEX_INCOMPATIBLE


def test_thieu_index_thi_ra_INDEX_MISSING():
    assert qg._phan_loai_loi(vs.IndexMissing("chưa dựng")) == loi.INDEX_MISSING


def test_loi_hinh_dang_that_van_la_INDEX_INCOMPATIBLE():
    """numpy/FAISS ném khi vector truy vấn không khớp số chiều index — lỗi chỉ mục THẬT."""
    assert qg._phan_loai_loi(
        ValueError("shapes (1,384) and (1024,) not aligned")) == loi.INDEX_INCOMPATIBLE


def test_loi_la_thi_KHONG_doan_bua():
    """Không phân loại được thì trả None, chứ không gán đại một lớp."""
    assert qg._phan_loai_loi(RuntimeError("cái gì đó")) is None


# ── I: thông điệp 401 KHÔNG được khuyên dựng lại index ────────────────────
@pytest.mark.parametrize("ma", [
    loi.EMBEDDING_PROVIDER_AUTH_FAILED,
    loi.EMBEDDING_PROVIDER_UNAVAILABLE,
    loi.EMBEDDING_REQUEST_FAILED,
])
def test_loi_nha_cung_cap_KHONG_khuyen_rebuild(ma):
    van = loi.thong_diep(ma).lower()
    assert "rebuild" not in van
    assert "upload lại tài liệu" not in van
    assert "không tương thích" not in van


def test_chi_INDEX_INCOMPATIBLE_moi_duoc_khuyen_rebuild():
    van = loi.thong_diep(loi.INDEX_INCOMPATIBLE).lower()
    assert "rebuild index" in van and "upload lại tài liệu" in van
    khac = [m for m in loi.THONG_DIEP if m != loi.INDEX_INCOMPATIBLE]
    assert all("rebuild" not in loi.thong_diep(m).lower() for m in khac)


# ── Ranh giới truy hồi: 401 đi hết đường tới payload API ──────────────────
def _node(ten: str, **bien_dong):
    """Lấy node lồng trong `build_query_graph` ra chạy thật, cấp closure bằng tay."""
    import types

    for c in qg.build_query_graph.__code__.co_consts:
        if getattr(c, "co_name", "") != ten:
            continue
        o = tuple(types.CellType(bien_dong.get(t, lambda *a, **k: None))
                  for t in c.co_freevars)
        return types.FunctionType(c, qg.__dict__, closure=o)
    pytest.skip(f"không tìm thấy {ten}")


def test_401_di_het_duong_toi_payload_API(monkeypatch):
    """Test hồi quy cho ĐÚNG lỗi production: khoá sai -> người dùng phải thấy thông
    điệp xác thực, KHÔNG phải lời khuyên dựng lại index."""
    monkeypatch.setattr(qg, "log_node_event", lambda *a, **k: None)
    xu_ly = _node("error_handler_node", _set_job=lambda *a, **k: None)

    ra = xu_ly({"job_id": "j",
                "error": "dịch vụ embedding từ chối xác thực (HTTP 401)",
                "error_code": loi.EMBEDDING_PROVIDER_AUTH_FAILED})

    assert ra["status_code"] == 500
    assert ra["payload"]["code"] == loi.EMBEDDING_PROVIDER_AUTH_FAILED
    van = ra["payload"]["error"]
    assert "xác thực" in van
    assert "rebuild" not in van.lower()
    assert "upload lại tài liệu" not in van.lower()


def test_lech_danh_tinh_VAN_khuyen_rebuild(monkeypatch):
    """Chiều ngược: lời khuyên dựng lại index phải còn nguyên cho đúng lớp lỗi của nó."""
    monkeypatch.setattr(qg, "log_node_event", lambda *a, **k: None)
    xu_ly = _node("error_handler_node", _set_job=lambda *a, **k: None)

    ra = xu_ly({"job_id": "j", "error": "identity mismatch",
                "error_code": loi.INDEX_INCOMPATIBLE})
    assert ra["payload"]["code"] == loi.INDEX_INCOMPATIBLE
    assert "rebuild index" in ra["payload"]["error"].lower()


def test_khong_co_ma_thi_giu_nguyen_hop_dong_cu(monkeypatch):
    """Tương thích ngược: lỗi chưa phân loại vẫn trả `error` như trước, không thêm
    `code` rỗng để client cũ khỏi phải đoán."""
    monkeypatch.setattr(qg, "log_node_event", lambda *a, **k: None)
    xu_ly = _node("error_handler_node", _set_job=lambda *a, **k: None)

    ra = xu_ly({"job_id": "j", "error": "cái gì đó", "error_code": None})
    assert ra["payload"] == {"error": "cái gì đó"}
    assert "code" not in ra["payload"]


# ── J: không rò bí mật ────────────────────────────────────────────────────
def test_payload_loi_khong_mang_bi_mat(monkeypatch):
    monkeypatch.setattr(qg, "log_node_event", lambda *a, **k: None)
    xu_ly = _node("error_handler_node", _set_job=lambda *a, **k: None)
    ra = xu_ly({"job_id": "j", "error": f"Bearer {KHOA_GIA}",
                "error_code": loi.EMBEDDING_PROVIDER_AUTH_FAILED})
    van = json.dumps(ra["payload"], ensure_ascii=False)
    assert KHOA_GIA not in van and "Bearer" not in van


def test_query_graph_KHONG_con_do_chuoi_de_phan_loai():
    """Cấu trúc: chuỗi "embedding" không được quay lại làm điều kiện phân loại.

    Đọc bằng AST, bỏ docstring ra. Bản đầu của chính test này quét văn bản và tự đỏ vì
    docstring của hàm có nhắc chữ ấy — đúng cái bẫy nó đi bắt, lần thứ ba trong kho này
    (xem `test_dry_run_KHONG_goi_embedding`, `test_KHONG_tu_chay_o_dau_ca`).
    """
    import ast
    import inspect
    import textwrap

    cay = ast.parse(textwrap.dedent(inspect.getsource(qg._phan_loai_loi)))
    ham = cay.body[0]
    than = ham.body[1:] if (ham.body and isinstance(ham.body[0], ast.Expr)
                            and isinstance(ham.body[0].value, ast.Constant)) else ham.body

    hang = [n.value for th in than for n in ast.walk(th)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)]
    assert not [h for h in hang if "embedding" in h.lower()], hang
