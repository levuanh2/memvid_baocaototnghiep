"""Phiên âm ảnh bằng mô hình thị giác — Ollama cục bộ hoặc FPT AI Marketplace.

Ảnh dán vào khung chat KHÔNG đi vào pipeline ingest. Nó được đọc thành chữ ngay
tại đây, chữ đó ghép vào câu hỏi, rồi `/query` chạy y như một câu hỏi thuần chữ:
retrieval, RRF, rerank, NLI, HITL, trích dẫn, cache đều giữ nguyên. Đổi lại,
QUERY_GRAPH không phải biết ảnh là gì.

Gọi thẳng HTTP thay vì đi qua `llm_factory`: tầng đó dựng chat model cho hội thoại
thuần chữ, còn ở đây chỉ cần một lượt hỏi-đáp có kèm ảnh base64. Thêm một nhánh
vision vào `llm_factory` sẽ kéo theo cả đường temperature/num_ctx/gateway mà lượt
gọi này không dùng tới.

Hai backend, chọn qua `VISION_BACKEND`:
  - `auto` (mặc định): có `FPT_AI_API_KEY` thì dùng FPT, không thì Ollama. Cùng luật
    với thứ tự provider của chat — có khoá từ xa thì đó là đường production.
  - `ollama`: `/api/chat` với `messages[].images` (mảng base64 KHÔNG có tiền tố data:).
  - `fpt`: `/chat/completions` với `content` dạng mảng và `image_url` là data URI.

Hai backend khác nhau ở cách nhét ảnh vào request và ở chỗ bóc chữ ra khỏi response,
nên chúng là hai hàm riêng chứ không phải một hàm có cờ. Phần chung — prompt, cổng
bật/tắt, cache khả dụng, hình dạng dict trả về — vẫn dùng chung.
"""

from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.request

# Ollama nhận ảnh qua `messages[].images` (mảng base64 không có tiền tố data:).
_CHAT_PATH = "/api/chat"
_SHOW_PATH = "/api/show"

DEFAULT_MODEL = "qwen3.5:9b"

# Model thị giác chuyên dụng trên marketplace. Đo thật 2026-09-04 trên ảnh đề bài
# tiếng Việt CÓ DẤU: chép đúng nguyên văn cả 4 dòng. `gemma-3-27b-it` và `Qwen3.8-27B`
# cũng đọc được, nhưng đây là model dựng riêng cho thị giác và nhẹ hơn hẳn.
FPT_DEFAULT_VISION_MODEL = "Qwen2.5-VL-7B-Instruct"

# Yêu cầu đọc NGUYÊN VĂN trước, mô tả sau. Thứ tự này quan trọng: sinh viên chụp
# đề bài thì phần chữ mới là thứ đi vào truy hồi, còn mô tả hình vẽ là phụ trợ.
_PROMPT = (
    "Đọc ảnh này và trả về hai phần:\n"
    "1. Toàn bộ chữ trong ảnh, chép lại nguyên văn, giữ đúng ký hiệu toán học.\n"
    "2. Nếu có hình vẽ, biểu đồ hay bảng, mô tả ngắn gọn nội dung của nó.\n"
    "Không giải bài, không thêm nhận xét. Nếu ảnh không có chữ, chỉ mô tả."
)


class VisionUnavailable(RuntimeError):
    """Không có mô hình thị giác nào dùng được."""


def backend() -> str:
    """`ollama` hoặc `fpt`. `auto` (mặc định) chọn FPT khi có khoá."""
    chon = (os.getenv("VISION_BACKEND") or "auto").strip().lower()
    if chon in ("ollama", "fpt"):
        return chon
    return "fpt" if (os.getenv("FPT_AI_API_KEY") or "").strip() else "ollama"


def vision_model() -> str:
    """Mỗi backend có biến model RIÊNG: `qwen3.5:9b` là tag Ollama, còn marketplace
    dùng tên khác hẳn. Một biến chung cho cả hai là cách chắc chắn để một bên sai."""
    if backend() == "fpt":
        return (os.getenv("FPT_AI_VISION_MODEL") or FPT_DEFAULT_VISION_MODEL).strip()
    return (os.getenv("VISION_MODEL") or DEFAULT_MODEL).strip()


