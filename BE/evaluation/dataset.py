from __future__ import annotations

import json
import argparse
import hashlib
import csv
from datetime import datetime, timezone
from pathlib import Path

DATASET_SCHEMA_VERSION = "memvid-research-dataset-v1"

REQUIRED = {
    "documents.jsonl": {"doc_id", "source", "format", "language", "length", "structure_quality", "scan_status", "domain", "duplicate_group", "eligible_for_study", "annotation_status"},
    "queries.jsonl": {"query_id", "query", "query_type", "language", "relevant_doc_ids", "gold_status", "gold_answer", "difficulty", "ambiguity", "requires_multi_chunk", "requires_hierarchical_context", "contradiction_case", "split", "annotation_status"},
    "citation_annotations.jsonl": {"query_id", "answer_or_claim_id", "claim", "supporting_span_ids", "support_label", "annotation_status"},
    "contradictions.jsonl": {"span_a_id", "span_b_id", "label", "notes", "human_rationale", "annotation_status"},
    "artifact_annotations.jsonl": {"document_id", "evaluation_scope", "important_concepts", "important_sections", "expected_relations", "annotator", "annotation_status"},
    "canonical_evidence_spans.jsonl": {"span_id", "query_id", "doc_id", "locator", "evidence_text", "evidence_text_sha256", "annotation_status"},
    "representation_qrels.jsonl": {"query_id", "span_id", "representation_id", "chunk_id", "mapping_rule_version", "annotation_status"},
}

ANNOTATION_STATUSES = {"candidate", "human_validated", "adjudicated", "excluded"}
FINAL_STATUSES = {"human_validated", "adjudicated"}


def validate_candidate_package(root: Path) -> dict:
    """Validate annotation aids without treating them as final research labels."""
    root = Path(root)
    candidate_path = root / "query_candidates.jsonl"
    if not candidate_path.exists():
        return {}
    documents = {d["doc_id"]: d for d in load_jsonl(root / "documents.jsonl")}
    units = {
        (u["doc_id"], json.dumps(u["locator"], ensure_ascii=False, sort_keys=True)): u
        for u in load_jsonl(root / "source_units.jsonl")
    }
    queries = load_jsonl(candidate_path)
    query_ids: set[str] = set()
    answerability = {"answerable", "ambiguous", "insufficient_evidence"}
    for row in queries:
        qid = row.get("query_id")
        if not qid or qid in query_ids:
            raise ValueError(f"candidate query_id missing or duplicate: {qid!r}")
        query_ids.add(qid)
        if row.get("annotation_status") != "candidate":
            raise ValueError(f"candidate query {qid}: annotation_status must be candidate")
        if row.get("document_id") not in documents or not documents[row["document_id"]].get("eligible_for_study"):
            raise ValueError(f"candidate query {qid}: unknown/ineligible document")
        if row.get("answerability") not in answerability:
            raise ValueError(f"candidate query {qid}: invalid answerability")
        spans = row.get("candidate_evidence_spans") or []
        if row["answerability"] == "answerable" and (not row.get("candidate_answer") or not spans):
            raise ValueError(f"candidate query {qid}: answerable proposal needs answer and evidence")
        if row["answerability"] != "answerable" and (row.get("candidate_answer") or spans):
            raise ValueError(f"candidate query {qid}: non-answerable proposal must not carry gold-like answer/evidence")
        for span in spans:
            key = (row["document_id"], json.dumps(span.get("locator"), ensure_ascii=False, sort_keys=True))
            unit = units.get(key)
            start, end = span.get("start_offset"), span.get("end_offset")
            if unit is None or not isinstance(start, int) or not isinstance(end, int):
                raise ValueError(f"candidate query {qid}: unresolved evidence locator/offset")
            if unit["text"][start:end] != span.get("evidence_text"):
                raise ValueError(f"candidate query {qid}: evidence text/offset mismatch")
    candidate_spans = load_jsonl(root / "candidate_canonical_evidence_spans.jsonl")
    span_ids = {s["span_id"] for s in candidate_spans}
    if len(span_ids) != len(candidate_spans) or any(s.get("query_id") not in query_ids for s in candidate_spans):
        raise ValueError("candidate span IDs are duplicate or reference unknown queries")
    claims = load_jsonl(root / "candidate_citation_annotations.jsonl")
    if any(c.get("query_id") not in query_ids or any(s not in span_ids for s in c.get("supporting_span_ids", [])) for c in claims):
        raise ValueError("candidate claim references unknown query/span")
    contradictions = load_jsonl(root / "candidate_contradictions.jsonl")
    if any(p.get("span_a_id") not in span_ids or p.get("span_b_id") not in span_ids for p in contradictions):
        raise ValueError("candidate contradiction references unknown span")
    artifacts = load_jsonl(root / "candidate_artifact_annotations.jsonl")
    if any(a.get("document_id") not in documents for a in artifacts):
        raise ValueError("candidate artifact references unknown document")
    review_counts = {}
    for filename in ("human_review_queries.csv", "human_review_citations.csv", "human_review_contradictions.csv", "human_review_artifacts.csv"):
        with (root / filename).open("r", encoding="utf-8-sig", newline="") as handle:
            review_counts[filename] = sum(1 for _ in csv.DictReader(handle))
    expected = {
        "human_review_queries.csv": len(queries), "human_review_citations.csv": len(claims),
        "human_review_contradictions.csv": len(contradictions), "human_review_artifacts.csv": len(artifacts),
    }
    if review_counts != expected:
        raise ValueError(f"human review sheet counts do not match candidates: {review_counts} != {expected}")
    return {
        "queries": len(queries), "spans": len(candidate_spans), "claims": len(claims),
        "contradictions": len(contradictions), "artifact_documents": len(artifacts),
        "review_sheets": review_counts, "status": "candidate_only_valid",
    }


