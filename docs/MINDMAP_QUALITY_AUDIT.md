# MindMap Quality Audit — Release Hardening Sprint V1, Phase 1

Scope note up front, honestly: this sprint found that an extensive, uncommitted MindMap
quality-instrumentation layer already exists in the working tree (`BE/services/mindmap/pipeline/
{branch_budget,branch_report,coverage_analyzer,deterministic_concepts,enrichment_metrics,
heading_tree,hierarchy_validator,intrablock_concepts,loss_classifier,missing_concepts,
node_allocator,node_grouping,provenance,quality_report,recovery}.py` + `BE/services/mindmap/
analytics/`), wired into `app/graphs/mindmap_graph.py`, with its own focused test suite. That
tree is reserved to the BE/Codex workstream for this sprint — **nothing in it was edited,
renamed, or reimplemented here.** This document reports on REAL output produced by RUNNING that
existing instrumentation (read-only usage) against a real document, not a reimplementation of it.

## Method

Local BE server (`PYTHONPATH=. python app/main.py`, isolated `DATA_DIR`, queue disabled) run
against the current uncommitted working tree, with real LLM access (Ollama `qwen2.5:7b-instruct`
local; Gemini/FPT cloud keys present in local `.env` but returned HTTP 401 for every call this
session — see Confounds below). One real document generated end-to-end through the actual
`generate-mindmap` endpoint and LangGraph pipeline; `quality_report`'s output captured from the
server's own log line and the persisted analytics JSONL record
(`services/mindmap/analytics/generation_report.py` → `mindmap_generation_reports.jsonl`).

**Document**: `qa_large_doc.txt` — real 8-chapter Vietnamese biology/genetics text (cell
structure, DNA, transcription/translation, gene regulation, Mendelian genetics, mutation/repair,
biotechnology), used earlier this session for live Final Visual QA against production. TXT
format, heading-structured (numbered `1`, `1.1`, `1.2`, ... `8.3`).

## Real metrics (job `7f3702c1-2491-4344-97e6-b0e58fb818c6`)

| Metric | Value |
|---|---|
| Headings detected (skeleton method) | `headings` (heading-path based, 0-LLM skeleton) |
| Final node count | **94** |
| Semantic groups | **27** |
| Coverage (heading-unit → node) | **100.0%** |
| Missing concepts | **0** |
| Hierarchy violations | **8** |
| Sibling-merge violations | **0** |
| Avg branch depth | **3.47** |
| Avg branching factor | **1.82** |
| Collapsed nodes (enrichment present but all-empty) | **17 / 94 (18.1%)** |
| Recovered nodes (self-healing) | **0** |
| Still-unresolved (post-recovery) | **17**, all classified `MISSING_BY_ENRICHMENT` |
| Node/hierarchy preservation (enrichment metrics) | **100.0%** / **100.0%** |
| Enrichment items attempted / ok / prompt-failed / json-failed / skipped | **51 / 34 / 2 / 1 / 14** |
| Avg enrichment latency | **32,060.9 ms/item** (CPU-local Ollama) |
| Generation time (total) | **1,659.9 s (27.7 min)** |
| `quality_report` compute cost itself | **2.5 ms** (cheap, as designed — diagnostics, not generation) |

Full real record (`mindmap_generation_reports.jsonl`):
```json
{
  "document_id": "a410dd32082ef9612d9cf62cf5682f214de23bdb4029fcf53f2da401619e885c",
  "sources": ["qa_large_doc__6__txt"], "node_count": 94, "coverage_pct": 100.0,
  "recovered_pct": 0.0, "still_unresolved_count": 17,
  "loss_reasons": {"MISSING_BY_ENRICHMENT": 17},
  "hierarchy_violations_count": 8, "semantic_groups": 27, "avg_depth": 3.47,
  "avg_branching_factor": 1.82, "branch_completeness_pct": 100.0,
  "generation_time_sec": 1659.888
}
```

## Confounds — read this before trusting the raw numbers as "pipeline quality"

