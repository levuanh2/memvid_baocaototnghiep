"""
LLM và embedding factory — LangChain (thay ai_provider / ollama_utils).

- get_llm(feature): một ChatModel theo kế hoạch migrate (Gemini > Groq > Ollama).
- ask_ai / summarize_*: giữ thứ tự PROVIDERS (fallback giữa provider như trước).
"""

from __future__ import annotations

import hashlib
import os
import threading
from collections import OrderedDict
from contextlib import contextmanager
from typing import Any, Iterator, Optional

import numpy as np

from shared.config import DEFAULT_LOCAL_MODEL
from langchain_core.embeddings import Embeddings as _LCEmbeddings

try:
    from shared.env_loader import load_project_env
    load_project_env(override=False)
except Exception:
    pass

PROVIDERS: list[str] = []

has_gemini = bool((os.getenv("GEMINI_API_KEY") or "").strip())
has_groq = bool((os.getenv("GROQ_API_KEY") or "").strip())
has_fpt = bool((os.getenv("FPT_AI_API_KEY") or "").strip())
has_any_remote = has_gemini or has_groq or has_fpt

# FPT đứng TRƯỚC ollama: khi có key, đây là provider từ xa dùng cho production, còn
# ollama chỉ là fallback cục bộ. Không có key thì danh sách giữ nguyên như trước —
# thứ tự cũ (ollama, gemini, groq) không đổi một chữ.
if has_fpt:
    PROVIDERS.append("fpt")

if (os.getenv("OLLAMA_HOST") or "").strip() or (not has_any_remote):
    PROVIDERS.append("ollama")

if has_gemini:
    PROVIDERS.append("gemini")

if has_groq:
    PROVIDERS.append("groq")

print("Active providers:", PROVIDERS)

# Ollama num_predict / Groq max_tokens — thấp quá thì cắt giữa câu; mặc định 8192 cho trả lời dài.
_DEFAULT_LLM_OUT = int((os.getenv("LLM_MAX_TOKENS") or "8192").strip() or "8192")


# === llm-gateway chokepoint ===
# Khi LLM_GATEWAY_ADDR được set, mọi lệnh gọi LLM/embedding của monolith (và của
# mindmap-service) đi qua llm-gateway gRPC thay vì gọi trực tiếp. Khi KHÔNG set
# (mặc định, test, và CHÍNH process llm-gateway), giữ nguyên hành vi cũ — nên tiến
# trình gateway không tự gọi lại chính nó.
_GRPC_LLM_CACHE: dict = {}
_GRPC_EMB_CACHE: dict = {}


def _gateway_addr() -> str:
    return (os.getenv("LLM_GATEWAY_ADDR") or "").strip()


# === PR#4: in-process LLM concurrency cap ===
# Khi KHÔNG có llm-gateway (LLM_GATEWAY_ADDR unset — monolith-only), không có gì
# chặn N pipeline cùng dội generation lên một Ollama CPU. Cap tại chokepoint
# ask_ai (mọi batch pipeline + memory-tree + fallback đi qua đây; cache hit thì
# không). Cùng env với gateway: MAX_CONCURRENT_LLM_CALLS / LLM_QUEUE_WAIT_TIMEOUT_SECONDS.
# Quá hạn chờ → RuntimeError → rơi vào đúng error-path degraded sẵn có của caller.
# Nhánh gateway KHÔNG đi qua gate này (gateway tự cap ở server).
_inproc_gate_lock = threading.Lock()


def _inproc_enabled() -> bool:
    return (os.getenv("LLM_INPROCESS_CAP_ENABLED", "1") or "").strip().lower() in (
        "1", "true", "yes", "on",
    )


def _load_inproc_gate() -> tuple[threading.BoundedSemaphore, int, float]:
    try:
        max_calls = max(1, int((os.getenv("MAX_CONCURRENT_LLM_CALLS") or "").strip() or 2))
    except ValueError:
        max_calls = 2
    try:
        wait = max(0.0, float((os.getenv("LLM_QUEUE_WAIT_TIMEOUT_SECONDS") or "").strip() or 30.0))
    except ValueError:
        wait = 30.0
    return threading.BoundedSemaphore(max_calls), max_calls, wait


_inproc_semaphore, _INPROC_MAX, _INPROC_WAIT = _load_inproc_gate()


