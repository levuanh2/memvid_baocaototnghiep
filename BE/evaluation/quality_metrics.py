from __future__ import annotations

import statistics


def citation_metrics(claims: list[dict]) -> dict[str, float]:
    """Aggregate human claim labels; no automatic evidence invention/judging."""
    cited = [c for c in claims if c.get("cited_chunk_ids")]
    correct_citations = sum(c.get("citation_label") == "supported" for c in cited)
    support_required = [c for c in claims if c.get("requires_support", True)]
    supported = sum(c.get("support_label") == "supported" for c in support_required)
    unsupported = sum(c.get("support_label") == "unsupported" for c in support_required)
    return {
        "citation_precision": correct_citations / len(cited) if cited else 0.0,
        "citation_recall_completeness": supported / len(support_required) if support_required else 0.0,
        "unsupported_claim_rate": unsupported / len(support_required) if support_required else 0.0,
    }


def rubric_summary(records: list[dict], dimensions: list[str]) -> dict:
    out = {}
    for dimension in dimensions:
        values = [float(r[dimension]) for r in records if r.get(dimension) is not None]
        out[dimension] = {"n": len(values), "mean": statistics.fmean(values) if values else None,
                          "median": statistics.median(values) if values else None}
    return out


SUMMARY_DIMENSIONS = ["coverage", "faithfulness", "redundancy", "section_organization", "provenance_validity"]
MINDMAP_DIMENSIONS = ["concept_coverage", "hierarchy_correctness", "relation_correctness", "redundancy", "provenance_validity"]
QA_DIMENSIONS = ["answer_correctness", "faithfulness", "context_relevance"]

