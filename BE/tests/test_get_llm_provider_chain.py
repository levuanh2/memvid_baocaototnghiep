"""`get_llm()` đi theo `PROVIDERS`, và client FPT biết stream.

Trước phase này `get_llm()` hardcode Ollama. Production đặt `OLLAMA_HOST=""`, nên năm
đường đi qua nó đều trỏ vào hư không — trong đó có bộ sinh câu trả lời RAG của
`/query`. Quiz vẫn chạy vì nó dùng `ask_ai`. Cùng một ứng dụng, hai kết cục, và không
có lỗi nào ở tầng cấu hình để nhìn ra.

File này khoá bốn điều:

1. Thứ tự chọn provider của `get_llm` GIỐNG `ask_ai` — một nguồn sự thật, không hai.
2. Không có khoá từ xa nào thì kết quả y hệt trước: Ollama.
3. Stream chỉ lấy `delta.content`. `gpt-oss-120b` phát cả `delta.reasoning_content`;
   trộn vào thì phần suy luận tiếng Anh chảy thẳng vào câu trả lời người dùng đọc.
4. `.invoke()` nhận cả MỘT CHUỖI trần — `llm_cache` gọi kiểu đó. Duyệt chuỗi như
   danh sách message thì mỗi ký tự thành một message, không lỗi, chỉ vô nghĩa.
"""

from __future__ import annotations

import importlib
import json

import pytest

KHOA_GIA = "sk-khoa-gia-chi-dung-trong-test"


def _nap(monkeypatch, **env):
    """Nạp lại llm_factory với env cho trước — `PROVIDERS` dựng lúc import."""
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    import app.clients.llm_factory as lf
    return importlib.reload(lf)


