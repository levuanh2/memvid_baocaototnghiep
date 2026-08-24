"""Phiên âm ảnh bằng mô hình thị giác chạy cục bộ trên Ollama.

Ảnh dán vào khung chat KHÔNG đi vào pipeline ingest. Nó được đọc thành chữ ngay
tại đây, chữ đó ghép vào câu hỏi, rồi `/query` chạy y như một câu hỏi thuần chữ:
retrieval, RRF, rerank, NLI, HITL, trích dẫn, cache đều giữ nguyên. Đổi lại,
QUERY_GRAPH không phải biết ảnh là gì.

Gọi thẳng HTTP `/api/chat` của Ollama thay vì đi qua `llm_factory`: tầng đó dựng
`ChatOllama` cho hội thoại thuần chữ, còn ở đây chỉ cần một lượt hỏi-đáp có kèm
ảnh base64. Thêm một nhánh vision vào `llm_factory` sẽ kéo theo cả đường
temperature/num_ctx/gateway mà lượt gọi này không dùng tới.
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


def vision_model() -> str:
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
    if not (os.getenv("OLLAMA_HOST") or "http://localhost:11434").strip():
        return False

    now = time.monotonic()
    if _availability and now - _availability[0] < _AVAILABILITY_TTL:
        return _availability[1]

    try:
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

    started = time.perf_counter()
    try:
        body = _post(_CHAT_PATH, payload, timeout=limit)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")[:200]
        raise VisionUnavailable(f"Ollama tu choi anh (HTTP {exc.code}): {detail}") from exc
    except Exception as exc:
        raise VisionUnavailable(f"Khong goi duoc mo hinh thi giac: {exc}") from exc

    text = ((body.get("message") or {}).get("content") or "").strip()
    if not text:
        raise VisionUnavailable(
            f"Mo hinh {model} khong doc duoc anh (tra ve rong) — kiem tra no co "
            f"'vision' trong capabilities khong."
        )
    return {
        "text": text,
        "model": model,
        "elapsed_ms": int((time.perf_counter() - started) * 1000),
    }
