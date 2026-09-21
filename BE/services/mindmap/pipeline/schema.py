"""Schema v2 mindmap: MỘT artifact nodes(tree) + relations(cross-edges) + provenance."""
from __future__ import annotations

import hashlib
import uuid
from difflib import SequenceMatcher
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
REL_TYPES = ("relates_to", "leads_to", "causes", "supports", "contrasts", "contains",
             "part_of", "prerequisite", "cause_effect", "sequence", "contrast", "example", "related")
_KIND_PRIORITY = {"root": 0, "section": 1, "idea": 2, "detail": 3}
# node_type: compact SEMANTIC taxonomy, additive to (never replacing) `kind`.
# `kind` stays purely structural/depth-based (root/section/idea/detail) and is
# load-bearing for sort/repair below; node_type answers "what kind of
# knowledge unit is this" instead of "how deep is it". Old records without
# this field default to "concept" via NodeV2's field default — no migration
# needed, no break for existing V2 records.
NODE_TYPES = ("concept", "definition", "process", "cause_effect", "comparison", "example", "rule", "evidence")


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
    node_type: str = "concept"
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
            payload = {**n, "kind": n.get("kind") if n.get("kind") in KINDS else "idea",
                       "node_type": n.get("node_type") if n.get("node_type") in NODE_TYPES else "concept"}
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
                 generation_intent: Optional[dict] = None, job_id: Optional[str] = None,
                 generation_config: Optional[dict] = None) -> dict:
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
    record = {
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
    if guided:
        record["generation_config"] = dict(generation_config or {})
    return record


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
        parent = n.get("parent")
        if parent is not None and parent not in ids:
            issues.append("v3_orphan_node")
            break
    for node in nodes:
        seen: set[str] = set()
        current = node.get("id")
        while current is not None:
            if current in seen:
                issues.append("v3_hierarchy_cycle")
                break
            seen.add(current)
            parent = next((item.get("parent") for item in nodes if item.get("id") == current), None)
            current = parent
        if "v3_hierarchy_cycle" in issues:
            break
    for parent in {n.get("parent") for n in nodes}:
        labels = [str(n.get("title") or "").casefold() for n in nodes if n.get("parent") == parent]
        if len(labels) != len(set(labels)):
            issues.append("v3_duplicate_sibling")
            break
        for left_idx, left in enumerate(labels):
            if any(SequenceMatcher(None, left, right).ratio() >= 0.92 for right in labels[left_idx + 1:]):
                issues.append("v3_near_duplicate_sibling")
                break
        if "v3_near_duplicate_sibling" in issues:
            break
    for relation in record.get("relations") or []:
        if relation.get("source") not in ids or relation.get("target") not in ids:
            issues.append("v3_relation_endpoint")
            break
        if relation.get("type") not in REL_TYPES:
            issues.append("v3_relation_type")
            break
    config = record.get("generation_config") or {}
    known_refs = {str(ref) for ref in config.get("available_chunk_refs") or []}
    if known_refs and any(str(ref) not in known_refs for node in nodes for ref in node.get("chunk_refs") or []):
        issues.append("v3_citation_chunk_missing")
    budget = config.get("node_budget")
    if isinstance(budget, int) and len(nodes) > budget:
        issues.append("v3_detail_budget_exceeded")
    return list(dict.fromkeys(issues))


def repair_v3_record(record: dict, *, max_attempts: int = 2) -> tuple[dict, list[str]]:
    """Repair only deterministic, diagnosed shape errors; never invent evidence."""
    repaired = {**record, "nodes": [dict(node) for node in record.get("nodes") or []],
                "relations": [dict(rel) for rel in record.get("relations") or []]}
    issues: list[str] = []
    for _attempt in range(max(0, max_attempts)):
        before = validate_v3_record(repaired)
        if not before:
            break
        changed = False
        ids = {node.get("id") for node in repaired["nodes"]}
        root = next((node for node in repaired["nodes"] if node.get("kind") == "root"), None)
        root_id = root.get("id") if root else None
        if root_id:
            for node in repaired["nodes"]:
                if node.get("id") != root_id and node.get("parent") not in ids:
                    node["parent"] = root_id; changed = True
                if node.get("id") != root_id and node.get("parent") == node.get("id"):
                    node["parent"] = root_id; changed = True
        valid_relations = [rel for rel in repaired["relations"]
                           if rel.get("source") in ids and rel.get("target") in ids
                           and rel.get("type") in REL_TYPES]
        if len(valid_relations) != len(repaired["relations"]):
            repaired["relations"] = valid_relations; changed = True
        if not changed:
            issues.extend(before)
            break
        issues.extend(code for code in before if code not in issues)
    remaining = validate_v3_record(repaired)
    issues.extend(code for code in remaining if code not in issues)
    return repaired, list(dict.fromkeys(issues))
            # Provenance: khung xương đến từ đâu (headings/tree_sections/clusters/
            # llm_outline/single) — không có nó thì record đã lưu không chẩn đoán được.
