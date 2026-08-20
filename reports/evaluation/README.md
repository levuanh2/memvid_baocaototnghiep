# MemVid research evaluation readiness

This directory defines FULL METHOD v1, versioned data contracts, executable ablations, namespaced representation indexes, run outputs, and human annotation protocols. The synthetic `smoke_v1` dataset is software validation only and must never appear as Chapter 4 evidence.

Run outputs are created as `runs/<run_id>/{manifest.json,per_query.jsonl,retrieval.jsonl,qa.jsonl,timing.jsonl,aggregate_metrics.json}`. Each query trace retains separate BM25, FAISS, fusion, rerank, NLI, corrective retrieval, Memory Tree, provenance, timing, model-call, token-when-available, fallback, and error fields.

CRAG calibration, if performed, uses only the development split. Keep the original 0.25/0.10 heuristic as FULL METHOD v1, save calibrated thresholds under a new config name, freeze it, and apply it once to the held-out test set.

Source-tag sensitivity is a paired run of `source_tags_on.yaml` and `source_tags_off.yaml` on identical query/candidate inputs. Compare raw reranker scores/ranks and bidirectional NLI probabilities.
