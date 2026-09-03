"""
Rerank (Two-Stage Retrieval — Stage 2 / Precision).

Stage 1 (Recall) ở HybridRetriever trả candidate pool rộng (bi-encoder, nhanh).
Stage 2 (Precision) ở đây dùng cross-encoder chấm (query, passage) cùng lúc nên
hiểu ngữ cảnh sâu hơn, rồi lọc xuống top_n để đưa vào LLM.

Thiết kế (mirror app.clients.llm_factory.get_embedding_model):
  - lazy-load + cache model, guard SKIP_MODEL_LOAD,
  - MỌI lỗi load/predict → fallback IdentityReranker (giữ nguyên thứ tự) để
    không bao giờ làm vỡ pipeline truy hồi.

Backend cắm-rút qua RERANK_BACKEND:
  - cross_encoder (mặc định): sentence_transformers.CrossEncoder — đã có sẵn dep.
  - fpt: FPT AI Marketplace `/rerank`, model `bge-reranker-v2-m3` — CÙNG model với
    default cross_encoder, chỉ khác chỗ chạy. Không nạp weight nên hợp với môi
    trường 512 MB không nạp nổi 568M tham số.
  - cohere: gọi Cohere Rerank API (lazy-import 'cohere', cần API key + internet).
  - llm: tái dùng get_llm() làm LLM-as-reranker.
  - none/identity: passthrough.
"""

from __future__ import annotations

import logging
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout
from typing import List, Optional, Protocol, Tuple, runtime_checkable

from shared.config import get_settings

logger = logging.getLogger(__name__)


@runtime_checkable
class Reranker(Protocol):
    def rerank(
        self, query: str, texts: List[str], *, top_n: Optional[int] = None
    ) -> List[Tuple[int, float]]:
        """Trả về [(index_trong_texts, relevance_score)] đã sắp giảm dần, cắt top_n."""
        ...


def _clip_top_n(n: int, top_n: Optional[int]) -> int:
    if top_n is None or top_n <= 0:
        return n
    return min(n, top_n)


class IdentityReranker:
    """Giữ nguyên thứ tự (fallback an toàn / backend=none)."""

    def rerank(
        self, query: str, texts: List[str], *, top_n: Optional[int] = None
    ) -> List[Tuple[int, float]]:
        n = _clip_top_n(len(texts), top_n)
        return [(i, 0.0) for i in range(len(texts))][:n]


class CrossEncoderReranker:
    """sentence-transformers CrossEncoder (self-host, offline)."""

    def __init__(self, model_name: str, *, batch_size: int = 16) -> None:
        self.model_name = model_name
        self.batch_size = max(1, int(batch_size))
        self._model = None  # lazy
        self._lock = threading.Lock()  # chống double-load khi warmup + node chạy song song
        self._warmed = False  # đã warm đường inference (forward mồi) chưa

    def _ensure_model(self):
        if self._model is None:  # double-checked locking
            with self._lock:
                if self._model is None:
                    from sentence_transformers import CrossEncoder

                    from shared.device import torch_device

                    # max_length tránh OOM với chunk dài; bge-reranker-v2-m3 tới 8K.
                    # Đặt device TƯỜNG MINH: CrossEncoder tự dò CUDA, nên nếu không
                    # nói rõ thì nó có thể lên GPU trong khi các model khác ở CPU —
                    # tốn VRAM ngoài dự tính và làm số đo không tái lập được.
                    self._model = CrossEncoder(self.model_name, max_length=512, device=torch_device())
        return self._model

    def rerank(
        self, query: str, texts: List[str], *, top_n: Optional[int] = None
    ) -> List[Tuple[int, float]]:
        if not texts:
            return []
        model = self._ensure_model()
        pairs = [(query, t or "") for t in texts]
        scores = model.predict(pairs, batch_size=self.batch_size)
        ranked = sorted(
            ((i, float(s)) for i, s in enumerate(scores)),
            key=lambda x: x[1],
            reverse=True,
        )
        return ranked[: _clip_top_n(len(ranked), top_n)]


# Backend gọi API từ xa: KHÔNG nạp weight nào vào tiến trình này. Phân biệt quan
# trọng vì `SKIP_MODEL_LOAD=1` tồn tại để chặn nạp weight (RAM), không phải để tắt
# rerank — production chạy cờ đó và vẫn cần rerank.
_REMOTE_BACKENDS = frozenset({"fpt", "cohere"})