def configure_inproc_gate(max_calls: int | None = None, wait_timeout: float | None = None) -> None:
    """Rebuild in-process gate từ env (hook cho test/ops — không gọi per request)."""
    global _inproc_semaphore, _INPROC_MAX, _INPROC_WAIT
    if max_calls is not None:
        os.environ["MAX_CONCURRENT_LLM_CALLS"] = str(max_calls)
    if wait_timeout is not None:
        os.environ["LLM_QUEUE_WAIT_TIMEOUT_SECONDS"] = str(wait_timeout)
    with _inproc_gate_lock:
        _inproc_semaphore, _INPROC_MAX, _INPROC_WAIT = _load_inproc_gate()


def inproc_slots() -> int:
    """Số lời gọi LLM chạy song song được. Cổng tắt → coi như không giới hạn.

    Ai muốn chạy nhiều lời gọi song song (mindmap enrich chẳng hạn) phải hỏi con số
    này thay vì đoán: đẩy nhiều hơn số slot không nhanh hơn, chỉ làm bên thua xếp
    hàng rồi chết vì `LLM_QUEUE_WAIT_TIMEOUT_SECONDS`.
    """
    return 1024 if not _inproc_enabled() else _INPROC_MAX


@contextmanager
def _inproc_slot():
    """Một slot generation in-process (bounded wait). Tắt qua LLM_INPROCESS_CAP_ENABLED=0."""
    if not _inproc_enabled():
        yield
        return
    if not _inproc_semaphore.acquire(timeout=_INPROC_WAIT):
        raise RuntimeError(
            f"LLM busy (in-process): all {_INPROC_MAX} slots in use, waited {_INPROC_WAIT}s"
        )
    try:
        yield
    finally:
        _inproc_semaphore.release()


def _grpc_llm_provider(addr: str):
    p = _GRPC_LLM_CACHE.get(addr)
    if p is None:
        from app.clients.llm_client import GrpcLLMProvider
        p = GrpcLLMProvider(addr)
        _GRPC_LLM_CACHE[addr] = p
    return p


def _grpc_embedding_provider(addr: str, name: str):
    key = (addr, name)
    p = _GRPC_EMB_CACHE.get(key)
    if p is None:
        from app.clients.llm_client import GrpcEmbeddingProvider
        p = GrpcEmbeddingProvider(addr, model_name=name)
        _GRPC_EMB_CACHE[key] = p
    return p


def _model_map(feature: str) -> str:
    # Default lấy từ shared.config.DEFAULT_LOCAL_MODEL — MỘT chỗ, xem giải thích ở đó.
    _chat = os.getenv("SLM_MODEL_CHAT", os.getenv("SLM_MODEL", DEFAULT_LOCAL_MODEL))
    return {
        "chat": _chat,
        "summary": os.getenv("SLM_MODEL_SUMMARY", DEFAULT_LOCAL_MODEL),
        "mindmap": os.getenv("MINDMAP_MODEL", DEFAULT_LOCAL_MODEL),
        # Ra đề bám ngữ liệu — cùng hạng model với summary/mindmap. Đổi model không
        # phải sửa code (NFR-05.3), chỉ đặt QUIZ_MODEL.
        "quiz": os.getenv("QUIZ_MODEL", os.getenv("SLM_MODEL_SUMMARY", DEFAULT_LOCAL_MODEL)),
    }.get(feature, _chat)


# Tác vụ factual/grounded → temperature thấp (tiến 0): bám sự thật, tái lập, giảm bịa.
# 'answer' = sinh đáp án RAG (cùng model chat nhưng cần factual). Chat hội thoại giữ
# LLM_TEMPERATURE để văn phong tự nhiên.
_FACTUAL_FEATURES = frozenset({"answer", "summary", "mindmap", "quiz", "grade", "classify", "extract"})


def _resolve_temperature(feature: str, options: dict | None = None) -> float:
    """Per-feature temperature. Ưu tiên options['temperature'] (override tường minh),
    sau đó factual→LLM_TEMPERATURE_FACTUAL (0), còn lại→LLM_TEMPERATURE (0.3)."""
    if options and "temperature" in options:
        return float(options["temperature"])
    if feature in _FACTUAL_FEATURES:
        return float(os.getenv("LLM_TEMPERATURE_FACTUAL", "0"))
    return float(os.getenv("LLM_TEMPERATURE", "0.3"))


