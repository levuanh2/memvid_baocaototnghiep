"""Gom input mindmap TẠI MONOLITH — worker/service không tự đọc đĩa (spec §4.1)."""
from __future__ import annotations

import json
from pathlib import Path

from shared.source_id import canonical_source_stem


def _load_tree_sections(stems: set[str]) -> list[dict]:
    """Section node từ memory tree của các source (fallback skeleton)."""
    try:
        from app.domains.memory.tree import _load_memory_trees
        out: list[dict] = []
        for tree in _load_memory_trees() or []:
            if canonical_source_stem(tree.get("source_stem") or "") not in stems:
                continue
            for n in tree.get("nodes") or []:
                if n.get("type") == "section" and (n.get("title") or "").strip():
                    out.append({"title": n["title"].strip(),
                                "chunk_refs": [str(r) for r in (n.get("chunk_refs") or [])]})
        return out
    except Exception:
        return []


def _title_for(source_names: list[str]) -> str:
    stems = [Path(s).stem for s in source_names if Path(s).stem]
    if not stems:
        return "Mind Map tổng hợp"
    if len(source_names) == 1:
        return stems[0]
    preview = ", ".join(stems[:3])
    if len(stems) > 3:
        preview += f" + {len(stems) - 3} nguồn"
    return f"Tổng hợp: {preview}"


def collect_mindmap_input(index_meta_path: Path, source_names: list[str]) -> dict:
    from app.domains.vectorstore import chunk_text_store

    wanted = {canonical_source_stem(s) for s in (source_names or []) if (s or "").strip()}
    wanted.discard("")
    with open(index_meta_path, encoding="utf-8") as f:
        meta = json.load(f)

    def _text(key: str, m: dict) -> str:
        try:
            t = (chunk_text_store.get_text(int(key)) or "").strip()
        except Exception:
            t = ""
        return t or (m.get("text") or "").strip()

    chunks: list[dict] = []
    for key, m in (meta or {}).items():
        if not isinstance(m, dict):
            continue
        stem = canonical_source_stem(m.get("source_stem") or "")
        if not stem or stem not in wanted:
            continue
        text = _text(key, m)
        if not text:
            continue
        c = {"key": str(key), "text": text,
             "heading_path": (m.get("heading_path") or "").strip(),
             "chunk_keys": [str(key)],
             "source_stem": stem}
        # Pointer metadata (Summary v3 Phase 2): ADDITIVE — chỉ gắn khi có, mindmap
        # bỏ qua field lạ (skeleton chỉ đọc heading_path/chunk_keys/text).
        if m.get("source_id"):
            c["source_id"] = str(m["source_id"])
        if m.get("page") is not None:
            c["page"] = m.get("page")
        if m.get("chunk_index") is not None:
            c["chunk_index"] = m.get("chunk_index")
        chunks.append(c)

    return {"title": _title_for(source_names), "sources": sorted(wanted),
            "chunks": chunks, "tree_sections": _load_tree_sections(wanted)}
