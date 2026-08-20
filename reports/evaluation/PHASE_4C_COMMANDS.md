# Phase 4C — gated final experiment commands

Do not run this workflow until human annotation is complete. Every command is from the repository root in PowerShell.

## 1. Import the completed Phase 4B review and freeze source membership

`import-review` verifies the immutable candidate-package hash, imports only explicit approve/edit decisions, materializes `corpus_approval.json` into `documents.jsonl`, and bridges reviewed source-unit offsets to canonical document coordinates. It fails atomically if any source, document ID, evidence boundary, Unicode-normalized text, or hash does not match. Do not edit final JSONL or document splits manually.

```powershell
$env:PYTHONPATH = "BE"
python -m evaluation.dataset import-review reports/evaluation/datasets/corpus_v1 --input reports/evaluation/datasets/corpus_v1/reviews/R1/export/human_review_queries.csv
python -m evaluation.dataset validate reports/evaluation/datasets/corpus_v1
python -m evaluation.dataset freeze-corpus reports/evaluation/datasets/corpus_v1
```

Run `import-review` exactly once for a review package. A successful import creates non-empty final annotation JSONL, `canonical_documents.jsonl`, `review_import_manifest.json`, and `coordinate_bridge_manifest.json`. `freeze-corpus` must then succeed before index construction; it verifies original file hashes and document-level splits.

## 2. Build immutable representation indexes

Preflight the exact frozen embedding checkpoint under the recorded Python/PyTorch/Transformers environment. Do not substitute another embedding model when the checkpoint is missing or incompatible. A fully cached environment may set `HF_HUB_OFFLINE=1`; otherwise obtain the exact model through the approved model-distribution path before continuing. The index command must fail rather than fall back to a different embedding.

```powershell
python -m evaluation.index_builder --config reports/evaluation/configs/R0_recursive.yaml --dataset reports/evaluation/datasets/corpus_v1
python -m evaluation.index_builder --config reports/evaluation/configs/R1_structure.yaml --dataset reports/evaluation/datasets/corpus_v1
python -m evaluation.index_builder --config reports/evaluation/configs/R2_late.yaml --dataset reports/evaluation/datasets/corpus_v1 --build-memory-tree
```

These commands refuse non-empty namespaces and record document/chunk counts, chunk-size statistics, late-chunk eligibility/application/fallback, alignment failures, and hashes.

## 3. Map validated source spans into R0/R1/R2 qrels

After humans have validated `queries.jsonl`, `canonical_evidence_spans.jsonl`, gold answers/status, claim support, contradiction and artifact annotations:

```powershell
python -m evaluation.evidence --dataset reports/evaluation/datasets/corpus_v1 --index reports/evaluation/indexes/R0_recursive --representation R0
python -m evaluation.evidence --dataset reports/evaluation/datasets/corpus_v1 --index reports/evaluation/indexes/R1_structure --representation R1
python -m evaluation.evidence --dataset reports/evaluation/datasets/corpus_v1 --index reports/evaluation/indexes/R2_late --representation R2
```

Resolve any reported alignment failures through human adjudication. Then freeze the complete dataset:

```powershell
python -m evaluation.dataset validate reports/evaluation/datasets/corpus_v1
python -m evaluation.dataset freeze reports/evaluation/datasets/corpus_v1
```

Confirm `dataset_manifest.json` says `status: frozen` and contains non-null `dataset_hash`, `split_hash`, and `annotation_hash`.

`freeze` also verifies `canonical_documents.jsonl`, canonical span boundaries, qrel provenance, `qrel_manifest.json`, and R0/R1/R2 coverage. On success it updates `study_manifest.json` from the frozen artifacts; no manual hash transcription is required.

## 4. Phase 4C execution

Use explicit run IDs and never mix cached/non-cached experiments.

```powershell
# RQ1 — identical E3 method components, representation is the only changed factor.
python -m evaluation.runner run --config reports/evaluation/configs/E3_rerank.yaml --dataset reports/evaluation/datasets/corpus_v1 --index-dir reports/evaluation/indexes/R0_recursive --representation-id R0 --experiment-id RQ1_R0 --run-id RQ1_R0_FINAL
python -m evaluation.runner run --config reports/evaluation/configs/E3_rerank.yaml --dataset reports/evaluation/datasets/corpus_v1 --index-dir reports/evaluation/indexes/R1_structure --representation-id R1 --experiment-id RQ1_R1 --run-id RQ1_R1_FINAL
python -m evaluation.runner run --config reports/evaluation/configs/E3_rerank.yaml --dataset reports/evaluation/datasets/corpus_v1 --index-dir reports/evaluation/indexes/R2_late --representation-id R2 --experiment-id RQ1_R2 --run-id RQ1_R2_FINAL

# RQ2/RQ3/full automatic configurations. Run separately for auditable failures.
python -m evaluation.runner run --config reports/evaluation/configs/E0_bm25.yaml --dataset reports/evaluation/datasets/corpus_v1 --run-id E0_FINAL
python -m evaluation.runner run --config reports/evaluation/configs/E1_faiss.yaml --dataset reports/evaluation/datasets/corpus_v1 --run-id E1_FINAL
python -m evaluation.runner run --config reports/evaluation/configs/E2_hybrid.yaml --dataset reports/evaluation/datasets/corpus_v1 --run-id E2_FINAL
python -m evaluation.runner run --config reports/evaluation/configs/E3_rerank.yaml --dataset reports/evaluation/datasets/corpus_v1 --run-id E3_FINAL
python -m evaluation.runner run --config reports/evaluation/configs/E4_nli.yaml --dataset reports/evaluation/datasets/corpus_v1 --run-id E4_FINAL
python -m evaluation.runner run --config reports/evaluation/configs/E5_crag.yaml --dataset reports/evaluation/datasets/corpus_v1 --run-id E5_FINAL
python -m evaluation.runner run --config reports/evaluation/configs/E6_full_automatic.yaml --dataset reports/evaluation/datasets/corpus_v1 --run-id E6_FINAL

# E7 produces drafts awaiting real humans. It never fabricates decisions.
python -m evaluation.runner run --config reports/evaluation/configs/E7_full_hitl.yaml --dataset reports/evaluation/datasets/corpus_v1 --run-id E7_FINAL
python -m evaluation.hitl reports/evaluation/runs/E7_FINAL --reviewer-id reviewer_pseudonym

# Source-tag sensitivity.
python -m evaluation.runner run --config reports/evaluation/configs/source_tags_on.yaml --dataset reports/evaluation/datasets/corpus_v1 --run-id TAGS_ON_FINAL
python -m evaluation.runner run --config reports/evaluation/configs/source_tags_off.yaml --dataset reports/evaluation/datasets/corpus_v1 --run-id TAGS_OFF_FINAL

python -m evaluation.aggregate reports/evaluation
```

If development-only CRAG calibration is approved, create a newly named frozen config and run it separately. Never edit E5/FULL METHOD v1 or select thresholds from test results.
