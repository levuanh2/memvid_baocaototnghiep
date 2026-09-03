"""Backend thị giác FPT — `VISION_BACKEND=fpt`.

Hợp đồng đo thật 2026-09-04 trên `Qwen2.5-VL-7B-Instruct`:

    POST {base}/chat/completions
    messages[0].content = [ {type:"text",...}, {type:"image_url", image_url:{url:"data:..."}} ]
    200 -> {"choices":[{"message":{"content": "..."}}]}   # phẳng, KHÔNG bọc `data`

Ba thứ dễ hỏng mà file này khoá:

1. Hai backend nhét ảnh theo hai lối KHÁC HẲN nhau — Ollama dùng `messages[].images`
   với base64 trần, FPT dùng `content` mảng với data URI đầy đủ. Trộn hai lối thì
   model nhận được request hợp lệ về cú pháp nhưng không thấy ảnh, rồi trả lời như
   chưa từng có ảnh nào. Không có lỗi nào nổ ra.
2. Model của hai backend có tên hoàn toàn khác nhau (`qwen3.5:9b` vs
   `Qwen2.5-VL-7B-Instruct`), nên mỗi bên phải có biến env riêng.
3. `is_available()` phải hỏi marketplace chứ không tin cấu hình: một tên model gõ sai
   vẫn hiện nút kèm ảnh cho người dùng rồi hỏng lúc họ đã chọn xong file.
"""

from __future__ import annotations

import json

import pytest

from app.domains.vision import transcribe as vt

KHOA_GIA = "sk-khoa-gia-chi-dung-trong-test"
ANH = b"\x89PNG\r\n\x1a\n gia-lam-anh"


@pytest.fixture(autouse=True)
def _sach(monkeypatch):
    vt.reset_availability_cache()
    monkeypatch.delenv("VISION_ENABLED", raising=False)
    monkeypatch.delenv("VISION_BACKEND", raising=False)
    monkeypatch.delenv("FPT_AI_VISION_MODEL", raising=False)
    yield
    vt.reset_availability_cache()


class _Resp:
    def __init__(self, status=200, body=None, text=None):
        self.status_code = status
        self._body = body
        self.text = text if text is not None else json.dumps(body, ensure_ascii=False)

    def json(self):
        if self._body is None:
            raise ValueError("not json")
        return self._body


def _bat(monkeypatch, *, post=None, get=None):
    """Chặn requests.post/get, ghi lại lời gọi."""
    ghi = {}
    import requests

    if post is not None:
        def _post(url, headers=None, json=None, timeout=None):
            ghi.update(url=url, headers=headers, payload=json, timeout=timeout)
            if isinstance(post, Exception):
                raise post
            return post
        monkeypatch.setattr(requests, "post", _post)
    if get is not None:
        def _get(url, headers=None, timeout=None):
            ghi.update(get_url=url, get_headers=headers, get_timeout=timeout)
            if isinstance(get, Exception):
                raise get
            return get
        monkeypatch.setattr(requests, "get", _get)
    return ghi


