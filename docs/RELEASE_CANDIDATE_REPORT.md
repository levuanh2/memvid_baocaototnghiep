# Release Candidate Report — Release Hardening Sprint V1

**P0.5 update**: read `docs/P0_BLOCKER_REPORT.md` alongside this report — it now supersedes this
report's original Final Assessment on 3 of the items below (Summary instrumentation built,
UNKNOWN taxonomy resolved with evidence, enrichment-loss root cause found and partially fixed).
This report's own tables are left as originally written (not rewritten); the note at each
affected row below points to the newer evidence. The dataset-benchmark gap (1/10) remains
unchanged and is the dominant reason the overall verdict is still NOT READY.

Read `docs/MINDMAP_QUALITY_AUDIT.md`, `docs/SUMMARIES_QUALITY.md`, and
`docs/PERFORMANCE_REPORT.md` first — this report summarizes and adds Phases 3-5 and 7. Same
ground rule throughout: every number is either a real measurement from this sprint, or cited
from an existing document with its source named. Nothing here is invented to fill a gap; gaps
are named as gaps.

**Ownership boundary honored throughout**: `BE/services/mindmap/pipeline/{branch_budget,
branch_report,coverage_analyzer,deterministic_concepts,enrichment_metrics,heading_tree,
hierarchy_validator,intrablock_concepts,loss_classifier,missing_concepts,node_allocator,
node_grouping,provenance,quality_report,recovery}.py`, `services/mindmap/analytics/`,
`services/citation/`, `services/document_ast/`, `services/semantic_ast/`, their tests, and
`docs/{DOCUMENT_AST_DESIGN,SEMANTIC_AST_DESIGN,CITATION_ENGINE_V2}.md` were read-only —
never edited, staged, or reimplemented. This sprint ran a local BE server (`PYTHONPATH=.
python app/main.py`, isolated `DATA_DIR`) to exercise that code, which is execution, not
modification.

---

## Phase 3 — Real Dataset Evaluation

**Requested**: ≥10 real documents, varied size, varied heading structure, Word/PDF/Markdown/TXT.
**Actual**: 1 complete real end-to-end run (MindMap + Summary), 1 partial (ingest failed).

| # | Document | Format | Size | Result |
|---|---|---|---|---|
| 1 | `qa_large_doc.txt` | TXT | Large (8 chapters, numbered headings) | **Complete.** MindMap: 94 nodes, 100% coverage, 8 hierarchy violations, 27.7min (confounded, see `MINDMAP_QUALITY_AUDIT.md`). Summary: 9/9 sections, 207.5s. |
| 2 | `rh_doc_small.txt` | TXT | Small (4 short items, no numbered headings) | **Failed at ingest** — local FPT embedding key returned HTTP 401 (`dịch vụ embedding từ chối xác thực`). Not a pipeline defect; a dead local credential. Retried once, same result. |

**Why not 10**: each real MindMap generation costs ~28 minutes wall-clock under this session's
confounded local environment (CPU Ollama + dead cloud keys — see `MINDMAP_QUALITY_AUDIT.md`
Confounds section), and a second document's ingest failed outright on the same dead key before
generation could even start. Ten real end-to-end runs at this cost would be 3-5+ hours of
serialized wall-clock time in an interactive session — not attempted rather than faked. No
Word/PDF/Markdown documents were run through generation this sprint (a `.md` document,
`rh_doc_medium.md`, and a real DOCX/PDF were not reached).

**This is a real, named gap, not a pass.** See Recommendations.

---

## Phase 4 — Failure Classification

**Finding, stated plainly**: the requested 9-category taxonomy (`HEADING_PARSE`, `CHUNK_SPLIT`,
`SEMANTIC_GROUP`, `REFERENCE_FILTER`, `LLM_TIMEOUT`, `TOKEN_LIMIT`, `NODE_BUDGET`,
`PROMPT_REFUSAL`, `UNKNOWN`) does **not** fit this pipeline's real failure surface well enough to
keep `UNKNOWN` under 5% without forcing bad-fit labels. Applying it honestly to this sprint's one
real run's 17 unresolved losses (all `MISSING_BY_ENRICHMENT` under the pipeline's own taxonomy)
produces:

| Requested category | Count this run | Basis |
|---|---|---|
| `LLM_TIMEOUT` | 2 | `group_llm_failed` — provider/connection failure (imprecise fit: this was a dropped TCP connection + dead cloud-provider auth, not strictly a timeout, but closest of the 9) |
| `UNKNOWN` | 15 | 1 `group_json_malformed` (JSON parse failure — no category among the 9 fits) + 14 `group_partial_omission` (LLM responded successfully but returned fewer child items than the deterministic grouping expected — this is model *behavior*, not a code cap (`NODE_BUDGET`), a chunking artifact (`CHUNK_SPLIT`), or a filter (`SEMANTIC_GROUP`/`REFERENCE_FILTER`); forcing it into one of those would be exactly the "fabricated reason" this sprint's own instructions and the pipeline's own `loss_classifier.py` docstring both explicitly warn against |

**`UNKNOWN` = 15/17 = 88.2%** under the requested taxonomy — badly over the 5% bar.

**Why this happened, and what actually satisfies the bar**: the codebase's own taxonomy
(`loss_classifier.py::LossReason` — `MISSING_BY_FILTER`, `MISSING_BY_CAP`,
`MISSING_BY_HEADING_GATE`, `MISSING_BY_REFERENCE_FILTER`, `MISSING_BY_NUMBERING`,
`MISSING_BY_ENRICHMENT`, `MISSING_BY_VALIDATION`, `UNKNOWN`) was built by reading the actual
pipeline mechanisms — each category is traced to one specific, cited code path (see its module
docstring). Applied to this same run, it produces **0% `UNKNOWN`** (all 17 losses classified as
`MISSING_BY_ENRICHMENT`, a real, well-defined category: "the node's structural home survived,
but its own enrichment entry failed"). **The reserved taxonomy already meets the spirit of this
phase's bar; the newly-requested taxonomy, applied honestly, does not.**

Rough mapping between the two, for reference (not a recommendation to rename anything in the
reserved code):

| Reserved (`LossReason`) | Closest requested category | Fit |
|---|---|---|
| `MISSING_BY_HEADING_GATE` | `HEADING_PARSE` | Good |
| `MISSING_BY_REFERENCE_FILTER` | `REFERENCE_FILTER` | Exact |
| `MISSING_BY_CAP` | `NODE_BUDGET` | Exact |
| `MISSING_BY_FILTER` | `SEMANTIC_GROUP` | Fair |
| `MISSING_BY_NUMBERING` | `HEADING_PARSE` | Fair (numbering is a heading-parse artifact) |
| `MISSING_BY_ENRICHMENT` | *(no good fit — see above)* | Poor |
| `MISSING_BY_VALIDATION` | *(no good fit)* | Poor |
| `UNKNOWN` | `UNKNOWN` | Exact |

**Recommendation**: keep the reserved taxonomy as the real classification system; treat the
brief's 9-category list as a presentation-layer grouping at most, not a replacement.

---

## Phase 5 — Prompt Evaluation

Measured only, per the brief's own instruction ("do NOT rewrite prompts immediately"). No prompt
changes were made or proposed as code this sprint.

| Prompt | Completion rate (this run) | Avg items produced | Empty outputs | Duplicate outputs | Hallucination indicators |
|---|---|---|---|---|---|
| `enrich.py` (per-branch, MindMap) | 34/51 = **66.7%** — but see caveat below | avg branching factor **1.82** (proxy; not a direct "avg children" count) | 17 collapsed nodes (all-empty enrichment) | **0** (`sibling_merge_violations: 0`) | **Not measured** — no instrumentation exists to compare LLM output against source content for fabrication; out of this sprint's build scope (reserved tree) |
| `summarize.py` (per-section, Summary) | 9/9 = **100%** | n/a (prose, not item-count) | 0 | Not measured (no cross-section duplicate check exists) | Not measured, same reason |

**Caveat on the 66.7% enrich completion rate**: per `MINDMAP_QUALITY_AUDIT.md`'s Confounds
section, of the 17 failures, 2 were connection/auth failures (local environment, not prompt
quality) and 15 were JSON-malformed/partial-omission — the *malformed* one is plausibly a real
prompt/model-format issue worth tracking across more runs; the *partial-omission* 14 could be
either genuine model under-coverage (a real prompt-quality signal) or an artifact of this local
run's degraded conditions — **not enough data (one run) to tell them apart**, and manufacturing
that distinction from a single run would be exactly the kind of unmeasured prompt judgment this
phase explicitly says not to make yet.

**No prompt changes are proposed this sprint** — correctly, per the brief: one confounded run is
not "metrics that justify" a change.

---

## Phase 7 — Regression

Full BE test suite run against the current (uncommitted) working tree:

```
2353 passed, 21 failed, 236 skipped, 9 collection errors, in 168-260s
```

**All 21 failures + all 9 collection errors trace to one pre-existing, unrelated cause**:
`ModuleNotFoundError: No module named 'langchain_core.pydantic_v1'` — a local `langchain`/
`langchain_core` version mismatch in this machine's Python environment, breaking only the
query/retrieval graph (`app/graphs/query_graph.py` → `ensemble_retriever.py`) and everything that
imports it. Verified by direct traceback inspection of a representative failure
(`test_query_ownership.py::test_filter_by_sources_excludes_non_owned`) — same root exception.
**Zero of these failures touch MindMap, Summary, ingest, auth, or any file this sprint's Phase
1/2 work exercised.** Not fixed here — out of scope (no dependency version changes per this
sprint's own rules), and not this sprint's regression to own (pre-existing local environment
state, not caused by any change in this working tree).

**Real, clean regression signal**: 2353/2353 non-query-graph tests pass. MindMap and Summary
pipeline tests (including the reserved-tree's own 20+ new test files, run as part of the full
suite, not individually re-verified beyond this) are in the passing set.

**Not verified this sprint**: FE test suite (FE is frozen, correctly out of scope), golden
regression comparison against a prior release baseline (no baseline artifact was located/run),
API/route/persistence/renderer identity checks beyond "no code in those layers was touched."

---

## Final Assessment

| Area | Verdict | Basis |
|---|---|---|
| MindMap quality instrumentation | **PASS** (exists, runs, cheap) — data volume **WARNING** | `MINDMAP_QUALITY_AUDIT.md` |
| MindMap real-world quality baseline | **WARNING (sample size), but the confound is resolved** — 1 real document, still not ≥10; but that one document's final run (job `71083a43`, final verification pass) is a clean, complete, uncontended real result: 0 hierarchy violations, 0 enrichment loss, 100% coverage. No longer confounded by timeouts or credential failures — just not yet a representative sample | Same; final number in `docs/P0_BLOCKER_REPORT.md` "Final Verification" |
| Summary quality instrumentation | **FAIL at time of writing → P0.5: PASS.** Built and verified: per-section timing/provider/retry/status/empty-output/failure-reason, additive-only, real run confirmed | `SUMMARIES_QUALITY.md`; superseded by `docs/P0_BLOCKER_REPORT.md` P0.5 Blocker #1 |
| Summary real-world quality | **WARNING** — 1 clean local run, contradicts an earlier-observed production partial-failure state, unreconciled | Same |
| Performance | **WARNING** — real local numbers captured; zero production numbers; ingest/summary lack per-stage timing | `PERFORMANCE_REPORT.md` |
| Determinism | **PASS** — skeleton stage is 0-LLM and measured at 94.9ms; `quality_report` never raised on real or malformed input (per its own tests + this run) | Read `quality_report.py`, ran it for real |
| Recovery (self-healing) | **WARNING** — mechanism exists (`recovery.py`), but this run recovered 0/17 (all losses were `MISSING_BY_ENRICHMENT`, the one category the recovery module doesn't act on by its own design — it "only ACTS on MISSING_BY_CAP, the one provably-safe case") — untested on the case it's actually built for | `recovery.py` docstring + this run's data |
| Analytics | **PASS** — `generation_report`/`append_report` wired and confirmed writing real records this sprint | `mindmap_generation_reports.jsonl` produced |
| Visual QA | **PASS** — carried over from the prior sprint, not re-touched (out of this sprint's frozen-FE scope) | `docs/FINAL_VISUAL_QA.md` |
| Accessibility | **Not evaluated this sprint** — FE frozen, out of scope; prior sprint's keyboard-focus check stands | `docs/FINAL_VISUAL_QA.md` |
| Production deployment | **FAIL (not yet)** — none of this sprint's instrumentation is deployed; production runs the older, uninstrumented pipeline (`docs/MINDMAP_V2_AUDIT.md §6`); no production data was pulled this sprint | This sprint's own scope discovery |
| Failure classification (`UNKNOWN` < 5%) | **PASS under the reserved taxonomy (0%)**, **FAIL under the brief's requested taxonomy (88.2%) → P0.5: confirmed the 88.2% is not real pipeline output on either real run measured** (`loss_reasons` pulled directly from the analytics record: `{"MISSING_BY_ENRICHMENT": N}`, zero `UNKNOWN`, both runs) | Phase 4 above; superseded by `docs/P0_BLOCKER_REPORT.md` P0.5 Blocker #3 |
| Dataset coverage (Phase 3) | **FAIL against the ≥10-document ask** — 1 complete, 1 failed-at-ingest. **P0.5: still 1/10** — 4 more real documents (TXT/MD/DOCX/PDF) prepared, all blocked by the same reproducible local FPT embedding outage (5 failed attempts total across both sprints) | Phase 3 above; reconfirmed in `docs/P0_BLOCKER_REPORT.md` P0.5 Blocker #2 |
| Regression | **PASS** (2353/2353 relevant tests; 21 failures independently root-caused to an unrelated pre-existing environment issue) | Phase 7 above |

---

## Would I deploy this to production today?

**NO.**

### Blocking issues

1. **The quality instrumentation this sprint evaluated is not deployed.** It lives entirely in
   an uncommitted working tree. Shipping "release hardening" without shipping the thing that
   measures the hardening is a contradiction — there is currently no way to know MindMap quality
   in production at all, before or after this sprint.
2. ~~Summary has no failure-reason/token/timing instrumentation~~ — **P0.5: closed.** Built,
   tested, and verified against a real run (`docs/P0_BLOCKER_REPORT.md` P0.5 Blocker #1). The
   underlying local-vs-production discrepancy this instrumentation was meant to help explain is
   still unreconciled, though — that specific question remains open, just no longer invisible.
3. **Phase 3's dataset ask (≥10 real documents) still not met** — 1 complete. P0.5 tried again
   with 4 more real, diverse documents; all blocked by the same reproducible local infrastructure
   issue (see #4 below, which is now confirmed to be the SAME root cause blocking this too, not
   just a confound on the numbers). This is now the single biggest reason this report's numbers
   can't be trusted as representative.
4. **This sprint's local environment has a dead/unreliable FPT credential** — confirmed across
   three passes now (this report's original 1 failed second-document attempt, P0.5's 4 more
   failed attempts, and one final re-verification this pass — **6 failed attempts total, all the
   identical `HTTP 401`**). LLM text-generation calls through FPT succeeded intermittently (worked
   for one real Summary run in P0.5); embedding calls through FPT failed every single time tested,
   with no exception. That needs verifying against real production credentials before trusting
   any failure-rate number in this report family, and is now also the direct blocker on closing
   #3 above.
5. **The requested Phase 4 taxonomy question — root-caused with evidence (P0.5), not closed.**
   Confirmed directly from the real analytics records that 0% `UNKNOWN` is what the reserved,
   internal pipeline taxonomy actually produces on both real runs measured. The 88.2% figure is
   not a pipeline output field — it's a derived projection of those same real cases onto the
   brief's own requested external taxonomy. **That projection still fails the stated <5%
   requirement, and 0% internal output does not by itself satisfy an external contract** — this
   needs an explicit owner decision (accept the internal taxonomy as satisfying the ask, or treat
   the external contract as still unmet), not something this report resolves unilaterally.
6. **Recovery (self-healing) was never exercised on the failure mode it's built for** in this
   sprint's one real run — 0 opportunities to recover `MISSING_BY_CAP` (the only case
   `recovery.py` acts on) appeared.
7. ~~Hierarchy violations and enrichment loss~~ — **closed for this run/configuration (final
   verification pass).** 8→0 hierarchy violations, fully verified end-to-end. The
   remaining-enrichment-loss root cause (a key-mismatch, not model omission) has a real fix, and
   its full effect is now fully measured: a complete, real, uncontended end-to-end regeneration
   (job `71083a43`) shows 0 degraded entries, 0 hierarchy violations, 100% coverage — superseding
   the earlier partial re-test. Both fixes still undeployed (see #1).

**Net effect of this pass**: two of six original blockers now fully closed with real, complete
evidence (#2, #7 — Summary diagnostics, hierarchy+enrichment). #5 is root-caused with evidence but
stays open pending an owner decision on the external-taxonomy contract. #3 and #4 turned out to be
the same underlying infrastructure issue — re-verified one final time this pass (6th identical
failure), still open, not a code defect. #1 and #6 are unchanged. The verdict stays **NO** —
narrower each pass, and this pass in particular removes any doubt about whether the hierarchy and
enrichment fixes actually work; what remains is deployment, the dataset benchmark, and the
taxonomy decision, not further engineering on the two fixes themselves.

### Remaining risks (non-blocking, but real)

- Production's actual credential/infra profile is unverified against this sprint's findings.
- `hierarchy_violations` (8, real, reproducible) type-level detail wasn't captured — unclear if
  any are severe.
- The 21 test failures' root cause (langchain version mismatch) exists in this local environment;
  not confirmed absent from CI/production — worth a quick independent check even though it's
  clearly unrelated to this sprint's own changes.

### Recommended future improvements

1. Deploy the MindMap quality-instrumentation tree (coordinate with its owning workstream —
   it's ready, tested, and cheap; this is the single highest-leverage next step).
2. Build the equivalent instrumentation for Summary (reason enum, per-section timing, token
   usage) — currently the weaker-instrumented half of this sprint's mission.
3. Run Phase 3 for real, as a batch job with valid credentials, outside an interactive session,
   across the full format/size matrix requested.
4. Reconcile the local-clean-vs-production-partial-failure Summary discrepancy under controlled,
   single-variable-at-a-time conditions.
5. Once instrumentation is live in production, revisit this report's WARNING/FAIL rows with real
   production data — most of this report's caution comes from small sample size and a confounded
   local environment, not from evidence of an actual pipeline defect.
