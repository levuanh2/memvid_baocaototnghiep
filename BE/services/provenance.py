"""Deterministic source provenance helpers for generated artifacts.

This module has no I/O and never infers provenance from titles or generated
text. A source is attached only when a referenced chunk resolves to a known
canonical stem. Missing or unresolved references return ``None`` so callers
can omit the optional field rather than asserting an empty result.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from shared.source_id import canonical_source_stem


def _keys_for_chunk(chunk: Mapping[str, Any]) -> list[str]:
    keys = chunk.get("chunk_keys")
    if not keys and chunk.get("key") is not None:
        keys = [chunk["key"]]
    return [str(key) for key in (keys or []) if key is not None]


def build_chunk_source_index(mm_input: Mapping[str, Any] | None) -> dict[str, set[str]]:
    """Return every chunk-key -> known source-stem mapping in input order."""
    index: dict[str, set[str]] = {}
    for chunk in (mm_input or {}).get("chunks") or []:
        if not isinstance(chunk, Mapping):
            continue
        raw = chunk.get("source_stem")
        stem = canonical_source_stem(str(raw or "")) if raw else ""
        if not stem:
            continue
        for key in _keys_for_chunk(chunk):
            index.setdefault(key, set()).add(stem)
    return index


def source_stems_for_refs(refs: Iterable[Any] | None,
                          chunk_index: Mapping[str, set[str]]) -> list[str] | None:
    """Resolve refs to sorted unique stems, or ``None`` if not fully resolvable.

    A node/section is provenance-safe only when every non-empty ref resolves to
    at least one source. Empty refs and unknown refs therefore produce ``None``.
    """
    normalized = [str(ref) for ref in (refs or []) if ref is not None and str(ref)]
    if not normalized:
        return None
    stems: set[str] = set()
    for ref in normalized:
        found = chunk_index.get(ref)
        if not found:
            return None
        stems.update(found)
    return sorted(stems) or None


def attach_node_source_stems(nodes: list[dict], mm_input: Mapping[str, Any] | None) -> list[dict]:
    """Copy nodes and attach optional source_stems after node sanitization."""
    index = build_chunk_source_index(mm_input)
    out: list[dict] = []
    for node in nodes or []:
        item = dict(node)
        stems = source_stems_for_refs(item.get("chunk_refs"), index)
        if stems is not None:
            item["source_stems"] = stems
        else:
            item.pop("source_stems", None)
        out.append(item)
    return out


def attach_section_source_stems(sections: list[dict], mm_input: Mapping[str, Any] | None) -> list[dict]:
    """Copy summary sections and attach optional source_stems after sanitize."""
    index = build_chunk_source_index(mm_input)
    out: list[dict] = []
    for section in sections or []:
        item = dict(section)
        stems = source_stems_for_refs(item.get("chunk_refs"), index)
        if stems is not None:
            item["source_stems"] = stems
        else:
            item.pop("source_stems", None)
        out.append(item)
    return out


def source_stems_for_single_document(source_stem: Any) -> list[str] | None:
    """Return one canonical stem for a current single-document StudyMap."""
    stem = canonical_source_stem(str(source_stem or ""))
    return [stem] if stem else None
