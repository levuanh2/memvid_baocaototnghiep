"""
interfaces/ — các Protocol (PEP 544, structural typing) định nghĩa seam của hệ thống.

Mục tiêu "liên kết dẻo": code lõi phụ thuộc vào *interface*, còn implementation
(local in-process hay gRPC client) được *inject* lúc wiring. Dùng typing.Protocol
nên các class hiện có (LangChainEmbeddingAdapter, HybridRetriever, vector_store)
khớp interface mà KHÔNG cần kế thừa — đổi tối thiểu, không phá vỡ hành vi.
"""

from .errors import (
    EMBEDDING_PROVIDER_AUTH_FAILED,
    EMBEDDING_PROVIDER_UNAVAILABLE,
    EMBEDDING_REQUEST_FAILED,
    INDEX_INCOMPATIBLE,
    INDEX_MISSING,
    EmbeddingError,
    EmbeddingProviderAuthFailed,
    EmbeddingProviderUnavailable,
    EmbeddingRequestFailed,
    ma_loi,
    thong_diep,
)
from .llm import EmbeddingProvider, LLMProvider
from .object_storage import ObjectStorage
from .retriever import RetrievedChunk, Retriever
from .vectorstore import VectorStore

__all__ = [
    "EmbeddingError",
    "EmbeddingProviderAuthFailed",
    "EmbeddingProviderUnavailable",
    "EmbeddingRequestFailed",
    "INDEX_INCOMPATIBLE",
    "INDEX_MISSING",
    "EMBEDDING_PROVIDER_AUTH_FAILED",
    "EMBEDDING_PROVIDER_UNAVAILABLE",
    "EMBEDDING_REQUEST_FAILED",
    "ma_loi",
    "thong_diep",
    "LLMProvider",
    "EmbeddingProvider",
    "ObjectStorage",
    "VectorStore",
    "Retriever",
    "RetrievedChunk",
]
