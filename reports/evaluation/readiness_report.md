# Phase 4A — research evaluation readiness

## A. Assessment

The project is software-ready for controlled evaluation after a real, human-validated corpus/query/qrels package is frozen and the three representation indexes are built. No Chapter 4 results have been generated.

## B. Correctness fixes

HITL rejection retains its visible response but now sets `cache_write_allowed=false`; Finalize cannot create or replace a reusable semantic answer entry. A regression covers query → draft → reject → finalize → identical query and proves the generator runs again. Cache records now retain additive evaluation provenance.

## C. Memory Tree provenance

Memory Tree remains a router. Direct results export their real `evidence_chunk_ids`, node metadata, query type, latency, and answer. IDs resolve against the namespaced `index.json`; unresolved IDs are explicit with null text and mark provenance incomplete. No evidence is synthesized. Semantic-cache records preserve the originating path and evidence IDs; full retrieval tracks IDs through rerank and NLI.

## D. Harness architecture

`BE/evaluation` contains pre-import evaluation controls, production adapters, pipeline execution, index building, trace serialization, versioned dataset validation, provenance resolution, metrics/statistics, cross-run aggregation, and interactive real-human HITL collection. Production retrieval, fusion, reranking, NLI, grading, rewriting, generation, and Memory Tree functions are reused.

## E. Dataset schema and split

The v1 contract covers documents, queries/qrels, citation/claim annotations, contradictions, and artifact annotations. Development/calibration and held-out test labels are mandatory. A leakage guard rejects near-duplicate groups crossing splits. Human validation is required for qrels and gold evidence.

## F. Ablation matrix

E0 BM25; E1 FAISS; E2 current hybrid fusion; E3 + cross-encoder; E4 + NLI; E5 + CRAG/rewrite; E6 full automatic with Memory Tree routing; E7 full draft plus pending real-human review. R0 recursive/independent, R1 structure/independent, and R2 structure/conditional-late use non-overwriting namespaces. Source tags have paired ON/OFF configs.

## G. Metrics and statistics

Implemented per-query Recall@k, Precision@k, MRR, nDCG@k, aggregate mean/median/std/IQR, deterministic 95% bootstrap CIs, and paired bootstrap differences without automatic significance claims. Human-label aggregators cover citation precision/recall, unsupported-claim rate, QA rubrics, summary rubrics, and mind-map rubrics.

## H. Trace

Each query records IDs/queries/rewrites/sources/path; BM25, FAISS, fusion and rerank ranks/scores; bounded bidirectional NLI probabilities and removal policy; every CRAG round and transition; Memory Tree routing; evidence/context/citations; HITL state; stage timings; LLM calls/tokens when exposed; degraded flags; and errors. Secrets are excluded.

## I. Reproducibility

FULL METHOD v1 freezes configuration, commit, Python/packages, and checkpoint names. Evaluation disables semantic and retrieval caches by default, applies seed controls and factual temperature zero before production imports, hashes datasets/indexes, and records uncontrolled remote/model/hardware nondeterminism. Representation manifests record corpus/config/hash and per-document late-chunk eligibility, application, fallback, and actual-use rate.

## J. Software validation only

The synthetic smoke dataset validates schema/qrels loading, isolated BM25/FAISS, same-query channel-preserving hybrid, rerank, detailed NLI, CRAG rewrite loop, Memory Tree resolution, metrics/statistics, serialization, and repeatability. Focused result: 15 passed. Broader retrieval/cache/graph result: 63 passed. A prior targeted set of CRAG/config/rerank/NLI/late-ingest/resume/cache tests: 61 passed. These are software checks, not research results.

The complete backend run produced 626 passed, 1 skipped, and 37 failures caused by the current root `.env` enabling protected APIs while legacy HTTP fixtures expect anonymous access. With `AUTH_PROTECT_APP_APIS=false`, the sampled failing HTTP modules produced 34 passed and one known conversation-flag fixture-order failure. This is a test-environment blocker, not a benchmark score.

## K. Remaining blockers

Freeze a real corpus version; complete human qrels/gold evidence and QA/artifact annotations; approve ethics/participant handling if HITL participants are used; build/download pinned local checkpoints; build R0–R2 and the R2 Memory Tree; decide whether CRAG calibration will be omitted or performed only on development; fix the auth-dependent full-suite fixture; and perform a pilot resource/cost check before the held-out run. Token accounting remains null for providers that do not expose usage.

## L. Exact workflow

From the repository root in PowerShell:

```powershell
$env:PYTHONPATH = "BE"
python -m evaluation.dataset init reports/evaluation/datasets/corpus_v1 --dataset-id corpus_v1 --corpus-version corpus_v1
# Human annotators now populate all five JSONL files and freeze dataset_manifest.json.
python -m evaluation.dataset validate reports/evaluation/datasets/corpus_v1

# Put the immutable source files under reports/evaluation/corpora/corpus_v1/documents,
# replace REPLACE_BEFORE_BUILD with corpus_v1 in R0/R1/R2 configs, then:
python -m evaluation.index_builder --config reports/evaluation/configs/R0_recursive.yaml --documents reports/evaluation/corpora/corpus_v1/documents
python -m evaluation.index_builder --config reports/evaluation/configs/R1_structure.yaml --documents reports/evaluation/corpora/corpus_v1/documents
python -m evaluation.index_builder --config reports/evaluation/configs/R2_late.yaml --documents reports/evaluation/corpora/corpus_v1/documents --build-memory-tree

# RQ1: identical E3 components on each immutable representation.
python -m evaluation.runner run --config reports/evaluation/configs/E3_rerank.yaml --dataset reports/evaluation/datasets/corpus_v1 --index-dir reports/evaluation/indexes/R0_recursive --representation-id R0 --experiment-id RQ1_R0
python -m evaluation.runner run --config reports/evaluation/configs/E3_rerank.yaml --dataset reports/evaluation/datasets/corpus_v1 --index-dir reports/evaluation/indexes/R1_structure --representation-id R1 --experiment-id RQ1_R1
python -m evaluation.runner run --config reports/evaluation/configs/E3_rerank.yaml --dataset reports/evaluation/datasets/corpus_v1 --index-dir reports/evaluation/indexes/R2_late --representation-id R2 --experiment-id RQ1_R2

# RQ2–RQ5 automatic drafts/runs (run E0 through E7 individually for explicit run IDs).
Get-ChildItem reports/evaluation/configs/E*.yaml | ForEach-Object { python -m evaluation.runner run --config $_.FullName --dataset reports/evaluation/datasets/corpus_v1 }

# E7 only: collect actual reviewers after its run; never automate this command.
python -m evaluation.hitl reports/evaluation/runs/<E7_RUN_ID> --reviewer-id reviewer_pseudonym

# Paired source-tag sensitivity and final machine-readable aggregation.
python -m evaluation.runner run --config reports/evaluation/configs/source_tags_on.yaml --dataset reports/evaluation/datasets/corpus_v1
python -m evaluation.runner run --config reports/evaluation/configs/source_tags_off.yaml --dataset reports/evaluation/datasets/corpus_v1
python -m evaluation.aggregate reports/evaluation
```
