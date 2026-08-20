from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from evaluation import SCHEMA_VERSION


@dataclass
class QueryTrace:
    experiment_id: str
    run_id: str
    query_id: str
    original_query: str
    effective_query: str = ""
    rewritten_queries: list[str] = field(default_factory=list)
    selected_sources: list[str] = field(default_factory=list)
    runtime_path: str = "full_retrieval"
    chunking_mode: str = ""
    late_chunking_applied: bool | None = None
    bm25_candidates: list[dict] = field(default_factory=list)
    faiss_candidates: list[dict] = field(default_factory=list)
    fusion_candidates: list[dict] = field(default_factory=list)
    reranked_candidates: list[dict] = field(default_factory=list)
    nli: dict = field(default_factory=lambda: {"pairs": [], "removed_ids": [], "retained_ids": []})
    crag: dict = field(default_factory=lambda: {"rounds": [], "final_action": None})
    memory_tree: dict = field(default_factory=dict)
    final_evidence_ids: list[int] = field(default_factory=list)
    context_ids: list[int] = field(default_factory=list)
    system_answer: str = ""
    citations: list[dict] = field(default_factory=list)
    source_ids: list[str] = field(default_factory=list)
    hitl: dict | None = None
    timing_ms: dict[str, float] = field(default_factory=dict)
    llm_calls: list[dict] = field(default_factory=list)
    tokens: dict = field(default_factory=lambda: {"input": None, "output": None})
    fallback_degraded_flags: list[str] = field(default_factory=list)
    error: dict | None = None

    def as_dict(self) -> dict[str, Any]:
        return {"schema_version": SCHEMA_VERSION, **self.__dict__}


def append_jsonl(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")

