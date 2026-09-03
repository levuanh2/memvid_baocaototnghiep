"""Provider FPT AI Marketplace — cổng bật/tắt, hình dạng request, và cách bóc response.

FPT trả HAI hình dạng response, và đó là thứ file này canh chặt nhất. Tài liệu
marketplace mô tả bản bọc trong `data`
(`body["data"]["choices"][0]["message"]["content"]`), nhưng đo thật 2026-09-03 với
`gpt-oss-120b` thì endpoint trả THẲNG hình dạng OpenAI phẳng (`body["choices"]`).
Chỉ đọc một bản là hỏng nửa số model — và hỏng IM LẶNG, vì lỗi parse bị vòng
fallback nuốt rồi rơi sang provider khác, người dùng vẫn thấy câu trả lời.

Thứ hai: FPT gói **mã lỗi nghiệp vụ trong thân** kèm HTTP 200. Một
`{"code": 500, "data": null}` mà không kiểm sẽ đi tiếp rồi vỡ ở bước bóc `data` với
thông báo vô nghĩa — hoặc tệ hơn, im lặng.

Không gọi API thật. Không dùng key thật. Mọi HTTP đều bị thay.
"""

from __future__ import annotations

import importlib

import pytest

KEY_GIA = "test-key-khong-phai-that"
URL_MONG_DOI = "https://mkp-api.fptcloud.com/v1/chat/completions"


def _nap_lai(monkeypatch, **env):
    """`PROVIDERS` dựng lúc IMPORT module, nên đổi env rồi phải nạp lại mới thấy.

    Đặt RỖNG chứ không `delenv`: module gọi `load_project_env(override=False)` mỗi lần
    nạp, và nó chỉ bỏ qua khoá ĐANG CÓ trong `os.environ`. Xoá hẳn thì `BE/.env` của
    máy lập trình viên lẻn vào và kết quả test đổi theo từng máy.
    """
    for k in ("FPT_AI_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "OLLAMA_HOST",
              "FPT_AI_BASE_URL", "FPT_AI_CHAT_MODEL"):
        monkeypatch.setenv(k, "")
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    import app.clients.llm_factory as lf
    return importlib.reload(lf)


@pytest.fixture(autouse=True)
def _tra_lai_module():
    """Nạp lại lần cuối với env thật để không rò trạng thái sang test khác."""
    yield
    import app.clients.llm_factory as lf
    importlib.reload(lf)


class _Resp:
    def __init__(self, body, status=200, text=None):
        self._body, self.status_code = body, status
        self.text = text if text is not None else str(body)

    def json(self):
        if self._body is None:
            raise ValueError("khong phai JSON")
        return self._body


def _bat_post(monkeypatch, lf, resp):
    """Thay `requests.post`, ghi lại đối số. Patch trên chính module `requests` vì
    client import lười bên trong hàm."""
    import requests

    ghi = {}

    def _post(url, headers=None, json=None, timeout=None):
        ghi.update(url=url, headers=headers or {}, payload=json or {}, timeout=timeout)
        if isinstance(resp, Exception):
            raise resp
        return resp

    monkeypatch.setattr(requests, "post", _post)
    return ghi


def _tin_nhan(lf, noi_dung="xin chao"):
    from langchain_core.messages import HumanMessage

    return [HumanMessage(content=noi_dung)]


# ── 1 & 2: cổng bật/tắt ────────────────────────────────────────────────────
def test_khong_co_key_thi_fpt_khong_vao_providers(monkeypatch):
    lf = _nap_lai(monkeypatch)
    assert "fpt" not in lf.PROVIDERS
    assert lf.has_fpt is False


def test_co_key_thi_fpt_vao_providers_va_dung_TRUOC_ollama(monkeypatch):
    lf = _nap_lai(monkeypatch, FPT_AI_API_KEY=KEY_GIA)
    assert "fpt" in lf.PROVIDERS
    # Có provider từ xa thì ollama không được thêm như fallback mặc định nữa.
    assert lf.PROVIDERS[0] == "fpt", f"thứ tự đổi: {lf.PROVIDERS}"


def test_co_ca_key_fpt_lan_ollama_host_thi_fpt_van_truoc(monkeypatch):
    lf = _nap_lai(monkeypatch, FPT_AI_API_KEY=KEY_GIA,
                  OLLAMA_HOST="http://localhost:11434")
    assert lf.PROVIDERS.index("fpt") < lf.PROVIDERS.index("ollama")


def test_khong_co_key_nao_thi_thu_tu_cu_giu_nguyen(monkeypatch):
    """Hồi quy: khi FPT vắng mặt, danh sách phải y hệt trước khi có provider này."""
    lf = _nap_lai(monkeypatch)
    assert lf.PROVIDERS == ["ollama"]

    lf = _nap_lai(monkeypatch, GEMINI_API_KEY="g", GROQ_API_KEY="q")
    assert lf.PROVIDERS == ["gemini", "groq"], f"thứ tự cũ đổi: {lf.PROVIDERS}"


