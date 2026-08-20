# Human review instructions

These sheets contain annotation aids, not system outputs and not ground truth. Keep the source PDF/DOCX open while reviewing. Do not consult E0–E7 outputs.

The recommended workflow is the local interface documented in `reports/evaluation/HUMAN_REVIEW_INTERFACE.md`. It writes review state and exports under `reviews/<reviewer_id>/` without overwriting these source sheets. Manual spreadsheet review remains supported.

## 1. Review documents and proposed split

Confirm that each of the three eligible documents may be used and that the proposed split is acceptable. Do not change `annotation_status` to `human_validated` yet unless you are explicitly approving corpus membership. The proposed split is one AI/RAG deck for development and the other AI/RAG deck plus the cybersecurity essay for test.

## 2. Review QA rows

Open `human_review_queries.csv` in a spreadsheet application. For every row:

- Set `reviewer_id` to a stable pseudonym such as `reviewer_01`.
- Set `review_decision` to exactly `approve`, `edit`, or `reject`.
- For approve/edit, set `approve_query=yes` and `approve_answerability=yes` explicitly.
- For answerable rows, also set `approve_answer=yes`, `approve_evidence=yes`, and `approve_citations=yes` only after checking the source.
- Use `corrected_*` fields only with `review_decision=edit`.
- For corrected evidence, provide a JSON list in `corrected_evidence_json`; each object must include `locator`, `start_offset`, `end_offset`, and exact `evidence_text` matching `source_units.jsonl`.
- For ambiguous rows, confirm that the ambiguity is natural and that the listed interpretations/resolution are adequate.
- For insufficient-evidence rows, search the selected source scope and confirm that the requested detail is genuinely absent.

## 3. Review atomic claims

In `human_review_citations.csv`, independently approve or edit every claim belonging to each approved answerable query. Set `reviewer_id` and `review_decision`. If editing, provide `corrected_claim`, `corrected_supporting_span_ids_json`, and/or `corrected_support_label`. Allowed labels are `full`, `partial`, `none`, and `contradicted`.

## 4. Review contradiction/difference candidates

In `human_review_contradictions.csv`, label only after reading both passages. Allowed final labels are `contradiction`, `not contradiction`, `conditional difference`, `temporal difference`, and `scope difference`. A non-empty `human_rationale` is mandatory for approve/edit.

## 5. Review summary and mind-map aids

In `human_review_artifacts.csv`, check concepts, sections, relations, exclusions, and invalid/redundant relations against each source. Use `approve` only if the full JSON aid is acceptable. For edits, put the corrected object in `corrected_annotation_json`.

## 6. Import

From the repository root:

```powershell
$env:PYTHONPATH="BE"
python -m evaluation.dataset import-review reports/evaluation/datasets/corpus_v1 --input reports/evaluation/datasets/corpus_v1/human_review_queries.csv
python -m evaluation.dataset validate reports/evaluation/datasets/corpus_v1
```

The importer rejects unknown/duplicate IDs, missing explicit approvals, invalid values, changed source hashes, unresolved locators, and evidence text/offset mismatches. It does not freeze the corpus or dataset.

Current reviewer metadata: `annotator_count = 0`; inter-annotator agreement is `not applicable / not measured`. If the user completes the first review, record one human validator, not independent multi-annotator validation.
