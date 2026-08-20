from __future__ import annotations

import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .dataset import load_jsonl


TRUTHY = {"1", "true", "yes", "y", "approved"}
DECISIONS = {"approve", "edit", "reject"}
ANSWERABILITY = {"answerable", "insufficient_evidence", "ambiguous"}
QUERY_TYPES = {
    "exact-term factual", "paraphrase factual", "multi-chunk", "cross-section",
    "overview", "main-points", "compare", "how/why", "ambiguous",
    "insufficient evidence", "contradictory evidence", "citation-sensitive",
}

REVIEW_FIELDS = [
    "query_id", "document_id", "document", "split", "query", "query_type",
    "difficulty", "answerability", "candidate_answer", "candidate_evidence",
    "page_heading", "candidate_rationale", "requires_multi_chunk",
    "citation_sensitive", "potential_contradiction", "ambiguity_reason",
    "acceptable_interpretations", "resolution_evidence_needed",
    "nearest_passage", "annotation_status", "reviewer_id", "review_decision",
    "approve_query", "approve_answerability", "approve_answer",
    "approve_evidence", "approve_citations", "corrected_query",
    "corrected_answer", "corrected_query_type", "corrected_answerability",
    "corrected_evidence_json", "reviewer_notes",
]

CITATION_REVIEW_FIELDS = [
    "query_id", "claim_id", "claim", "supporting_span_ids", "candidate_support_label",
    "supporting_evidence", "reviewer_id", "review_decision", "corrected_claim",
    "corrected_supporting_span_ids_json", "corrected_support_label", "reviewer_notes",
]

CONTRADICTION_REVIEW_FIELDS = [
    "pair_id", "query_id", "span_a_id", "span_a_text", "span_b_id", "span_b_text",
    "proposed_label", "notes", "reviewer_id", "review_decision", "corrected_label",
    "human_rationale", "reviewer_notes",
]

ARTIFACT_REVIEW_FIELDS = [
    "document_id", "evaluation_scope", "important_concepts", "important_sections",
    "expected_relations", "critical_facts", "critical_exclusions",
    "invalid_or_redundant_relations", "reviewer_id", "review_decision",
    "corrected_annotation_json", "reviewer_notes",
]

REVIEW_PACKAGE_FILES = (
    "human_review_queries.csv", "human_review_citations.csv",
    "human_review_contradictions.csv", "human_review_artifacts.csv",
    "human_review_summary.json", "corpus_approval.json",
)


def _truthy(value: object) -> bool:
    return str(value or "").strip().lower() in TRUTHY


def _write_jsonl(path: Path, records: Iterable[dict]) -> None:
    path.write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records),
        encoding="utf-8",
    )


