"""Schema v2 mindmap: MỘT artifact nodes(tree) + relations(cross-edges) + provenance."""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field

PIPELINE_VERSION = "skeleton_v3"
MAX_NODES = 120
MAX_RELATIONS = 20
LAYOUT_VERSION = "side-balanced-v2"
GENERATION_PROFILE = "learning-map-v2"
GUIDED_GENERATION_PROFILE = "guided-learning-map-v3"
MAX_TOPIC_LENGTH = 100
KINDS = ("root", "section", "idea", "detail")
REL_TYPES = ("relates_to", "leads_to", "causes", "supports", "contrasts", "contains")
_KIND_PRIORITY = {"root": 0, "section": 1, "idea": 2, "detail": 3}


def compact_topic(value: str, max_length: int = MAX_TOPIC_LENGTH) -> str:
    """Keep node labels scannable while retaining source text in note."""
    text = " ".join(str(value or "").split())
    if len(text) <= max_length:
        return text
    cutoff = max_length - 1
    boundary = text.rfind(" ", 0, cutoff)
    return text[: boundary if boundary > 0 else cutoff].rstrip() + "…"


class NodeV2(BaseModel):
    id: str
    parent: Optional[str] = None
    kind: str = "idea"
    title: str
    note: str = ""
    chunk_refs: list[str] = Field(default_factory=list)
    order: int = 0


class RelationV2(BaseModel):
    source: str
    target: str
    type: str = "relates_to"
    label: str = ""


def content_hash(source_stems: list[str], chunk_texts: list[str],
                 chunk_headings: list[str] | None = None) -> str:
    """Cache key: đổi PIPELINE_VERSION là tự vô hiệu cache cũ.

    Hash CẢ heading_path: re-ingest phục hồi heading nhưng text không đổi phải
    ra hash MỚI, nếu không cache trả mãi bản mindmap nông cũ (không cần force).
    """
    h = hashlib.sha256()
    h.update(PIPELINE_VERSION.encode("utf-8"))
    for s in sorted(source_stems or []):
        h.update(b"\x00" + s.encode("utf-8"))
    for t in chunk_texts or []:
        h.update(b"\x01" + (t or "").encode("utf-8"))
    for hp in chunk_headings or []:
        h.update(b"\x02" + (hp or "").encode("utf-8"))
    return h.hexdigest()


def sanitize_nodes(nodes: list[dict]) -> list[dict]:
    """Dedupe id, kind lạ → idea, mồ côi → về root, cap MAX_NODES (root/section ưu tiên giữ)."""
    seen: set[str] = set()
    clean: list[dict] = []
    for n in nodes or []:
        try:
            original_title = " ".join(str(n.get("title") or "").split())
            payload = {**n, "kind": n.get("kind") if n.get("kind") in KINDS else "idea"}
            payload["title"] = compact_topic(original_title)
            if original_title and payload["title"] != original_title:
                payload["note"] = "\n\n".join(
                    part for part in (original_title, str(payload.get("note") or "")) if part
                )
            m = NodeV2(**payload)
        except Exception:
            continue
        if not m.id or m.id in seen or not (m.title or "").strip():
            continue
        seen.add(m.id)
        clean.append(m.model_dump())
    root = next((n for n in clean if n["parent"] is None or n["kind"] == "root"), None)
    if root is None:
        return []
    root["parent"], root["kind"] = None, "root"
    ids = {n["id"] for n in clean}
    for n in clean:
        if n["id"] != root["id"] and (n["parent"] not in ids or n["parent"] == n["id"]):
            n["parent"] = root["id"]
    if len(clean) > MAX_NODES:
        clean.sort(key=lambda n: (_KIND_PRIORITY.get(n["kind"], 9), n["order"]))
        kept = clean[:MAX_NODES]
        kept_ids = {n["id"] for n in kept}
        kept = [n for n in kept if n["parent"] is None or n["parent"] in kept_ids]
        clean = kept
    return clean