# ── Chọn backend ───────────────────────────────────────────────────────────
def test_auto_chon_fpt_khi_co_khoa(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    assert vt.backend() == "fpt"


def test_auto_giu_ollama_khi_khong_co_khoa(monkeypatch):
    """Hành vi cũ được giữ nguyên khi chưa cấu hình FPT — điều kiện của cả phase."""
    monkeypatch.setenv("FPT_AI_API_KEY", "")
    assert vt.backend() == "ollama"
    assert vt.vision_model() == vt.DEFAULT_MODEL


@pytest.mark.parametrize("dat,mong", [("ollama", "ollama"), ("fpt", "fpt"),
                                      ("FPT", "fpt"), ("  ollama  ", "ollama")])
def test_ep_backend_tuong_minh(monkeypatch, dat, mong):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    monkeypatch.setenv("VISION_BACKEND", dat)
    assert vt.backend() == mong


def test_gia_tri_la_thi_ve_auto(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    monkeypatch.setenv("VISION_BACKEND", "bia-dat")
    assert vt.backend() == "fpt"


def test_model_theo_backend(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    monkeypatch.setenv("VISION_MODEL", "qwen-cua-ollama")
    assert vt.vision_model() == "Qwen2.5-VL-7B-Instruct", (
        "VISION_MODEL là tag Ollama, không được rò sang backend FPT")
    monkeypatch.setenv("FPT_AI_VISION_MODEL", "model-fpt-khac")
    assert vt.vision_model() == "model-fpt-khac"


# ── is_available ───────────────────────────────────────────────────────────
def test_kha_dung_khi_model_co_trong_danh_sach(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    ghi = _bat(monkeypatch, get=_Resp(body={"data": [
        {"id": "gpt-oss-120b"}, {"id": "Qwen2.5-VL-7B-Instruct"}]}))
    assert vt.is_available() is True
    assert ghi["get_url"].endswith("/models")
    assert ghi["get_headers"]["Authorization"] == f"Bearer {KHOA_GIA}"


def test_KHONG_kha_dung_khi_model_khong_co_trong_danh_sach(monkeypatch):
    """Tên gõ sai phải tắt nút kèm ảnh, không phải để người dùng phát hiện hộ."""
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    monkeypatch.setenv("FPT_AI_VISION_MODEL", "model-khong-ton-tai")
    _bat(monkeypatch, get=_Resp(body={"data": [{"id": "gpt-oss-120b"}]}))
    assert vt.is_available() is False


def test_khong_co_khoa_thi_khong_kha_dung(monkeypatch):
    monkeypatch.setenv("VISION_BACKEND", "fpt")
    monkeypatch.setenv("FPT_AI_API_KEY", "")

    import requests
    monkeypatch.setattr(requests, "get", lambda *a, **k: pytest.fail("không được gọi mạng"))
    assert vt.is_available() is False


def test_vision_enabled_tat_thang_ca_backend_fpt(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    monkeypatch.setenv("VISION_ENABLED", "0")

    import requests
    monkeypatch.setattr(requests, "get", lambda *a, **k: pytest.fail("không được gọi mạng"))
    assert vt.is_available() is False


@pytest.mark.parametrize("resp", [_Resp(status=500, text="down"),
                                  _Resp(body=None, text="<html>"),
                                  TimeoutError("het gio")])
def test_loi_khi_hoi_danh_sach_thi_coi_nhu_khong_kha_dung(monkeypatch, resp):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    _bat(monkeypatch, get=resp)
    assert vt.is_available() is False


def test_cache_kha_dung_dung_chung_cho_ca_hai_backend(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    dem = {"n": 0}

    import requests

    def _get(url, headers=None, timeout=None):
        dem["n"] += 1
        return _Resp(body={"data": [{"id": "Qwen2.5-VL-7B-Instruct"}]})

    monkeypatch.setattr(requests, "get", _get)
    assert vt.is_available() is True
    assert vt.is_available() is True
    assert dem["n"] == 1, "lần thứ hai phải lấy từ cache 5 phút"


# ── Dựng request ───────────────────────────────────────────────────────────
def test_anh_di_dang_data_uri_trong_content_mang(monkeypatch):
    """Lối OpenAI, KHÔNG phải lối `messages[].images` của Ollama."""
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    monkeypatch.setenv("FPT_AI_BASE_URL", "https://vi-du.test/v1/")
    ghi = _bat(monkeypatch, post=_Resp(body={"choices": [{"message": {"content": "chu"}}]}))

    vt.transcribe_image(ANH, timeout=42.0)

    assert ghi["url"] == "https://vi-du.test/v1/chat/completions"
    assert ghi["timeout"] == 42.0
    p = ghi["payload"]
    assert p["model"] == "Qwen2.5-VL-7B-Instruct"
    assert p["stream"] is False and p["temperature"] == 0
    noi_dung = p["messages"][0]["content"]
    assert isinstance(noi_dung, list) and len(noi_dung) == 2
    assert noi_dung[0] == {"type": "text", "text": vt._PROMPT}
    assert noi_dung[1]["type"] == "image_url"
    assert noi_dung[1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert "images" not in p["messages"][0], "đó là lối Ollama, không phải lối FPT"


def test_max_tokens_lay_tu_VISION_MAX_TOKENS(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    monkeypatch.setenv("VISION_MAX_TOKENS", "123")
    ghi = _bat(monkeypatch, post=_Resp(body={"choices": [{"message": {"content": "x"}}]}))
    vt.transcribe_image(ANH)
    assert ghi["payload"]["max_tokens"] == 123


def test_anh_rong_van_la_ValueError(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    with pytest.raises(ValueError):
        vt.transcribe_image(b"")


# ── Bóc response ───────────────────────────────────────────────────────────
def test_tra_ve_dung_hinh_dang_dict(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    _bat(monkeypatch, post=_Resp(body={"choices": [{"message": {"content": "  Bài 3  "}}]}))
    ra = vt.transcribe_image(ANH)
    assert set(ra) == {"text", "model", "elapsed_ms"}, "hợp đồng cũ không được đổi"
    assert ra["text"] == "Bài 3"
    assert ra["model"] == "Qwen2.5-VL-7B-Instruct"
    assert isinstance(ra["elapsed_ms"], int)


def test_boc_ca_hinh_dang_boc_trong_data(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    _bat(monkeypatch, post=_Resp(body={"data": {"choices": [{"message": {"content": "chu"}}]}}))
    assert vt.transcribe_image(ANH)["text"] == "chu"


# ── Lỗi ────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("resp,khop", [
    (_Resp(status=401, text="unauthorized"), "HTTP 401"),
    (_Resp(status=404, text="model not found"), "HTTP 404"),
    (_Resp(body=None, text="<html>"), "khong phai JSON"),
    (_Resp(body={"khong_co_choices": 1}), "thieu `choices`"),
    (_Resp(body={"choices": []}), "thieu `choices`"),
    (_Resp(body={"choices": [{"khong_co_message": 1}]}), "thieu `choices\\[0\\].message`"),
    (_Resp(body={"choices": [{"message": {"content": ""}}]}), "tra ve rong"),
    (_Resp(body={"choices": [{"message": {"content": "   "}}]}), "tra ve rong"),
])
def test_moi_than_hong_deu_thanh_VisionUnavailable(monkeypatch, resp, khop):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    _bat(monkeypatch, post=resp)
    with pytest.raises(vt.VisionUnavailable, match=khop):
        vt.transcribe_image(ANH)


def test_loi_mang_thanh_VisionUnavailable(monkeypatch):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    _bat(monkeypatch, post=TimeoutError("het gio"))
    with pytest.raises(vt.VisionUnavailable, match="TimeoutError"):
        vt.transcribe_image(ANH)


@pytest.mark.parametrize("resp", [_Resp(status=401, text="unauthorized"),
                                  _Resp(body={"khong_co_choices": 1}),
                                  TimeoutError("het gio")])
def test_khoa_KHONG_lot_vao_thong_bao_loi(monkeypatch, resp):
    monkeypatch.setenv("FPT_AI_API_KEY", KHOA_GIA)
    _bat(monkeypatch, post=resp)
    with pytest.raises(vt.VisionUnavailable) as e:
        vt.transcribe_image(ANH)
    assert KHOA_GIA not in str(e.value)
    assert "Bearer" not in str(e.value)


# ── Backend Ollama không bị đụng ────────────────────────────────────────────
def test_nhanh_ollama_van_dung_images_base64_tran(monkeypatch):
    """Chứng minh cụ thể là hai lối vẫn tách bạch, không phải khẳng định suông."""
    monkeypatch.setenv("VISION_BACKEND", "ollama")
    ghi = {}

    def _post(path, payload, timeout):
        ghi.update(path=path, payload=payload, timeout=timeout)
        return {"message": {"content": "chu tu ollama"}}

    monkeypatch.setattr(vt, "_post", _post)
    ra = vt.transcribe_image(ANH)
    assert ra["text"] == "chu tu ollama"
    assert ghi["path"] == "/api/chat"
    assert isinstance(ghi["payload"]["messages"][0]["content"], str), "Ollama: content là chuỗi"
    assert ghi["payload"]["messages"][0]["images"], "Ollama: ảnh nằm ở `images`"
    assert not ghi["payload"]["messages"][0]["images"][0].startswith("data:"), (
        "Ollama nhận base64 trần, thêm tiền tố data: là hỏng")
    assert ghi["payload"]["think"] is False
