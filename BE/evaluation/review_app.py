from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .dataset import load_jsonl, validate_candidate_package
from .review import (
    ARTIFACT_REVIEW_FIELDS,
    CITATION_REVIEW_FIELDS,
    CONTRADICTION_REVIEW_FIELDS,
    REVIEW_FIELDS,
    _validate_evidence,
)


STATE_VERSION = "human-review-state-v1"
REVIEWER_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
KINDS = ("queries", "citations", "contradictions", "artifacts")
CONTRADICTION_LABELS = {
    "direct_contradiction", "conditional_difference", "scope_difference",
    "temporal_difference", "not_contradiction",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def read_csv(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, fields: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    os.replace(temporary, path)


class ReviewWorkspace:
    guarded_files = (
        "query_candidates.jsonl", "candidate_canonical_evidence_spans.jsonl",
        "candidate_citation_annotations.jsonl", "candidate_contradictions.jsonl",
        "candidate_artifact_annotations.jsonl", "source_units.jsonl",
        "human_review_queries.csv", "human_review_citations.csv",
        "human_review_contradictions.csv", "human_review_artifacts.csv",
    )

    def __init__(self, root: Path):
        self.root = Path(root).resolve()
        validate_candidate_package(self.root)
        self.documents = {d["doc_id"]: d for d in load_jsonl(self.root / "documents.jsonl")}
        self.queries = load_jsonl(self.root / "query_candidates.jsonl")
        self.spans = {s["span_id"]: s for s in load_jsonl(self.root / "candidate_canonical_evidence_spans.jsonl")}
        self.citations = load_jsonl(self.root / "candidate_citation_annotations.jsonl")
        self.contradictions = load_jsonl(self.root / "candidate_contradictions.jsonl")
        self.artifacts = load_jsonl(self.root / "candidate_artifact_annotations.jsonl")
        self.units = {
            (u["doc_id"], json.dumps(u["locator"], ensure_ascii=False, sort_keys=True)): u
            for u in load_jsonl(self.root / "source_units.jsonl")
        }
        self.by_kind = {
            "queries": {q["query_id"]: q for q in self.queries},
            "citations": {c["answer_or_claim_id"]: c for c in self.citations},
            "contradictions": {c["pair_id"]: c for c in self.contradictions},
            "artifacts": {a["document_id"]: a for a in self.artifacts},
        }
        for kind, records in self.by_kind.items():
            expected = len(getattr(self, kind))
            if len(records) != expected:
                raise ValueError(f"duplicate IDs in {kind}")
        self.candidate_hashes = {name: sha256(self.root / name) for name in self.guarded_files}
        manifest = json.loads((self.root / "dataset_manifest.json").read_text(encoding="utf-8"))
        self.package_hash = manifest.get("candidate_package_hash")

    def validate_reviewer(self, reviewer_id: str) -> str:
        value = str(reviewer_id or "").strip()
        if not REVIEWER_RE.fullmatch(value):
            raise ValueError("reviewer_id must be 1–32 letters, digits, underscores, or hyphens")
        return value

    def state_path(self, reviewer_id: str) -> Path:
        return self.root / "reviews" / self.validate_reviewer(reviewer_id) / "state.json"

    def corpus_approval_path(self, reviewer_id: str) -> Path:
        return self.root / "reviews" / self.validate_reviewer(reviewer_id) / "corpus_approval.json"

    def load_corpus_approval(self, reviewer_id: str) -> dict | None:
        path = self.corpus_approval_path(reviewer_id)
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    def corpus_items(self, reviewer_id: str) -> list[dict]:
        approval = self.load_corpus_approval(reviewer_id) or {}
        decisions = {row["document_id"]: row for row in approval.get("documents", [])}
        return [{
            "document_id": doc["doc_id"], "filename": doc["filename"],
            "domain": doc["domain"], "format": doc["format"],
            "source_hash": doc["sha256"], "proposed_include_in_corpus": "yes",
            "proposed_split": doc.get("proposed_split") or "",
            "decision": decisions.get(doc["doc_id"]),
        } for doc in self.documents.values() if doc.get("eligible_for_study")]

    def _validated_corpus_decisions(self, decisions: list[dict]) -> list[dict]:
        selected = {doc["doc_id"]: doc for doc in self.documents.values() if doc.get("eligible_for_study")}
        ids = [str(decision.get("document_id") or "") for decision in decisions]
        if len(ids) != len(set(ids)) or set(ids) != set(selected):
            raise ValueError("corpus approval must contain each selected candidate document exactly once")
        normalized = []
        for decision in decisions:
            doc_id = str(decision.get("document_id") or "")
            document = selected[doc_id]
            if decision.get("source_hash") != document.get("sha256"):
                raise ValueError(f"document {doc_id}: source hash does not match the candidate package")
            source = Path(document["source"])
            if not source.is_file() or sha256(source) != document.get("sha256"):
                raise ValueError(f"document {doc_id}: source hash is stale")
            include = decision.get("include_in_corpus")
            split = decision.get("split") or ""
            if include == "no" and split:
                raise ValueError(f"document {doc_id}: excluded document cannot have a split")
            if include == "yes" and split not in {"development", "test"}:
                raise ValueError(f"document {doc_id}: included document requires development or test split")
            if include not in {"yes", "no"}:
                raise ValueError(f"document {doc_id}: explicit include_in_corpus yes or no is required")
            normalized.append({
                "document_id": doc_id, "source_hash": document["sha256"],
                "include_in_corpus": include, "split": split,
                "reviewer_note": str(decision.get("reviewer_note") or ""),
            })
        return normalized

    def save_corpus_approval(self, payload: dict) -> dict:
        reviewer_id = self.validate_reviewer(payload.get("reviewer_id"))
        decisions = payload.get("documents") or []
        normalized = self._validated_corpus_decisions(decisions)
        self.assert_candidates_unchanged()
        approval = {
            "schema_version": "corpus-approval-v1", "reviewer_id": reviewer_id,
            "reviewed_at": utc_now(), "candidate_package_hash": self.package_hash,
            "documents": normalized,
        }
        atomic_json(self.corpus_approval_path(reviewer_id), approval)
        self.assert_candidates_unchanged()
        return {"saved": True, "approval": approval}

    def load_state(self, reviewer_id: str) -> dict:
        reviewer_id = self.validate_reviewer(reviewer_id)
        path = self.state_path(reviewer_id)
        if path.exists():
            state = json.loads(path.read_text(encoding="utf-8"))
            if state.get("reviewer_id") != reviewer_id or state.get("schema_version") != STATE_VERSION:
                raise ValueError("review state identity/schema mismatch")
            return state
        return {
            "schema_version": STATE_VERSION, "reviewer_id": reviewer_id,
            "candidate_package_hash": self.package_hash,
            "created_at": utc_now(), "updated_at": utc_now(),
            "decisions": {kind: {} for kind in KINDS},
        }

    def assert_candidates_unchanged(self) -> None:
        changed = [name for name, expected in self.candidate_hashes.items() if sha256(self.root / name) != expected]
        if changed:
            raise ValueError(f"candidate package changed during review: {changed}")

    def save_state(self, state: dict) -> None:
        self.assert_candidates_unchanged()
        state["updated_at"] = utc_now()
        atomic_json(self.state_path(state["reviewer_id"]), state)

    def _source_view(self, span: dict) -> dict:
        doc_id = span["doc_id"]
        key = (doc_id, json.dumps(span["locator"], ensure_ascii=False, sort_keys=True))
        unit = self.units.get(key)
        if unit is None:
            raise ValueError(f"source locator no longer resolves: {span['locator']}")
        start, end = span["start_offset"], span["end_offset"]
        if unit["text"][start:end] != span["evidence_text"]:
            raise ValueError("candidate evidence no longer matches source text")
        radius = 320
        return {
            **span, "locator_label": unit["locator_label"],
            "context_before": unit["text"][max(0, start - radius):start],
            "context_after": unit["text"][end:min(len(unit["text"]), end + radius)],
            "exact_source_text": span["evidence_text"],
        }

    def items(self, kind: str, reviewer_id: str) -> list[dict]:
        if kind not in KINDS:
            raise ValueError("unknown review kind")
        state = self.load_state(reviewer_id)
        decisions = state["decisions"][kind]
        result = []
        if kind == "queries":
            for row in self.queries:
                evidence = [self._source_view({"doc_id": row["document_id"], **s}) for s in row.get("candidate_evidence_spans", [])]
                result.append({**row, "source_views": evidence, "decision": decisions.get(row["query_id"])})
        elif kind == "citations":
            for row in self.citations:
                support = [self._source_view(self.spans[sid]) for sid in row.get("supporting_span_ids", [])]
                result.append({**row, "source_views": support, "decision": decisions.get(row["answer_or_claim_id"])})
        elif kind == "contradictions":
            for row in self.contradictions:
                result.append({**row, "passage_a": self._source_view(self.spans[row["span_a_id"]]),
                               "passage_b": self._source_view(self.spans[row["span_b_id"]]),
                               "decision": decisions.get(row["pair_id"])})
        else:
            for row in self.artifacts:
                result.append({**row, "document": self.documents[row["document_id"]],
                               "decision": decisions.get(row["document_id"])})
        return result

    def _candidate_evidence(self, query: dict, payload: dict) -> list[dict]:
        corrected = payload.get("corrected_evidence")
        evidence = corrected if corrected not in (None, "") else query.get("candidate_evidence_spans", [])
        if isinstance(evidence, str):
            evidence = json.loads(evidence)
        if not isinstance(evidence, list):
            raise ValueError("corrected evidence must be a JSON list")
        return evidence

    def validate_decision(self, kind: str, item_id: str, payload: dict) -> dict:
        if kind not in KINDS or item_id not in self.by_kind[kind]:
            raise ValueError("unknown review item ID")
        reviewer_id = self.validate_reviewer(payload.get("reviewer_id"))
        decision = {**payload, "reviewer_id": reviewer_id, "saved_at": utc_now()}
        if kind == "queries":
            action = payload.get("query_decision")
            if action not in {"approve", "edit", "reject"}:
                raise ValueError("an explicit query Approve, Edit, or Reject decision is required")
            if action == "reject":
                return decision
            answerability = payload.get("answerability")
            if answerability not in {"answerable", "ambiguous", "insufficient_evidence"}:
                raise ValueError("an explicit answerability decision is required")
            query = self.by_kind[kind][item_id]
            if action == "edit" and not str(payload.get("corrected_query") or "").strip():
                raise ValueError("Edit + Approve requires corrected query text")
            if answerability == "answerable":
                if payload.get("answer_decision") not in {"approve", "edit", "reject"}:
                    raise ValueError("an explicit answer Approve, Edit, or Reject decision is required")
                if payload.get("answer_decision") == "edit" and not str(payload.get("corrected_answer") or "").strip():
                    raise ValueError("edited answer text is required")
                if payload.get("answer_decision") == "reject":
                    return decision
                if payload.get("evidence_decision") not in {"approve", "incomplete", "wrong"}:
                    raise ValueError("an explicit evidence decision is required")
                if payload.get("evidence_decision") == "approve":
                    evidence = self._candidate_evidence(query, payload)
                    if not evidence:
                        raise ValueError("answerable query needs evidence")
                    _validate_evidence(self.root, query["document_id"], evidence)
            return decision
        if kind == "citations":
            if payload.get("claim_decision") not in {"approve", "edit", "reject"}:
                raise ValueError("an explicit claim Approve, Edit, or Reject decision is required")
            if payload.get("claim_decision") == "reject":
                return decision
            if payload.get("support_label") not in {"full", "partial", "none", "contradicted"}:
                raise ValueError("an explicit citation support label is required")
            support_ids = payload.get("supporting_span_ids")
            if not isinstance(support_ids, list):
                raise ValueError("supporting_span_ids must be a list")
            claim = self.by_kind[kind][item_id]
            valid = {s["span_id"] for s in self.spans.values() if s["query_id"] == claim["query_id"]}
            if any(sid not in valid for sid in support_ids):
                raise ValueError("citation correction references unknown evidence")
            if payload.get("claim_decision") == "edit" and not str(payload.get("corrected_claim") or "").strip():
                raise ValueError("edited claim text is required")
            return decision
        if kind == "contradictions":
            if payload.get("label") not in CONTRADICTION_LABELS:
                raise ValueError("an explicit contradiction/difference label is required")
            if not str(payload.get("rationale") or "").strip():
                raise ValueError("human rationale is required")
            return decision
        action = payload.get("artifact_decision")
        if action not in {"approve", "edit", "reject"}:
            raise ValueError("an explicit artifact Approve, Edit, or Reject decision is required")
        if action == "edit":
            corrected = payload.get("corrected_annotation")
            if isinstance(corrected, str):
                corrected = json.loads(corrected)
            if not isinstance(corrected, dict):
                raise ValueError("artifact edit requires a corrected JSON object")
            decision["corrected_annotation"] = corrected
        return decision

    def save_decision(self, kind: str, item_id: str, payload: dict) -> dict:
        decision = self.validate_decision(kind, item_id, payload)
        state = self.load_state(decision["reviewer_id"])
        state["decisions"][kind][item_id] = decision
        self.save_state(state)
        return {"saved": True, "decision": decision, "progress": self.progress(state)}

    def progress(self, state: dict) -> dict:
        query_counts = {"approved": 0, "edited": 0, "rejected": 0, "pending": 0}
        for query in self.queries:
            d = state["decisions"]["queries"].get(query["query_id"])
            if not d:
                query_counts["pending"] += 1
            elif d["query_decision"] == "reject":
                query_counts["rejected"] += 1
            elif d.get("answer_decision") == "reject":
                query_counts["rejected"] += 1
            elif d.get("answerability") == "answerable" and d.get("evidence_decision") != "approve":
                query_counts["pending"] += 1
            elif d["query_decision"] == "edit" or d.get("answer_decision") == "edit" or d.get("corrected_evidence"):
                query_counts["edited"] += 1
            else:
                query_counts["approved"] += 1
        result = {"queries": query_counts}
        for kind, records in (("citations", self.citations), ("contradictions", self.contradictions), ("artifacts", self.artifacts)):
            reviewed = len(state["decisions"][kind])
            result[kind] = {"reviewed": reviewed, "pending": len(records) - reviewed, "total": len(records)}
        approval = self.load_corpus_approval(state["reviewer_id"])
        corpus_total = len(self.corpus_items(state["reviewer_id"]))
        if approval is not None:
            self._validated_corpus_decisions(approval.get("documents") or [])
        result["corpus"] = {
            "reviewed": len(approval.get("documents", [])) if approval else 0,
            "pending": 0 if approval else corpus_total, "total": corpus_total,
            "complete": approval is not None,
        }
        result["complete"] = approval is not None and query_counts["pending"] == 0 and all(result[k]["pending"] == 0 for k in ("citations", "contradictions", "artifacts"))
        result["dataset_blocked"] = not result["complete"]
        return result

    def bootstrap(self, reviewer_id: str) -> dict:
        state = self.load_state(reviewer_id)
        return {
            "reviewer_id": reviewer_id, "candidate_label": "CANDIDATE — NOT GROUND TRUTH",
            "package_hash": self.package_hash,
            "items": {kind: self.items(kind, reviewer_id) for kind in KINDS},
            "corpus": self.corpus_items(reviewer_id),
            "progress": self.progress(state), "updated_at": state["updated_at"],
        }

    def export(self, reviewer_id: str) -> dict:
        state = self.load_state(reviewer_id)
        progress = self.progress(state)
        approval = self.load_corpus_approval(reviewer_id)
        if approval is None:
            raise ValueError("review is incomplete; corpus approval is required before export")
        if not progress["complete"]:
            raise ValueError("review is incomplete; export remains blocked")
        self.assert_candidates_unchanged()
        export_root = self.root / "reviews" / reviewer_id / "export"

        citation_by_query: dict[str, list[dict]] = {}
        for claim in self.citations:
            citation_by_query.setdefault(claim["query_id"], []).append(claim)
        query_rows = read_csv(self.root / "human_review_queries.csv")
        for row in query_rows:
            d = state["decisions"]["queries"][row["query_id"]]
            row.update({"reviewer_id": reviewer_id, "reviewer_notes": d.get("notes", "")})
            if d["query_decision"] == "reject" or d.get("answer_decision") == "reject":
                row["review_decision"] = "reject"
                continue
            edited = d["query_decision"] == "edit" or d.get("answer_decision") == "edit" or bool(d.get("corrected_evidence"))
            row.update({
                "review_decision": "edit" if edited else "approve",
                "approve_query": "yes", "approve_answerability": "yes",
                "approve_answer": "yes" if d.get("answerability") == "answerable" else "",
                "approve_evidence": "yes" if d.get("answerability") == "answerable" else "",
                "approve_citations": "yes" if d.get("answerability") == "answerable" else "",
                "corrected_query": d.get("corrected_query", ""),
                "corrected_answer": d.get("corrected_answer", ""),
                "corrected_query_type": d.get("query_type", "") if d.get("query_type") != row["query_type"] else "",
                "corrected_answerability": d.get("answerability", "") if d.get("answerability") != row["answerability"] else "",
                "corrected_evidence_json": json.dumps(d.get("corrected_evidence"), ensure_ascii=False) if d.get("corrected_evidence") else "",
            })
        write_csv(export_root / "human_review_queries.csv", REVIEW_FIELDS, query_rows)

        citation_rows = read_csv(self.root / "human_review_citations.csv")
        for row in citation_rows:
            d = state["decisions"]["citations"][row["claim_id"]]
            if d["claim_decision"] == "reject":
                row.update({
                    "reviewer_id": reviewer_id, "review_decision": "reject",
                    "reviewer_notes": d.get("notes", ""),
                })
                continue
            changed = d["claim_decision"] == "edit" or d["support_label"] != row["candidate_support_label"] or d["supporting_span_ids"] != json.loads(row["supporting_span_ids"])
            row.update({
                "reviewer_id": reviewer_id, "review_decision": "edit" if changed else "approve",
                "corrected_claim": d.get("corrected_claim", ""),
                "corrected_supporting_span_ids_json": json.dumps(d["supporting_span_ids"], ensure_ascii=False) if changed else "",
                "corrected_support_label": d["support_label"] if changed else "",
                "reviewer_notes": d.get("notes", ""),
            })
        write_csv(export_root / "human_review_citations.csv", CITATION_REVIEW_FIELDS, citation_rows)

        contradiction_rows = read_csv(self.root / "human_review_contradictions.csv")
        label_aliases = {"contradiction": "direct_contradiction", "conditional difference": "conditional_difference",
                         "scope difference": "scope_difference", "temporal difference": "temporal_difference",
                         "not contradiction": "not_contradiction"}
        for row in contradiction_rows:
            d = state["decisions"]["contradictions"][row["pair_id"]]
            proposed = label_aliases.get(row["proposed_label"], row["proposed_label"])
            row.update({
                "reviewer_id": reviewer_id,
                "review_decision": "approve" if d["label"] == proposed else "edit",
                "corrected_label": "" if d["label"] == proposed else d["label"],
                "human_rationale": d["rationale"], "reviewer_notes": d.get("notes", ""),
            })
        write_csv(export_root / "human_review_contradictions.csv", CONTRADICTION_REVIEW_FIELDS, contradiction_rows)

        artifact_rows = read_csv(self.root / "human_review_artifacts.csv")
        for row in artifact_rows:
            d = state["decisions"]["artifacts"][row["document_id"]]
            row.update({
                "reviewer_id": reviewer_id, "review_decision": d["artifact_decision"],
                "corrected_annotation_json": json.dumps(d.get("corrected_annotation"), ensure_ascii=False) if d.get("corrected_annotation") else "",
                "reviewer_notes": d.get("notes", ""),
            })
        write_csv(export_root / "human_review_artifacts.csv", ARTIFACT_REVIEW_FIELDS, artifact_rows)
        atomic_json(export_root / "corpus_approval.json", approval)

        summary = {
            "schema_version": "human-review-summary-v1", "reviewer_id": reviewer_id,
            "exported_at": utc_now(), "candidate_package_hash": self.package_hash,
            "counts": progress, "contains_research_performance_metrics": False,
            "dataset_frozen": False,
        }
        atomic_json(export_root / "human_review_summary.json", summary)
        return {"export_dir": str(export_root), "summary": summary}


class ReviewHandler(BaseHTTPRequestHandler):
    workspace: ReviewWorkspace
    static_root: Path

    def log_message(self, fmt: str, *args) -> None:
        print(f"[review-ui] {self.address_string()} {fmt % args}")

    def _json(self, status: int, value: dict) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, exc: Exception, status: int = HTTPStatus.BAD_REQUEST) -> None:
        self._json(status, {"error": str(exc)})

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/bootstrap":
            try:
                reviewer = parse_qs(parsed.query).get("reviewer_id", [""])[0]
                self._json(200, self.workspace.bootstrap(reviewer))
            except Exception as exc:
                self._error(exc)
            return
        filename = "index.html" if parsed.path == "/" else parsed.path.removeprefix("/")
        path = (self.static_root / filename).resolve()
        if self.static_root.resolve() not in path.parents and path != self.static_root.resolve():
            self.send_error(404); return
        if not path.is_file():
            self.send_error(404); return
        content_type = "text/html; charset=utf-8" if path.suffix == ".html" else "text/css; charset=utf-8" if path.suffix == ".css" else "text/javascript; charset=utf-8"
        body = path.read_bytes()
        self.send_response(200); self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body))); self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(body)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/session":
                body = self._body(); reviewer = self.workspace.validate_reviewer(body.get("reviewer_id"))
                state = self.workspace.load_state(reviewer); self.workspace.save_state(state)
                self._json(200, {"reviewer_id": reviewer, "progress": self.workspace.progress(state)})
                return
            if parsed.path == "/api/export":
                self._json(200, self.workspace.export(self._body().get("reviewer_id")))
                return
            if parsed.path == "/api/corpus-approval":
                result = self.workspace.save_corpus_approval(self._body())
                state = self.workspace.load_state(result["approval"]["reviewer_id"])
                result["progress"] = self.workspace.progress(state)
                self._json(200, result)
                return
            match = re.fullmatch(r"/api/review/(queries|citations|contradictions|artifacts)/([^/]+)", parsed.path)
            if match:
                self._json(200, self.workspace.save_decision(match.group(1), match.group(2), self._body()))
                return
            self.send_error(404)
        except Exception as exc:
            self._error(exc)


def serve(dataset: Path, host: str, port: int) -> None:
    workspace = ReviewWorkspace(dataset)
    static_root = Path(__file__).with_name("review_ui")
    handler = type("BoundReviewHandler", (ReviewHandler,), {"workspace": workspace, "static_root": static_root})
    server = ThreadingHTTPServer((host, port), handler)
    print(f"Human review UI: http://{host}:{port}")
    print(f"Dataset: {workspace.root}")
    print("Candidate annotations remain unchanged; Ctrl+C stops the server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Local Phase 4B.2 human annotation interface")
    parser.add_argument("--dataset", type=Path, default=Path("reports/evaluation/datasets/corpus_v1"))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args(argv)
    serve(args.dataset, args.host, args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
