"""Chuyển artifact mindmap (schema v2) sang hàng `knowledge_*` (FR-04).

Tách riêng khỏi tầng DB để test được mà không cần Postgres lẫn LLM: vào là
`nodes`/`relations` do pipeline mindmap sinh ra, ra là hàng đã sạch, đã sắp
cha-trước-con, sẵn sàng insert.

Hai ràng buộc DB (`ck_knowledge_nodes_not_self_parent`,
`ck_knowledge_edges_no_self_loop`) được kiểm ngay ở đây: để DB bắt thì cả
transaction hỏng, người dùng chỉ thấy 500 không rõ vì sao.
"""

from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

# mindmap `kind` → `knowledge_nodes.node_type` (đặc tả 5.6)
NODE_TYPE_BY_KIND = {"root": "root", "section": "section", "idea": "concept", "detail": "example"}
DEFAULT_NODE_TYPE = "concept"

# mindmap `type` → `knowledge_edges.relation_type` (CHECK ở đặc tả 5.7).
# `leads_to`/`causes` đều là "phải nắm A trước mới hiểu B" → prerequisite.
RELATION_TYPE_BY_MM = {
    "contains": "parent_child",
    "supports": "supports",
    "leads_to": "prerequisite",
    "causes": "prerequisite",
    "contrasts": "contrasts",
    "relates_to": "related",
}
DEFAULT_RELATION_TYPE = "related"


