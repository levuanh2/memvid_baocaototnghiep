"""Deterministic, evidence-backed planning for Guided Mind Map V3.

The planner is intentionally provider-independent: it creates a bounded plan
from persisted indexed chunks, while the existing enrichment path may still use
the configured model. No label or citation is invented when evidence is absent.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any

REL_TYPES = {"part_of", "prerequisite", "cause_effect", "sequence", "contrast", "example", "related"}
_STOP = {"của", "và", "các", "cho", "trong", "một", "được", "với", "là", "the", "and", "for", "from", "this", "that"}


def _words(text: str) -> list[str]:
    return [w for w in re.findall(r"[\wÀ-ỹ]{3,}", text.casefold()) if w not in _STOP]


def _short(text: str, limit: int = 56) -> str:
    value = " ".join(str(text or "").split())
    if len(value) <= limit:
        return value
    cut = value.rfind(" ", 0, limit)
    return value[:cut if cut > 10 else limit].rstrip(" .,;:")


def _root_title(chunks: list[dict], intent: dict[str, Any]) -> str:
    topics = intent.get("selected_topics") or []
    if topics:
        return _short(str(topics[0]), 72)
    headings = [str(c.get("heading_path") or "").split(" > ")[0].strip() for c in chunks]
    headings = [h for h in headings if h]
    if headings:
        return _short(Counter(headings).most_common(1)[0][0], 72)
    for chunk in chunks:
        sentence = re.split(r"[.!?\n]", str(chunk.get("text") or ""))[0].strip()
        if sentence:
            return _short(sentence, 72)
    return "Sơ đồ nội dung"


def _select_chunks(chunks: list[dict], intent: dict[str, Any]) -> tuple[list[dict], list[str]]:
    instruction = " ".join([str(intent.get("instruction") or ""), *[str(x) for x in intent.get("selected_topics") or []]])
    terms = set(_words(instruction))
    preset = intent.get("preset") or "overview"
    if preset == "process":
        terms.update({"quy", "trình", "bước", "triển", "khai", "sequence", "process"})
    elif preset == "comparison":
        terms.update({"so", "sánh", "khác", "giống", "compare", "contrast"})
    elif preset == "study":
        terms.update({"định", "nghĩa", "ví", "dụ", "câu", "hỏi", "nhớ"})
    scored = []
    for idx, chunk in enumerate(chunks):
        text = f"{chunk.get('heading_path') or ''} {chunk.get('text') or ''}"
        score = sum(text.casefold().count(term) for term in terms)
        scored.append((score, idx, chunk))
    # Keep every source represented, then fill by relevance. This prevents a
    # large source from silently dominating a multi-source map.
    by_source: dict[str, list[tuple[int, dict]]] = defaultdict(list)
    for score, _idx, chunk in sorted(scored, key=lambda row: (-row[0], row[1])):
        by_source[str(chunk.get("source_stem") or "unknown")].append((score, chunk))
    chosen: list[dict] = []
    for rows in by_source.values():
        chosen.append(rows[0][1])
    budget = {"compact": 12, "balanced": 24, "detailed": 42}.get(intent.get("detail_level"), 24)
    for _score, _idx, chunk in sorted(scored, key=lambda row: (-row[0], row[1])):
        if chunk not in chosen and len(chosen) < budget:
            chosen.append(chunk)
    queries = [" ".join(sorted(terms))] if terms else ["document structure and key concepts"]
    return chosen, queries


def plan_guided(mm_input: dict[str, Any]) -> tuple[list[dict], list[dict], dict[str, Any], list[str]]:
    intent = dict(mm_input.get("generation_intent") or {})
    chunks, queries = _select_chunks(list(mm_input.get("chunks") or []), intent)
    missing: list[str] = []
    if not chunks:
        return [], [], {"retrieval_queries": queries, "node_budget": 0, "max_depth": 0}, ["guided_no_evidence"]
    detail = intent.get("detail_level") or "balanced"
    preset = intent.get("preset") or "overview"
    node_budget = {"compact": 12, "balanced": 24, "detailed": 42}.get(detail, 24)
    max_depth = {"compact": 2, "balanced": 3, "detailed": 4}.get(detail, 3)
    root_id = "n0"
    nodes = [{"id": root_id, "parent": None, "kind": "root", "title": _root_title(chunks, intent), "note": "", "chunk_refs": [], "order": 0}]
    groups: dict[str, list[dict]] = defaultdict(list)
    for chunk in chunks:
        heading = str(chunk.get("heading_path") or "").split(" > ")[0].strip()
        if not heading:
            tokens = _words(str(chunk.get("text") or ""))
            heading = " ".join(tokens[:3]).title() if tokens else "Nội dung chính"
        groups[_short(heading, 48).casefold()].append(chunk)
    if preset == "comparison" and len(groups) < 2:
        by_source: dict[str, list[dict]] = defaultdict(list)
        for chunk in chunks:
            by_source[str(chunk.get("source_stem") or "Nguồn")].append(chunk)
        groups = defaultdict(list, {k: v for k, v in by_source.items()})
    relations: list[dict] = []
    next_id = 1
    previous_branch_id = None
    for group_idx, (label, group_chunks) in enumerate(groups.items()):
        if len(nodes) >= node_budget:
            missing.append("guided_node_budget")
            break
        branch_id = f"n{next_id}"; next_id += 1
        branch_title = label.title()[:100]
        branch_refs = [str(ref) for c in group_chunks for ref in c.get("chunk_keys") or []]
        nodes.append({"id": branch_id, "parent": root_id, "kind": "section", "title": branch_title, "note": "", "chunk_refs": list(dict.fromkeys(branch_refs)), "order": group_idx})
        previous_child_id = None
        for child_idx, chunk in enumerate(group_chunks):
            if len(nodes) >= node_budget:
                missing.append("guided_node_budget")
                break
            child_id = f"n{next_id}"; next_id += 1
            text = str(chunk.get("text") or "").strip()
            title = _short(str(chunk.get("heading_path") or "").split(" > ")[-1] or (" ".join(_words(text)[:5]).title()), 64)
            if not title:
                title = "Chi tiết có bằng chứng"
            nodes.append({"id": child_id, "parent": branch_id, "kind": "idea", "title": title, "note": text[:900], "chunk_refs": [str(ref) for ref in chunk.get("chunk_keys") or []], "order": child_idx})
            if preset == "comparison" and previous_branch_id:
                relations.append({"source": previous_branch_id, "target": child_id, "type": "contrast", "label": "đối chiếu"})
            elif preset == "process" and previous_child_id:
                relations.append({"source": previous_child_id, "target": child_id, "type": "sequence", "label": "trình tự"})
            previous_child_id = child_id
        previous_branch_id = branch_id
    if len(nodes) <= 1:
        missing.append("guided_no_semantic_groups")
    if len(nodes) > 1 and max_depth >= 3 and len(chunks) >= 8:
        # The planner intentionally records the budget/depth decision. A later
        # model enrichment pass may add details, but cannot invent citations.
        pass
    config = {"retrieval_queries": queries, "node_budget": node_budget, "max_depth": max_depth, "branch_target": {"compact": "3-5", "balanced": "4-7", "detailed": "5-8"}.get(detail, "4-7"), "preset": preset, "detail_level": detail, "available_chunk_refs": [str(ref) for chunk in chunks for ref in chunk.get("chunk_keys") or []]}
    return nodes, relations, config, list(dict.fromkeys(missing))