def export_review(dataset_root: Path, output: Path | None = None) -> dict:
    root = Path(dataset_root)
    candidates = load_jsonl(root / "query_candidates.jsonl")
    output = Path(output or root / "human_review_queries.csv")
    seen: set[str] = set()
    with output.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=REVIEW_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for candidate in candidates:
            qid = candidate["query_id"]
            if qid in seen:
                raise ValueError(f"duplicate candidate query_id: {qid}")
            seen.add(qid)
            evidence = candidate.get("candidate_evidence_spans") or []
            row = dict(candidate)
            row.update({
                "document": candidate.get("document_filename", ""),
                "candidate_evidence": "\n---\n".join(e.get("evidence_text", "") for e in evidence),
                "page_heading": " | ".join(
                    str(e.get("locator_label") or e.get("locator") or "") for e in evidence
                ),
                "acceptable_interpretations": " | ".join(candidate.get("acceptable_interpretations") or []),
                "annotation_status": "candidate",
            })
            for field in REVIEW_FIELDS:
                row.setdefault(field, "")
            writer.writerow(row)
    span_text = {s["span_id"]: s["evidence_text"] for s in load_jsonl(root / "candidate_canonical_evidence_spans.jsonl")}
    citation_path = root / "human_review_citations.csv"
    citation_rows = load_jsonl(root / "candidate_citation_annotations.jsonl")
    with citation_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CITATION_REVIEW_FIELDS)
        writer.writeheader()
        for claim in citation_rows:
            ids = claim.get("supporting_span_ids") or []
            writer.writerow({
                "query_id": claim["query_id"], "claim_id": claim["answer_or_claim_id"],
                "claim": claim["claim"], "supporting_span_ids": json.dumps(ids, ensure_ascii=False),
                "candidate_support_label": claim["support_label"],
                "supporting_evidence": "\n---\n".join(span_text.get(i, "") for i in ids),
            })

    contradiction_path = root / "human_review_contradictions.csv"
    contradiction_rows = load_jsonl(root / "candidate_contradictions.jsonl")
    with contradiction_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CONTRADICTION_REVIEW_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for pair in contradiction_rows:
            writer.writerow({**pair, "span_a_text": span_text.get(pair["span_a_id"], ""),
                             "span_b_text": span_text.get(pair["span_b_id"], "")})

    artifact_path = root / "human_review_artifacts.csv"
    artifact_rows = load_jsonl(root / "candidate_artifact_annotations.jsonl")
    with artifact_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=ARTIFACT_REVIEW_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for artifact in artifact_rows:
            writer.writerow({
                **artifact,
                "evaluation_scope": json.dumps(artifact.get("evaluation_scope", []), ensure_ascii=False),
                "important_concepts": json.dumps(artifact.get("important_concepts", []), ensure_ascii=False),
                "important_sections": json.dumps(artifact.get("important_sections", []), ensure_ascii=False),
                "expected_relations": json.dumps(artifact.get("expected_relations", []), ensure_ascii=False),
                "critical_facts": json.dumps(artifact.get("critical_facts", []), ensure_ascii=False),
                "critical_exclusions": json.dumps(artifact.get("critical_exclusions", []), ensure_ascii=False),
                "invalid_or_redundant_relations": json.dumps(artifact.get("invalid_or_redundant_relations", []), ensure_ascii=False),
            })
    return {
        "output": str(output), "candidate_count": len(candidates),
        "citation_review": str(citation_path), "claim_count": len(citation_rows),
        "contradiction_review": str(contradiction_path), "contradiction_count": len(contradiction_rows),
        "artifact_review": str(artifact_path), "artifact_document_count": len(artifact_rows),
    }