# ── 3: hình dạng request ───────────────────────────────────────────────────
def test_request_dung_url_header_model_va_stream_false(monkeypatch):
    lf = _nap_lai(monkeypatch, FPT_AI_API_KEY=KEY_GIA)
    ghi = _bat_post(monkeypatch, lf, _Resp(
        {"code": 200, "data": {"choices": [{"message": {"content": "ok"}}]}}))

    lf._fpt_chat_llm("chat").invoke(_tin_nhan(lf))

    assert ghi["url"] == URL_MONG_DOI
    assert ghi["headers"]["Content-Type"] == "application/json"
    assert ghi["headers"]["Authorization"].startswith("Bearer ")
    assert ghi["payload"]["model"] == "gpt-oss-120b", "model mặc định"
    assert ghi["payload"]["stream"] is False, "phase này KHÔNG dùng streaming"
    assert ghi["payload"]["messages"] == [{"role": "user", "content": "xin chao"}]
    assert isinstance(ghi["payload"]["max_tokens"], int)
    assert isinstance(ghi["payload"]["temperature"], float)
    assert ghi["timeout"] and ghi["timeout"] > 0, "phải có timeout, không treo vô hạn"


def test_base_url_va_model_doc_tu_env(monkeypatch):
    lf = _nap_lai(monkeypatch, FPT_AI_API_KEY=KEY_GIA,
                  FPT_AI_BASE_URL="https://vi-du.test/v1/",
                  FPT_AI_CHAT_MODEL="Qwen3.8-27B")
    ghi = _bat_post(monkeypatch, lf, _Resp(
        {"code": 200, "data": {"choices": [{"message": {"content": "ok"}}]}}))

    lf._fpt_chat_llm("chat").invoke(_tin_nhan(lf))

    assert ghi["url"] == "https://vi-du.test/v1/chat/completions", "dấu / thừa phải bị cắt"
    assert ghi["payload"]["model"] == "Qwen3.8-27B"


def test_system_prompt_thanh_vai_system(monkeypatch):
    """`_invoke_chat` dựng SystemMessage + HumanMessage; ánh xạ vai phải đúng."""
    lf = _nap_lai(monkeypatch, FPT_AI_API_KEY=KEY_GIA)
    ghi = _bat_post(monkeypatch, lf, _Resp(
        {"code": 200, "data": {"choices": [{"message": {"content": "ok"}}]}}))

    lf._invoke_chat(lf._fpt_chat_llm("chat"), "cau hoi", "luat choi")

    assert [m["role"] for m in ghi["payload"]["messages"]] == ["system", "user"]
    assert ghi["payload"]["messages"][0]["content"] == "luat choi"


# ── 4: bóc response ────────────────────────────────────────────────────────
def test_boc_dung_lop_data_cua_fpt(monkeypatch):
    lf = _nap_lai(monkeypatch, FPT_AI_API_KEY=KEY_GIA)
    _bat_post(monkeypatch, lf, _Resp({
        "code": 200,
        "message": "Chat completion successful",
        "data": {"id": "chatcmpl-x", "object": "chat.completion",
                 "choices": [{"index": 0,
                              "message": {"role": "assistant", "content": "hello"},
                              "finish_reason": "stop"}],
                 "usage": {"total_tokens": 23}},
    }))

    out = lf._invoke_chat(lf._fpt_chat_llm("chat"), "hi", None)
    assert out == "hello"


def test_boc_duoc_ca_hinh_dang_openai_phang(monkeypatch):
    """Đo thật 2026-09-03: `gpt-oss-120b` trả THẲNG hình dạng OpenAI, KHÔNG có `data`.

    Tài liệu marketplace mô tả bản bọc `data`. Cả hai đều phải đọc được — cược vào một
    bản là hỏng nửa số model, và triệu chứng sẽ là "FPT im lặng rơi sang Ollama".
    """
    lf = _nap_lai(monkeypatch, FPT_AI_API_KEY=KEY_GIA)
    _bat_post(monkeypatch, lf, _Resp({
        "id": "chatcmpl-x", "object": "chat.completion",
        "choices": [{"index": 0, "finish_reason": "stop",
                     "message": {"role": "assistant", "content": "hello",
                                 "reasoning_content": "..."}}],
    }))

    assert lf._invoke_chat(lf._fpt_chat_llm("chat"), "hi", None) == "hello"


