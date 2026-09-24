"""Read-only, persisted context for a single mind-map node.

This module deliberately contains no generation or retrieval calls.  It maps the
stored mind-map record and persisted chunk metadata into the inspector contract,
while callers provide the owner checks and chunk-text reader.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any


def _as_ref(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def build_node_context(
    record: Mapping[str, Any],
    node_id: str,
    *,
    chunk_meta: Callable[[str], Mapping[str, Any] | None],
    chunk_text: Callable[[str], str | None],
    source_info: Callable[[str], Mapping[str, Any] | None],
    source_allowed: Callable[[str], bool],
) -> dict[str, Any] | None:
    nodes = [item for item in (record.get("nodes") or []) if isinstance(item, Mapping)]
    node = next((item for item in nodes if _as_ref(item.get("id")) == _as_ref(node_id)), None)
    if node is None:
        return None

    missing: list[str] = []
    citations: list[dict[str, Any]] = []
    seen_chunks: set[str] = set()
    refs = node.get("chunk_refs") or node.get("chunkRefs") or []
    if not isinstance(refs, list):
        refs = []
    for raw_ref in refs:
        ref = _as_ref(raw_ref)
        if not ref or ref in seen_chunks:
            continue
        seen_chunks.add(ref)
        meta = chunk_meta(ref)
        if not isinstance(meta, Mapping):
            missing.append(f"chunk:{ref}")
            continue
        stem = _as_ref(meta.get("source_stem") or meta.get("source_id"))
        if not stem or not source_allowed(stem):
            missing.append(f"chunk:{ref}")
            continue
        text = chunk_text(ref)
        if text is None:
            missing.append(f"chunk_text:{ref}")
            continue
        source = source_info(stem) or {}
        location = {key: meta[key] for key in ("page", "page_number", "location", "heading_path", "start", "end") if meta.get(key) is not None}
        citations.append({
            "source_id": _as_ref(source.get("id") or source.get("source_id") or stem),
            "source_name": _as_ref(source.get("display_name") or source.get("filename") or stem),
            "chunk_id": ref,
            "excerpt": text,
            "location": location,
        })
    if refs and not citations:
        missing.append("citations")
    elif not refs:
        missing.append("citations")

    relations: list[dict[str, Any]] = []
    current = _as_ref(node_id)
    for relation in (record.get("relations") or []):
        if not isinstance(relation, Mapping):
            continue
        source = _as_ref(relation.get("source"))
        target = _as_ref(relation.get("target"))
        if current not in (source, target):
            continue
        evidence_refs = relation.get("evidence_refs") or relation.get("chunk_refs") or relation.get("refs") or []
        relations.append({
            "target_node_id": target if source == current else source,
            "type": _as_ref(relation.get("type")) or "relates_to",
            "label": _as_ref(relation.get("label")),
            "evidence_refs": list(evidence_refs) if isinstance(evidence_refs, list) else [],
        })

    generator = record.get("generator") if isinstance(record.get("generator"), Mapping) else {}
    persisted_missing = generator.get("missing") if isinstance(generator.get("missing"), list) else []
    all_missing = list(dict.fromkeys([str(item) for item in persisted_missing if item] + missing))
    result: dict[str, Any] = {
        "node_id": current,
        "topic": _as_ref(node.get("topic") or node.get("title")),
        "explanation": _as_ref(node.get("explanation") or node.get("note")),
        "node_type": _as_ref(node.get("node_type") or node.get("kind")),
        "source_id": node.get("source_id"),
        "chunk_id": node.get("chunk_id"),
        "citations": citations,
        "relations": relations,
        "missing": all_missing,
        "degraded": bool(generator.get("degraded") or all_missing),
    }
    if isinstance(node.get("confidence"), (int, float)):
        result["confidence"] = node["confidence"]
    return result
