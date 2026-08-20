# Phase 4B.1 status — human-validation package ready

## Outcome

The workspace contains only three genuine user-provided research/learning documents. No additional eligible source was found, so the corpus remains scientifically small and unfrozen. A source-grounded, candidate-only package is ready for human review: 60 query proposals, 92 canonical source-span proposals, 83 atomic claim proposals, 3 natural contradiction/difference candidates, and 3 summary/mind-map document sheets.

## Corpus and split

- Development proposal: `cv1_ragas_guardrails`.
- Test proposal: `cv1_vector_feature_store`, `cv1_social_engineering`.
- Ratio: 1/3 development and 2/3 test at document level.
- AI/RAG occurs in both splits; cybersecurity occurs only in test.
- No exact or screened near-duplicate crosses the split.
- Human approval is pending; the split is not frozen.

## Candidate distributions

- By document: RAGAS/Guardrails 28; Vector/Feature Store 18; Social Engineering 14.
- By split: development 28; test 32.
- By answerability proposal: answerable 53; ambiguous 4; insufficient evidence 3.
- By stratum: exact-term factual 13; paraphrase factual 8; multi-chunk 7; compare 5; how/why 5; ambiguous 4; cross-section 4; overview 3; main-points 3; insufficient evidence 3; citation-sensitive 3; contradictory evidence 2.

All records are `candidate`. `queries.jsonl`, final canonical spans, final citation annotations, final contradiction labels, and final artifact annotations remain empty.

## Review deliverables

- `human_review_queries.csv`
- `human_review_citations.csv`
- `human_review_contradictions.csv`
- `human_review_artifacts.csv`
- `query_candidates.jsonl`
- `candidate_canonical_evidence_spans.jsonl`
- `candidate_citation_annotations.jsonl`
- `candidate_contradictions.jsonl`
- `candidate_artifact_annotations.jsonl`
- `source_units.jsonl`
- `HUMAN_REVIEW_INSTRUCTIONS.md`

The importer requires explicit approval fields and validates source existence, source hash, locator, exact evidence text, and offsets. Non-empty answers or corrections never imply approval.

## Natural contradiction status

Three natural candidates were found; none is labeled as ground truth. They cover a likely conditional difference for unit-normalized similarity metrics, a possible NLI threshold inconsistency, and a likely scope difference between deliverable and CI-gate targets. No synthetic contradiction was added.

## Scientific blockers

- Zero human validators have completed review.
- Corpus membership and split are unapproved.
- The preferred 6–10 document target is unmet.
- No human-validated queries, qrels, answers, evidence, claims, contradiction labels, or artifact annotations exist.
- Corpus freeze, R0/R1/R2, representation mapping, dataset freeze, and E0–E7 remain blocked.

Production authentication remains unchanged; the prior 663-passed/1-skipped backend result is preserved. Phase 4B.1 intentionally stops here.