def validate_relations(relations: list[dict], nodes: list[dict]) -> list[dict]:
    ids = {n["id"] for n in nodes or []}
    tree_edges = {(n["parent"], n["id"]) for n in nodes or [] if n.get("parent")}
    out: list[dict] = []
    seen: set[tuple] = set()
    for r in relations or []:
        try:
            m = RelationV2(**{**r, "type": r.get("type") if r.get("type") in REL_TYPES else "relates_to"})
        except Exception:
            continue
        key = (m.source, m.target)
        if (m.source not in ids or m.target not in ids or m.source == m.target
                or key in tree_edges or (key[1], key[0]) in tree_edges or key in seen):
            continue
        seen.add(key)
        out.append(m.model_dump())
        if len(out) >= MAX_RELATIONS:
            break
    return out


def build_record(*, title: str, sources: list[str], nodes: list[dict], relations: list[dict],
                 content_hash_value: str, model: str, elapsed_sec: float,
                 degraded_missing: list[str], skeleton_method: str = "",
                 generation_intent: Optional[dict] = None, job_id: Optional[str] = None) -> dict:
    guided = generation_intent is not None
    generator = {
        "pipeline": PIPELINE_VERSION,
        "model": model,
        "elapsed_sec": round(float(elapsed_sec), 1),
        "degraded": bool(degraded_missing),
        "missing": list(degraded_missing or []),
        "skeleton_method": skeleton_method or "",
    }

    if guided:
        generator.update({"generation_intent": dict(generation_intent), "job_id": job_id or ""})
    return {
        "id": str(uuid.uuid4()),
        "schema_version": 3 if guided else 2,
        "layout_version": LAYOUT_VERSION,
        "generation_profile": GUIDED_GENERATION_PROFILE if guided else GENERATION_PROFILE,
        "title": title,
        "sources": list(sources or []),
        "content_hash": content_hash_value,
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "nodes": nodes,
        "relations": relations,
        "generator": generator,
    }


def validate_v3_record(record: dict) -> list[str]:
    """Return bounded structural/semantic issues for a guided record."""
    issues: list[str] = []
    nodes = record.get("nodes") or []
    roots = [n for n in nodes if n.get("parent") is None or n.get("kind") == "root"]
    if len(roots) != 1:
        issues.append("v3_invalid_root")
    ids = {n.get("id") for n in nodes}
    for n in nodes:
        label = str(n.get("title") or "")
        if len(label) > MAX_TOPIC_LENGTH or len(label.split()) > 12:
            issues.append("v3_label_too_long")
            break
    for parent in {n.get("parent") for n in nodes}:
        labels = [str(n.get("title") or "").casefold() for n in nodes if n.get("parent") == parent]
        if len(labels) != len(set(labels)):
            issues.append("v3_duplicate_sibling")
            break
    for relation in record.get("relations") or []:
        if relation.get("source") not in ids or relation.get("target") not in ids:
            issues.append("v3_relation_endpoint")
            break
    return list(dict.fromkeys(issues))
    if guided:
        generator.update({"generation_intent": dict(generation_intent), "job_id": job_id or ""})
    return {
        "id": str(uuid.uuid4()),
        "schema_version": 3 if guided else 2,
        "layout_version": LAYOUT_VERSION,
        "generation_profile": GUIDED_GENERATION_PROFILE if guided else GENERATION_PROFILE,
        "title": title,
        "sources": list(sources or []),
        "content_hash": content_hash_value,
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "nodes": nodes,
        "relations": relations,
        "generator": generator,
        "_legacy_generator": {
            "pipeline": PIPELINE_VERSION,
            "model": model,
            "elapsed_sec": round(float(elapsed_sec), 1),
            "degraded": bool(degraded_missing),
            "missing": list(degraded_missing or []),
            # Provenance: khung xương đến từ đâu (headings/tree_sections/clusters/
            # llm_outline/single) — không có nó thì record đã lưu không chẩn đoán được.
            "skeleton_method": skeleton_method or "",
        },
    }