# ── 5: lỗi API ─────────────────────────────────────────────────────────────
def test_code_500_trong_than_la_that_bai(monkeypatch):
    """HTTP 200 nhưng `code` lỗi — không kiểm thì đi tiếp rồi vỡ ở chỗ khác."""
    lf = _nap_lai(monkeypatch, FPT_AI_API_KEY=KEY_GIA)
    _bat_post(monkeypatch, lf, _Resp({"code": 500, "message": "loi noi bo", "data": None}))

    with pytest.raises(RuntimeError, match="code=500"):
        lf._fpt_chat_llm("chat").invoke(_tin_nhan(lf))


def test_http_4xx_5xx_la_that_bai(monkeypatch):
    lf = _nap_lai(monkeypatch, FPT_AI_API_KEY=KEY_GIA)
    _bat_post(monkeypatch, lf, _Resp({"message": "unauthorized"}, status=401,
                                     text='{"message":"unauthorized"}'))

    with pytest.raises(RuntimeError, match="HTTP 401"):
        lf._fpt_chat_llm("chat").invoke(_tin_nhan(lf))


def test_loi_ket_noi_la_that_bai_va_khong_lo_key(monkeypatch):
    lf = _nap_lai(monkeypatch, FPT_AI_API_KEY=KEY_GIA)
    _bat_post(monkeypatch, lf, ConnectionError("khong noi duoc"))

    with pytest.raises(RuntimeError) as e:
        lf._fpt_chat_llm("chat").invoke(_tin_nhan(lf))
    assert KEY_GIA not in str(e.value), "API key KHÔNG được lọt vào thông báo lỗi"
    assert "Bearer" not in str(e.value)


def test_that_bai_cua_fpt_cho_phep_fallback_chay_tiep(monkeypatch):
    """Lỗi phải là Exception thường để vòng fallback bắt được và đi sang provider sau."""
    lf = _nap_lai(monkeypatch, FPT_AI_API_KEY=KEY_GIA, OLLAMA_HOST="http://localhost:11434")
    _bat_post(monkeypatch, lf, _Resp({"code": 500, "message": "hong", "data": None}))
    da_goi = {}

    def _ollama(model, feature, options, timeout=None):
        da_goi["ollama"] = True
        raise RuntimeError("ollama cung hong")

    monkeypatch.setattr(lf, "_ollama_chat_llm", _ollama)

    with pytest.raises(RuntimeError, match="All AI providers failed"):
        lf.ask_ai("hoi gi do")
    assert da_goi.get("ollama"), "sau khi FPT hỏng, fallback phải chạy tiếp"


# ── 6: response méo ────────────────────────────────────────────────────────
@pytest.mark.parametrize("body,khop", [
    ({"code": 200, "data": None}, "choices"),
    ({"code": 200, "data": {}}, "choices"),
    ({"code": 200, "data": {"choices": []}}, "choices"),
    ({"code": 200, "data": {"choices": [{}]}}, "content"),
    ({"code": 200, "data": {"choices": [{"message": {"role": "assistant"}}]}}, "content"),
])
def test_response_thieu_khoa_thi_bao_loi_ro_rang(monkeypatch, body, khop):
    lf = _nap_lai(monkeypatch, FPT_AI_API_KEY=KEY_GIA)
    _bat_post(monkeypatch, lf, _Resp(body))

    with pytest.raises(RuntimeError, match=khop):
        lf._fpt_chat_llm("chat").invoke(_tin_nhan(lf))


def test_than_khong_phai_json_thi_bao_loi(monkeypatch):
    lf = _nap_lai(monkeypatch, FPT_AI_API_KEY=KEY_GIA)
    _bat_post(monkeypatch, lf, _Resp(None, text="<html>502 Bad Gateway</html>"))

    with pytest.raises(RuntimeError, match="JSON"):
        lf._fpt_chat_llm("chat").invoke(_tin_nhan(lf))


def test_thieu_key_thi_builder_bao_ro(monkeypatch):
    lf = _nap_lai(monkeypatch)
    with pytest.raises(RuntimeError, match="FPT_AI_API_KEY"):
        lf._fpt_chat_llm("chat")


# ── 7: hồi quy provider cũ ─────────────────────────────────────────────────
def test_builder_cu_khong_doi_chu_ky(monkeypatch):
    """Không đụng Gemini/Groq/Ollama ngoài việc thêm FPT vào danh sách."""
    import inspect

    lf = _nap_lai(monkeypatch, GEMINI_API_KEY="g", GROQ_API_KEY="q")
    assert list(inspect.signature(lf._gemini_chat_llm).parameters) == ["feature", "options"]
    assert list(inspect.signature(lf._groq_chat_llm).parameters) == ["feature", "options"]
    assert list(inspect.signature(lf._ollama_chat_llm).parameters) == [
        "model", "feature", "options", "timeout"]
    assert list(inspect.signature(lf.ask_ai).parameters) == [
        "prompt", "system_prompt", "model", "options", "feature", "timeout"]