def _invoke_chat(llm: Any, user: str, system_prompt: str | None, timeout: float | None = None) -> str:
    from langchain_core.messages import HumanMessage, SystemMessage
    from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout

    if system_prompt:
        msgs = [SystemMessage(content=system_prompt), HumanMessage(content=user)]
    else:
        msgs = [HumanMessage(content=user)]
    # ChatOllama mặc định stream=True — một số model (Qwen 3.x + think) có chunk content rỗng; stream=False lấy 1 response đầy đủ.

    def _call():
        return llm.invoke(msgs, stream=False)

    if timeout is not None and timeout > 0:
        with ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(_call)
            try:
                out = fut.result(timeout=timeout)
            except FuturesTimeout:
                raise TimeoutError(f"LLM call timed out after {timeout:.0f}s") from None
    else:
        out = _call()
    return lc_ai_message_text(out).strip()


def _ollama_reasoning_param() -> Any:
    """Map OLLAMA_REASONING / OLLAMA_THINK -> ChatOllama reasoning (think=...). Empty = để None (behavior model)."""
    raw = (os.getenv("OLLAMA_REASONING") or os.getenv("OLLAMA_THINK") or "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return None


def _ollama_chat_llm(model: str | None, feature: str, options: dict | None, timeout: float | None = None) -> Any:
    from langchain_ollama import ChatOllama

    host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
    m = model or _model_map(feature)
    kw: dict[str, Any] = {
        "model": m,
        "base_url": host,
        "temperature": _resolve_temperature(feature, options),
        "num_predict": _DEFAULT_LLM_OUT,
        "num_ctx": int(os.getenv("LLM_CTX_SIZE", "4096")),
        "reasoning": _ollama_reasoning_param(),
    }
    if options:
        if "num_predict" in options:
            kw["num_predict"] = int(options["num_predict"])
        if "num_ctx" in options:
            kw["num_ctx"] = int(options["num_ctx"])
    
    # IMPORTANT: Truyền timeout vào ChatOllama để HTTP request có timeout thật.
    # Nếu không truyền, HTTP request có thể treo vĩnh viễn nếu Ollama không respond.
    # ThreadPoolExecutor.fut.result(timeout=x) chỉ kill thread sau x giây,
    # NHƯNG HTTP request bên trong vẫn tiếp tục chạy và chiếm tài nguyên.
    if timeout is not None and timeout > 0:
        kw["timeout"] = timeout
    
    return ChatOllama(**kw)


# ── FPT AI Marketplace ─────────────────────────────────────────────────────
FPT_DEFAULT_BASE_URL = "https://mkp-api.fptcloud.com/v1"
FPT_DEFAULT_CHAT_MODEL = "gpt-oss-120b"


class _FptChatResponse:
    """Chỉ mang `.content` — đủ cho `lc_ai_message_text` đọc."""

    __slots__ = ("content",)

    def __init__(self, content: str) -> None:
        self.content = content


class _FptChatLLM:
    """Client tối thiểu cho FPT AI Marketplace, mang hình dạng của một chat model
    LangChain (`.invoke(messages, stream=False)`) để dùng LẠI `_invoke_chat` — không
    dựng thêm một đường gọi LLM thứ hai song song với ba provider hiện có.

    Dùng `requests` (đã có trong requirements), KHÔNG thêm dependency mới.

    Hình dạng response KHÔNG cố định. Tài liệu marketplace mô tả bản bọc trong `data`
    (`body["data"]["choices"][0]["message"]["content"]`), nhưng đo thật 2026-09-03 với
    `gpt-oss-120b` thì endpoint trả thẳng hình dạng OpenAI phẳng (`body["choices"]`),
    không có `data`. Cược vào một bản là hỏng nửa số model, nên đọc cả hai.

    Không đưa API key vào bất kỳ thông báo lỗi nào — chỉ status và một đoạn thân
    response đã cắt ngắn.
    """

    def __init__(self, *, api_key: str, base_url: str, model: str,
                 temperature: float, max_tokens: int, timeout: float) -> None:
        self._api_key = api_key
        self._url = base_url.rstrip("/") + "/chat/completions"
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout = timeout

    @staticmethod
    def _vai(message: Any) -> str:
        """LangChain đặt tên loại là system/human/ai; FPT dùng từ vựng OpenAI."""
        loai = getattr(message, "type", "") or ""
        return {"system": "system", "human": "user", "ai": "assistant"}.get(loai, "user")

    def invoke(self, messages: Any, stream: bool = False) -> _FptChatResponse:
        """`stream` nhận vào cho khớp chữ ký của `_invoke_chat` nhưng bị bỏ qua: phase
        này chỉ cần completion đồng bộ, và request luôn gửi `stream: false`."""
        import requests

        payload = {
            "model": self.model,
            "messages": [{"role": self._vai(m),
                          "content": lc_message_content_text(getattr(m, "content", ""))}
                         for m in messages],
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "stream": False,
        }
        try:
            r = requests.post(
                self._url,
                headers={"Content-Type": "application/json",
                         "Authorization": f"Bearer {self._api_key}"},
                json=payload,
                timeout=self.timeout,
            )
        except Exception as exc:
            # `exc` của requests không chứa header, nhưng vẫn chỉ lấy tên lớp + URL
            # để chắc chắn không có gì từ Authorization lọt ra log.
            raise RuntimeError(
                f"FPT request failed: {type(exc).__name__} khi gọi {self._url}") from None

        if r.status_code >= 400:
            raise RuntimeError(
                f"FPT HTTP {r.status_code}: {r.text[:200]}")

        try:
            body = r.json()
        except ValueError:
            raise RuntimeError(
                f"FPT trả về thân không phải JSON: {r.text[:200]}") from None

        # FPT gói mã lỗi nghiệp vụ TRONG thân, kèm HTTP 200. Không kiểm thì một
        # {"code": 500, "data": null} sẽ đi tiếp và vỡ ở bước bóc `data`.
        ma = body.get("code")
        if ma is not None and int(ma) >= 400:
            raise RuntimeError(
                f"FPT API error code={ma}: {str(body.get('message'))[:200]}")

        # FPT trả HAI hình dạng tuỳ endpoint/model. Tài liệu marketplace mô tả bản có
        # wrapper `data`, nhưng `gpt-oss-120b` (đo thật 2026-09-03) trả thẳng hình dạng
        # OpenAI phẳng, không có `data`. Nhận cả hai thay vì cược vào một bản.
        goi = body.get("data")
        loi = goi if isinstance(goi, dict) else body
        choices = loi.get("choices")
        if not isinstance(choices, list) or not choices:
            raise RuntimeError(
                f"FPT thiếu `choices` (đã thử cả `data.choices` lẫn `choices`): "
                f"{str(body)[:200]}")
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        if not isinstance(message, dict) or "content" not in message:
            raise RuntimeError(
                f"FPT thiếu `choices[0].message.content`: {str(body)[:200]}")

        return _FptChatResponse(lc_message_content_text(message.get("content")))


def _fpt_chat_llm(feature: str = "chat", options: dict | None = None,
                  timeout: float | None = None) -> Any:
    api_key = (os.getenv("FPT_AI_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("Missing FPT_AI_API_KEY for FPT provider.")
    base_url = (os.getenv("FPT_AI_BASE_URL") or FPT_DEFAULT_BASE_URL).strip()
    model = (os.getenv("FPT_AI_CHAT_MODEL") or FPT_DEFAULT_CHAT_MODEL).strip()

    max_tokens = _DEFAULT_LLM_OUT
    if options:
        # `num_predict` là từ vựng của Ollama; caller (mindmap) đã dùng nó để hạ trần
        # output, nên tôn trọng cả hai tên thay vì bắt caller biết provider nào đang chạy.
        for khoa in ("max_tokens", "num_predict"):
            if khoa in options:
                max_tokens = int(options[khoa])
                break

    # Không dựng hệ timeout mới: lấy timeout của lời gọi, thiếu thì dùng đúng
    # `AI_TIMEOUT_SEC` mà phần còn lại của ứng dụng đã dùng.
    giay = timeout if (timeout is not None and timeout > 0) else float(
        os.getenv("AI_TIMEOUT_SEC", "180"))

    return _FptChatLLM(
        api_key=api_key,
        base_url=base_url,
        model=model,
        temperature=_resolve_temperature(feature, options),
        max_tokens=max_tokens,
        timeout=giay,
    )


def _gemini_chat_llm(feature: str = "chat", options: dict | None = None) -> Any:
    from langchain_google_genai import ChatGoogleGenerativeAI

    api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("Missing GEMINI_API_KEY for Gemini provider.")
    model = os.getenv("GEMINI_CHAT_MODEL", "gemini-2.5-flash")
    max_out = _DEFAULT_LLM_OUT
    temp = _resolve_temperature(feature, options)
    try:
        return ChatGoogleGenerativeAI(
            model=model,
            api_key=api_key,
            temperature=temp,
            max_output_tokens=max_out,
        )
    except TypeError:
        return ChatGoogleGenerativeAI(model=model, api_key=api_key, temperature=temp)


def _groq_chat_llm(feature: str = "chat", options: dict | None = None) -> Any:
    from langchain_groq import ChatGroq

    api_key = (os.getenv("GROQ_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("Missing GROQ_API_KEY for Groq provider.")
    model = os.getenv("GROQ_CHAT_MODEL", "llama-3.3-70b-versatile")
    return ChatGroq(
        model=model,
        api_key=api_key,
        temperature=_resolve_temperature(feature, options),
        max_tokens=_DEFAULT_LLM_OUT,
    )


def lc_message_content_text(content: Any) -> str:
    """Chuẩn hoá message.content (str | list blocks | None) thành một chuỗi — stream/invoke LC đôi khi trả list."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                t = block.get("text") or block.get("content")
                if isinstance(t, str):
                    parts.append(t)
            else:
                tx = getattr(block, "text", None)
                if isinstance(tx, str):
                    parts.append(tx)
        return "".join(parts)
    return str(content)


def lc_ai_message_text(message: Any) -> str:
    """Lấy text hiển thị từ AIMessage — kể cả reasoning_content/thinking nếu content rỗng (Ollama think)."""
    base = lc_message_content_text(getattr(message, "content", None))
    if base.strip():
        return base
    ak = getattr(message, "additional_kwargs", None) or {}
    for key in ("reasoning_content", "thinking"):
        v = ak.get(key)
        if isinstance(v, str) and v.strip():
            return v
    return base


def lc_ai_chunk_text(chunk: Any) -> str:
    """Tương tự lc_ai_message_text cho chunk khi stream."""
    base = lc_message_content_text(getattr(chunk, "content", None))
    if base.strip():
        return base
    ak = getattr(chunk, "additional_kwargs", None) or {}
    for key in ("reasoning_content", "thinking"):
        v = ak.get(key)
        if isinstance(v, str) and v.strip():
            return v
    return base


def stream_chat_tokens(llm: Any, messages: list) -> Iterator[str]:
    """Yield nội dung token/chunk từ LangChain chat model (.stream)."""
    for chunk in llm.stream(messages):
        piece = lc_ai_chunk_text(chunk)
        if piece:
            yield piece


def get_llm(feature: str = "chat") -> Any:
    """
    LLM chính cho chain (LangChain) — luôn dùng Ollama local.
    feature: 'chat' -> SLM_MODEL_CHAT (mặc định DEFAULT_LOCAL_MODEL)
    """
    return _ollama_chat_llm(None, feature, None)


_emb_instance: Any = None
_emb_bound_name: str | None = None


def _late_chunking_enabled() -> bool:
    """Late chunking bật? (env LATE_CHUNKING, mặc định ON). Đọc env trực tiếp để không
    phụ thuộc thứ tự reload settings trong test."""
    return (os.getenv("LATE_CHUNKING", "1") or "").strip().lower() in ("1", "true", "yes", "on")


class LateChunkEmbeddings(_LCEmbeddings):
    """langchain Embeddings dùng encoder mean-pool (late chunking) cho query-time.
    PHẢI cùng pooling với vector chunk đã index → cosine query↔chunk có nghĩa.
    PHẢI subclass Embeddings: LC FAISS isinstance-check, không thì bị coi là callable."""

    def __init__(self, encoder: Any) -> None:
        self._enc = encoder

    def embed_query(self, text: str) -> list[float]:
        return np.asarray(self._enc.embed_query(text), dtype=np.float32).reshape(-1).tolist()

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        arr = np.atleast_2d(np.asarray(self._enc.encode(list(texts), convert_to_numpy=True), dtype=np.float32))
        return [row.tolist() for row in arr]


def get_embeddings() -> Any:
    """
    Lazy singleton embeddings.
    - SKIP_MODEL_LOAD=1 → FakeEmbeddings.
    - Late chunking ON (mặc định) → LateChunkEmbeddings (mean-pool, cùng encoder với ingest).
    - Tắt → HuggingFaceEmbeddings (CLS) như cũ.
    """
    global _emb_instance, _emb_bound_name

    from langchain_core.embeddings import Embeddings

    if os.getenv("SKIP_MODEL_LOAD") == "1":
        from langchain_core.embeddings.fake import FakeEmbeddings

        return FakeEmbeddings(size=384)

    if _late_chunking_enabled():
        from app.domains.ingest.late_chunk import get_late_chunk_encoder

        # KHÔNG fallback all-MiniLM (max 512 → vỡ late chunking): để encoder áp default
        # bge-m3 khi EMBEDDING_MODEL_NAME chưa set. Bind theo tên model đã resolve để
        # get_embeddings/get_embedding_model dùng CÙNG encoder.
        enc = get_late_chunk_encoder(os.getenv("EMBEDDING_MODEL_NAME") or None)
        bound = f"late:{enc.model_name}"
        if _emb_instance is not None and _emb_bound_name == bound:
            return _emb_instance
        _emb_instance = LateChunkEmbeddings(enc)
        _emb_bound_name = bound
        return _emb_instance

    model_name = os.getenv("EMBEDDING_MODEL_NAME", "sentence-transformers/all-MiniLM-L6-v2")
    if _emb_instance is not None and _emb_bound_name == model_name:
        return _emb_instance

    from langchain_huggingface import HuggingFaceEmbeddings

    # `use_safetensors=True` là BẮT BUỘC, không phải tối ưu.
    #
    # `transformers` mới từ chối `torch.load` mọi checkpoint `.bin` khi torch < 2.6
    # (CVE-2025-32434) và ném thẳng ValueError. bge-m3 có CẢ HAI định dạng trong
    # kho, nhưng sentence-transformers chọn `.bin` nên nạp là chết. Đường ingest
    # của app không lộ ra lỗi này vì late chunking dùng loader riêng — chỉ những
    # nhánh đi qua get_embeddings() với LATE_CHUNKING=0 mới dính, và đó đúng là
    # cách bộ dựng index ablation (R0/R1) chạy.
    from shared.device import torch_device

    _emb_instance = HuggingFaceEmbeddings(
        model_name=model_name,
        model_kwargs={"device": torch_device(), "model_kwargs": {"use_safetensors": True}},
        encode_kwargs={"normalize_embeddings": True, "batch_size": 32},
    )
    _emb_bound_name = model_name
    assert isinstance(_emb_instance, Embeddings)
    return _emb_instance


_EMB_QUERY_VEC_CACHE: OrderedDict[str, np.ndarray] = OrderedDict()
QUERY_EMBED_CACHE_MAX = int(os.getenv("QUERY_EMBED_CACHE_MAX", "512"))


def clear_embeddings_cache() -> None:
    global _emb_instance, _emb_bound_name, _EMB_QUERY_VEC_CACHE
    _emb_instance = None
    _emb_bound_name = None
    _EMB_QUERY_VEC_CACHE.clear()


def encode_query_cached(query: str, model_name: Optional[str] = None) -> Optional[np.ndarray]:
    """
    Cache embedding vector cho một câu query (retrieve). LRU theo md5(query_normalized).
    Trả về float32 shape (1, dim) hoặc None (CI / lỗi).
    """
    global _EMB_QUERY_VEC_CACHE

    if os.getenv("SKIP_MODEL_LOAD") == "1":
        return None
    q = (query or "").strip()
    if not q:
        return None
    key = hashlib.md5(q.lower().encode("utf-8")).hexdigest()
    if key in _EMB_QUERY_VEC_CACHE:
        _EMB_QUERY_VEC_CACHE.move_to_end(key)
        return _EMB_QUERY_VEC_CACHE[key]

    m = get_embedding_model(model_name)
    if m is None:
        return None
    v = m.encode([q], convert_to_numpy=True).astype("float32")
    _EMB_QUERY_VEC_CACHE[key] = v
    _EMB_QUERY_VEC_CACHE.move_to_end(key)
    while len(_EMB_QUERY_VEC_CACHE) > QUERY_EMBED_CACHE_MAX:
        _EMB_QUERY_VEC_CACHE.popitem(last=False)
    return v


# --- Embedding adapter (.encode tương thích SentenceTransformer) ---
DEFAULT_EMBEDDING_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
DEFAULT_MODEL_NAME = DEFAULT_EMBEDDING_MODEL_NAME


class LangChainEmbeddingAdapter:
    """Tương thích .encode() như SentenceTransformer cho index / memory_tree / mindmap."""

    def encode(
        self,
        texts: list[str] | str,
        convert_to_numpy: bool = True,
        batch_size: int = 32,
        show_progress_bar: bool = False,
        **kwargs: Any,
    ) -> Any:
        emb = get_embeddings()
        if isinstance(texts, str):
            v = emb.embed_query(texts)
            return np.array(v, dtype=np.float32)

        vecs: list[list[float]] = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            vecs.extend(emb.embed_documents(batch))
        out = np.array(vecs, dtype=np.float32)
        return out if convert_to_numpy else out.tolist()


_emb_adapter_cache: Optional[LangChainEmbeddingAdapter] = None
_emb_adapter_name: Optional[str] = None


def get_embedding_model(model_name: Optional[str] = None) -> Optional[LangChainEmbeddingAdapter]:
    """SKIP_MODEL_LOAD=1 → None. Đổi model_name → cập nhật env + clear cache embeddings."""
    global _emb_adapter_cache, _emb_adapter_name

    if os.getenv("SKIP_MODEL_LOAD") == "1":
        return None

    # Late chunking: embed CỤC BỘ bằng encoder mean-pool (bỏ qua gateway Embed — model/pooling
    # của gateway khác → cosine query↔chunk sai). Encoder .encode() tương thích SentenceTransformer.
    # BỎ QUA model_name của caller: late chunking là scheme TOÀN CỤC → MỘT encoder duy nhất
    # (env EMBEDDING_MODEL_NAME hoặc bge-m3). Nhiều caller truyền MODEL_NAME = all-MiniLM (default
    # khi env chưa set) → nếu tôn trọng sẽ tách không gian embedding (MiniLM 384 vs bge-m3 1024).
    if _late_chunking_enabled():
        from app.domains.ingest.late_chunk import get_late_chunk_encoder

        return get_late_chunk_encoder(os.getenv("EMBEDDING_MODEL_NAME") or None)

    _addr = _gateway_addr()
    if _addr:
        # Embed qua llm-gateway (giữ MỘT model embedding cho cả hệ thống).
        _name = model_name or os.environ.get("EMBEDDING_MODEL_NAME", DEFAULT_EMBEDDING_MODEL_NAME)
        return _grpc_embedding_provider(_addr, _name)

    name = model_name or os.environ.get("EMBEDDING_MODEL_NAME", DEFAULT_EMBEDDING_MODEL_NAME)
    env_name = os.environ.get("EMBEDDING_MODEL_NAME", DEFAULT_EMBEDDING_MODEL_NAME)

    if name != env_name:
        os.environ["EMBEDDING_MODEL_NAME"] = name
        clear_embeddings_cache()
        _emb_adapter_cache = None
        _emb_adapter_name = None

    if _emb_adapter_cache is not None and _emb_adapter_name == name:
        return _emb_adapter_cache

    clear_embeddings_cache()
    get_embeddings()
    _emb_adapter_cache = LangChainEmbeddingAdapter()
    _emb_adapter_name = name
    return _emb_adapter_cache


def ask_ai(
    prompt: str,
    system_prompt: str | None = None,
    model: str | None = None,
    options: dict | None = None,
    feature: str = "chat",
    timeout: float | None = None,
) -> str:
    """Gọi AI qua Ollama. `feature` xác định model mặc định khi `model` không truyền.
    feature='chat'    -> SLM_MODEL_CHAT (mặc định DEFAULT_LOCAL_MODEL)
    feature='summary' -> SLM_MODEL_SUMMARY (dùng cho summarize_advanced, memory_tree)
    feature='mindmap' -> MINDMAP_MODEL
    timeout: số giây tối đa cho LLM call (None = không giới hạn)
    """
    # Phase 0 observability: đếm MỘT lần cho mỗi invocation (cả nhánh gateway lẫn
    # in-process; cache hit không đi qua ask_ai). Đếm không bao giờ chặn call.
    try:
        from app.graphs.logger import note_llm_call
        note_llm_call()
    except Exception:
        pass
    _addr = _gateway_addr()
    if _addr:
        # Định tuyến qua llm-gateway. Temperature resolve theo `feature` ở PHÍA SERVER
        # (ProviderPool.ask → builder nhận feature) cho đồng nhất cả 3 provider — KHÔNG
        # inject temp client-side (proto3 double không phân biệt 0.0-đặt-rõ vs mặc định,
        # truthy-check ở server sẽ rớt 0.0). Override per-call (mindmap) vẫn đi qua options.
        return _grpc_llm_provider(_addr).ask(
            prompt,
            system_prompt=system_prompt,
            model=model,
            options=options,
            feature=feature,
            timeout=timeout,
        )

    last_error: Exception | None = None
    errors: list[str] = []

    # Nếu không truyền model cụ thể, tự động chọn theo feature
    effective_model = model or _model_map(feature)

    # PR#4: một slot cho TOÀN BỘ vòng fallback provider (retry không bypass cap,
    # mirror gateway). Quá hạn chờ → RuntimeError → error-path degraded sẵn có.
    with _inproc_slot():
        for provider in PROVIDERS:
            try:
                if provider == "ollama":
                    llm = _ollama_chat_llm(effective_model, feature, options)
                    return _invoke_chat(llm, prompt, system_prompt, timeout=timeout)

                if provider == "fpt":
                    llm = _fpt_chat_llm(feature, options, timeout=timeout)
                    return _invoke_chat(llm, prompt, system_prompt, timeout=timeout)

                if provider == "gemini":
                    llm = _gemini_chat_llm(feature, options)
                    return _invoke_chat(llm, prompt, system_prompt, timeout=timeout)

                if provider == "groq":
                    llm = _groq_chat_llm(feature, options)
                    return _invoke_chat(llm, prompt, system_prompt, timeout=timeout)
            except Exception as e:
                # Chỉ giữ `last_error` là nuốt mất lỗi của provider ĐẦU. Khi Ollama
                # timeout rồi rơi sang Gemini hết hạn key, thông báo cuối là "Gemini
                # 401" — người đọc đi sửa nhầm chỗ hoàn toàn. Log từng provider và
                # gộp hết vào lỗi cuối.
                errors.append(f"{provider}: {type(e).__name__}: {str(e)[:200]}")
                print(f"[llm] provider '{provider}' thất bại (feature={feature}, "
                      f"model={effective_model}): {type(e).__name__}: {str(e)[:200]}",
                      flush=True)
                last_error = e
                continue

    if not PROVIDERS:
        raise RuntimeError(
            "No AI provider configured. Set OLLAMA_HOST for local Ollama, or set "
            "FPT_AI_API_KEY/GEMINI_API_KEY/GROQ_API_KEY."
        )

    raise RuntimeError(
        "All AI providers failed — " + " | ".join(errors or [str(last_error)]))


def summarize_results(query: str, chunks: list[str], model: str | None = None) -> str:
    sources = "\n".join(f"{i + 1}. {c}" for i, c in enumerate(chunks))
    system_prompt = (
        "Bạn là trợ lý nghiên cứu cá nhân. Trả lời bằng tiếng Việt, tự nhiên, đi thẳng vào nội dung.\n"
        "Chỉ dùng thông tin có trong các đoạn trích người dùng cung cấp; nếu thiếu thì nói rõ thiếu."
    )
    _cite_on = (os.getenv("ENABLE_QUERY_CITATION_PROMPT", "0") or "").strip().lower() in ("1", "true", "yes", "on")
    if _cite_on:
        extra = (os.getenv("QUERY_CITATION_SYSTEM_SUFFIX") or "").strip()
        if not extra:
            extra = (
                "\n\nQuy tắc trích dẫn:\n"
                "- Các đoạn tài liệu có dạng [Nguồn: tên_file, đoạn N].\n"
                "- Khi dùng ý từ một đoạn, ghi rõ (Nguồn: tên_file, đoạn N) trong câu trả lời.\n"
                "- Nếu không có trong đoạn đã cho, nói rõ không tìm thấy trong tài liệu."
            )
        system_prompt = system_prompt + "\n" + extra
    user_msg = (
        f"Câu hỏi: {query}\n\n"
        f"Nội dung liên quan từ tài liệu:\n{sources}\n\n"
        "Hãy trả lời trực tiếp câu hỏi, mạch lạc."
    )
    # feature='answer' → factual temperature (≈0): bám đoạn trích, giảm bịa đặt.
    return ask_ai(user_msg, system_prompt=system_prompt, model=model, feature="answer")
