"""Typed, deterministic helpers for Guided Mind Map V3 request intent.

Suggestions are derived only from the selected source chunks.  This module does
not call an LLM and never accepts client-supplied evidence as authoritative.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

PRESETS = {"overview", "concepts", "process", "comparison", "study"}
DETAIL_LEVELS = {"compact", "balanced", "detailed"}


def normalize_intent(data: dict[str, Any]) -> dict[str, Any]:
    preset = str(data.get("preset") or "overview").strip().lower()
    detail = str(data.get("detail_level") or "balanced").strip().lower()
    if preset not in PRESETS:
        raise ValueError("preset không hợp lệ")
    if detail not in DETAIL_LEVELS:
        raise ValueError("detail_level không hợp lệ")
    instruction = str(data.get("instruction") or "").strip()
    if len(instruction) > 2000:
        raise ValueError("instruction vượt quá 2000 ký tự")
    topics = data.get("selected_topics") or []
    if not isinstance(topics, list):
        topics = []
    topic_ids = data.get("selected_topic_ids") or []
    if not isinstance(topic_ids, list):
        topic_ids = []
    return {
        "instruction": instruction,
        "selected_topic_ids": [str(x)[:160] for x in topic_ids[:12]],
        "selected_topics": [str(x).strip()[:160] for x in topics[:12] if str(x).strip()],
        "preset": preset,
        "detail_level": detail,
        "locale": str(data.get("locale") or "vi")[:16],
    }


def _stable_id(title: str, refs: list[str]) -> str:
    raw = title.casefold() + "|" + "|".join(refs)
    return "topic-" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def suggest_topics(mm_input: dict[str, Any], query: str = "") -> list[dict[str, Any]]:
    chunks = mm_input.get("chunks") or []
    candidates: list[tuple[str, list[str]]] = []
    for chunk in chunks:
        heading = " ".join(str(chunk.get("heading_path") or "").split()).strip()
        if heading:
            candidates.append((heading.split("/")[-1].strip(), [str(chunk.get("chunk_id"))]))
    if not candidates:
        for chunk in chunks[:24]:
            text = " ".join(str(chunk.get("text") or "").split())
            match = re.match(r"(.{3,90}?)(?:[.!?:]|$)", text)
            if match:
                candidates.append((match.group(1).strip(), [str(chunk.get("chunk_id"))]))
    grouped: dict[str, list[str]] = {}
    for title, refs in candidates:
        clean = " ".join(title.split())
        if len(clean) < 3:
            continue
        grouped.setdefault(clean.casefold(), []).extend(refs)
    query_norm = str(query or "").casefold().strip()
    rows = []
    for key, refs in grouped.items():
        title = key[:120].strip().capitalize()
        if query_norm and query_norm not in key:
            continue
        refs = sorted(set(refs))
        rows.append({
            "id": _stable_id(title, refs),
            "title": title,
            "rationale": "Chủ đề được suy ra từ tiêu đề/đoạn đã index của tài liệu đã chọn.",
            "evidence_refs": [{"chunk_id": ref} for ref in refs[:8]],
            "evidence_count": len(refs),
        })
    return rows[:12]


def intent_hash(base_hash: str, intent: dict[str, Any]) -> str:
    payload = json.dumps(intent, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256((base_hash + "|guided-v3|" + payload).encode("utf-8")).hexdigest()
