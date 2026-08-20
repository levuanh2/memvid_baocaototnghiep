# corpus_v1 candidate-package quality report

## Status

`corpus_v1-candidate.2` is a mutable human-validation package, not a frozen research dataset. The corpus has not been frozen, R0/R1/R2 have not been built, and E0–E7 remain blocked.

## Corpus composition

- 12 physical inventory records; 3 eligible real documents and 9 excluded files.
- 2 PDFs and 1 DOCX; all primarily Vietnamese with English technical terminology.
- Approximately 12,277 extracted tokens in total, strongly skewed across 682, 1,190, and 10,405 tokens.
- Domain A: two AI/RAG lecture decks. Domain B: one cybersecurity essay/lab.
- PDF page and DOCX paragraph/table locators are resolvable. Some slide facts live mainly in graphics, so affected candidates are marked hard and explicitly require visual review.
- No additional usable real document was found. The preferred 6–10 document target is therefore unmet.

## Candidate annotation package

| Item | Candidate | Human-validated |
|---|---:|---:|
| QA queries | 60 | 0 |
| Answerable / ambiguous / insufficient | 53 / 4 / 3 | 0 / 0 / 0 |
| Canonical source spans | 92 | 0 |
| Atomic citation claims | 83 | 0 |
| Natural contradiction/difference pairs | 3 | 0 |
| Summary/mind-map document sheets | 3 | 0 |

Candidate queries by source: RAGAS/Guardrails 28, Vector/Feature Store 18, Social Engineering 14. Proposed query split: development 28, test 32. This is below the requested 80–120 planning target because only three real documents are available; adding weaker or repetitive candidates would not improve scientific validity.

Candidate strata: exact-term factual 13; paraphrase factual 8; multi-chunk 7; compare 5; how/why 5; ambiguous 4; cross-section 4; overview 3; main-points 3; insufficient evidence 3; citation-sensitive 3; contradictory evidence 2.

## Duplicate and leakage checks

- Exact fixture duplicates remain excluded and grouped.
- No selected exact duplicate exists.
- Automated near-duplicate screen passes at the predeclared 0.80 threshold; human semantic/version confirmation remains pending.
- Proposed document split is development: `cv1_ragas_guardrails`; test: `cv1_vector_feature_store`, `cv1_social_engineering`.
- The AI/RAG domain occurs in both splits; cybersecurity occurs only in test. No document or duplicate group crosses splits.
- Final leakage validation is not yet meaningful because `queries.jsonl` remains empty until review import.

## Natural contradiction availability

Three candidates are provided for human classification, not ground truth: similarity-metric behavior under unit normalization (likely conditional difference), two NLI blocking thresholds in the RAGAS deck (possible direct contradiction or policy/scope difference), and deliverable versus CI-gate thresholds (likely scope difference). No synthetic contradiction was inserted into the natural corpus.

## Unresolved issues

1. Human approval of document eligibility, permissions, and proposed split.
2. Human review of all query, answerability, answer, evidence, and atomic claim rows.
3. Human classification/rationale for contradiction candidates.
4. Human review of summary and mind-map annotation aids.
5. A second reviewer if agreement measurement is desired; current annotator count is zero.
6. Only after corpus approval: corpus freeze, R0/R1/R2 builds, span mapping, final dataset validation and freeze.