FPT_DEFAULT_RERANK_MODEL = "bge-reranker-v2-m3"


class FptReranker:
    """FPT AI Marketplace `/rerank`.

    Hợp đồng đã đo thật 2026-09-04 (không lấy từ tài liệu):
        POST {base}/rerank {"model", "query", "documents", "top_n"}
        200 -> {"results": [{"index", "relevance_score", "document"}], "object": "rerank"}
    `results` trả về ĐÃ SẮP giảm dần theo `relevance_score` — đúng thứ tự
    `Reranker.rerank` cam kết, nên không sắp lại; nhưng cũng không phụ thuộc vào đó:
    `rerank_texts` chỉ đọc cặp (index, score).

    `document` mặc định là null (chỉ có khi gửi `return_documents`), nên KHÔNG đọc
    trường ấy — index mới là thứ ánh xạ ngược về `texts`.

    Mọi lỗi thành RuntimeError để `rerank_texts` bắt và giữ nguyên thứ tự: rerank
    hỏng phải làm truy hồi kém đi, không được làm nó vỡ.
    """

    def __init__(self, model_name: str) -> None:
        self.model_name = (model_name or "").strip() or FPT_DEFAULT_RERANK_MODEL

    def rerank(
        self, query: str, texts: List[str], *, top_n: Optional[int] = None
    ) -> List[Tuple[int, float]]:
        if not texts:
            return []
        import requests

        from app.clients.llm_factory import fpt_api_key, fpt_base_url, fpt_headers

        if not fpt_api_key():
            raise RuntimeError("FPT_AI_API_KEY rỗng")
        n = _clip_top_n(len(texts), top_n)
        payload = {"model": self.model_name, "query": query,
                   "documents": [str(t) for t in texts], "top_n": n}
        try:
            r = requests.post(fpt_base_url() + "/rerank", headers=fpt_headers(),
                              json=payload, timeout=get_settings().rerank_timeout_sec)
        except Exception as exc:
            raise RuntimeError(f"FPT rerank request lỗi: {type(exc).__name__}") from None
        if r.status_code >= 400:
            raise RuntimeError(f"FPT rerank HTTP {r.status_code}: {r.text[:200]}")
        try:
            body = r.json()
        except ValueError:
            raise RuntimeError(f"FPT rerank thân không phải JSON: {r.text[:200]}") from None

        # Cùng phòng thủ như client chat: chấp nhận cả bản bọc `data` lẫn bản phẳng,
        # vì marketplace không đồng nhất giữa các model.
        goi = body.get("data")
        loi = goi if isinstance(goi, dict) else body
        results = loi.get("results")
        if not isinstance(results, list):
            raise RuntimeError(f"FPT rerank thiếu `results`: {str(body)[:200]}")

        ra: List[Tuple[int, float]] = []
        for it in results:
            if not isinstance(it, dict) or "index" not in it:
                raise RuntimeError(f"FPT rerank phần tử thiếu `index`: {str(it)[:120]}")
            idx = int(it["index"])
            if not 0 <= idx < len(texts):
                # Index ngoài khoảng = ánh xạ ngược sai chunk. Thà giữ nguyên thứ tự
                # còn hơn đưa nhầm đoạn văn vào ngữ cảnh của LLM.
                raise RuntimeError(f"FPT rerank trả index ngoài khoảng: {idx}")
            ra.append((idx, float(it.get("relevance_score") or 0.0)))
        return ra[:n]


class CohereReranker:
    """Cohere Rerank API (lazy-import; cần COHERE_API_KEY)."""

    def __init__(self, model_name: str) -> None:
        self.model_name = model_name or "rerank-multilingual-v3.0"
        self._client = None

    def _ensure_client(self):
        if self._client is None:
            import cohere

            key = (os.getenv("COHERE_API_KEY") or "").strip()
            if not key:
                raise RuntimeError("COHERE_API_KEY rỗng")
            self._client = cohere.Client(key)
        return self._client

    def rerank(
        self, query: str, texts: List[str], *, top_n: Optional[int] = None
    ) -> List[Tuple[int, float]]:
        if not texts:
            return []
        client = self._ensure_client()
        n = _clip_top_n(len(texts), top_n)
        resp = client.rerank(
            model=self.model_name, query=query, documents=list(texts), top_n=n
        )
        return [(int(r.index), float(r.relevance_score)) for r in resp.results]


