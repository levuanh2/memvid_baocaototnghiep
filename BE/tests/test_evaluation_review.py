from __future__ import annotations

import csv
import hashlib
import json
import shutil
from pathlib import Path

import pytest

from evaluation.dataset import load_jsonl
from evaluation.review import (
    ARTIFACT_REVIEW_FIELDS,
    CITATION_REVIEW_FIELDS,
    CONTRADICTION_REVIEW_FIELDS,
    REVIEW_FIELDS,
    export_review,
    import_review,
)


SOURCE_DATASET = Path("reports/evaluation/datasets/corpus_v1")


def _write_csv(path: Path, fields: list[str], rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def _fixture(tmp_path: Path) -> Path:
    root = tmp_path / "dataset"
    shutil.copytree(SOURCE_DATASET, root)
    for name in (
        "queries.jsonl", "canonical_evidence_spans.jsonl", "citation_annotations.jsonl",
        "contradictions.jsonl", "artifact_annotations.jsonl", "representation_qrels.jsonl",
    ):
        (root / name).write_text("", encoding="utf-8")
    for name in ("canonical_documents.jsonl", "review_import_manifest.json", "coordinate_bridge_manifest.json", "qrel_manifest.json"):
        (root / name).unlink(missing_ok=True)
    documents = load_jsonl(root / "documents.jsonl")
    for document in documents:
        if document.get("doc_id", "").startswith("cv1_"):
            document["annotation_status"] = "candidate"
            for field in ("split", "corpus_reviewer_id", "corpus_reviewed_at", "corpus_reviewer_note"):
                document.pop(field, None)
    (root / "documents.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in documents),
        encoding="utf-8",
    )
    manifest_path = root / "dataset_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["status"] = "human_validation_package_ready"
    manifest["candidate_package_file_hashes"]["documents.jsonl"] = hashlib.sha256((root / "documents.jsonl").read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return root


def _approved_v01_rows(root: Path) -> tuple[list[dict], list[dict]]:
    with (root / "human_review_queries.csv").open("r", encoding="utf-8-sig", newline="") as handle:
        query_rows = list(csv.DictReader(handle))
    for query_row in query_rows:
        query_row.update({"reviewer_id": "reviewer_01", "review_decision": "reject"})
        if query_row["query_id"] == "V01":
            query_row.update({
                "review_decision": "approve", "approve_query": "yes",
                "approve_answerability": "yes", "approve_answer": "yes",
                "approve_evidence": "yes", "approve_citations": "yes",
            })
    claim_rows = []
    for claim in load_jsonl(root / "candidate_citation_annotations.jsonl"):
        claim_rows.append({
            "query_id": claim["query_id"], "claim_id": claim["answer_or_claim_id"],
            "claim": claim["claim"],
            "supporting_span_ids": json.dumps(claim["supporting_span_ids"]),
            "candidate_support_label": claim["support_label"],
            "reviewer_id": "reviewer_01", "review_decision": "approve",
        })
    return query_rows, claim_rows


def _write_complete_export(root: Path, query_rows: list[dict], claim_rows: list[dict]) -> Path:
    export = root / "reviews" / "reviewer_01" / "export"
    export.mkdir(parents=True)
    _write_csv(export / "human_review_queries.csv", REVIEW_FIELDS, query_rows)
    _write_csv(export / "human_review_citations.csv", CITATION_REVIEW_FIELDS, claim_rows)
    contradiction_rows = []
    for pair in load_jsonl(root / "candidate_contradictions.jsonl"):
        contradiction_rows.append({
            **pair, "reviewer_id": "reviewer_01", "review_decision": "approve",
            "human_rationale": "explicit test rationale",
        })
    _write_csv(export / "human_review_contradictions.csv", CONTRADICTION_REVIEW_FIELDS, contradiction_rows)
    artifact_rows = [{"document_id": a["document_id"], "reviewer_id": "reviewer_01",
                      "review_decision": "reject"}
                     for a in load_jsonl(root / "candidate_artifact_annotations.jsonl")]
    _write_csv(export / "human_review_artifacts.csv", ARTIFACT_REVIEW_FIELDS, artifact_rows)
    manifest = json.loads((root / "dataset_manifest.json").read_text(encoding="utf-8"))
    summary = {
        "schema_version": "human-review-summary-v1", "reviewer_id": "reviewer_01",
        "candidate_package_hash": manifest["candidate_package_hash"],
        "counts": {"complete": True, "dataset_blocked": False},
        "contains_research_performance_metrics": False, "dataset_frozen": False,
    }
    (export / "human_review_summary.json").write_text(json.dumps(summary), encoding="utf-8")
    documents = [d for d in load_jsonl(root / "documents.jsonl") if d.get("eligible_for_study")]
    approval = {
        "schema_version": "corpus-approval-v1", "reviewer_id": "reviewer_01",
        "reviewed_at": "2026-08-12T00:00:00+00:00",
        "candidate_package_hash": manifest["candidate_package_hash"],
        "documents": [{"document_id": d["doc_id"], "source_hash": d["sha256"],
                       "include_in_corpus": "yes", "split": d["proposed_split"],
                       "reviewer_note": ""} for d in documents],
    }
    (export / "corpus_approval.json").write_text(json.dumps(approval), encoding="utf-8")
    return export / "human_review_queries.csv"


def test_export_review_creates_all_human_sheets(tmp_path: Path):
    root = _fixture(tmp_path)
    result = export_review(root)
    assert result["candidate_count"] == 60
    assert result["claim_count"] == 83
    assert (root / "human_review_queries.csv").is_file()
    assert (root / "human_review_citations.csv").is_file()
    assert (root / "human_review_contradictions.csv").is_file()
    assert (root / "human_review_artifacts.csv").is_file()


def test_import_review_never_infers_approval_from_nonempty_fields(tmp_path: Path):
    root = _fixture(tmp_path)
    query_rows, claim_rows = _approved_v01_rows(root)
    next(row for row in query_rows if row["query_id"] == "V01")["approve_evidence"] = ""
    review_csv = _write_complete_export(root, query_rows, claim_rows)
    with pytest.raises(ValueError, match="explicit answer and evidence approval required"):
        import_review(root, review_csv)
    assert load_jsonl(root / "queries.jsonl") == []


def test_import_review_validates_and_imports_explicit_human_approval(tmp_path: Path):
    root = _fixture(tmp_path)
    query_rows, claim_rows = _approved_v01_rows(root)
    review_csv = _write_complete_export(root, query_rows, claim_rows)
    result = import_review(root, review_csv)
    assert result["queries_imported"] == 1
    assert result["spans_imported"] == 1
    assert result["claims_imported"] >= 1
    query = load_jsonl(root / "queries.jsonl")[0]
    assert query["annotation_status"] == "human_validated"
    assert query["reviewer_id"] == "reviewer_01"
    span = load_jsonl(root / "canonical_evidence_spans.jsonl")[0]
    assert span["span_id"] == "V01_s01"
    assert load_jsonl(root / "citation_annotations.jsonl")[0]["supporting_span_ids"] == ["V01_s01"]