def build_graph(
    nodes: List[Dict[str, Any]],
    relations: List[Dict[str, Any]],
    chunk_map: Dict[str, Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """(node_rows, edge_rows).

    `chunk_map`: embedding_id (id FAISS dạng chuỗi) → {chunk_id, section_id},
    lấy từ `documents.repository.chunks_by_embedding`.

    node_rows: {key, parent_key, title, summary, node_type, level, order_index,
    section_id, chunk_ids} — cha LUÔN đứng trước con để resolve FK khi insert.
    """
    by_key: Dict[str, Dict[str, Any]] = {}
    for n in nodes or []:
        key = str(n.get("id") or "").strip()
        title = (n.get("title") or "").strip()
        if not key or not title or key in by_key:
            continue  # FR-04.6: node không title thì bỏ, không bịa tên
        by_key[key] = n

    if not by_key:
        return [], []

    root_key: Optional[str] = None
    for key, n in by_key.items():
        if n.get("kind") == "root" or not n.get("parent"):
            root_key = key
            break

    # Mồ côi / tự trỏ chính mình → về root. `sanitize_nodes` đã làm, nhưng đây là
    # ranh giới với DB nên kiểm lại: một node hỏng làm hỏng cả transaction.
    parent_of: Dict[str, Optional[str]] = {}
    for key, n in by_key.items():
        parent = str(n.get("parent") or "").strip() or None
        if key == root_key:
            parent = None
        elif parent == key or parent not in by_key:
            parent = root_key
        parent_of[key] = parent

    children: Dict[Optional[str], List[str]] = {}
    for key, parent in parent_of.items():
        children.setdefault(parent, []).append(key)
    for keys in children.values():
        keys.sort(key=lambda k: (int(by_key[k].get("order") or 0), by_key[k]["title"]))

    node_rows: List[Dict[str, Any]] = []
    stack: List[Tuple[str, int]] = [
        (k, 1) for k in reversed(children.get(None, []))
    ]
    seen: set = set()
    while stack:
        key, level = stack.pop()
        if key in seen:
            continue
        seen.add(key)
        n = by_key[key]
        chunk_ids, section_id = _resolve_chunks(n.get("chunk_refs") or [], chunk_map)
        node_rows.append({
            "key": key,
            "parent_key": parent_of[key],
            "title": n["title"].strip()[:500],
            "summary": (n.get("note") or "").strip() or None,
            "node_type": NODE_TYPE_BY_KIND.get(n.get("kind"), DEFAULT_NODE_TYPE),
            "level": level,
            "order_index": len(node_rows),
            "section_id": section_id,
            "chunk_ids": chunk_ids,
        })
        for child in reversed(children.get(key, [])):
            stack.append((child, level + 1))

    valid = {r["key"] for r in node_rows}
    edge_rows: List[Dict[str, Any]] = []
    pairs: set = set()
    for r in relations or []:
        src = str(r.get("source") or "").strip()
        tgt = str(r.get("target") or "").strip()
        if src not in valid or tgt not in valid or src == tgt or (src, tgt) in pairs:
            continue
        pairs.add((src, tgt))
        edge_rows.append({
            "source_key": src,
            "target_key": tgt,
            "relation_type": RELATION_TYPE_BY_MM.get(r.get("type"), DEFAULT_RELATION_TYPE),
            "description": (r.get("label") or "").strip() or None,
        })
    return node_rows, edge_rows


def _resolve_chunks(refs: List[str], chunk_map: Dict[str, Dict[str, Any]],
                    ) -> Tuple[List[str], Optional[str]]:
    """chunk_refs (id FAISS) → (chunk_id UUID, section_id chiếm đa số).

    Node thường trải trên vài chunk của cùng một mục; lấy section xuất hiện nhiều
    nhất thay vì section của chunk đầu — chunk đầu hay là phần dẫn nhập vắt sang
    mục trước.
    """
    chunk_ids: List[str] = []
    sections: List[str] = []
    for ref in refs or []:
        hit = chunk_map.get(str(ref))
        if not hit:
            continue
        if hit["chunk_id"] not in chunk_ids:
            chunk_ids.append(hit["chunk_id"])
        if hit.get("section_id"):
            sections.append(hit["section_id"])
    section_id = Counter(sections).most_common(1)[0][0] if sections else None
    return chunk_ids, section_id


def demo() -> None:
    """Self-check: `python -m app.domains.studymap.generator`."""
    chunk_map = {
        "1": {"chunk_id": "c1", "section_id": "sA"},
        "2": {"chunk_id": "c2", "section_id": "sA"},
        "3": {"chunk_id": "c3", "section_id": "sB"},
    }
    nodes = [
        {"id": "n2", "parent": "r", "kind": "idea", "title": "Khai niem", "note": "ghi chu",
         "chunk_refs": ["1", "2", "3"], "order": 1},
        {"id": "r", "parent": None, "kind": "root", "title": "Goc", "order": 0},
        {"id": "n3", "parent": "mat-tieu", "kind": "detail", "title": "Vi du", "order": 2},
        {"id": "n4", "parent": "n4", "kind": "idea", "title": "Tu tro", "order": 3},
        {"id": "n5", "parent": "r", "kind": "idea", "title": "   ", "order": 4},
    ]
    rows, edges = build_graph(nodes, [
        {"source": "n2", "target": "n3", "type": "leads_to", "label": "dan toi"},
        {"source": "n2", "target": "n2", "type": "relates_to"},
        {"source": "n2", "target": "khong-co", "type": "relates_to"},
        {"source": "n2", "target": "n3", "type": "supports"},
    ], chunk_map)

    titles = [r["title"] for r in rows]
    assert "   " not in titles and len(rows) == 4, titles  # node không title bị bỏ
    assert rows[0]["title"] == "Goc" and rows[0]["parent_key"] is None
    order = {r["key"]: i for i, r in enumerate(rows)}
    for r in rows:  # cha luôn đứng trước con
        assert r["parent_key"] is None or order[r["parent_key"]] < order[r["key"]]
        assert r["key"] != r["parent_key"], "không được tự trỏ parent"
    by_key = {r["key"]: r for r in rows}
    assert by_key["n3"]["parent_key"] == "r", "mồ côi phải về root"
    assert by_key["n4"]["parent_key"] == "r", "tự trỏ phải về root"
    assert by_key["n2"]["level"] == 2 and by_key["n2"]["node_type"] == "concept"
    assert by_key["n3"]["node_type"] == "example"
    assert by_key["n2"]["chunk_ids"] == ["c1", "c2", "c3"]
    assert by_key["n2"]["section_id"] == "sA", "section chiếm đa số"

    assert len(edges) == 1, edges  # self-loop, node lạ, trùng cặp đều bị bỏ
    assert edges[0]["relation_type"] == "prerequisite"
    assert edges[0]["description"] == "dan toi"

    assert build_graph([], [], {}) == ([], [])
    print("studymap generator demo OK")


if __name__ == "__main__":
    demo()