class LLMReranker:
    """LLM-as-reranker — tái dùng get_llm(); chấm điểm 0-10 từng passage."""

    _SYS = (
        "Bạn là bộ chấm độ liên quan. Cho câu hỏi và một đoạn văn bản, "
        "trả về DUY NHẤT một số nguyên 0-10 thể hiện mức độ đoạn này trả lời "
        "được câu hỏi (10 = rất liên quan, 0 = không liên quan). Không giải thích."
    )

    def __init__(self, *, feature: str = "grade") -> None:
        # 'grade' → factual temperature (≈0): chấm điểm 0-10 cần tất định, không "sáng tạo".
        self.feature = feature

    def _score_one(self, query: str, text: str) -> float:
        from langchain_core.messages import HumanMessage, SystemMessage

        from app.clients.llm_factory import get_llm, lc_ai_message_text

        llm = get_llm(feature=self.feature)
        prompt = f"Câu hỏi: {query}\n\nĐoạn văn bản:\n{(text or '')[:2000]}"
        out = llm.invoke(
            [SystemMessage(content=self._SYS), HumanMessage(content=prompt)],
            stream=False,
        )
        raw = (lc_ai_message_text(out) or "").strip()
        m = re.search(r"\d+(?:\.\d+)?", raw)
        return float(m.group()) if m else 0.0

    def rerank(
        self, query: str, texts: List[str], *, top_n: Optional[int] = None
    ) -> List[Tuple[int, float]]:
        if not texts:
            return []
        scored = [(i, self._score_one(query, t)) for i, t in enumerate(texts)]
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[: _clip_top_n(len(scored), top_n)]


# --- Factory (cache theo backend+model) ---
_reranker_cache: Optional[Reranker] = None
_reranker_key: Optional[str] = None
_warmup_lock = threading.Lock()  # serialize warmup cold-path → warm đúng 1 lần
_IDENTITY = IdentityReranker()


def _build_reranker(backend: str, model_name: str, batch_size: int) -> Reranker:
    backend = (backend or "").strip().lower()
    if backend in ("", "none", "identity", "off"):
        return _IDENTITY
    if backend == "cross_encoder":
        return CrossEncoderReranker(model_name, batch_size=batch_size)
    if backend == "fpt":
        # Model rerank có biến RIÊNG: `RERANK_MODEL` mang tên HuggingFace
        # ("BAAI/bge-reranker-v2-m3") còn marketplace dùng tên trần
        # ("bge-reranker-v2-m3"). Cùng model, khác cách gọi tên.
        return FptReranker(os.getenv("FPT_AI_RERANK_MODEL") or FPT_DEFAULT_RERANK_MODEL)
    if backend == "cohere":
        return CohereReranker(model_name)
    if backend == "llm":
        return LLMReranker()
    logger.warning("RERANK_BACKEND không hợp lệ (%s) → identity.", backend)
    return _IDENTITY


def get_reranker() -> Reranker:
    """Singleton. SKIP_MODEL_LOAD=1 hoặc lỗi build → IdentityReranker."""
    global _reranker_cache, _reranker_key

    s = get_settings()
    if not s.rerank_enabled:
        return _IDENTITY

    # `SKIP_MODEL_LOAD=1` nghĩa là "đừng nạp weight vào tiến trình này", không phải
    # "đừng rerank". Backend từ xa không nạp gì nên cờ đó không áp cho nó — nếu áp,
    # production (đang chạy cờ này) sẽ im lặng mất hẳn tầng rerank.
    if os.getenv("SKIP_MODEL_LOAD") == "1" and (s.rerank_backend or "").strip().lower()             not in _REMOTE_BACKENDS:
        return _IDENTITY

    key = f"{s.rerank_backend}|{s.rerank_model}|{s.rerank_batch}"
    if _reranker_cache is not None and _reranker_key == key:
        return _reranker_cache

    try:
        _reranker_cache = _build_reranker(s.rerank_backend, s.rerank_model, s.rerank_batch)
    except Exception as exc:  # pragma: no cover - phòng thủ
        logger.warning("get_reranker: build thất bại (%s) → identity.", exc)
        _reranker_cache = _IDENTITY
    _reranker_key = key
    return _reranker_cache


