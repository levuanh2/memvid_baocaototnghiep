"""Đọc/ghi `knowledge_maps` / `knowledge_nodes` / `knowledge_edges` /
`knowledge_node_chunks` (đặc tả 5.5–5.8).

Mỗi lần tạo là MỘT map mới, không ghi đè map cũ: bản đồ cũ có thể đang được
`review_plan_items` / `questions` trỏ tới qua `knowledge_node_id`, xoá đi là mất
dấu vết bài đã làm.
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy import select

from app.db import session_scope
from app.db.models import (
    Document,
    KnowledgeEdge,
    KnowledgeMap,
    KnowledgeNode,
    KnowledgeNodeChunk,
)


def create_map(*, document_id: str, user_id: Optional[str], title: str) -> str:
    """`user_id` None = chế độ mở (`AUTH_PROTECT_APP_APIS` tắt) → gắn vào user ẩn danh.

    `knowledge_maps.user_id` là NOT NULL uuid, mà `str(None)` ra chuỗi `"None"` —
    Postgres từ chối với `invalid input syntax for type uuid: "None"` và người dùng
    chỉ thấy job error kèm nguyên văn lỗi psycopg. `documents.repository.create` đã
    quy None về user ẩn danh từ lâu; đây chỉ là làm cho khớp.
    """
    from app.domains.documents.repository import ensure_anonymous_user

    map_id = str(uuid.uuid4())
    owner = str(user_id) if user_id else ensure_anonymous_user()
    with session_scope() as s:
        s.add(KnowledgeMap(
            id=map_id, document_id=str(document_id), user_id=owner,
            title=(title or "Study Map")[:500], status="processing",
        ))
    return map_id


def save_graph(map_id: str, document_id: str, node_rows: List[Dict[str, Any]],
               edge_rows: List[Dict[str, Any]]) -> Dict[str, int]:
    """Ghi nodes + edges + liên kết chunk. `node_rows` phải cha-trước-con."""
    key_to_id: Dict[str, str] = {}
    links = 0
    with session_scope() as s:
        for row in node_rows:
            node_id = str(uuid.uuid4())
            key_to_id[row["key"]] = node_id
            s.add(KnowledgeNode(
                id=node_id, map_id=str(map_id), document_id=str(document_id),
                section_id=row.get("section_id"),
                parent_node_id=key_to_id.get(row.get("parent_key")),
                title=row["title"], summary=row.get("summary"),
                node_type=row["node_type"], level=int(row["level"]),
                order_index=int(row["order_index"]),
                metadata_json=(
                    {"source_stems": list(row["source_stems"])}
                    if row.get("source_stems") else None
                ),
            ))
        s.flush()
        for row in node_rows:
            for chunk_id in row.get("chunk_ids") or []:
                s.add(KnowledgeNodeChunk(
                    id=str(uuid.uuid4()), node_id=key_to_id[row["key"]], chunk_id=chunk_id,
                ))
                links += 1
        for edge in edge_rows:
            src, tgt = key_to_id.get(edge["source_key"]), key_to_id.get(edge["target_key"])
            if not src or not tgt or src == tgt:
                continue
            s.add(KnowledgeEdge(
                id=str(uuid.uuid4()), map_id=str(map_id),
                source_node_id=src, target_node_id=tgt,
                relation_type=edge["relation_type"], description=edge.get("description"),
            ))
    return {"nodes": len(node_rows), "edges": len(edge_rows), "chunk_links": links}


def finish(map_id: str, status: str, *, generator: Optional[Dict[str, Any]] = None) -> None:
    with session_scope() as s:
        m = s.get(KnowledgeMap, str(map_id))
        if m is None:
            return
        m.status = status
        if generator is not None:
            m.generator_json = generator


def get_map(map_id: str) -> Optional[Dict[str, Any]]:
    """Map kèm toàn bộ node + edge. `user_id` trả kèm để route kiểm quyền."""
    with session_scope() as s:
        m = s.get(KnowledgeMap, str(map_id))
        if m is None:
            return None
        nodes = s.execute(
            select(KnowledgeNode).where(KnowledgeNode.map_id == m.id)
            .order_by(KnowledgeNode.order_index)
        ).scalars().all()
        edges = s.execute(
            select(KnowledgeEdge).where(KnowledgeEdge.map_id == m.id)
        ).scalars().all()
        chunk_rows = s.execute(
            select(KnowledgeNodeChunk.node_id, KnowledgeNodeChunk.chunk_id)
            .join(KnowledgeNode, KnowledgeNode.id == KnowledgeNodeChunk.node_id)
            .where(KnowledgeNode.map_id == m.id)
        ).all()
        by_node: Dict[str, List[str]] = {}
        for node_id, chunk_id in chunk_rows:
            by_node.setdefault(node_id, []).append(chunk_id)
        return {
            "map_id": m.id,
            "document_id": m.document_id,
            "user_id": m.user_id,
            "title": m.title,
            "status": m.status,
            "generator": m.generator_json,
            "created_at": m.created_at.isoformat() if m.created_at else None,
            "nodes": [{
                "node_id": n.id,
                "parent_node_id": n.parent_node_id,
                "section_id": n.section_id,
                "title": n.title,
                "summary": n.summary,
                "node_type": n.node_type,
                "level": n.level,
                "order_index": n.order_index,
                "chunk_ids": by_node.get(n.id, []),
                **({"source_stems": (n.metadata_json or {}).get("source_stems")}
                   if (n.metadata_json or {}).get("source_stems") else {}),
            } for n in nodes],
            "edges": [{
                "edge_id": e.id,
                "source_node_id": e.source_node_id,
                "target_node_id": e.target_node_id,
                "relation_type": e.relation_type,
                "description": e.description,
            } for e in edges],
        }


def list_by_document(document_id: str, *, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Tóm tắt các map của một tài liệu, mới nhất trước (không kèm node/edge)."""
    from sqlalchemy import func

    with session_scope() as s:
        counts = dict(s.execute(
            select(KnowledgeNode.map_id, func.count())
            .join(KnowledgeMap, KnowledgeMap.id == KnowledgeNode.map_id)
            .where(KnowledgeMap.document_id == str(document_id))
            .group_by(KnowledgeNode.map_id)
        ).all())
        q = (select(KnowledgeMap)
             .where(KnowledgeMap.document_id == str(document_id))
             .order_by(KnowledgeMap.created_at.desc()))
        if user_id is not None:
            q = q.where(KnowledgeMap.user_id == str(user_id))
        return [{
            "map_id": m.id,
            "document_id": m.document_id,
            "title": m.title,
            "status": m.status,
            "node_count": int(counts.get(m.id, 0)),
            "created_at": m.created_at.isoformat() if m.created_at else None,
        } for m in s.execute(q).scalars().all()]


def latest_completed(document_id: str, user_id: Optional[str]) -> Optional[str]:
    """map_id hoàn tất gần nhất — dùng cho cache khi không `force`.

    `user_id` None = chế độ mở, KHÔNG lọc theo chủ sở hữu — y hệt quy ước
    `list_by_document` ngay trên. Trước đây `str(None)` thành chuỗi `"None"` và
    Postgres ném `invalid input syntax for type uuid`, nên route
    `/api/study-maps/generate` trả 500 ngay trước khi job kịp chạy.
    """
    with session_scope() as s:
        q = (select(KnowledgeMap.id)
             .where(KnowledgeMap.document_id == str(document_id),
                    KnowledgeMap.status == "completed")
             .order_by(KnowledgeMap.created_at.desc()).limit(1))
        if user_id is not None:
            q = q.where(KnowledgeMap.user_id == str(user_id))
        return s.execute(q).scalar()


def document_title(document_id: str) -> str:
    with session_scope() as s:
        return s.execute(
            select(Document.title).where(Document.id == str(document_id))
        ).scalar() or "Study Map"