def _read_csv(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _validate_review_package(root: Path, review_csv: Path) -> dict:
    """Reject partial/stale exports before any final annotation file is written."""
    sheet_root = review_csv.parent
    missing = [name for name in REVIEW_PACKAGE_FILES if not (sheet_root / name).is_file()]
    if missing:
        raise ValueError(f"review export is incomplete; missing files: {missing}")
    if review_csv.name != "human_review_queries.csv":
        raise ValueError("--input must name the exported human_review_queries.csv")

    summary = json.loads((sheet_root / "human_review_summary.json").read_text(encoding="utf-8"))
    if summary.get("schema_version") != "human-review-summary-v1":
        raise ValueError("unsupported or missing human review summary schema")
    reviewer_id = str(summary.get("reviewer_id") or "").strip()
    if not reviewer_id:
        raise ValueError("human review summary requires reviewer_id")
    counts = summary.get("counts") or {}
    if summary.get("dataset_frozen") is not False or summary.get("contains_research_performance_metrics") is not False:
        raise ValueError("review summary has invalid phase-boundary flags")
    if counts.get("complete") is not True or counts.get("dataset_blocked") is not False:
        raise ValueError("human review summary is incomplete or blocked")

    corpus_approval = json.loads((sheet_root / "corpus_approval.json").read_text(encoding="utf-8"))
    if corpus_approval.get("schema_version") != "corpus-approval-v1":
        raise ValueError("unsupported or missing corpus approval schema")
    if corpus_approval.get("reviewer_id") != reviewer_id:
        raise ValueError("corpus approval reviewer does not match review summary")

    manifest = json.loads((root / "dataset_manifest.json").read_text(encoding="utf-8"))
    expected_package_hash = manifest.get("candidate_package_hash")
    if not expected_package_hash or summary.get("candidate_package_hash") != expected_package_hash:
        raise ValueError("review export candidate_package_hash does not match the candidate snapshot")
    if corpus_approval.get("candidate_package_hash") != expected_package_hash:
        raise ValueError("corpus approval candidate_package_hash does not match the candidate snapshot")
    expected_hashes = manifest.get("candidate_package_file_hashes") or {}
    changed = [name for name, digest in expected_hashes.items()
               if not (root / name).is_file() or _sha256(root / name) != digest]
    if changed:
        raise ValueError(f"candidate proposal history changed after export: {changed}")
    return {"summary": summary, "reviewer_id": reviewer_id,
            "candidate_package_hash": expected_package_hash,
            "candidate_file_hashes": expected_hashes,
            "corpus_approval": corpus_approval}


def _apply_corpus_approval(root: Path, documents: list[dict], approval: dict,
                           reviewer_id: str, reviewed_at: str) -> list[dict]:
    """Materialize the reviewed corpus membership/split without manual edits."""
    eligible = {d["doc_id"]: d for d in documents if d.get("eligible_for_study")}
    decisions = approval.get("documents") or []
    decision_ids = [str(row.get("document_id") or "") for row in decisions]
    if set(decision_ids) != set(eligible) or len(decision_ids) != len(set(decision_ids)):
        raise ValueError("corpus approval must contain every eligible document exactly once")
    by_id = {row["document_id"]: row for row in decisions}
    updated = []
    for original in documents:
        document = dict(original)
        decision = by_id.get(document["doc_id"])
        if decision is None:
            updated.append(document)
            continue
        if decision.get("source_hash") != document.get("sha256"):
            raise ValueError(f"corpus approval source hash mismatch: {document['doc_id']}")
        source = Path(document["source"])
        if not source.is_file() or _sha256(source) != document.get("sha256"):
            raise ValueError(f"corpus approval source changed: {document['doc_id']}")
        include = str(decision.get("include_in_corpus") or "").strip().lower()
        split = str(decision.get("split") or "").strip()
        if include == "yes":
            if split not in {"development", "test"}:
                raise ValueError(f"included document requires a frozen split: {document['doc_id']}")
            document.update({
                "eligible_for_study": True,
                "split": split,
                "annotation_status": "human_validated",
                "corpus_reviewer_id": reviewer_id,
                "corpus_reviewed_at": reviewed_at,
                "corpus_reviewer_note": decision.get("reviewer_note", ""),
            })
        elif include == "no":
            if split:
                raise ValueError(f"excluded document cannot retain a split: {document['doc_id']}")
            document.update({
                "eligible_for_study": False,
                "split": None,
                "annotation_status": "excluded",
                "exclusion_reason": decision.get("reviewer_note") or "Excluded by reviewed corpus decision.",
                "corpus_reviewer_id": reviewer_id,
                "corpus_reviewed_at": reviewed_at,
            })
        else:
            raise ValueError(f"invalid corpus inclusion decision: {document['doc_id']}")
        updated.append(document)
    return updated


def _require_exact_ids(kind: str, rows: list[dict], id_field: str, expected_ids: set[str]) -> None:
    ids = [str(row.get(id_field) or "").strip() for row in rows]
    missing_ids = sorted(expected_ids - set(ids))
    unknown_ids = sorted(set(ids) - expected_ids)
    duplicates = sorted({value for value in ids if value and ids.count(value) > 1})
    if missing_ids or unknown_ids or duplicates or any(not value for value in ids):
        raise ValueError(
            f"{kind} review rows do not exactly match candidates; "
            f"missing={missing_ids[:10]}, unknown={unknown_ids[:10]}, duplicates={duplicates[:10]}"
        )


def _reviewed_citations(sheet_root: Path, approved_query_ids: set[str], final_span_ids: dict[str, list[str]],
                        expected_claim_ids: set[str], package_reviewer: str) -> list[dict]:
    rows = _read_csv(sheet_root / "human_review_citations.csv")
    _require_exact_ids("citation", rows, "claim_id", expected_claim_ids)
    by_query: dict[str, list[dict]] = {}
    for row in rows:
        reviewer = str(row.get("reviewer_id") or "").strip()
        decision = str(row.get("review_decision") or "").strip().lower()
        if reviewer != package_reviewer or decision not in DECISIONS:
            raise ValueError(f"citation {row.get('claim_id')}: explicit approve/edit/reject by package reviewer required")
        by_query.setdefault(str(row.get("query_id") or "").strip(), []).append(row)
    result = []
    allowed_support = {"full", "partial", "none", "contradicted"}
    for qid in approved_query_ids:
        claim_rows = by_query.get(qid) or []
        if not claim_rows:
            raise ValueError(f"query {qid}: no claim-level citation review rows")
        for row in claim_rows:
            reviewer = str(row.get("reviewer_id") or "").strip()
            decision = str(row.get("review_decision") or "").strip().lower()
            if reviewer != package_reviewer or decision not in DECISIONS:
                raise ValueError(f"query {qid}: each candidate claim needs explicit approve/edit/reject by package reviewer")
            if decision == "reject":
                continue
            claim = (row.get("corrected_claim") if decision == "edit" else "") or row.get("claim", "")
            label = (row.get("corrected_support_label") if decision == "edit" else "") or row.get("candidate_support_label", "")
            if label not in allowed_support:
                raise ValueError(f"query {qid}: invalid claim support label {label!r}")
            corrected_ids = str(row.get("corrected_supporting_span_ids_json") or "").strip()
            ids = json.loads(corrected_ids) if corrected_ids else final_span_ids[qid]
            if isinstance(ids, list):
                ids = [
                    value.replace(f"{qid}_candidate_s", f"{qid}_s", 1)
                    if isinstance(value, str) and value.startswith(f"{qid}_candidate_s") else value
                    for value in ids
                ]
            if not isinstance(ids, list) or any(i not in final_span_ids[qid] for i in ids):
                raise ValueError(f"query {qid}: claim references unknown final evidence span")
            result.append({
                "query_id": qid, "answer_or_claim_id": row["claim_id"], "claim": claim,
                "supporting_span_ids": ids, "support_label": label,
                "annotation_status": "human_validated", "reviewer_id": reviewer,
                "reviewed_at": datetime.now(timezone.utc).isoformat(),
            })
    return result


def _import_required_review_sheets(root: Path, sheet_root: Path, package_reviewer: str) -> tuple[list[dict], list[dict]]:
    contradictions = []
    allowed_labels = {"contradiction", "not contradiction", "conditional difference", "temporal difference", "scope difference"}
    label_aliases = {
        "direct_contradiction": "contradiction",
        "direct contradiction": "contradiction",
        "conditional_difference": "conditional difference",
        "scope_difference": "scope difference",
        "temporal_difference": "temporal difference",
        "not_contradiction": "not contradiction",
    }
    contradiction_rows = _read_csv(sheet_root / "human_review_contradictions.csv")
    expected_pairs = {p["pair_id"] for p in load_jsonl(root / "candidate_contradictions.jsonl")}
    _require_exact_ids("contradiction", contradiction_rows, "pair_id", expected_pairs)
    for row in contradiction_rows:
        decision = str(row.get("review_decision") or "").strip().lower()
        reviewer = str(row.get("reviewer_id") or "").strip()
        if reviewer != package_reviewer or decision not in DECISIONS:
            raise ValueError(f"contradiction {row.get('pair_id')}: invalid explicit review")
        if decision == "reject":
            continue
        label = (row.get("corrected_label") if decision == "edit" else "") or row.get("proposed_label", "")
        label = label_aliases.get(label, label)
        if label not in allowed_labels or not str(row.get("human_rationale") or "").strip():
            raise ValueError(f"contradiction {row.get('pair_id')}: valid label and human_rationale required")
        contradictions.append({
            "pair_id": row["pair_id"],
            "span_a_id": row["span_a_id"].replace("_candidate_s", "_s"),
            "span_b_id": row["span_b_id"].replace("_candidate_s", "_s"),
            "label": label, "notes": row.get("notes", ""), "human_rationale": row["human_rationale"],
            "annotation_status": "human_validated", "reviewer_id": reviewer,
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
        })

    artifacts = []
    candidate_artifacts = {a["document_id"]: a for a in load_jsonl(root / "candidate_artifact_annotations.jsonl")}
    artifact_rows = _read_csv(sheet_root / "human_review_artifacts.csv")
    _require_exact_ids("artifact", artifact_rows, "document_id", set(candidate_artifacts))
    for row in artifact_rows:
        decision = str(row.get("review_decision") or "").strip().lower()
        doc_id = row.get("document_id", "")
        reviewer = str(row.get("reviewer_id") or "").strip()
        if doc_id not in candidate_artifacts or reviewer != package_reviewer or decision not in DECISIONS:
            raise ValueError(f"artifact {doc_id}: invalid explicit review")
        if decision == "reject":
            continue
        artifact = dict(candidate_artifacts[doc_id])
        corrected = str(row.get("corrected_annotation_json") or "").strip()
        if decision == "edit":
            if not corrected:
                raise ValueError(f"artifact {doc_id}: edit requires corrected_annotation_json")
            value = json.loads(corrected)
            if not isinstance(value, dict):
                raise ValueError(f"artifact {doc_id}: corrected_annotation_json must be an object")
            artifact.update(value)
        artifact.update({"annotation_status": "human_validated", "annotator": {"reviewer_id": reviewer, "count": 1},
                         "reviewed_at": datetime.now(timezone.utc).isoformat()})
        artifacts.append(artifact)
    return contradictions, artifacts


def _load_source_units(root: Path) -> tuple[dict[tuple[str, str], dict], dict[str, dict]]:
    units = {}
    for unit in load_jsonl(root / "source_units.jsonl"):
        key = (unit["doc_id"], json.dumps(unit["locator"], ensure_ascii=False, sort_keys=True))
        units[key] = unit
    docs = {d["doc_id"]: d for d in load_jsonl(root / "documents.jsonl")}
    return units, docs


def _validate_evidence(root: Path, doc_id: str, evidence: list[dict]) -> list[dict]:
    units, docs = _load_source_units(root)
    if doc_id not in docs or not docs[doc_id].get("eligible_for_study"):
        raise ValueError(f"unknown or ineligible document_id: {doc_id}")
    source = Path(docs[doc_id]["source"])
    if not source.is_file():
        raise ValueError(f"source file does not exist: {source}")
    if hashlib.sha256(source.read_bytes()).hexdigest() != docs[doc_id].get("sha256"):
        raise ValueError(f"source hash changed: {doc_id}")
    validated = []
    for index, span in enumerate(evidence, 1):
        locator = span.get("locator")
        key = (doc_id, json.dumps(locator, ensure_ascii=False, sort_keys=True))
        unit = units.get(key)
        if unit is None:
            raise ValueError(f"{doc_id}: evidence locator does not resolve: {locator}")
        text = span.get("evidence_text", "")
        start = span.get("start_offset")
        end = span.get("end_offset")
        if not isinstance(start, int) or not isinstance(end, int) or start < 0 or end <= start:
            raise ValueError(f"{doc_id}: invalid evidence offsets at span {index}")
        if unit["text"][start:end] != text:
            raise ValueError(f"{doc_id}: evidence text/offset mismatch at span {index}")
        checked = dict(span)
        checked["evidence_text_sha256"] = hashlib.sha256(text.encode("utf-8")).hexdigest()
        validated.append(checked)
    return validated


def import_review(dataset_root: Path, review_csv: Path) -> dict:
    """Import only explicitly approved human decisions; never infer approval from content."""
    root = Path(dataset_root)
    review_csv = Path(review_csv)
    package = _validate_review_package(root, review_csv)
    package_reviewer = package["reviewer_id"]
    corpus_reviewed_at = str(package["corpus_approval"].get("reviewed_at") or datetime.now(timezone.utc).isoformat())
    reviewed_documents = _apply_corpus_approval(
        root, load_jsonl(root / "documents.jsonl"), package["corpus_approval"],
        package_reviewer, corpus_reviewed_at,
    )
    candidates = {r["query_id"]: r for r in load_jsonl(root / "query_candidates.jsonl")}
    existing_queries = load_jsonl(root / "queries.jsonl")
    existing_ids = {q["query_id"] for q in existing_queries}
    imported_queries: list[dict] = []
    imported_spans: list[dict] = []
    imported_citations: list[dict] = []
    history: list[dict] = []
    seen: set[str] = set()

    rows = _read_csv(review_csv)
    _require_exact_ids("query", rows, "query_id", set(candidates))
    for line_no, row in enumerate(rows, 2):
        qid = str(row.get("query_id") or "").strip()
        if not qid or qid not in candidates:
            raise ValueError(f"review row {line_no}: unknown query_id {qid!r}")
        if qid in seen:
            raise ValueError(f"review row {line_no}: duplicate query_id {qid}")
        seen.add(qid)
        reviewer = str(row.get("reviewer_id") or "").strip()
        decision = str(row.get("review_decision") or "").strip().lower()
        if reviewer != package_reviewer:
            raise ValueError(f"review row {line_no}: reviewer_id must match the review summary")
        if decision not in DECISIONS:
            raise ValueError(f"review row {line_no}: review_decision must be approve/edit/reject")
        now = datetime.now(timezone.utc).isoformat()
        history.append({
            "query_id": qid, "reviewer_id": reviewer, "decision": decision,
            "reviewed_at": now, "reviewer_notes": row.get("reviewer_notes", ""),
            "review_schema_version": "human-review-v1",
        })
        if decision == "reject":
            continue
        if qid in existing_ids:
            raise ValueError(f"review row {line_no}: query_id already imported: {qid}")
        if not _truthy(row.get("approve_query")) or not _truthy(row.get("approve_answerability")):
            raise ValueError(f"review row {line_no}: explicit query and answerability approval required")

        candidate = candidates[qid]
        query = (row.get("corrected_query") if decision == "edit" else "") or candidate["query"]
        qtype = (row.get("corrected_query_type") if decision == "edit" else "") or candidate["query_type"]
        answerability = (row.get("corrected_answerability") if decision == "edit" else "") or candidate["answerability"]
        if qtype not in QUERY_TYPES:
            raise ValueError(f"review row {line_no}: invalid query_type {qtype!r}")
        if answerability not in ANSWERABILITY:
            raise ValueError(f"review row {line_no}: invalid answerability {answerability!r}")

        evidence = candidate.get("candidate_evidence_spans") or []
        corrected_json = str(row.get("corrected_evidence_json") or "").strip()
        if corrected_json:
            try:
                evidence = json.loads(corrected_json)
            except json.JSONDecodeError as exc:
                raise ValueError(f"review row {line_no}: corrected_evidence_json is invalid") from exc
            if not isinstance(evidence, list):
                raise ValueError(f"review row {line_no}: corrected_evidence_json must be a list")

        answer = (row.get("corrected_answer") if decision == "edit" else "") or candidate.get("candidate_answer", "")
        if answerability == "answerable":
            if not _truthy(row.get("approve_answer")) or not _truthy(row.get("approve_evidence")):
                raise ValueError(f"review row {line_no}: explicit answer and evidence approval required")
            if not answer or not evidence:
                raise ValueError(f"review row {line_no}: answerable query needs answer and evidence")
            evidence = _validate_evidence(root, candidate["document_id"], evidence)
        else:
            answer = ""
            evidence = []

        imported_queries.append({
            "query_id": qid, "query": query, "query_type": qtype,
            "language": candidate["language"],
            "relevant_doc_ids": [candidate["document_id"]] if answerability != "insufficient_evidence" else [],
            "gold_status": answerability, "gold_answer": answer,
            "difficulty": candidate["difficulty"],
            "ambiguity": candidate.get("ambiguity_reason", "") if answerability == "ambiguous" else "",
            "requires_multi_chunk": candidate["requires_multi_chunk"],
            "requires_hierarchical_context": candidate.get("requires_hierarchical_context", False),
            "contradiction_case": candidate.get("potential_contradiction", False),
            "split": candidate["split"], "annotation_status": "human_validated",
            "reviewer_id": reviewer, "reviewed_at": now,
        })
        for number, span in enumerate(evidence, 1):
            imported_spans.append({
                "span_id": f"{qid}_s{number:02d}", "query_id": qid,
                "doc_id": candidate["document_id"], "locator": span["locator"],
                "start_offset": span["start_offset"], "end_offset": span["end_offset"],
                "evidence_text": span["evidence_text"],
                "evidence_text_sha256": span["evidence_text_sha256"],
                "annotation_status": "human_validated", "reviewer_id": reviewer,
                "reviewed_at": now,
            })
        if answerability == "answerable":
            if not _truthy(row.get("approve_citations")):
                raise ValueError(f"review row {line_no}: explicit citation-claim approval required")
    final_span_ids: dict[str, list[str]] = {}
    for span in imported_spans:
        final_span_ids.setdefault(span["query_id"], []).append(span["span_id"])
    answerable_ids = {q["query_id"] for q in imported_queries if q["gold_status"] == "answerable"}
    sheet_root = Path(review_csv).parent
    candidate_claim_ids = {c["answer_or_claim_id"] for c in load_jsonl(root / "candidate_citation_annotations.jsonl")}
    imported_citations = _reviewed_citations(
        sheet_root, answerable_ids, final_span_ids, candidate_claim_ids, package_reviewer,
    )
    imported_contradictions, imported_artifacts = _import_required_review_sheets(
        root, sheet_root, package_reviewer,
    )

    from evaluation.evidence import COORDINATE_BRIDGE_VERSION, bridge_imported_spans
    from evaluation.reproducibility import code_config_snapshot, content_hash, sha256_path

    imported_spans, canonical_documents = bridge_imported_spans(root, imported_spans, reviewed_documents)

    _write_jsonl(root / "documents.jsonl", reviewed_documents)
    _write_jsonl(root / "queries.jsonl", [*existing_queries, *imported_queries])
    _write_jsonl(root / "canonical_evidence_spans.jsonl", [
        *load_jsonl(root / "canonical_evidence_spans.jsonl"), *imported_spans,
    ])
    _write_jsonl(root / "citation_annotations.jsonl", [
        *load_jsonl(root / "citation_annotations.jsonl"), *imported_citations,
    ])
    _write_jsonl(root / "contradictions.jsonl", [
        *load_jsonl(root / "contradictions.jsonl"), *imported_contradictions,
    ])
    _write_jsonl(root / "artifact_annotations.jsonl", [
        *load_jsonl(root / "artifact_annotations.jsonl"), *imported_artifacts,
    ])
    _write_jsonl(root / "canonical_documents.jsonl", canonical_documents)
    history_path = root / "review_history.jsonl"
    old_history = load_jsonl(history_path) if history_path.exists() else []
    _write_jsonl(history_path, [*old_history, *history])
    bridge_manifest = {
        "schema_version": "memvid-coordinate-bridge-manifest-v1",
        "bridge_version": COORDINATE_BRIDGE_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "candidate_package_hash": package["candidate_package_hash"],
        "document_count": len(canonical_documents),
        "span_count": len(imported_spans),
        "canonical_documents_sha256": sha256_path(root / "canonical_documents.jsonl"),
        "canonical_spans_sha256": sha256_path(root / "canonical_evidence_spans.jsonl"),
        "unresolved_span_count": 0,
        "policy": "fail atomically; no fuzzy or cross-document mapping",
        "code_config_snapshot": code_config_snapshot([
            Path(__file__), Path(__file__).with_name("evidence.py"),
            Path(__file__).parents[1] / "app" / "domains" / "ingest" / "document_loader.py",
        ]),
    }
    (root / "coordinate_bridge_manifest.json").write_text(
        json.dumps(bridge_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    import_manifest = {
        "schema_version": "human-review-import-v1",
        "imported_at": datetime.now(timezone.utc).isoformat(),
        "candidate_dataset_version": json.loads((root / "dataset_manifest.json").read_text(encoding="utf-8")).get("dataset_version"),
        "candidate_package_hash": package["candidate_package_hash"],
        "reviewer_count": 1, "reviewer_pseudonyms": [package_reviewer],
        "review_export_hashes": {name: _sha256(sheet_root / name) for name in REVIEW_PACKAGE_FILES},
        "candidate_file_hashes_verified": package["candidate_file_hashes"],
        "corpus_approval_sha256": _sha256(sheet_root / "corpus_approval.json"),
        "coordinate_bridge_version": COORDINATE_BRIDGE_VERSION,
        "canonical_document_count": len(canonical_documents),
        "canonical_documents_hash": content_hash([root / "canonical_documents.jsonl"]),
        "canonical_spans_sha256": sha256_path(root / "canonical_evidence_spans.jsonl"),
        "code_config_snapshot": code_config_snapshot([
            Path(__file__), Path(__file__).with_name("evidence.py"),
            Path(__file__).parents[1] / "app" / "domains" / "ingest" / "document_loader.py",
        ]),
    }
    (root / "review_import_manifest.json").write_text(
        json.dumps(import_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    return {
        "rows_reviewed": len(rows), "queries_imported": len(imported_queries),
        "queries_rejected": sum(h["decision"] == "reject" for h in history),
        "spans_imported": len(imported_spans), "claims_imported": len(imported_citations),
        "contradictions_imported": len(imported_contradictions),
        "artifact_documents_imported": len(imported_artifacts),
        "documents_human_validated": sum(
            d.get("eligible_for_study") and d.get("annotation_status") in {"human_validated", "adjudicated"}
            for d in reviewed_documents
        ),
        "canonical_documents_created": len(canonical_documents),
        "coordinate_bridge_version": COORDINATE_BRIDGE_VERSION,
        "reviewer_count": 1, "reviewer_pseudonyms": [package_reviewer],
        "candidate_package_hash": package["candidate_package_hash"],
    }