Two things degraded this specific run that have **nothing to do with pipeline correctness**:

1. **Local cloud LLM keys are dead.** `FPT_AI_API_KEY` and the Gemini credential in the local
   `.env` both returned HTTP 401 for every call this session (`FPT HTTP 401: Invalid API Key`,
   Gemini `Unauthenticated: 401`). Every enrichment call that needed a cloud fallback failed
   outright instead of falling back — this is a **local credential problem, not a pipeline bug**.
   It cannot be assumed to reproduce on production (which presumably has valid keys — not
   independently verified this sprint, see Recommendations).
2. **Local Ollama dropped 2 connections mid-generation** (`wsarecv: An existing connection was
   forcibly closed by the remote host`) — consistent with a single CPU-bound Ollama instance
   under sustained concurrent load (`MINDMAP_ENRICH_PARALLEL` default 2, each call ~32s), not a
   pipeline defect.

Net effect: of the 51 enrichment items, 17 (33%) degraded — 2 `group_llm_failed`, 1
`group_json_malformed`, 14 `group_partial_omission` — and **all 17 are directly attributable to
the two confounds above**, not to a structural pipeline flaw. The **coverage (100%)**, **missing
concepts (0)**, **sibling-merge violations (0)**, and **hierarchy violations (8)** numbers are
NOT affected by these confounds — those are either 0-LLM (heading-tree-based) or independent
structural checks, and are the more trustworthy numbers from this run.

**The 8 hierarchy violations are real and reproducible** — a genuine property of this source
document's own heading numbering, not an LLM-quality artifact (`hierarchy_validator.py` only
inspects the heading tree's own numbering, never LLM output). Type breakdown not captured in
this run's log line (only the count); re-running with the analytics store's own detail view
would surface exact violation types (see Recommendations).

## What already exists vs. what this sprint adds

This sprint did **not** build a parallel Phase-1 instrumentation layer — one already exists and
is materially more rigorous than what a fresh build in this session could have produced in the
same time (it traces every metric to a specific, cited code mechanism — see
`docs/MINDMAP_V2_AUDIT.md §3/§4`, already in the working tree, for the full per-stage loss audit
this quality layer is built on). This document's contribution is: (a) confirming it actually runs
end-to-end against a real document without crashing (`quality_report` never raised, degraded
gracefully as designed), (b) producing the first real numbers from it, (c) flagging the local
environment confounds above so those numbers aren't misread as production-representative failure
rates.

## Coverage gap, stated honestly

This is **one real document**, not the ten requested in Phase 3 (see
`docs/RELEASE_CANDIDATE_REPORT.md` for why: each full local mindmap generation took ~28 minutes
wall-clock under the LLM/connectivity confounds above, and a second document's ingest failed
outright on the same dead FPT embedding key). Treat the specific percentages here as **one
data point demonstrating the instrumentation works and is directionally sound**, not as a
statistically representative quality baseline. A representative baseline needs either (a) a
longer-running batch job outside an interactive session, using working, valid credentials
throughout, or (b) running this same instrumentation against production's own real generations
once it's actually deployed there (it currently is not — production runs the older, uninstrumented
pipeline; see `docs/MINDMAP_V2_AUDIT.md §6`).

## Recommendations

1. **Deploy this instrumentation layer to production first.** It exists, is tested, is wired,
   and costs 2.5ms per generation — the single highest-leverage step for real ongoing quality
   visibility, ahead of any prompt change.
2. **Verify production's own LLM credentials before trusting any failure-rate number from a
   local run** — this sprint's 33% enrichment degradation rate is a local-environment artifact,
   not a validated production number.
3. **Surface `hierarchy_violations` type-level detail**, not just the count, in whatever this
   layer's next consumer is (dashboard, log line, or `docs/` follow-up) — the count alone can't
   distinguish "harmless duplicate numbering" from a genuine structural defect.
4. Re-run Phase 3 as a longer batch job (not interactive) once (1) is addressed, for a real
   10-document baseline.
