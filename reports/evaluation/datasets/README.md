# Evaluation dataset contract

Create an immutable version directory containing `dataset_manifest.json`, `documents.jsonl`, `queries.jsonl`, `citation_annotations.jsonl`, `contradictions.jsonl`, and `artifact_annotations.jsonl`.

Freeze development/calibration and held-out test splits before tuning. Prefer document-level separation. `near_duplicate_group` must never cross splits. Query strata include exact-term factual, paraphrase factual, multi-chunk, overview, cross-section, ambiguous, insufficient evidence, contradictory sources, citation-sensitive, Vietnamese, and English; record the actual distribution rather than forcing balance.

Gold evidence and relevance judgments require human validation. LLM-generated candidates may assist annotation but are not qrels until validated.

Phase 4B.1 keeps candidate aids in separate `*_candidate*`/`candidate_*` files and leaves final JSONL collections empty. Export and import the spreadsheet package with:

```powershell
$env:PYTHONPATH="BE"
python -m evaluation.dataset export-review reports/evaluation/datasets/corpus_v1
python -m evaluation.dataset import-review reports/evaluation/datasets/corpus_v1 --input reports/evaluation/datasets/corpus_v1/human_review_queries.csv
```

Import requires explicit human decisions and approvals; populated correction fields never imply approval.
