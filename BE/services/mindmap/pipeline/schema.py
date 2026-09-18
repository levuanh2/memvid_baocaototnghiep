"""Schema v2 mindmap: MỘT artifact nodes(tree) + relations(cross-edges) + provenance."""
from __future__ import annotations

import hashlib
import os
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from pydantic import BaseModel, Field

PIPELINE_VERSION = "skeleton_v4_5_intrablock"
LAYOUT_VERSION = "side-balanced-v2"
GENERATION_PROFILE = "learning-map-v2"
MAX_TOPIC_LENGTH = 100


def _env_int(name: str, default: int) -> int:
    try:
        return int((os.getenv(name) or "").strip() or default)
    except (TypeError, ValueError):
        return default


# PHASE 1 (MindMap V2, Task 4 — docs/MINDMAP_V2_AUDIT.md §3 H10, §13 P0 #2):
# hai trần này từng là hằng số cứng — giờ đọc từ env (đọc MỘT LẦN lúc import,
# cùng cách `shared/config.py` làm với CHUNK_SIZE/CHUNK_OVERLAP), tên biến
# GIỮ NGUYÊN nên `s.MAX_NODES` vẫn đọc đúng giá trị hiện hành ở mọi call site
# cũ. Việc cap tự nó KHÔNG bị bỏ — audit chỉ yêu cầu đừng cap TRONG IM LẶNG;
# xem `sanitize_nodes(..., on_truncate=...)` bên dưới cho phần báo cáo.
MAX_NODES = _env_int("MINDMAP_MAX_NODES", 120)
MAX_RELATIONS = _env_int("MINDMAP_MAX_RELATIONS", 20)
KINDS = ("root", "section", "idea", "detail")
REL_TYPES = ("relates_to", "leads_to", "causes", "supports", "contrasts", "contains")
_KIND_PRIORITY = {"root": 0, "section": 1, "idea": 2, "detail": 3}


def compact_topic(value: str, max_length: int = MAX_TOPIC_LENGTH) -> str:
    """Keep node topics scannable; retain the full explanation in ``note``."""
    text = " ".join(str(value or "").split())
    if len(text) <= max_length:
        return text
    limit = max(12, max_length - 1)
    boundary = text[:limit + 1].rfind(" ")
    cut = boundary if boundary >= 12 else limit
    return text[:cut].rstrip() + "…"


class NodeV2(BaseModel):
    id: str
    parent: Optional[str] = None
    kind: str = "idea"
    title: str
    note: str = ""
    chunk_refs: list[str] = Field(default_factory=list)
    order: int = 0
    # PHASE 1 additive fields (docs/MINDMAP_V2_PHASE1_DESIGN.md) — default giữ
    # bản ghi CŨ (không có 3 field này) load được y nguyên, Pydantic tự điền default.
    document_order: int = 0   # Task 6: vị trí GỐC trong tài liệu, không chỉ thứ tự anh em
    number: str = ""          # Task 2: numbering tách riêng ("1.2.1"), KHÔNG thay title
    level: int = 0            # Task 3: cấp heading (0 = không đến từ heading tree)
    # PHASE 2B additive field (docs/MINDMAP_V2_PHASE2B.md) — LLM enrichment
    # NEVER touches id/parent/kind/title/order/document_order/number/level
    # (hierarchy is frozen); it only ever appends here. One entry per
    # SemanticNode under this node's OWN direct content (never merged across
    # siblings — Task 3), length == number of semantic items fed in, ALWAYS
    # (degraded/empty entries on failure, never a shorter list — Task 4/6).
    enrichment: list[dict] = Field(default_factory=list)
    # Quality V3.5 (Sprint C.5, Task 2) additive field — metadata only, no FE
    # rendering added this sprint (frontend out of scope). One of: heading_tree,
    # memory_merge, semantic_group, llm_enrichment, deterministic_recovery,
    # manual. "" for legacy records/any path that predates this field —
    # Pydantic's default keeps old records loading unchanged, same convention
    # as every other additive field above.
    created_by: str = ""
    # Source spans and construction-time counts; not enrichment or analytics.
    deterministic_concept: dict = Field(default_factory=dict)
    concept_completeness: dict = Field(default_factory=dict)


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


def sanitize_nodes(nodes: list[dict], *, max_nodes: int | None = None,
                   on_truncate: Callable[[int], None] | None = None) -> list[dict]:
    """Dedupe id, kind lạ → idea, mồ côi → về root, cap max_nodes (root/section ưu tiên giữ).

    `max_nodes` mặc định `None` → dùng `MAX_NODES` module-level (env-configurable,
    Task 4). `on_truncate(dropped_count)` — nếu có — được gọi ĐÚNG khi cap này
    thật sự cắt bớt node, để caller (vd `mindmap_graph.py::assemble_node`) ghi
    lại lý do cụ thể vào `generator.missing` thay vì cắt trong im lặng như
    trước (docs/MINDMAP_V2_AUDIT.md §3 H10). Không truyền `on_truncate` → hành
    vi y hệt bản cũ, chỉ cắt, không báo gì thêm ngoài dòng log dưới đây.
    """
    cap = MAX_NODES if max_nodes is None else max_nodes
    seen: set[str] = set()
    clean: list[dict] = []
    for n in nodes or []:
        try:
            payload = {**n, "kind": n.get("kind") if n.get("kind") in KINDS else "idea"}
            original_title = str(payload.get("title") or "").strip()
            payload["title"] = compact_topic(original_title)
            if original_title != payload["title"] and not str(payload.get("note") or "").strip():
                payload["note"] = original_title
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
    if len(clean) > cap:
        clean.sort(key=lambda n: (_KIND_PRIORITY.get(n["kind"], 9), n["order"]))
        kept = clean[:cap]
        kept_ids = {n["id"] for n in kept}
        kept = [n for n in kept if n["parent"] is None or n["parent"] in kept_ids]
        dropped = len(clean) - len(kept)
        print(f"[mindmap] sanitize_nodes: dropped {dropped} node(s) past cap {cap}")
        if on_truncate is not None and dropped > 0:
            on_truncate(dropped)
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
                 degraded_missing: list[str], skeleton_method: str = "") -> dict:
    return {
        "id": str(uuid.uuid4()),
        "schema_version": 2,
        "layout_version": LAYOUT_VERSION,
        "generation_profile": GENERATION_PROFILE,
        "title": title,
        "sources": list(sources or []),
        "content_hash": content_hash_value,
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "nodes": nodes,
        "relations": relations,
        "generator": {
            "pipeline": PIPELINE_VERSION,
            "model": model,
            "elapsed_sec": round(float(elapsed_sec), 1),
            "degraded": bool(degraded_missing),
            "missing": list(degraded_missing or []),
            # Provenance: khung xương đến từ đâu (headings/tree_sections/clusters/
            # llm_outline/single) — không có nó thì record đã lưu không chẩn đoán được.
            "skeleton_method": skeleton_method or "",
            "layout_version": LAYOUT_VERSION,
            "generation_profile": GENERATION_PROFILE,
        },
    }
