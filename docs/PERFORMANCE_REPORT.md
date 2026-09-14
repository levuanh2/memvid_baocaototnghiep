# Performance Report — Release Hardening Sprint V1, Phase 6

All numbers below are **real measurements from this sprint's local run** (isolated `DATA_DIR`,
real LLM calls via local Ollama `qwen2.5:7b-instruct` — cloud providers unavailable, see
confounds in `docs/MINDMAP_QUALITY_AUDIT.md`) unless explicitly marked as cited from an earlier
document. No number below is estimated or interpolated without saying so.

## Stage-by-stage (this sprint's real run, `qa_large_doc.txt`, 8 chapters, TXT)

| Stage | Time | Source |
|---|---|---|
| Upload → queryable index (`can_query: true`) | **≤ ~18s** (bounded by 6s poll interval, 3 polls) | Observed via `/sources/<id>/status` polling. Chunking vs. embedding not separately logged — see gap below. |
| MindMap: skeleton build (0-LLM, heading-tree) | **94.9 ms** | `quality_report` timings, `skeleton_stage` |
| MindMap: enrich (LLM, 51 branch calls, `MINDMAP_ENRICH_PARALLEL=2`) | **1,635,321.8 ms (27.3 min)** — dominant cost | `quality_report` timings, `enrich_stage` |
| MindMap: `quality_report` computation itself | **2.5 ms** | Diagnostics only, negligible |
| MindMap: total job (skeleton→enrich→relations→persist) | **1,659.9 s (27.7 min)** | `mindmap_generation_reports.jsonl` |
| Summary: total job (9 sections, `max_workers=2`) | **207.5 s (3.5 min)** | `generator.elapsed_sec` |
| Export (PNG) | **Not re-measured this sprint** — real production export path confirmed working earlier this session (real `snapdom` call, `mind.map` target, 2x scale, produced a genuine 6486×2294px PNG); see `docs/FINAL_VISUAL_QA.md`. | Prior evidence, not re-run |
| UI ready (FE load) | **Not measured this sprint** — FE is frozen per this sprint's own scope; no FE code was run or profiled | Out of scope |

## Why MindMap generation is ~27 minutes here (and why that's not a production number)

`enrich_stage` is 98.5% of total MindMap generation time. Per-item enrichment averaged
**32,060.9 ms** — call latency, not queueing — on a single CPU-bound local Ollama instance.
Production is presumed to use faster/cloud inference (not independently re-measured this
sprint — see Recommendations). This run also hit 2 dropped Ollama connections under concurrent
load (2 workers, ~32s/call) — a local-environment stability issue, not a pipeline cost.

**A real, environment-independent performance fact from this run**: the deterministic stages
(skeleton build, quality-report computation) are genuinely cheap — 94.9ms and 2.5ms respectively
for a 94-node tree. All meaningful generation latency is LLM call time, confirming the pipeline's
own architecture (0-LLM skeleton, N+1 LLM calls for enrich+relations) is not adding overhead of
its own beyond the LLM calls it has to make.

## Comparison to a previously-measured number (cited, not re-verified this sprint)

`docs/MINDMAP_V2_AUDIT.md §11` (already in the working tree, dated 2026-07-04) cites: a document
with headings, 4 chunks → 3 enrich branches: Skeleton 0.2s, Enrich 86.2s, Relations 14.0s, total
100.4s, also on local Ollama. That is a **much smaller document** (3 branches vs. this sprint's
51) — the two numbers are not directly comparable as a regression signal, but both show the same
qualitative shape: skeleton is near-free, enrich dominates, and per-branch enrich cost is in the
same order of magnitude (~28s/branch there vs. ~32s/item here).

## Gaps — instrumentation this phase's ask needs but doesn't exist yet

- **No per-stage ingest timing.** Upload, extraction, cleaning, chunking, and embedding are not
  individually timed/logged anywhere found in this sprint's reading of `app/graphs/ingest_graph.py`
  — only the end-to-end "processing → can_query" transition is externally observable via polling.
- **No per-stage Summary timing** (see `docs/SUMMARIES_QUALITY.md`) — only whole-job
  `elapsed_sec`.
- **No production performance data was pulled this sprint** — Render/production logs were not
  accessible in this session (no log-access tool connected); every number above is from a local
  run under real, but non-representative, hardware/network conditions.

## Recommendations

1. Add per-stage timing to the ingest graph (extraction/clean/chunk/embed), mirroring the
   pattern `quality_report.py`'s `timings_ms` already establishes for MindMap — cheap to add,
   high diagnostic value, consistent with this sprint's "instrument, don't rewrite" mandate.
2. Get real production timing (Render logs or an equivalent APM) before treating this sprint's
   ~28-minute local MindMap generation number as anything but a local-hardware artifact.
3. Re-measure PNG export and FE-ready timing in a dedicated pass — both are FE-adjacent and were
   correctly left untouched by this sprint's BE-only scope.
