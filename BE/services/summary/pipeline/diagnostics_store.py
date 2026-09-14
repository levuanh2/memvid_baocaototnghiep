"""P0.5 Blocker #1 — Summary per-section diagnostics persistence.

Mirrors `services/mindmap/analytics/store.py`'s own append-only JSONL pattern
(that module is reserved to the BE/Codex MindMap-quality workstream — this
is an independent, Summary-scoped implementation, not an import from it, and
not a modification of it) — one line per generation, best-effort, never
allowed to affect the summary job itself.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


def append_summary_diagnostics(document_id: str, sources: list[str],
                               section_diagnostics: list[dict], data_dir) -> None:
    """Append one JSONL record: {document_id, sources, sections, created_at}.
    Best-effort — callers wrap this in try/except; a write failure must
    never fail the summary job it's diagnosing."""
    path = Path(data_dir) / "summary_diagnostics_reports.jsonl"
    record = {
        "document_id": document_id,
        "sources": sources,
        "sections": section_diagnostics,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
