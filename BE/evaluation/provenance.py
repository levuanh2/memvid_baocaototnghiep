from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class ChunkResolver:
    """Resolve existing chunk IDs; unresolved IDs remain explicit and never get invented text."""

    def __init__(self, index_meta_path: Path):
        self.index_meta_path = Path(index_meta_path)

    def _records(self) -> dict[int, dict]:
        if not self.index_meta_path.exists():
            return {}
        raw = json.loads(self.index_meta_path.read_text(encoding="utf-8")) or {}
        return {int(k): v for k, v in raw.items() if str(k).isdigit() and isinstance(v, dict)}

    def resolve(self, chunk_ids: list[int]) -> list[dict[str, Any]]:
        records = self._records()
        out = []
        for cid in chunk_ids:
            rec = records.get(int(cid))
            if rec is None:
                out.append({"chunk_id": int(cid), "resolved": False, "source_id": None, "text": None})
                continue
            out.append({
                "chunk_id": int(cid), "resolved": True,
                "source_id": rec.get("source_stem") or rec.get("video"),
                "text": rec.get("text"), "metadata": {k: rec.get(k) for k in ("heading", "category", "language") if rec.get(k) is not None},
            })
        return out


def export_answer_path(*, path: str, answer_payload: dict, resolver: ChunkResolver) -> dict:
    ids = [int(x) for x in (answer_payload.get("evidence_chunk_ids") or [])]
    evidence = resolver.resolve(ids)
    return {
        "path": path, "answer": answer_payload.get("answer"), "source_ids": sorted({str(x["source_id"]) for x in evidence if x.get("source_id")}),
        "chunk_ids": ids, "evidence": evidence,
        "provenance_complete": bool(ids) and all(x["resolved"] for x in evidence),
    }


def export_cache_record(cache_record: dict, resolver: ChunkResolver) -> dict:
    provenance = cache_record.get("evaluation_provenance") or {}
    ids = [int(x) for x in provenance.get("chunk_ids") or []]
    evidence = resolver.resolve(ids)
    return {
        "path": "cache", "origin_path": provenance.get("path"),
        "answer": (cache_record.get("payload") or {}).get("answer"),
        "source_ids": provenance.get("source_ids") or [], "chunk_ids": ids,
        "evidence": evidence, "provenance_complete": bool(ids) and all(x["resolved"] for x in evidence),
    }
