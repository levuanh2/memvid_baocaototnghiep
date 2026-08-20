# Candidate generation and review workflow

1. `evaluation.candidate_package` extracts immutable page/paragraph/table review units from the three real sources.
2. The LLM-assisted proposals in `query_candidates.jsonl` are grounded to exact source substrings and marked `annotation_status=candidate`.
3. Production E0–E7 answers are never shown to annotators and were not used to construct the package.
4. A human reviews `human_review_queries.csv`, then the separate claim, contradiction, and artifact sheets.
5. Approval is explicit: reviewer pseudonym + `review_decision` + the relevant `approve_*` fields. Non-empty corrections never imply approval.
6. Edited evidence must be supplied as structured JSON with a real locator and exact offsets/text; the importer resolves it against `source_units.jsonl` and the unchanged source hash.
7. Rejected rows are recorded in review history but never enter final query/annotation JSONL files.
8. Imported rows become `human_validated`; a second reviewer and adjudication may follow later.
9. Corpus freeze, R0/R1/R2 construction, representation-specific qrel mapping, and dataset freeze remain later gated steps.

See `HUMAN_REVIEW_INSTRUCTIONS.md` for exact field values and commands.