def _ollama_host() -> str:
    return (os.getenv("OLLAMA_HOST") or "http://localhost:11434").rstrip("/")


def _post(path: str, payload: dict, timeout: float) -> dict:
    req = urllib.request.Request(
        _ollama_host() + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8") or "{}")


_availability: tuple[float, bool] | None = None
_AVAILABILITY_TTL = 300.0


def is_available() -> bool:
    """Mô hình đã cấu hình có thật sự nhận ảnh không. Nhớ kết quả 5 phút.

    Có cache vì FE hỏi mỗi lần mở khung chat, còn `/api/show` phải đi qua Ollama
    và chờ tới 10s khi Ollama đang bận nạp model khác.

    Hỏi `/api/show` và đọc `capabilities` thay vì thử gọi rồi bắt lỗi: model chỉ
    biết chữ KHÔNG báo lỗi khi nhận `images` — nó trả chuỗi rỗng hoặc bịa ra câu
    "hãy gửi ảnh cho tôi". Đo được: `qwen2.5:7b-instruct` trả HTTP 400, nhưng
    `gemma4:e4b` khai có vision mà vẫn trả lời như chưa thấy ảnh. Cờ capabilities
    là tín hiệu rẻ nhất, còn đúng hay không thì chỉ gọi thật mới biết.
    """
    global _availability

    if (os.getenv("VISION_ENABLED") or "").strip().lower() in ("0", "false", "no", "off"):
        return False

    la_fpt = backend() == "fpt"
    if la_fpt:
        if not (os.getenv("FPT_AI_API_KEY") or "").strip():
            return False
    elif not (os.getenv("OLLAMA_HOST") or "http://localhost:11434").strip():
        return False

    now = time.monotonic()
    if _availability and now - _availability[0] < _AVAILABILITY_TTL:
        return _availability[1]

    try:
        if la_fpt:
            # Hỏi danh sách model thay vì tin cấu hình. Lý do y hệt nhánh Ollama bên
            # dưới: một `FPT_AI_VISION_MODEL` gõ sai vẫn hiện nút kèm ảnh cho người
            # dùng, rồi hỏng lúc họ đã chọn xong file.
            ok = vision_model() in _fpt_model_ids(timeout=10.0)
        else:
            body = _post(_SHOW_PATH, {"model": vision_model()}, timeout=10.0)
            ok = "vision" in (body.get("capabilities") or [])
    except Exception:
        ok = False
    _availability = (now, ok)
    return ok


def reset_availability_cache() -> None:
    """Dùng trong test và sau khi đổi VISION_MODEL lúc chạy."""
    global _availability
    _availability = None


def transcribe_image(image_bytes: bytes, *, timeout: float | None = None) -> dict:
    """Trả `{text, model, elapsed_ms}`. Ném VisionUnavailable nếu không gọi được.

    `think: False` là bắt buộc với model có khả năng suy nghĩ: để mặc định thì
    toàn bộ ngân sách token rơi vào trường `thinking` và `content` về rỗng — đúng
    triệu chứng gặp lúc dò đầu tiên.
    """
    if not image_bytes:
        raise ValueError("anh rong")

    model = vision_model()
    limit = timeout if timeout is not None else float(os.getenv("VISION_TIMEOUT_SEC", "180"))
    started = time.perf_counter()
    if backend() == "fpt":
        text = _fpt_transcribe(image_bytes, model=model, timeout=limit)
    else:
        text = _ollama_transcribe(image_bytes, model=model, timeout=limit)
    if not text:
        raise VisionUnavailable(
            f"Mo hinh {model} khong doc duoc anh (tra ve rong) — kiem tra no co "
            f"kha nang thi giac khong."
        )
    return {
        "text": text,
        "model": model,
        "elapsed_ms": int((time.perf_counter() - started) * 1000),
    }


def _ollama_transcribe(image_bytes: bytes, *, model: str, timeout: float) -> str:
    """Ollama nhận ảnh qua `messages[].images` — base64 trần, KHÔNG có tiền tố data:."""
    payload = {
        "model": model,
        "stream": False,
        "think": False,
        "messages": [{
            "role": "user",
            "content": _PROMPT,
            "images": [base64.b64encode(image_bytes).decode("ascii")],
        }],
        "options": {
            "temperature": 0,
            "num_predict": int(os.getenv("VISION_MAX_TOKENS", "800")),
        },
    }

    try:
        body = _post(_CHAT_PATH, payload, timeout=timeout)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")[:200]
        raise VisionUnavailable(f"Ollama tu choi anh (HTTP {exc.code}): {detail}") from exc
    except Exception as exc:
        raise VisionUnavailable(f"Khong goi duoc mo hinh thi giac: {exc}") from exc

    return ((body.get("message") or {}).get("content") or "").strip()


# ── FPT AI Marketplace ─────────────────────────────────────────────────────
def _fpt_model_ids(*, timeout: float) -> set:
    """Tập id model marketplace đang phục vụ. Không đưa khoá vào thông báo lỗi."""
    import requests

    from app.clients.llm_factory import fpt_base_url, fpt_headers

    r = requests.get(fpt_base_url() + "/models", headers=fpt_headers(), timeout=timeout)
    if r.status_code >= 400:
        raise VisionUnavailable(f"FPT /models HTTP {r.status_code}")
    body = r.json()
    goi = body.get("data")
    muc = goi if isinstance(goi, list) else (body.get("models") or [])
    return {str(m.get("id")) for m in muc if isinstance(m, dict)}


def _fpt_transcribe(image_bytes: bytes, *, model: str, timeout: float) -> str:
    """FPT nhận ảnh theo lối OpenAI đa phương thức: `content` là MẢNG phần tử, ảnh đi
    trong `image_url.url` dưới dạng data URI đầy đủ (`data:image/png;base64,...`).

    Khác hẳn Ollama ở cả hai đầu — chỗ nhét ảnh và chỗ bóc chữ — nên là hàm riêng.
    Hình dạng response đo thật 2026-09-04: phẳng OpenAI, không bọc `data`; vẫn đọc cả
    hai vì marketplace không đồng nhất giữa các model (client chat đã dính một lần).
    """
    import requests

    from app.clients.llm_factory import fpt_base_url, fpt_headers

    b64 = base64.b64encode(image_bytes).decode("ascii")
    payload = {
        "model": model,
        "stream": False,
        "temperature": 0,
        "max_tokens": int(os.getenv("VISION_MAX_TOKENS", "800")),
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": _PROMPT},
                {"type": "image_url",
                 "image_url": {"url": f"data:image/png;base64,{b64}"}},
            ],
        }],
    }
    try:
        r = requests.post(fpt_base_url() + "/chat/completions", headers=fpt_headers(),
                          json=payload, timeout=timeout)
    except Exception as exc:
        raise VisionUnavailable(
            f"Khong goi duoc mo hinh thi giac FPT: {type(exc).__name__}") from None
    if r.status_code >= 400:
        raise VisionUnavailable(f"FPT tu choi anh (HTTP {r.status_code}): {r.text[:200]}")
    try:
        body = r.json()
    except ValueError:
        raise VisionUnavailable(f"FPT tra ve than khong phai JSON: {r.text[:200]}") from None

    goi = body.get("data")
    loi = goi if isinstance(goi, dict) else body
    choices = loi.get("choices")
    if not isinstance(choices, list) or not choices:
        raise VisionUnavailable(
            f"FPT thieu `choices` (da thu ca `data.choices` lan `choices`): {str(body)[:200]}")
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(message, dict):
        raise VisionUnavailable(f"FPT thieu `choices[0].message`: {str(body)[:200]}")
    return str(message.get("content") or "").strip()