@pytest.fixture()
def sach(monkeypatch):
    for k in ("FPT_AI_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "OLLAMA_HOST"):
        monkeypatch.setenv(k, "")
    yield
    import app.clients.llm_factory as lf
    importlib.reload(lf)


# ── Chọn provider ──────────────────────────────────────────────────────────
def test_khong_co_khoa_tu_xa_thi_van_la_ollama(sach, monkeypatch):
    """Điều kiện của cả phase: chưa cấu hình FPT thì hành vi không đổi."""
    lf = _nap(monkeypatch)
    assert lf.PROVIDERS == ["ollama"]
    llm = lf.get_llm("chat")
    assert type(llm).__name__ == "ChatOllama"


def test_co_khoa_fpt_thi_get_llm_tra_ve_client_fpt(sach, monkeypatch):
    lf = _nap(monkeypatch, FPT_AI_API_KEY=KHOA_GIA)
    assert lf.PROVIDERS[0] == "fpt"
    assert isinstance(lf.get_llm("chat"), lf._FptChatLLM)


def test_thu_tu_giong_het_ask_ai(sach, monkeypatch):
    """`get_llm` và `ask_ai` phải trả lời CÙNG một câu hỏi 'provider nào'."""
    lf = _nap(monkeypatch, FPT_AI_API_KEY=KHOA_GIA, OLLAMA_HOST="http://localhost:11434")
    assert lf.PROVIDERS[0] == "fpt", "FPT đứng trước ollama khi có khoá"
    assert isinstance(lf.get_llm("chat"), lf._FptChatLLM)


def test_ollama_van_duoc_uu_tien_khi_dung_dau_danh_sach(sach, monkeypatch):
    """Máy dev có Ollama nhưng không có khoá từ xa: không đổi gì."""
    lf = _nap(monkeypatch, OLLAMA_HOST="http://localhost:11434")
    assert lf.PROVIDERS == ["ollama"]
    assert type(lf.get_llm("chat")).__name__ == "ChatOllama"


def test_bo_qua_provider_dung_hong_va_di_tiep(sach, monkeypatch):
    lf = _nap(monkeypatch, FPT_AI_API_KEY=KHOA_GIA, OLLAMA_HOST="http://localhost:11434")

    def _no(*a, **k):
        raise RuntimeError("dung hong")

    monkeypatch.setattr(lf, "_fpt_chat_llm", _no)
    assert type(lf.get_llm("chat")).__name__ == "ChatOllama"


def test_khong_provider_nao_thi_nem_loi_ro_rang(sach, monkeypatch):
    lf = _nap(monkeypatch)
    monkeypatch.setattr(lf, "PROVIDERS", [])
    with pytest.raises(RuntimeError, match="No AI provider configured"):
        lf.get_llm("chat")


def test_moi_provider_dung_hong_thi_nem_kem_danh_sach(sach, monkeypatch):
    lf = _nap(monkeypatch, FPT_AI_API_KEY=KHOA_GIA)

    def _no(*a, **k):
        raise RuntimeError("thieu cai gi do")

    monkeypatch.setattr(lf, "_fpt_chat_llm", _no)
    monkeypatch.setattr(lf, "PROVIDERS", ["fpt"])
    with pytest.raises(RuntimeError, match="PROVIDERS"):
        lf.get_llm("chat")


# ── invoke nhận chuỗi trần ─────────────────────────────────────────────────
class _Resp:
    """Giả `requests.Response`, KỂ CẢ luật giải mã của nó.

    `encoding` khởi tạo là ISO-8859-1 đúng như requests đặt cho một
    `content-type: text/event-stream` không khai charset — đó chính là mặc định của
    HTTP. `iter_lines` ở đây giải mã byte thật bằng `self.encoding`, nên nếu mã sản
    phẩm quên ép UTF-8 thì test sẽ thấy chữ hỏng y như production.
    """

    def __init__(self, status=200, body=None, text=None, lines=None):
        self.status_code = status
        self._body = body
        self._lines = lines or []
        self.encoding = "ISO-8859-1"
        self.text = text if text is not None else json.dumps(body or {}, ensure_ascii=False)

    def json(self):
        if self._body is None:
            raise ValueError("not json")
        return self._body

    def iter_lines(self, decode_unicode=False):
        for dong in self._lines:
            b = dong.encode("utf-8") if isinstance(dong, str) else dong
            yield b.decode(self.encoding, errors="replace") if decode_unicode else b


def _bat_post(monkeypatch, resp):
    ghi = {}

    def _post(url, headers=None, json=None, timeout=None, stream=False):
        ghi.update(url=url, headers=headers, payload=json, timeout=timeout, stream=stream)
        if isinstance(resp, Exception):
            raise resp
        return resp

    import requests
    monkeypatch.setattr(requests, "post", _post)
    return ghi


def _client(lf):
    return lf._FptChatLLM(api_key=KHOA_GIA, base_url="https://vi-du.test/v1",
                          model="m", temperature=0.0, max_tokens=100, timeout=30.0)


def test_invoke_nhan_chuoi_tran_thanh_MOT_message(sach, monkeypatch):
    """`llm_cache._judge_same_intent` gọi `.invoke(prompt_str)`."""
    import app.clients.llm_factory as lf
    ghi = _bat_post(monkeypatch, _Resp(body={"choices": [{"message": {"content": "ok"}}]}))
    _client(lf).invoke("mot cau hoi dai")
    assert ghi["payload"]["messages"] == [{"role": "user", "content": "mot cau hoi dai"}]


def test_invoke_van_nhan_danh_sach_message(sach, monkeypatch):
    import app.clients.llm_factory as lf
    from langchain_core.messages import HumanMessage, SystemMessage

    ghi = _bat_post(monkeypatch, _Resp(body={"choices": [{"message": {"content": "ok"}}]}))
    _client(lf).invoke([SystemMessage(content="he thong"), HumanMessage(content="nguoi")])
    assert ghi["payload"]["messages"] == [
        {"role": "system", "content": "he thong"},
        {"role": "user", "content": "nguoi"},
    ]


# ── stream ─────────────────────────────────────────────────────────────────
def _sse(*objs):
    return [f"data: {json.dumps(o, ensure_ascii=False)}" for o in objs] + ["data: [DONE]"]


def _delta(**d):
    return {"choices": [{"delta": d}]}


def test_stream_ghep_dung_cac_manh_content(sach, monkeypatch):
    import app.clients.llm_factory as lf
    ghi = _bat_post(monkeypatch, _Resp(lines=_sse(
        _delta(role="assistant"), _delta(content="Quang "), _delta(content="hợp"))))
    ra = "".join(lf.lc_ai_chunk_text(c) for c in _client(lf).stream(["q"]))
    assert ra == "Quang hợp"
    assert ghi["payload"]["stream"] is True
    assert ghi["stream"] is True


def test_stream_KHONG_lay_reasoning_content(sach, monkeypatch):
    """Luật quan trọng nhất của phần stream — `gpt-oss-120b` phát trường này thật."""
    import app.clients.llm_factory as lf
    _bat_post(monkeypatch, _Resp(lines=_sse(
        _delta(reasoning_content="The user asks in Vietnamese..."),
        _delta(content="Đáp án:"),
        _delta(reasoning_content=" more thinking "),
        _delta(content=" oxy"))))
    ra = "".join(lf.lc_ai_chunk_text(c) for c in _client(lf).stream(["q"]))
    assert ra == "Đáp án: oxy"
    assert "thinking" not in ra and "user asks" not in ra


def test_stream_giu_nguyen_dau_tieng_viet(sach, monkeypatch):
    """FPT trả `text/event-stream` KHÔNG kèm charset, nên requests áp ISO-8859-1 và
    `decode_unicode=True` sẽ giải mã byte UTF-8 bằng latin-1 — "Quang hợp" thành
    "Quang há»£p". Đo thật trên API 2026-09-04: `r.encoding` đúng là 'ISO-8859-1'.

    Đường non-stream không dính vì `r.json()` tự lo UTF-8. Nên đây là lỗi CHỈ có ở
    stream, và nó không làm gì hỏng to tát — chỉ xoá sạch dấu của một ứng dụng tiếng
    Việt, ngay trong câu trả lời người dùng đọc."""
    import app.clients.llm_factory as lf
    _bat_post(monkeypatch, _Resp(lines=_sse(
        _delta(content="Quang hợp "), _delta(content="tạo ra khí ôxy."))))
    ra = "".join(lf.lc_ai_chunk_text(c) for c in _client(lf).stream(["q"]))
    assert ra == "Quang hợp tạo ra khí ôxy."


def test_stream_dung_o_DONE(sach, monkeypatch):
    import app.clients.llm_factory as lf
    _bat_post(monkeypatch, _Resp(lines=[
        'data: {"choices":[{"delta":{"content":"a"}}]}',
        "data: [DONE]",
        'data: {"choices":[{"delta":{"content":"KHONG-DUOC-LAY"}}]}',
    ]))
    ra = "".join(lf.lc_ai_chunk_text(c) for c in _client(lf).stream(["q"]))
    assert ra == "a"


def test_stream_bo_qua_dong_hong_thay_vi_huy_ca_cau(sach, monkeypatch):
    import app.clients.llm_factory as lf
    _bat_post(monkeypatch, _Resp(lines=[
        'data: {"choices":[{"delta":{"content":"a"}}]}',
        "data: {khong-phai-json",
        "",
        ": comment cua SSE",
        'data: {"choices":[]}',
        'data: {"choices":[{"delta":{"content":"b"}}]}',
        "data: [DONE]",
    ]))
    ra = "".join(lf.lc_ai_chunk_text(c) for c in _client(lf).stream(["q"]))
    assert ra == "ab"


def test_stream_chat_tokens_dung_duoc_voi_client_fpt(sach, monkeypatch):
    """Hàm dùng chung của qa_chain phải chạy được trên client này."""
    import app.clients.llm_factory as lf
    _bat_post(monkeypatch, _Resp(lines=_sse(_delta(content="x"), _delta(content="y"))))
    assert list(lf.stream_chat_tokens(_client(lf), ["q"])) == ["x", "y"]


@pytest.mark.parametrize("resp,khop", [
    (_Resp(status=401, text="unauthorized"), "HTTP 401"),
    (_Resp(status=500, text="boom"), "HTTP 500"),
])
def test_stream_loi_http_thanh_RuntimeError(sach, monkeypatch, resp, khop):
    import app.clients.llm_factory as lf
    _bat_post(monkeypatch, resp)
    with pytest.raises(RuntimeError, match=khop):
        list(_client(lf).stream(["q"]))


def test_stream_loi_mang_thanh_RuntimeError(sach, monkeypatch):
    import app.clients.llm_factory as lf
    _bat_post(monkeypatch, TimeoutError("het gio"))
    with pytest.raises(RuntimeError, match="TimeoutError"):
        list(_client(lf).stream(["q"]))


@pytest.mark.parametrize("resp", [_Resp(status=401, text="unauthorized"),
                                  TimeoutError("het gio")])
def test_khoa_KHONG_lot_vao_loi_stream(sach, monkeypatch, resp):
    import app.clients.llm_factory as lf
    _bat_post(monkeypatch, resp)
    with pytest.raises(RuntimeError) as e:
        list(_client(lf).stream(["q"]))
    assert KHOA_GIA not in str(e.value)
    assert "Bearer" not in str(e.value)
