from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import pytest

from evaluation.review_app import ReviewWorkspace
from evaluation.review import import_review


SOURCE = Path("reports/evaluation/datasets/corpus_v1")

# Bộ dữ liệu này sống ngoài git (reports/ nằm trong .gitignore — nó thuộc dự án
# báo cáo NCKH riêng). Bản clone sạch không có nó, nên skip thay vì gãy.
if not SOURCE.exists():
    pytest.skip(
        "Thiếu reports/evaluation/datasets/corpus_v1 — bộ dữ liệu thực nghiệm không theo git",
        allow_module_level=True,
    )



def fixture(tmp_path: Path) -> Path:
    root = tmp_path / "corpus_v1"
    shutil.copytree(SOURCE, root)
    shutil.rmtree(root / "reviews", ignore_errors=True)
    for name in (
        "queries.jsonl", "canonical_evidence_spans.jsonl", "citation_annotations.jsonl",
        "contradictions.jsonl", "artifact_annotations.jsonl", "representation_qrels.jsonl",
    ):
        (root / name).write_text("", encoding="utf-8")
    for name in ("canonical_documents.jsonl", "review_import_manifest.json", "coordinate_bridge_manifest.json", "qrel_manifest.json"):
        (root / name).unlink(missing_ok=True)
    documents = [json.loads(line) for line in (root / "documents.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
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


def file_hashes(root: Path, names: tuple[str, ...]) -> dict[str, str]:
    return {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in names}


def complete_annotation_state(workspace: ReviewWorkspace, reviewer_id: str = "R1") -> dict:
    state = workspace.load_state(reviewer_id)
    approved_for_pair_export = {"V16", "R14", "R27"}
    for query in workspace.queries:
        if query["query_id"] in approved_for_pair_export:
            state["decisions"]["queries"][query["query_id"]] = {
                "reviewer_id": reviewer_id, "query_decision": "approve", "answerability": "answerable",
                "answer_decision": "approve", "evidence_decision": "approve", "notes": "software-test decision",
            }
        else:
            state["decisions"]["queries"][query["query_id"]] = {
                "reviewer_id": reviewer_id, "query_decision": "reject", "notes": "software-test decision",
            }
    for claim in workspace.citations:
        state["decisions"]["citations"][claim["answer_or_claim_id"]] = {
            "reviewer_id": reviewer_id, "claim_decision": "approve", "support_label": "full",
            "supporting_span_ids": claim["supporting_span_ids"], "notes": "software-test decision",
        }
    for pair in workspace.contradictions:
        state["decisions"]["contradictions"][pair["pair_id"]] = {
            "reviewer_id": reviewer_id, "label": "not_contradiction", "rationale": "software-test rationale",
        }
    for artifact in workspace.artifacts:
        state["decisions"]["artifacts"][artifact["document_id"]] = {
            "reviewer_id": reviewer_id, "artifact_decision": "reject", "notes": "software-test decision",
        }
    workspace.save_state(state)
    return state


def corpus_approval_payload(workspace: ReviewWorkspace, reviewer_id: str = "R1") -> dict:
    return {
        "reviewer_id": reviewer_id,
        "documents": [
            {
                "document_id": document["doc_id"], "source_hash": document["sha256"],
                "include_in_corpus": "yes", "split": document["proposed_split"], "reviewer_note": "",
            }
            for document in workspace.documents.values() if document.get("eligible_for_study")
        ],
    }


def test_query_approval_is_never_implicit(tmp_path: Path):
    workspace = ReviewWorkspace(fixture(tmp_path))
    with pytest.raises(ValueError, match="explicit query"):
        workspace.save_decision("queries", "V01", {"reviewer_id": "R1"})


def test_reject_persists_after_workspace_reload_and_candidates_do_not_change(tmp_path: Path):
    root = fixture(tmp_path)
    workspace = ReviewWorkspace(root)
    before = file_hashes(root, workspace.guarded_files)
    workspace.save_decision("queries", "V01", {
        "reviewer_id": "R1", "query_decision": "reject", "notes": "Not suitable",
    })
    reloaded = ReviewWorkspace(root).load_state("R1")
    assert reloaded["decisions"]["queries"]["V01"]["query_decision"] == "reject"
    assert file_hashes(root, workspace.guarded_files) == before


def test_answer_reject_is_saved_and_counted_as_rejected(tmp_path: Path):
    workspace = ReviewWorkspace(fixture(tmp_path))
    result = workspace.save_decision("queries", "V01", {
        "reviewer_id": "R1", "query_decision": "approve", "answerability": "answerable",
        "answer_decision": "reject", "notes": "The query is valid but the proposed answer is not",
    })

    assert result["decision"]["answer_decision"] == "reject"
    assert result["progress"]["queries"]["rejected"] == 1
    assert result["progress"]["queries"]["pending"] == len(workspace.queries) - 1


def test_claim_reject_does_not_require_support_fields(tmp_path: Path):
    workspace = ReviewWorkspace(fixture(tmp_path))
    claim = workspace.citations[0]
    result = workspace.save_decision("citations", claim["answer_or_claim_id"], {
        "reviewer_id": "R1", "claim_decision": "reject", "notes": "Unsupported claim",
    })

    assert result["decision"]["claim_decision"] == "reject"
    assert result["progress"]["citations"]["reviewed"] == 1


def test_corrected_evidence_must_resolve_before_approval(tmp_path: Path):
    workspace = ReviewWorkspace(fixture(tmp_path))
    query = workspace.by_kind["queries"]["V01"]
    valid = query["candidate_evidence_spans"]
    result = workspace.save_decision("queries", "V01", {
        "reviewer_id": "R1", "query_decision": "approve", "answerability": "answerable",
        "answer_decision": "approve", "evidence_decision": "approve",
        "corrected_evidence": valid,
    })
    assert result["saved"] is True
    broken = [dict(valid[0], start_offset=valid[0]["start_offset"] + 1)]
    with pytest.raises(ValueError, match="evidence text/offset mismatch"):
        workspace.save_decision("queries", "V02", {
            "reviewer_id": "R1", "query_decision": "approve", "answerability": "answerable",
            "answer_decision": "approve", "evidence_decision": "approve",
            "corrected_evidence": broken,
        })


def test_missing_source_cannot_be_approved(tmp_path: Path):
    root = fixture(tmp_path)
    rows = [json.loads(line) for line in (root / "documents.jsonl").read_text(encoding="utf-8").splitlines()]
    rows[0]["source"] = str(root / "does-not-exist.pdf")
    (root / "documents.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    workspace = ReviewWorkspace(root)
    with pytest.raises(ValueError, match="source file does not exist"):
        workspace.save_decision("queries", "V01", {
            "reviewer_id": "R1", "query_decision": "approve", "answerability": "answerable",
            "answer_decision": "approve", "evidence_decision": "approve",
        })


def test_duplicate_candidate_ids_are_rejected(tmp_path: Path):
    root = fixture(tmp_path)
    path = root / "query_candidates.jsonl"
    first = path.read_text(encoding="utf-8").splitlines()[0]
    path.write_text(path.read_text(encoding="utf-8") + first + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match="duplicate"):
        ReviewWorkspace(root)


def test_missing_corpus_approval_blocks_export(tmp_path: Path):
    workspace = ReviewWorkspace(fixture(tmp_path))
    complete_annotation_state(workspace)
    with pytest.raises(ValueError, match="corpus approval"):
        workspace.export("R1")


def test_stale_source_hash_blocks_corpus_approval(tmp_path: Path):
    workspace = ReviewWorkspace(fixture(tmp_path))
    payload = corpus_approval_payload(workspace)
    payload["documents"][0]["source_hash"] = "0" * 64
    with pytest.raises(ValueError, match="source hash"):
        workspace.save_corpus_approval(payload)


def test_excluded_document_cannot_retain_split(tmp_path: Path):
    workspace = ReviewWorkspace(fixture(tmp_path))
    payload = corpus_approval_payload(workspace)
    payload["documents"][0].update({"include_in_corpus": "no", "split": "development"})
    with pytest.raises(ValueError, match="excluded document cannot have a split"):
        workspace.save_corpus_approval(payload)


def test_included_document_requires_split(tmp_path: Path):
    workspace = ReviewWorkspace(fixture(tmp_path))
    payload = corpus_approval_payload(workspace)
    payload["documents"][0]["split"] = ""
    with pytest.raises(ValueError, match="included document requires development or test split"):
        workspace.save_corpus_approval(payload)


def test_reload_preserves_corpus_approval(tmp_path: Path):
    root = fixture(tmp_path)
    workspace = ReviewWorkspace(root)
    payload = corpus_approval_payload(workspace)
    payload["documents"][0]["reviewer_note"] = "Confirmed against the source inventory"
    result = workspace.save_corpus_approval(payload)
    reloaded = ReviewWorkspace(root).load_corpus_approval("R1")
    assert result["saved"] is True
    assert reloaded["reviewer_id"] == "R1"
    assert reloaded["candidate_package_hash"] == workspace.package_hash
    assert reloaded["documents"] == payload["documents"]
    assert reloaded["reviewed_at"]


def test_corpus_approval_keeps_candidate_package_byte_identical(tmp_path: Path):
    root = fixture(tmp_path)
    workspace = ReviewWorkspace(root)
    before = file_hashes(root, workspace.guarded_files)
    workspace.save_corpus_approval(corpus_approval_payload(workspace))
    assert file_hashes(root, workspace.guarded_files) == before


def test_complete_test_ledger_exports_compatible_files_without_touching_candidates(tmp_path: Path):
    root = fixture(tmp_path)
    workspace = ReviewWorkspace(root)
    before = file_hashes(root, workspace.guarded_files)
    complete_annotation_state(workspace)
    workspace.save_corpus_approval(corpus_approval_payload(workspace))
    result = workspace.export("R1")
    export_root = Path(result["export_dir"])
    assert (export_root / "human_review_queries.csv").is_file()
    assert (export_root / "human_review_citations.csv").is_file()
    assert (export_root / "human_review_contradictions.csv").is_file()
    assert (export_root / "human_review_artifacts.csv").is_file()
    assert (export_root / "corpus_approval.json").is_file()
    summary = json.loads((export_root / "human_review_summary.json").read_text(encoding="utf-8"))
    assert summary["contains_research_performance_metrics"] is False
    assert summary["dataset_frozen"] is False
    imported = import_review(root, export_root / "human_review_queries.csv")
    assert imported["queries_imported"] == 3
    assert imported["contradictions_imported"] == 3
    assert file_hashes(root, workspace.guarded_files) == before