def rerank_texts(
    query: str, texts: List[str], *, top_n: Optional[int] = None
) -> List[Tuple[int, float]]:
    """Wrapper an toàn: trả [(index, score)]; mọi lỗi predict → giữ nguyên thứ tự."""
    if not texts:
        return []
    reranker = get_reranker()
    try:
        out = reranker.rerank(query, texts, top_n=top_n)
        if out:
            return out
    except Exception as exc:
        logger.warning("rerank_texts: predict thất bại (%s) → giữ nguyên thứ tự.", exc)
    return _IDENTITY.rerank(query, texts, top_n=top_n)


def warmup(timeout_sec: float = 120.0) -> None:
    """Nạp model NGAY (đồng bộ), trước khi node chấm điểm trong vùng timeout inference.

    Vì sao: `_ensure_model()` (tải/khởi tạo CrossEncoder) là lazy nên lần đầu nó
    chạy NGAY TRONG block `result(timeout=RERANK_TIMEOUT)`. Trên CPU/cache nguội,
    thời gian tải model > timeout (mặc định 10s) → TimeoutError → rerank âm thầm
    fallback identity ở query ĐẦU TIÊN. Tách load ra ngoài để timeout chỉ bao
    inference. Có timeout riêng (rộng) để model lỗi không treo vô hạn.

    SKIP_MODEL_LOAD / backend không có model cục bộ (identity/cohere/llm) / lỗi → no-op.
    Idempotent: warm xong set cờ `_warmed` → các lần sau no-op (KHÔNG forward lại)."""
    if os.getenv("SKIP_MODEL_LOAD") == "1":
        return
    try:
        reranker = get_reranker()
    except Exception:  # pragma: no cover - get_reranker đã tự nuốt lỗi
        return
    ensure = getattr(reranker, "_ensure_model", None)
    if not callable(ensure):
        return  # identity/cohere/llm: không có model cục bộ cần preload
    if getattr(reranker, "_warmed", False):
        return  # hot-path (đã warm) → no-op rẻ, KHÔNG khoá, KHÔNG forward lại mỗi query

    def _load():
        ensure()
        # Warm cả đường INFERENCE: lần forward đầu tốn thêm JIT/trace (một-lần).
        # Chạy 1 cặp mồi để chi phí này nằm NGOÀI vùng timeout của node.
        try:
            reranker.rerank("warmup", ["warmup"], top_n=1)
        except Exception:  # pragma: no cover - mồi lỗi không sao
            pass
        reranker._warmed = True

    # Serialize cold-path: 2 query cold-start đồng thời chỉ 1 cái warm (cái kia
    # thấy _warmed=True ở double-check). Hot-path đã return ở trên nên không kẹt khoá.
    with _warmup_lock:
        if getattr(reranker, "_warmed", False):
            return
        if not (timeout_sec and timeout_sec > 0):
            try:
                _load()
            except Exception as exc:
                logger.warning("rerank.warmup: bỏ qua (%s).", exc)
            return

        # KHÔNG dùng `with ThreadPoolExecutor` (shutdown(wait=True) sẽ chặn tới khi load
        # xong → vô hiệu hoá timeout). shutdown(wait=False): hết timeout thì TRẢ NGAY,
        # model nạp tiếp ở nền, node tự xử lý (double-load đã được _lock của engine chặn).
        ex = ThreadPoolExecutor(max_workers=1)
        try:
            ex.submit(_load).result(timeout=timeout_sec)
        except FuturesTimeout:
            logger.warning("rerank.warmup: nạp model quá %ss → nạp tiếp ở nền, node tự xử lý.", timeout_sec)
        except Exception as exc:
            logger.warning("rerank.warmup: bỏ qua (%s).", exc)
        finally:
            ex.shutdown(wait=False)


def reset_cache() -> None:
    """Cho test sau khi đổi env (giống config.reload)."""
    global _reranker_cache, _reranker_key
    _reranker_cache = None
    _reranker_key = None
