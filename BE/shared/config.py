"""
Settings tập trung — nạp env MỘT lần thay vì os.getenv() rải rác lúc import.

Phạm vi (cố ý hẹp): chỉ gom các knob *cross-cutting* mà nhiều module/giai đoạn
dùng chung (provider, model, timeout, RRF/top_k, toggle LC, địa chỉ service gRPC).
Các tham số chỉ dùng cục bộ trong 1 node vẫn để inline.

Dùng:
    from shared.config import get_settings
    s = get_settings()
    if s.crag_enabled: ...

get_settings() trả singleton (đọc env lần đầu, cache lại). Gọi reload() trong test
sau khi đổi env (tương tự cách conftest reload llm_factory).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List, Optional

# Model local mặc định khi KHÔNG có env nào đặt. Phải VỪA VRAM của máy yếu nhất mà
# dự án nhắm tới (ở đây 6 GiB): qwen2.5:14b nặng 9.95 GB, qwen3.5:9b nặng 6.59 GB,
# qwen3.6:35b-a3b thì chưa từng được pull về. Cả ba từng là default rải rác trong mã,
# và cả ba đều là lý do hai buổi debug "sinh mãi không xong" (.playbook 2026-08-26/27).
# Đổi ở ĐÂY, không đổi rải rác — 12 chỗ hardcode là cách nó quay lại lần trước.
DEFAULT_LOCAL_MODEL = "qwen2.5:7b-instruct"

DEFAULT_EMBEDDING_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"


def _flag(name: str, default: str = "0") -> bool:
    return (os.getenv(name, default) or "").strip().lower() in ("1", "true", "yes", "on")


def _int(name: str, default: int) -> int:
    try:
        return int((os.getenv(name) or "").strip() or default)
    except (TypeError, ValueError):
        return default


def _float(name: str, default: float) -> float:
    try:
        return float((os.getenv(name) or "").strip() or default)
    except (TypeError, ValueError):
        return default


def _compute_providers() -> List[str]:
    """Thứ tự fallback provider — giống logic llm_factory hiện tại nhưng KHÔNG
    chạy lúc import module; chỉ chạy khi get_settings() được gọi."""
    providers: List[str] = []
    has_gemini = bool((os.getenv("GEMINI_API_KEY") or "").strip())
    has_groq = bool((os.getenv("GROQ_API_KEY") or "").strip())
    has_any_remote = has_gemini or has_groq
    if (os.getenv("OLLAMA_HOST") or "").strip() or (not has_any_remote):
        providers.append("ollama")
    if has_gemini:
        providers.append("gemini")
    if has_groq:
        providers.append("groq")
    return providers


@dataclass(frozen=True)
class Settings:
    # --- Providers (runtime-configurable: ProviderPool sẽ dùng cái này) ---
    providers: List[str] = field(default_factory=_compute_providers)
    ollama_host: str = ""
    gemini_chat_model: str = "gemini-2.5-flash"
    groq_chat_model: str = "llama-3.3-70b-versatile"

    # --- Models theo feature ---
    model_chat: str = DEFAULT_LOCAL_MODEL
    model_summary: str = DEFAULT_LOCAL_MODEL
    model_mindmap: str = DEFAULT_LOCAL_MODEL

    # --- Embedding ---
    embedding_model_name: str = DEFAULT_EMBEDDING_MODEL_NAME
    query_embed_cache_max: int = 512
    skip_model_load: bool = False
    # Late chunking (mặc định ON): embed toàn văn + mean-pool theo span; query/chunk CÙNG
    # encoder mean-pool. Tắt (LATE_CHUNKING=0) = đường embed cũ (CLS) — cho tình huống khẩn.
    late_chunking: bool = True

    # --- LLM params ---
    llm_max_tokens: int = 8192
    llm_temperature: float = 0.3  # chat hội thoại (văn phong tự nhiên)
    # Tác vụ factual/grounded (sinh đáp án RAG, summary, grade): tiến về 0 để
    # bám sự thật + tái lập, giảm bịa đặt. (xem .playbook/lessons-learned)
    llm_temperature_factual: float = 0.0
    llm_ctx_size: int = 4096
    ai_timeout_sec: int = 180

    # --- Toggles LangChain: KHÔNG có ở đây, CỐ Ý (gỡ 2026-08-29) ---
    # `use_lc_vector_store/ensemble/qa_chain/ingest` từng là 4 trường ở đây với default
    # True, và KHÔNG AI ĐỌC chúng — mã thật đọc thẳng env, mỗi chỗ một default:
    #     vectorstore/store.py:64   os.getenv("USE_LC_VECTOR_STORE", "0")   <- NGƯỢC
    #     graphs/query_graph.py     os.getenv("USE_LC_ENSEMBLE"/"USE_LC_QA_CHAIN", "1")
    #     graphs/ingest_graph.py    os.getenv("USE_LC_INGEST", "1")
    # `conftest.py` đặt MEMVID_DISABLE_LC_DEFAULTS=1 nên tầng setdefault của env_loader im,
    # và khi đó config nói BẬT còn store nói TẮT cho cùng một câu hỏi. Giữ 4 trường chết ở
    # đây nguy hiểm hơn bỏ: người đọc file này tin nó là nguồn sự thật.
    # Nguồn sự thật thật sự = biến env; điểm đọc duy nhất cho vector store là
    # `store._use_lc_vector_store()`.

    # --- Retrieval (RRF + hybrid weights) ---
    hybrid_top_k: int = 4
    rrf_k: int = 60
    hybrid_bm25_weight: float = 0.4
    hybrid_faiss_weight: float = 0.6
    crag_enabled: bool = True
    crag_relevance_threshold: float = 0.25
    crag_wrong_floor: float = 0.1
    crag_rewrite_max: int = 2
    supervisor_enabled: bool = False
    hitl_enabled: bool = True

    # --- Conversation Context Layer (follow-up awareness) ---
    # Mặc định OFF → /query hành xử y hệt hôm nay. Khi bật: lưu turn hội thoại,
    # dựng ngữ cảnh source-scoped, viết lại câu follow-up trước khi retrieve.
    conversation_context_enabled: bool = False

    # --- Rerank (Two-Stage Retrieval — Stage 2 / Precision) ---
    # Mặc định ON; có thể tắt cho ablation. Stage 1 lấy rerank_candidate_k
    # ứng viên (rộng), cross-encoder lọc xuống rerank_top_n (= hybrid_top_k nếu 0).
    rerank_enabled: bool = True
    rerank_backend: str = "cross_encoder"  # cross_encoder | cohere | llm | none
    rerank_model: str = "BAAI/bge-reranker-v2-m3"
    rerank_candidate_k: int = 20
    rerank_top_n: int = 0  # 0 => dùng hybrid_top_k
    rerank_batch: int = 16
    rerank_timeout_sec: int = 10

    # --- NLI / contradiction-check (khử trùng context TRƯỚC khi sinh đáp án) ---
    # Mặc định ON; có thể tắt cho ablation. Quét các cặp chunk top-K
    # bằng NLI đa ngữ, hạ/loại chunk mâu thuẫn (phủ định/thời gian/con số) hạng thấp.
    # Model mặc định đổi 2026-09-01: mDeBERTa-v3-base mất 137s cho MỘT lượt forward
    # (batch 2 x 512 token) trên CPU máy này — nút thắt là gather/index tuần tự của
    # attention tách rời DeBERTa-v3, không phải FLOP. MiniLMv2-L6 cùng việc: 0.18s,
    # nhanh hơn 764 lần, và phân loại đúng 6/6 trên bộ thử tiếng Việt có dấu.
    nli_enabled: bool = True
    nli_model: str = "MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli"
    nli_contradiction_threshold: float = 0.6  # prob 'contradiction' tối thiểu để tính là xung đột
    # Đo thực trên CPU máy dev: 3 cặp chunk dài (6 forward) ≈ 66s → để 90s có đệm.
    # Có GPU/model nhanh hơn thì hạ timeout xuống. (xem .playbook/known-issues)
    nli_timeout_sec: int = 90
    nli_max_pairs: int = 3  # trần số cặp chunk đem đi NLI (kiểm soát latency)

    # --- Địa chỉ service gRPC (Phase 3/4). Rỗng => dùng impl local in-process. ---
    llm_gateway_addr: str = ""
    mindmap_service_addr: str = ""

    # --- Ingest data-quality (Raw->Cleaned->Structured->Enriched) ---
    use_markdown_ingest: bool = True       # convert sang MD + chunk theo heading
    md_dir: str = ""                       # nơi lưu .md artifact (rỗng = BE_ROOT/cleaned_md)
    chunk_strategy: str = "markdown_header"  # markdown_header | recursive | semantic
    chunk_size: int = 1200
    chunk_overlap: int = 180
    enrich_metadata: bool = True           # gán source/category/date/language/heading (rẻ, không cần LLM)
    contextual_embeddings: bool = False    # chèn câu định vị đầu chunk (tốn 1 LLM call/chunk)
    hypo_qa: bool = False                   # sinh câu hỏi giả định (tốn LLM/chunk)
    doc_category: str = "general"

    # --- Summary v3 ---
    # Mặc định OFF → tóm tắt hành xử y hệt Summary v2 (không có facts). Khi bật:
    # mỗi section trả thêm "facts" ledger (canonical IR), summary suy từ facts.
    summary_facts: bool = False
    # Phase 5: coverage judge (JUDGE-ONLY, mặc định OFF). Bật → sau khi record đã build/dedup,
    # 1 LLM judge chấm coverage/faithfulness → record["coverage"]. KHÔNG viết lại summary,
    # KHÔNG auto-repair. Judge lỗi/JSON hỏng → bỏ qua, không làm hỏng job tóm tắt.
    summary_coverage: bool = False

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            providers=_compute_providers(),
            ollama_host=(os.getenv("OLLAMA_HOST") or "").strip(),
            gemini_chat_model=os.getenv("GEMINI_CHAT_MODEL", "gemini-2.5-flash"),
            groq_chat_model=os.getenv("GROQ_CHAT_MODEL", "llama-3.3-70b-versatile"),
            model_chat=os.getenv("SLM_MODEL_CHAT", os.getenv("SLM_MODEL", DEFAULT_LOCAL_MODEL)),
            model_summary=os.getenv("SLM_MODEL_SUMMARY", DEFAULT_LOCAL_MODEL),
            model_mindmap=os.getenv("MINDMAP_MODEL", DEFAULT_LOCAL_MODEL),
            embedding_model_name=os.getenv("EMBEDDING_MODEL_NAME", DEFAULT_EMBEDDING_MODEL_NAME),
            query_embed_cache_max=_int("QUERY_EMBED_CACHE_MAX", 512),
            skip_model_load=_flag("SKIP_MODEL_LOAD"),
            late_chunking=_flag("LATE_CHUNKING", "1"),
            llm_max_tokens=_int("LLM_MAX_TOKENS", 8192),
            llm_temperature=_float("LLM_TEMPERATURE", 0.3),
            llm_temperature_factual=_float("LLM_TEMPERATURE_FACTUAL", 0.0),
            llm_ctx_size=_int("LLM_CTX_SIZE", 4096),
            ai_timeout_sec=_int("AI_TIMEOUT_SEC", 180),
            hybrid_top_k=_int("HYBRID_TOP_K", 4),
            rrf_k=_int("RRF_K", 60),
            hybrid_bm25_weight=_float("HYBRID_BM25_WEIGHT", 0.4),
            hybrid_faiss_weight=_float("HYBRID_FAISS_WEIGHT", 0.6),
            crag_enabled=_flag("CRAG_ENABLED", "1"),
            crag_relevance_threshold=_float("CRAG_RELEVANCE_THRESHOLD", 0.25),
            crag_wrong_floor=_float("CRAG_WRONG_FLOOR", 0.1),
            crag_rewrite_max=_int("CRAG_REWRITE_MAX", 2),
            supervisor_enabled=_flag("SUPERVISOR_ENABLED", "0"),
            hitl_enabled=_flag("HITL_ENABLED", "1"),
            conversation_context_enabled=_flag("CONVERSATION_CONTEXT_ENABLED", "0"),
            rerank_enabled=_flag("RERANK_ENABLED", "1"),
            rerank_backend=os.getenv("RERANK_BACKEND", "cross_encoder"),
            rerank_model=os.getenv("RERANK_MODEL", "BAAI/bge-reranker-v2-m3"),
            rerank_candidate_k=_int("RERANK_CANDIDATE_K", 20),
            rerank_top_n=_int("RERANK_TOP_N", 0),
            rerank_batch=_int("RERANK_BATCH", 16),
            rerank_timeout_sec=_int("RERANK_TIMEOUT_SEC", 10),
            nli_enabled=_flag("NLI_ENABLED", "1"),
            nli_model=os.getenv("NLI_MODEL", "MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli"),
            nli_contradiction_threshold=_float("NLI_CONTRADICTION_THRESHOLD", 0.6),
            nli_timeout_sec=_int("NLI_TIMEOUT_SEC", 90),
            nli_max_pairs=_int("NLI_MAX_PAIRS", 3),
            llm_gateway_addr=(os.getenv("LLM_GATEWAY_ADDR") or "").strip(),
            mindmap_service_addr=(os.getenv("MINDMAP_SERVICE_ADDR") or "").strip(),
            use_markdown_ingest=_flag("USE_MARKDOWN_INGEST", "1"),
            md_dir=(os.getenv("MD_DIR") or "").strip(),
            chunk_strategy=os.getenv("CHUNK_STRATEGY", "markdown_header"),
            chunk_size=_int("CHUNK_SIZE", 1200),
            chunk_overlap=_int("CHUNK_OVERLAP", 180),
            enrich_metadata=_flag("ENRICH_METADATA", "1"),
            contextual_embeddings=_flag("CONTEXTUAL_EMBEDDINGS", "0"),
            hypo_qa=_flag("HYPO_QA", "0"),
            doc_category=os.getenv("DOC_CATEGORY", "general"),
            summary_facts=_flag("SUMMARY_FACTS", "0"),
            summary_coverage=_flag("SUMMARY_COVERAGE", "0"),
        )


_settings: Optional[Settings] = None


def get_settings() -> Settings:
    """Singleton — đọc env lần đầu rồi cache."""
    global _settings
    if _settings is None:
        _settings = Settings.from_env()
    return _settings


def reload() -> Settings:
    """Đọc lại env (dùng trong test sau khi đổi biến môi trường)."""
    global _settings
    _settings = Settings.from_env()
    return _settings