def load_jsonl(path: Path) -> list[dict]:
    records = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        obj = json.loads(line)
        if not isinstance(obj, dict):
            raise ValueError(f"{path}:{line_no}: record must be an object")
        records.append(obj)
    return records


def validate_dataset(root: Path) -> dict:
    root = Path(root)
    manifest = json.loads((root / "dataset_manifest.json").read_text(encoding="utf-8"))
    if manifest.get("schema_version") != DATASET_SCHEMA_VERSION:
        raise ValueError("unsupported dataset schema_version")
    counts = {}
    for filename, required in REQUIRED.items():
        path = root / filename
        rows = load_jsonl(path)
        for line_no, row in enumerate(rows, 1):
            missing = required - row.keys()
            if missing:
                raise ValueError(f"{filename}:{line_no}: missing {sorted(missing)}")
            if row.get("annotation_status") not in ANNOTATION_STATUSES:
                raise ValueError(f"{filename}:{line_no}: invalid annotation_status")
        counts[filename] = len(rows)
    # Leakage guard: a document/group may belong to only one split.
    queries = load_jsonl(root / "queries.jsonl")
    split_by_group: dict[str, str] = {}
    for q in queries:
        group = str(q.get("near_duplicate_group") or "").strip()
        if not group:
            continue
        old = split_by_group.setdefault(group, q["split"])
        if old != q["split"]:
            raise ValueError(f"near_duplicate_group {group!r} crosses splits")
    documents = load_jsonl(root / "documents.jsonl")
    doc_split = {d["doc_id"]: d.get("split") for d in documents if d.get("eligible_for_study")}
    for q in queries:
        for doc_id in q.get("relevant_doc_ids") or []:
            if doc_split.get(doc_id) and doc_split[doc_id] != q["split"]:
                raise ValueError(f"query {q['query_id']} leaks document {doc_id} across splits")
    groups: dict[str, set[str]] = {}
    for d in documents:
        if d.get("duplicate_group") and d.get("split"):
            groups.setdefault(str(d["duplicate_group"]), set()).add(str(d["split"]))
    leaking_groups = sorted(g for g, splits in groups.items() if len(splits) > 1)
    if leaking_groups:
        raise ValueError(f"document duplicate groups cross splits: {leaking_groups}")
    return {"schema_version": DATASET_SCHEMA_VERSION, "counts": counts,
            "candidate_package": validate_candidate_package(root),
            "splits": sorted({q["split"] for q in queries}), "leakage_check": "pass"}


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def freeze_dataset(root: Path) -> dict:
    """Freeze only fully human-validated data. Refuses candidate or empty research labels."""
    root = Path(root)
    validation = validate_dataset(root)
    manifest = json.loads((root / "dataset_manifest.json").read_text(encoding="utf-8"))
    documents = load_jsonl(root / "documents.jsonl")
    queries = load_jsonl(root / "queries.jsonl")
    if not queries:
        raise ValueError("cannot freeze: queries.jsonl is empty")
    test = [q for q in queries if q.get("split") == "test"]
    development = [q for q in queries if q.get("split") == "development"]
    if not test or not development:
        raise ValueError("cannot freeze: both development and test queries are required")
    pending = [(name, row.get("query_id") or row.get("span_id") or row.get("answer_or_claim_id"))
               for name in REQUIRED for row in load_jsonl(root / name)
               if row.get("annotation_status") not in FINAL_STATUSES and row.get("annotation_status") != "excluded"]
    if pending:
        raise ValueError(f"cannot freeze: non-final annotations remain (first five: {pending[:5]})")
    spans = load_jsonl(root / "canonical_evidence_spans.jsonl")
    canonical_path = root / "canonical_documents.jsonl"
    if not canonical_path.is_file():
        raise ValueError("cannot freeze: canonical_documents.jsonl is missing")
    canonical_documents = load_jsonl(canonical_path)
    canonical_by_doc = {record.get("doc_id"): record for record in canonical_documents}
    eligible_doc_ids = {d["doc_id"] for d in documents if d.get("eligible_for_study")}
    if set(canonical_by_doc) != eligible_doc_ids:
        raise ValueError("cannot freeze: canonical document coverage does not match frozen corpus")
    from evaluation.evidence import validate_canonical_span
    for record in canonical_documents:
        text = str(record.get("canonical_text") or "")
        if not text or hashlib.sha256(text.encode("utf-8")).hexdigest() != record.get("canonical_text_sha256"):
            raise ValueError(f"cannot freeze: canonical document hash invalid: {record.get('doc_id')}")
        document = next((d for d in documents if d.get("doc_id") == record.get("doc_id")), None)
        if document is None or record.get("source_sha256") != document.get("sha256"):
            raise ValueError(f"cannot freeze: canonical source identity invalid: {record.get('doc_id')}")
    for span in spans:
        record = canonical_by_doc.get(span.get("doc_id"))
        if record is None:
            raise ValueError(f"cannot freeze: span references missing canonical document: {span.get('span_id')}")
        validate_canonical_span(span, record)
    span_queries = {s["query_id"] for s in spans if s["annotation_status"] in FINAL_STATUSES}
    answerable = {q["query_id"] for q in queries if q.get("gold_status") == "answerable"}
    missing_answers = sorted(q["query_id"] for q in queries if q["query_id"] in answerable and not q.get("gold_answer"))
    if missing_answers:
        raise ValueError(f"cannot freeze: answerable queries without gold answers: {missing_answers[:10]}")
    if not any(q.get("gold_status") == "insufficient_evidence" for q in queries):
        raise ValueError("cannot freeze: insufficient-evidence subset is empty")
    if not any(q.get("ambiguity") for q in queries):
        raise ValueError("cannot freeze: ambiguous-query subset is empty")
    missing = sorted(answerable - span_queries)
    if missing:
        raise ValueError(f"cannot freeze: answerable queries without canonical spans: {missing[:10]}")
    rqrels = load_jsonl(root / "representation_qrels.jsonl")
    span_by_id = {s["span_id"]: s for s in spans}
    for qrel in rqrels:
        span = span_by_id.get(qrel.get("span_id"))
        if span is None or qrel.get("query_id") != span.get("query_id") or qrel.get("doc_id") != span.get("doc_id"):
            raise ValueError(f"cannot freeze: qrel provenance mismatch: {qrel}")
    coverage = {(r["query_id"], r["representation_id"]) for r in rqrels if r["annotation_status"] in FINAL_STATUSES}
    missing_mappings = sorted((qid, rid) for qid in answerable for rid in ("R0", "R1", "R2") if (qid, rid) not in coverage)
    if missing_mappings:
        raise ValueError(f"cannot freeze: representation qrels incomplete (first ten: {missing_mappings[:10]})")
    citations = [c for c in load_jsonl(root / "citation_annotations.jsonl") if c["annotation_status"] in FINAL_STATUSES]
    citation_queries = {c["query_id"] for c in citations}
    if answerable - citation_queries:
        raise ValueError(f"cannot freeze: claim annotations missing for queries: {sorted(answerable - citation_queries)[:10]}")
    contradictions = [c for c in load_jsonl(root / "contradictions.jsonl") if c["annotation_status"] in FINAL_STATUSES]
    if not contradictions:
        raise ValueError("cannot freeze: validated contradiction/difference subset is empty")
    artifacts = [a for a in load_jsonl(root / "artifact_annotations.jsonl") if a["annotation_status"] in FINAL_STATUSES]
    scopes = {scope for a in artifacts for scope in a.get("evaluation_scope", [])}
    if not {"summary", "mind_map"}.issubset(scopes):
        raise ValueError("cannot freeze: summary and mind-map artifact annotations are both required")
    qrel_manifest_path = root / "qrel_manifest.json"
    if not qrel_manifest_path.is_file():
        raise ValueError("cannot freeze: qrel_manifest.json is missing")
    qrel_manifest = json.loads(qrel_manifest_path.read_text(encoding="utf-8"))
    if set((qrel_manifest.get("representations") or {})) != {"R0", "R1", "R2"}:
        raise ValueError("cannot freeze: qrel manifest must cover R0, R1, and R2")
    if qrel_manifest.get("corpus_hash") != manifest.get("corpus_hash"):
        raise ValueError("cannot freeze: qrel manifest corpus hash mismatch")
    if qrel_manifest.get("representation_qrels_sha256") != _sha256(root / "representation_qrels.jsonl"):
        raise ValueError("cannot freeze: qrel manifest hash is stale")
    files = sorted(root.glob("*.jsonl"))
    dataset_hash = hashlib.sha256("".join(f"{p.name}:{_sha256(p)}\n" for p in files).encode()).hexdigest()
    split_hash = hashlib.sha256("\n".join(sorted(f"{q['query_id']}:{q['split']}" for q in queries)).encode()).hexdigest()
    annotation_files = [p for p in files if p.name != "documents.jsonl"]
    annotation_hash = hashlib.sha256("".join(f"{p.name}:{_sha256(p)}\n" for p in annotation_files).encode()).hexdigest()
    manifest_path = root / "dataset_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.update({"status": "frozen", "annotation_status": "human_validated_or_adjudicated",
                     "split_status": "frozen", "frozen_at": datetime.now(timezone.utc).isoformat(),
                     "dataset_version": manifest.get("dataset_version") or manifest["dataset_id"],
                     "dataset_hash": dataset_hash, "split_hash": split_hash, "annotation_hash": annotation_hash,
                     "query_count": len(queries), "document_count_eligible": len(eligible_doc_ids),
                     "freeze_blocked": False, "freeze_blockers": [],
                     "file_hashes": {p.name: _sha256(p) for p in files}})
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    qrel_manifest.update({"frozen_dataset_hash": dataset_hash, "frozen_annotation_hash": annotation_hash})
    qrel_manifest_path.write_text(json.dumps(qrel_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    study_path = root.parent.parent / "study_manifest.json"
    if study_path.is_file():
        study = json.loads(study_path.read_text(encoding="utf-8"))
        study["dataset"] = {
            "path": str(root).replace("\\", "/"),
            "dataset_version": manifest["dataset_version"],
            "status": "frozen",
            "corpus_hash": manifest.get("corpus_hash"),
            "dataset_hash": dataset_hash,
            "split_hash": split_hash,
            "annotation_hash": annotation_hash,
        }
        study["representation_indexes"] = qrel_manifest["representations"]
        study["final_benchmark_authorized"] = True
        study["authorized_at"] = datetime.now(timezone.utc).isoformat()
        study["note"] = "Dataset, qrels, and R0/R1/R2 index manifests passed the reproducibility gate; no benchmark has been run."
        study_path.write_text(json.dumps(study, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {**validation, "dataset_hash": dataset_hash, "split_hash": split_hash, "annotation_hash": annotation_hash}


def freeze_corpus(root: Path) -> dict:
    """Lock human-approved source membership/hashes before representation indexes."""
    root = Path(root)
    validate_dataset(root)
    docs = [d for d in load_jsonl(root / "documents.jsonl") if d.get("eligible_for_study")]
    if not docs:
        raise ValueError("cannot freeze corpus: no eligible documents")
    pending = [d["doc_id"] for d in docs if d.get("annotation_status") not in FINAL_STATUSES]
    if pending:
        raise ValueError(f"cannot freeze corpus: eligible documents not human-approved: {pending}")
    if any(d.get("split") not in {"development", "test"} for d in docs):
        raise ValueError("cannot freeze corpus: each eligible document needs a human-approved split")
    entries = []
    for d in docs:
        path = Path(d["source"])
        if not path.is_file():
            raise ValueError(f"cannot freeze corpus: missing source {path}")
        actual = _sha256(path)
        if actual != d.get("sha256"):
            raise ValueError(f"cannot freeze corpus: source hash changed for {d['doc_id']}")
        entries.append(f"{d['doc_id']}:{d['split']}:{actual}\n")
    corpus_hash = hashlib.sha256("".join(sorted(entries)).encode()).hexdigest()
    manifest_path = root / "dataset_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.update({"status": "corpus_frozen_annotation_in_progress", "corpus_version": "corpus_v1.0",
                     "corpus_frozen_at": datetime.now(timezone.utc).isoformat(), "corpus_hash": corpus_hash,
                     "split_status": "document_split_frozen", "split_hash": hashlib.sha256(
                         "".join(sorted(f"{d['doc_id']}:{d['split']}\n" for d in docs)).encode()).hexdigest(),
                     "query_count": len(load_jsonl(root / "queries.jsonl")),
                     "document_count_eligible": len(docs),
                     "annotation_status": "review_imported_qrel_mapping_pending",
                     "freeze_blocked": True,
                     "freeze_blockers": ["R0/R1/R2 indexes and representation qrels are required before final dataset freeze."]})
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    study_path = root.parent.parent / "study_manifest.json"
    if study_path.is_file():
        study = json.loads(study_path.read_text(encoding="utf-8"))
        study["dataset"] = {
            "path": str(root).replace("\\", "/"),
            "dataset_version": manifest.get("dataset_version"),
            "status": "corpus_frozen_annotation_in_progress",
            "corpus_hash": corpus_hash,
            "dataset_hash": None,
            "split_hash": manifest["split_hash"],
            "annotation_hash": None,
        }
        study["representation_indexes"] = {"R0": "pending", "R1": "pending", "R2": "pending"}
        study["final_benchmark_authorized"] = False
        study["note"] = "Review import and canonical coordinate bridge passed; exact embedding index build and qrels remain pending."
        study_path.write_text(json.dumps(study, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"corpus_version": manifest["corpus_version"], "corpus_hash": corpus_hash,
            "document_count": len(docs), "split_hash": manifest["split_hash"]}


def scaffold(root: Path, *, dataset_id: str, corpus_version: str) -> Path:
    root = Path(root)
    if root.exists() and any(root.iterdir()):
        raise FileExistsError(f"refusing to overwrite dataset directory: {root}")
    root.mkdir(parents=True, exist_ok=True)
    manifest = {"schema_version": DATASET_SCHEMA_VERSION, "dataset_id": dataset_id, "corpus_version": corpus_version,
                "status": "annotation_in_progress", "warning": "Empty scaffold; do not run experiments until human annotations validate."}
    (root / "dataset_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    for filename in REQUIRED:
        (root / filename).write_text("", encoding="utf-8")
    return root


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init")
    init.add_argument("root", type=Path); init.add_argument("--dataset-id", required=True); init.add_argument("--corpus-version", required=True)
    val = sub.add_parser("validate"); val.add_argument("root", type=Path)
    freeze = sub.add_parser("freeze"); freeze.add_argument("root", type=Path)
    freeze_c = sub.add_parser("freeze-corpus"); freeze_c.add_argument("root", type=Path)
    export_r = sub.add_parser("export-review")
    export_r.add_argument("root", type=Path)
    export_r.add_argument("--output", type=Path)
    import_r = sub.add_parser("import-review")
    import_r.add_argument("root", type=Path)
    import_r.add_argument("--input", type=Path, required=True)
    args = p.parse_args(argv)
    if args.command == "init":
        print(scaffold(args.root, dataset_id=args.dataset_id, corpus_version=args.corpus_version))
    elif args.command == "freeze":
        print(json.dumps(freeze_dataset(args.root), indent=2))
    elif args.command == "freeze-corpus":
        print(json.dumps(freeze_corpus(args.root), indent=2))
    elif args.command == "export-review":
        from .review import export_review
        print(json.dumps(export_review(args.root, args.output), indent=2))
    elif args.command == "import-review":
        from .review import import_review
        print(json.dumps(import_review(args.root, args.input), indent=2))
    else:
        print(json.dumps(validate_dataset(args.root), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
