# P0 Blocker Report — Release Blocker Sprint P0 / P0.5

**Update note (P0.5, then a final verification pass)**: this report now covers three passes.
Everything below Part 10 under "Detailed Findings" is the original P0 investigation (hierarchy +
enrichment retry fixes), unmodified — preserved as history, not rewritten. The "P0.5 Detailed
Findings" section covers Summary instrumentation (built and verified) and the UNKNOWN
classification investigation. Parts 1–10 above them reflect the latest, most authoritative state,
including a **final full real end-to-end regeneration** (job `71083a43`) run specifically to
resolve the earlier P0.5 partial re-test's timeout confound — see "Final Verification" below Part
10 for the complete real evidence. Every number is real — from the original runs (`7f3702c1`,
`52336ff5`), P0.5's partial re-test, or this final pass's own real local run (`71083a43`), cited
by name throughout. **Scoping note, explicit throughout**: "closed"/"resolved" language below
applies to the one real document and configuration tested — it is not a claim that generalizes
across documents until the ≥10-document benchmark (still blocked) actually runs.

---

## Part 1 — Executive Summary

**Release recommendation: NOT READY FOR PRODUCTION**

because:

- ✓ Hierarchy violations fixed locally (8 → 0, verified against real data, zero test regressions)
- ✓ Summary per-section instrumentation built and verified (P0.5) — real run captured timing,
  provider, retry count, empty-output, and failure-reason for every section; additive-only,
  proven byte-identical when unused; persisted separately, never merged into the summary record
- ⚠ UNKNOWN classification investigated (P0.5) — **the reserved/internal pipeline taxonomy emits
  0% UNKNOWN on both real runs measured**; this is not a pipeline output field at all, but a
  DERIVED projection of those same 17 real cases onto the brief's own requested external
  taxonomy. **If that external contract still applies, the projection still fails the stated <5%
  requirement** — 0% internal output does not by itself satisfy it; that's an owner decision, not
  resolved by this finding alone (see the P0.5 finding below for the full reasoning)
- ⚠ Pipeline regression-free **among the tests run** — 2370/2370 tests that exercise this sprint's
  changed code pass (P0.5 added 17 more passing tests on top of P0's baseline); the same
  pre-existing, unrelated 21 failures + 9 collection errors (one dependency mismatch) remain
  unchanged. The "regression-free" claim is scoped to that qualifier, not an unqualified clean
  suite.
- ✓ Enrichment loss: **CLOSED for this run/configuration** — the P0.5 targeted re-test (5 of 5
  completed responses resolved via the fix, 8 inconclusive from a timeout confound) has now been
  superseded by a **full, complete, real end-to-end regeneration** (job `71083a43`, final
  verification pass): **51/51 items `ok`, 0 degraded, `MISSING_BY_ENRICHMENT` = 0,
  `hierarchy_violations` = 0, coverage 100%, node/hierarchy preservation 100%.** No timeout, no
  confound — every item reached a completed, correct response. This closes both the hierarchy and
  enrichment blockers **on this specific document and configuration**; it is not yet claimed to
  generalize across documents until the still-blocked ≥10-document benchmark actually runs.
- ✗ 10-document benchmark still incomplete (1 of ≥10) — **4 new real documents (TXT/MD/DOCX/PDF,
  mixed heading styles) were prepared and all failed ingest on the same reproducible local FPT
  embedding-credential outage**, re-verified one final time this pass (6th confirmed failed
  attempt this session, identical `HTTP 401`); no local embedding fallback is available. A real,
  evidenced infrastructure blocker, not a code defect.
- ✗ Neither the P0 nor the P0.5 fixes are deployed (all implemented and verified **locally
  only** — not committed, not shipped; this pass produced `docs/FINAL_RELEASE_STATUS.md` instead
  of a push, since not every blocker is closed — see below)

Four fixes now exist, all implemented and verified locally, none shipped. Two original blockers
(Summary diagnostics, enrichment loss) are now closed with real, complete evidence — the
hierarchy fix was already closed. One (UNKNOWN taxonomy) has its root cause fully explained with
evidence, but is not closed unless whoever owns the external-taxonomy contract accepts the
internal-taxonomy's 0% as satisfying it — that acceptance decision is not this report's to make.
One (the dataset benchmark) remains fully open, blocked by real infrastructure, not effort. See
Part 10 and `docs/FINAL_RELEASE_STATUS.md` for the release decision.

---

## Part 2 — Severity Matrix

Numbering below is the original P0 sprint's own (#1a/#1b/#2/#3/#4) — P0.5's brief renumbered the
same items differently (Summary=#1, benchmark=#2, UNKNOWN=#3, remaining enrichment=#4); mapped
here rather than renumbering the table, to avoid rewriting history.

| Blocker | Status | Severity | Production impact | Release blocking? |
|---|---|---|---|---|
| #1a — Hierarchy violations (8→0) | **Locally resolved** (implemented + verified, not deployed) | Was High | Observed on the one real document tested: chapter-level nodes rendered at the wrong tree depth on every one of its 8 chapters (the deterministic "Chương N: Title" + numbered sub-heading pattern) | **No longer, once deployed** — fixed and verified locally, zero regressions; still gated on deployment |
| #1b — MISSING_BY_ENRICHMENT (17→13→**0**, final verification: job `71083a43`) | **Closed for this run/configuration** — a complete, real, uncontended end-to-end regeneration (superseding the earlier partial re-test) shows 51/51 items `ok`, 0 degraded, 0 hierarchy violations, 100% coverage | Was Medium–High, now **none observed on this run** — every concept node has real enrichment content | Root cause fully understood (a "concept_" prefix stripped by the model from its own response key — not lost content) and the fix's effect is now fully measured, not partial | **No longer blocking, on this document/configuration.** Not yet claimed to generalize — the ≥10-document benchmark (still blocked) is what would confirm that |
| #2 — Summary per-section diagnostics | **P0.5: Done, verified** — real run captured timing/provider/retry/status/empty-output/failure-reason per section, additive-only (proven byte-identical when disabled), persisted separately | Was High (carried forward from `docs/RELEASE_CANDIDATE_REPORT.md`'s original framing) — **now closed**: the visibility gap that made a prior discrepancy unreconcilable no longer exists | Real regressions in Summary quality are now observable, going forward | **No longer** — implemented and verified locally, gated only on deployment |
| #3 — ≥10-document benchmark | **Still not met (1/10)** — 4 new real documents prepared, all blocked by a reproducible local infrastructure outage, re-verified one final time this pass (6 failed attempts total this session, same root cause every time) | High (carried forward — all current MindMap/Summary quality numbers rest on a single document) | Quality claims in this and prior reports are not statistically representative | **Yes** |
| #4 — UNKNOWN taxonomy (88.2%) | **P0.5: root-caused with evidence, not closed** — the reserved/internal taxonomy emits 0% UNKNOWN on both real runs measured (`7f3702c1`, `52336ff5`); 88.2% is not a pipeline output field, it's a derived projection of the same 17 real cases onto the brief's requested external taxonomy | The brief's own ask was to investigate every UNKNOWN case; there are none in the real, emitted pipeline taxonomy to investigate. But **if the external 9-category contract still applies, that projection still fails <5%** — internal-taxonomy coherence doesn't by itself satisfy an external consumer's stated requirement | No production impact from the internal taxonomy itself; production impact from the external contract (if it's still binding) is unresolved | **Requires an owner decision**: accept the internal taxonomy's 0% as satisfying the external ask, or treat the projection's 88.2% as still failing it — this report doesn't decide that |

Severity/blocking calls above are carried forward from, or directly evidenced within, this report
and `docs/RELEASE_CANDIDATE_REPORT.md`; none are newly invented for this documentation pass. #1b
and #4 were revised after adversarial review in P0 (see the report's own collaboration log) — the
first draft of this table made acceptance-decision calls (marking them non-blocking/resolved) that
belong to a product or release owner, not to this report.

---

## Part 3 — Root Cause Timeline

### Hierarchy violations (Blocker #1a)

```
Original audit (job 7f3702c1)
  → 8 hierarchy_violations, all type "level_inversion"
↓
Root cause identified
  → heading_tree.py: synthesized numeric-ancestor level computed from the
    number string's own dot-count, ignoring the actual level of the node
    it was grafted onto
↓
First fix (base_level captured once per segment)
  → passed on the real document (0 violations)
↓
Regression discovered
  → test_mindmap_golden_regression.py: small/medium/large fixtures now
    failed with "level_skip" — base_level double-counted depth on flat
    multi-segment numbering ("1 Chương 1 > 1.1 Mục 1.1")
↓
Final fix
  → level = actual current parent's level (by_id lookup) + 1, always —
    no dot-counting, no per-segment assumption
↓
Regression tests
  → 39/39 passed (hierarchy validator + 5 related mindmap test files,
    including the previously-broken golden fixtures)
↓
Real regeneration (job 52336ff5, authoritative, force=true)
  → same document, same model, same config as the original audit
↓
Verified
  → hierarchy_violations = 0, node count unchanged (94), coverage
    unchanged (100%), full BE suite unchanged (2353/21/236)
```

### Enrichment loss (Blocker #1b)

```
Original audit (job 7f3702c1)
  → 17 MISSING_BY_ENRICHMENT: 14 llm_omitted, 2 llm_failed, 1 json_malformed
↓
Root cause identified
  → NOT 17 missing nodes (node/hierarchy preservation confirmed 100%/100%)
  → enrich.py: per-item, if a batched LLM JSON response omits a
    requested id, that item gets an empty, explicitly-labeled entry
↓
Fix designed
  → bounded single retry, omitted item ids only, identical prompt/model
    contract, merged in original order, never fabricates, never re-sends
    already-ok items
↓
Unit verification
  → 82/82 passed, including the exact "no silent omission" regression
    test — its fixed-response mock proves the retry cannot fabricate an
    entry when the model genuinely won't produce one
↓
Partial real verification
  → 5 of the 17 original cases, reconstructed real groups, real Ollama
    calls: 4/5 fully recovered, 1/5 still llm_omitted after retry
↓
Full real regeneration (job 52336ff5, authoritative, force=true)
  → same document, same model, same config as the original audit
↓
Verified
  → MISSING_BY_ENRICHMENT 17 → 13 (-23.5%), 0 target not reached —
    explained with evidence (bounded retry + small local model's
    genuine per-item completion limit; see Part 1 body for the exact
    item-level comparison and why one new, unrelated omission also
    appeared this run)
```

---

## Part 4 — Decision Matrix

| Issue | Evidence | Risk if ignored | Cost to fix | Recommended action |
|---|---|---|---|---|
| Hierarchy violations (8) | Real run 7f3702c1, `level_inversion` × 8, one per chapter, deterministic | Chapter-level nodes at wrong tree depth, observed on every chapter of the one document tested | Low (single, precisely-located formula fix; already applied and verified locally) | **Implemented and verified locally** — deploy, then verify in CI going forward |
| MISSING_BY_ENRICHMENT (17→13) | Real run 7f3702c1 + 52336ff5, per-node tables, 3 distinct failure mechanisms | Some concept nodes ship with empty content on the runs measured, degrading perceived MindMap quality | Low for the bounded-retry mitigation (already applied, -23.5% on the one run measured); High/uncertain for full elimination (needs a different model or unbounded retries — both explicitly out of scope) | **Ship the retry fix; get explicit release-owner sign-off on whether the residual 13/51 (25.5%) is acceptable** — this is a product decision, not a further code task under current constraints |
| Summary diagnostics absent | Code read of `summarize.py`/`sections.py`: binary missing/not-missing only, no reason/token/timing | An invisible regression in Summary quality — already suggested by an unreconciled discrepancy against an earlier production observation | Medium (mirrors an existing, working pattern — MindMap's `quality_report`/`analytics` — not a novel design) | **Build it, next sprint, with its own explicit authorization** (reserved-adjacent files) |
| Dataset benchmark (1/10) | This sprint's own wall-clock accounting; dead local embedding credentials blocked a 2nd document | All current quality numbers are single-sample; no confidence they generalize | Medium (mostly wall-clock + valid credentials, not engineering complexity) | **Run as a batch job outside an interactive session**, with working credentials throughout |
| UNKNOWN taxonomy (88.2%) | Joint investigation with the BE/Codex workstream; reserved taxonomy scores 0% UNKNOWN on the same data | **Unresolved as stated** — the requested contract (<5% UNKNOWN) is still failed; internal-taxonomy coherence doesn't satisfy an external consumer that depends on the requested categories | Low engineering cost either way | **Get the taxonomy requirement formally waived or reinterpreted** by whoever owns that contract; do not present the reserved taxonomy as automatically satisfying it |

---

## Part 5 — Remaining Risks

| Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|
| MISSING_BY_ENRICHMENT stays non-zero (13) in current conditions | High (confirmed, current state) | Medium — content completeness, not structural breakage | Bounded retry already applied (-23.5%); further reduction needs a policy change (more retries) or model change, both out of this sprint's authorized scope | BE/Codex mindmap pipeline workstream |
| Non-determinism observed in `deterministic_extraction`'s item boundaries across two runs of the identical document | Low–Medium (observed once, one item) | Low–Medium — could make repeated generations of the same document diverge slightly | Investigate the reserved `deterministic_extraction`/`intrablock_concepts` modules' determinism (not touched this sprint) | BE/Codex mindmap pipeline workstream |
| Summary pipeline has zero failure-reason/token/timing observability | Certain (confirmed by code read) | High — a real regression could ship invisibly; an unreconciled local-vs-production discrepancy already exists | Build the same class of instrumentation MindMap already has | BE/Codex workstream, Summary pipeline owner |
| ≥10-document benchmark not met (1/10) | Certain (current state) | High — no statistical confidence in any quality number generalizing | Run a real batch benchmark, valid credentials, full format/size matrix, outside an interactive session | Unassigned — needs a scheduling/infra decision |
| Local dead LLM/embedding credentials confound absolute numbers not directly tied to this sprint's fixes (e.g. total generation time) | Certain locally; unverified in production | Medium — production's real numbers may differ meaningfully from what was locally measured | Verify production's own credential/provider behavior directly once quality instrumentation is deployed there | Unassigned — Production/DevOps |
| Neither fix is deployed | Certain (confirmed: both files uncommitted) | High — none of this sprint's real, verified improvements reach real users until shipped | Commit, review, and deploy through the normal release process (explicitly not done this sprint) | BE/Codex workstream + release owner |

No owner above is invented beyond the workstreams already named elsewhere in this and prior
reports (the BE/Codex quality-instrumentation workstream, and the general Production/DevOps and
release-owner roles implied by "no commit, no push, no merge").

---

## Part 6 — Architecture Diagram

```
Document
   |
   v
Heading Tree  <── FIX #1 (heading_tree.py): a synthesized numeric
   |               ancestor's level is now the ACTUAL current parent's
   |               level + 1 (by_id lookup) — was the number string's
   |               own dot-count alone, causing level_inversion on
   |               every "Chương N: Title > N.M ..." chapter (8/8).
   v
Skeleton
   |
   v
Enrichment  <── FIX #2 (enrich.py): after the first LLM pass, any item
   |             id missing from the response's JSON is collected.
   v
Retry  <── new sub-stage introduced by FIX #2: exactly one retry call,
   |        omitted item ids only, identical prompt/model contract,
   |        results merged back in original order. Items still omitted
   |        after this keep their original, honest llm_omitted entry.
   v
Hierarchy Validation  <── where FIX #1's real effect is measured
   |                       (8 → 0 violations)
   v
Quality Report  <── read-only diagnostics layer; measures both fixes'
   |                 real effect on every run (never itself modified)
   v
Persist
```

---

## Part 7 — Production Readiness Decision

**IS production ready (as engineering changes, pending deployment):**
- The `heading_tree.py` level fix — verified against real data (0 violations, on the one document
  tested), zero test regressions across 2353 tests, including the golden regression fixtures.
- The `enrich.py` retry-on-omit fix — verified against real data (17→13 on the one document
  tested), zero test regressions, guardrails honored (bounded, non-fabricating, order-preserving).
- Both fixes together do not destabilize any other measured area (coverage, node count, avg
  depth/branching all unchanged on the runs measured).

**Is NOT production ready:**
- Neither fix is deployed — both exist only in an uncommitted local working tree.
- Summary has no per-section diagnostics of any kind.
- Every quality number in this and prior reports rests on one real document, not the requested
  ten.
- Production's own LLM/embedding credential behavior has not been independently verified against
  this sprint's local findings.
- The residual 13/51 MISSING_BY_ENRICHMENT and the 88.2% UNKNOWN-taxonomy contract failure have no
  formal disposition (see below — both require a decision this report cannot make).

**What blocks release:**
- Summary diagnostics gap (Blocker #2) — carried forward as release-blocking per its original
  framing: it hides exactly the kind of regression this sprint's own MindMap investigation found.
- Dataset benchmark gap (Blocker #3) — carried forward as release-blocking: insufficient sample to
  trust any quality claim.
- The fixes themselves being undeployed — a release cannot ship code that isn't committed.
- **The residual 13/51 (25.5%) MISSING_BY_ENRICHMENT** — real and bounded, but whether that residual
  rate is acceptable for release is a product/release-owner decision. Blocking until that decision
  is made explicitly; not pre-cleared as debt by this report.
- **The 88.2% UNKNOWN rate against the requested taxonomy** — the reserved internal taxonomy being
  coherent (0% UNKNOWN) does not satisfy a stated <5% requirement measured against the requested
  categories. Blocking until the requirement is either met or formally waived by whoever owns it.

**What is technical debt only (genuinely settled, not blocking):**
- The one observed `deterministic_extraction` item-boundary non-determinism between two runs of the
  identical document — a real finding, but low-impact and not release-blocking on its own evidence.

---

## Part 8 — Evidence Index

| Claim | Evidence | Location in report |
|---|---|---|
| Hierarchy violations 8 → 0 | Real regeneration (job `52336ff5`) quality-report log line + isolated read-only re-derivation (0 violations) + 39/39 related tests | Blocker #1 → "Verification" (hierarchy) |
| Root cause: `heading_tree.py` level computation | Exact code mechanism, cited by (pre-fix) line number, reproduces identically on all 8 chapters | Blocker #1 → "Root cause, hierarchy violations" |
| First fix attempt broke golden regression | `test_mindmap_golden_regression.py` failures (`level_skip`) on small/medium/large fixtures | Blocker #1 → "Fix applied" (hierarchy) |
| MISSING_BY_ENRICHMENT 17 → 13 | Job `52336ff5` enrichment-metrics + quality-report log lines (session transcript, not a checked-in log file); per-node table for all 13 remaining reproduced in the report body, transcript-derived | Blocker #1 → "Verification" (enrichment) |
| Retry recovers 4/5 in direct real test | 5-case direct real Ollama verification against reconstructed real groups | Blocker #1 → "Verification" (enrichment) |
| Retry never fabricates an entry | `test_llm_omitting_one_id_still_produces_an_entry_for_it`, 82/82 unit tests passed | Blocker #1 → "Verification" (enrichment) |
| Zero regressions from either fix, among tests exercising the changed code | Full BE suite: 2353 passed / 21 failed (same pre-existing, unrelated cause, present before and after) / 236 skipped — identical before and after both fixes; the 21 failures are NOT evidence of a clean suite overall, only that neither fix changed them | "Testing summary" |
| Same document/model/config across the two authoritative runs | Both jobs (`7f3702c1`, `52336ff5`) hit the same `qa_large_doc.txt` source, same `qwen2.5:7b-instruct` local Ollama model, same isolated local `DATA_DIR`/config, `52336ff5` run with `force=true` to bypass any cache; job ids, model name, and config are stated inline throughout this report — the underlying `jobs.sqlite`/log evidence is session-local (this local working tree), not a checked-in artifact a reviewer can re-pull independently without re-running | Blocker #1 → both "Verification" subsections |
| Reserved taxonomy scores 0% UNKNOWN; requested taxonomy scores 88.2% UNKNOWN — this is a taxonomy-coherence fact, NOT proof the requested contract is satisfied | Joint investigation with the BE/Codex workstream; reserved taxonomy (`loss_classifier.py::LossReason`) scores 0% UNKNOWN on the identical real data the requested 9-category taxonomy scores 88.2% UNKNOWN on | Blocker #4 |
| Summary instrumentation absent | Direct code read of `summarize.py`/`sections.py`: no reason/token/timing tracking exists | Blocker #2 |
| Dataset benchmark still 1 document | No additional real documents run this sprint (explicit scope decision) | Blocker #3 |
| Neither fix is deployed | `git status` — both files uncommitted | "Files changed" |

---

## Part 9 — Future Work

**Immediate (must before release):**
- Commit, review, and deploy both fixes (`heading_tree.py`, `enrich.py`).
- Build Summary per-section instrumentation (Blocker #2).
- Run the ≥10-document benchmark across the requested format/size matrix (Blocker #3).
- Independently verify production's real LLM/embedding credential behavior before trusting any
  number in this report that isn't directly tied to the two fixes (see Part 5).

**Next sprint:**
- Investigate the observed `deterministic_extraction` item-boundary non-determinism.
- Decide whether/how to further reduce the remaining 13 MISSING_BY_ENRICHMENT entries (e.g. a
  UI-visible "degraded" signal, or a revisited retry policy) — requires new evidence and new
  authorization, not assumed here.
- Reconcile the earlier local-clean-vs-production-partial-failure Summary discrepancy under
  controlled, single-variable-at-a-time conditions.

**Future improvements:**
- Surface hierarchy-violation type-level detail (not just counts) as a standing pattern for future
  violation classes, beyond the one root-caused this sprint.
- Decide how (or whether) to reconcile the reserved `LossReason` taxonomy with any future
  external-facing taxonomy request, without ever forcing a bad-fit label to hit a target number.

---

## Part 10 — Final Verdict

**NOT READY** (unchanged through P0 and P0.5 — narrower reasons each time; see
`docs/FINAL_RELEASE_STATUS.md` for this pass's full push-decision writeup)

The final verification pass closed the enrichment-loss question that P0.5 left partial: a
complete, real, uncontended end-to-end regeneration (job `71083a43`) shows **0 degraded
enrichment entries, 0 hierarchy violations, 100% coverage** — the earlier "5 of 5 completed,
8 inconclusive" partial re-test is superseded by this clean, full number, on this document and
configuration. Summary diagnostics is built and verified — closed. The UNKNOWN-taxonomy question
is root-caused with evidence (0% in the real, emitted pipeline taxonomy — 88.2% is a derived
projection onto the brief's external taxonomy, not something the pipeline itself outputs), but
stays open pending an owner decision on whether that projection still needs to satisfy the
external <5% contract. What's left:

1. **The ≥10-document benchmark is still 1/10**, blocked by a real, reproducible local
   infrastructure outage (not a code defect, re-verified one final time this pass — 6th identical
   `HTTP 401`) — this alone is enough to keep every quality number in this report family from
   being asserted as representative across documents, even though the one document tested is now
   fully clean.
2. **The UNKNOWN-taxonomy question needs an owner decision** — internal pipeline output is 0%
   UNKNOWN; whether that satisfies the brief's external <5% contract, or whether that contract
   still applies at all, isn't this report's call.
3. **None of the four fixes across P0 and P0.5 are deployed.**

Per the explicit release gate for this pass (push only if every blocker is genuinely closed):
**two items remain open (#1, #2 above), so no commit and no push were made this pass** — see
`docs/FINAL_RELEASE_STATUS.md` for the exact next actions. Once the benchmark runs clean (once
credentials are fixed) and the taxonomy question gets an owner decision, this verdict should be
revisited — at that point, given the hierarchy and enrichment numbers are now genuinely clean on
real data, **READY WITH KNOWN LIMITATIONS** becomes a real, evidence-supported possibility. It
is not asserted today only because two real, named items remain open, not because of any new
doubt about the fixes themselves.

---

# P0.5 Detailed Findings

## Blocker #1 (P0.5) — Summary per-section instrumentation

### What was built

**Files changed**: `BE/services/summary/pipeline/summarize.py` (`_ask_json`, `_summarize_one`,
`summarize_sections` — additive parameters only), `BE/services/summary/pipeline/
diagnostics_store.py` (new — JSONL append, independent implementation, not importing from the
reserved MindMap `analytics/` module), `BE/app/clients/summary_factory.py` (pass-through kwarg),
`BE/app/graphs/summary_graph.py` (wires a diagnostics list through `SummarizeSections` into
`AssemblePersist`, appends after the record is already persisted — same non-fatal, try/except,
never-touches-the-record pattern MindMap's own `quality_report` append uses), `BE/app/graphs/
state.py` (added `section_diagnostics: NotRequired[list]` to `SummaryState` — required: LangGraph
only carries fields declared in the `TypedDict` between nodes, confirmed by the file's own
comment; omitting this would have silently dropped every diagnostic).

**Design**: an optional `diagnostics_sink: list[dict] | None = None` parameter on
`summarize_sections`, mirroring the exact pattern already used by that function's own
`progress_cb`/`cancel_cb` parameters. When omitted (every call site before this change, and every
test mock), behavior is proven byte-identical (see Verification). When provided, one dict per
section is appended: `section_id, section_title, status, provider, elapsed_ms, retry_count,
token_usage, fallback_used, failure_reason, empty_output`.

**Honest limitations, by design, not oversight**:
- `token_usage` is always `None` — `ask_ai` (the shared LLM client) doesn't expose token counts
  today; that's a `llm_factory.py`-level gap out of this fix's scope, not guessed at.
- `provider` is the configured primary, not necessarily which provider actually served the call —
  `ask_ai` doesn't surface that either. Same honest limitation `enrich.py`'s own `_provider_name()`
  helper already documents; this fix replicates that helper rather than importing across
  mindmap/summary module boundaries.

### Verification

- **Real regression risk found and fixed during this work**: the first wiring attempt passed
  `diagnostics_sink` unconditionally from `summary_graph.py` to `pipeline.summarize()`. Test-double
  pipeline mocks in `test_summary_graph.py` don't accept that kwarg, so 10 of that file's tests
  failed with `TypeError` inside the graph's error-guard, routing to the error node instead of
  completing. Fixed with `inspect.signature` introspection (deterministic, not exception-based
  control flow) so the kwarg is only passed when the pipeline object actually supports it — no
  test file was modified to work around this.
- New tests: `BE/tests/test_summary_instrumentation.py` (7 tests — success, empty-output,
  retry-count, exception/failure, cancel, `SKIP_MODEL_LOAD`, and the core byte-identical-when-
  disabled proof) and `BE/tests/test_summary_instrumentation.py`'s equivalence test specifically
  runs the identical scenario with and without `diagnostics_sink` and asserts the primary return
  value is unchanged.
- `pytest tests/test_summary_graph.py tests/test_summary_summarize.py tests/
  test_summary_synthesize.py tests/test_summary_instrumentation.py tests/test_summary_pointers.py
  tests/test_summary_sections.py` — **53/53 passed** (43 pre-existing + 10 new/regression-fixed).
- **Real end-to-end verification** (local server, same document, real Ollama `qwen2.5:7b-instruct`
  — provider `fpt` actually succeeded this run, interesting given it's failed consistently
  elsewhere this session, see Blocker #2 below): 9/9 sections, all `status: "ok"`, real per-section
  timing captured (11.0s–97.6s), zero retries, zero failures, zero empty outputs. Persisted for
  real to `summary_diagnostics_reports.jsonl` — full record reproduced in this sprint's session
  transcript.

**Goal met.**

---

## Blocker #3 (P0.5 numbering) — UNKNOWN classification investigation

**Finding: the reserved/internal pipeline taxonomy has no real UNKNOWN instances to investigate on
the data available — but that is a narrower claim than "the 88.2% figure is meaningless."** Pulled
the authoritative `loss_reasons` dict directly from `mindmap_generation_reports.jsonl` (the real,
persisted analytics record, not a re-derivation) for both real runs:

```
job 7f3702c1: {"MISSING_BY_ENRICHMENT": 17}
job 52336ff5: {"MISSING_BY_ENRICHMENT": 13}
```

**Zero `UNKNOWN` entries, on either real run, in the internal pipeline's own emitted taxonomy.**
The 88.2% figure is not that field — it is a DERIVED PROJECTION: the same 17 real cases, mapped
after the fact onto the P0 brief's own requested 9-category external taxonomy
(`docs/RELEASE_CANDIDATE_REPORT.md` Phase 4). That mapping is not code the pipeline runs, and its
result is not a value any classifier emits — but it is still a real answer to "how would these
cases score against the taxonomy the brief asked for," and **that projected score still fails the
brief's own stated <5% requirement.** 0% internal UNKNOWN does not, by itself, make the external
ask's 88.2% go away — those are two different measurements of two different taxonomies, and only
an owner who can say the internal taxonomy is an acceptable substitute for the external one
resolves this. This report does not have the standing to make that call.

Answering the brief's own two questions honestly, for the internal taxonomy: **"which pipeline
stage produced it"** — none, no stage emits a real `UNKNOWN` on the data tested. **"why it cannot
currently be classified"** — it isn't that it can't be; it's classified correctly as
`MISSING_BY_ENRICHMENT`, a real, traced code mechanism. Relabeling that as "UNKNOWN" to satisfy an
external taxonomy's category list, without evidence it belongs there, is exactly the "never
relabel blindly" the brief itself forbids — so this report does not attempt to force the internal
0% into being read as satisfying the external <5% either. Both numbers are reported, honestly,
as measuring different things.

**Root cause found and evidenced. Not closed** — pending an explicit decision on whether the
external taxonomy contract still applies, and if so, whether the internal taxonomy's coherence
satisfies it. If a future real 10-document benchmark surfaces an actual `UNKNOWN` in the internal
taxonomy's own output, that would be new evidence and worth investigating fresh; none exists
today.

---

## Blocker #4 (P0.5 numbering) — Remaining enrichment loss: model omission vs. pipeline bug

### Root cause, found via raw-response capture (not guessed)

**All 13 of job `52336ff5`'s remaining `llm_omitted` entries come from groups of size exactly
1** — computed directly from the real persisted record (every enrichment entry grouped by its
owning node; all 13 owning groups have exactly 1 item). This alone ruled out "the model got
overwhelmed batching many items" as the mechanism.

Captured the **real, raw LLM response** (not the parsed/judged result) for the exact real prompt
one of these cases used:

```
requested id:  concept_d41d834b998bbab2073c5c67
raw response nodes key: "d41d834b998bbab2073c5c67"   (the "concept_" prefix stripped)
```

The model's answer was **complete and correct** — full `short_explanation`, `key_idea`,
`important_facts`, `relationships`, `memory_hint`, all genuinely about the right content. The
code's exact-match lookup (`raw_nodes.get(it.id)`) missed it purely because of the key string
mismatch. Re-tested 3 more real single-item cases the same way: **3/4 sampled cases reproduced
this exact mechanism** (the 4th case's exact id matched on that particular re-run — the model is
not perfectly deterministic even at `temperature=0.15`). Per the user's own instruction: reporting
this as **3/4 sampled**, not generalized to "most/all" without a full re-run.

**This is genuinely neither "model omission" (the content isn't missing) nor a "pipeline bug" in
the sense of incorrect logic (an exact-match lookup is a defensible, correct-by-its-own-contract
design) — it's a recoverable key-normalization mismatch.**

### Fix applied

**File changed**: `BE/services/mindmap/pipeline/enrich.py` — added `_resolve_response_key()`: try
the exact requested id first (always wins); if missing, try the SAME id with exactly one known,
fixed prefix (`"concept_"` — not a generic split-on-underscore, which could misfire on ids like
`h1`/`hm1` from other stages that don't have this pattern at all) stripped, accepting that
fallback **only if the stripped form is not itself one of the group's own other requested ids**
(a collision means it's a sibling's real answer, not this item's normalized form). The item's
`semantic_node_id` in the output is always the ORIGINAL requested id — the fallback only changes
where the code looks, never what the item is called downstream. Applied to both the first pass
and the retry pass (same resolution rule, since the mismatch is a real model behavior, not
specific to either call).

**Guardrails honored** (explicit user instruction before this fix): exact canonical transform
only, no fuzzy/substring/Levenshtein matching, no cross-group lookup, no duplicate assignment (a
`claimed_keys` set prevents two requested ids from both claiming the same stripped-form key),
never overwrites an existing exact match, stays `llm_omitted` (never fabricated) when ambiguous,
duplicate, or genuinely unmatched.

### Verification

- New tests: `BE/tests/test_mindmap_enrich_key_resolution.py` — **10/10 passed**: exact-key
  priority over stripped-form, stripped-key resolution, collision rejection (stripped form
  matching another real requested id), unknown-key/no-prefix rejection, no-fuzzy-matching,
  mixed exact+stripped in one group, two-ids-strip-to-same-key (only first claims it, never
  double-assigned), `semantic_node_id` stays the original id, retry-pass uses the same rule,
  and genuine-omission still correctly stays `llm_omitted`.
- `pytest tests/test_mindmap_enrich.py tests/test_adaptive_skeleton.py tests/
  test_enrichment_validation.py tests/test_node_grouping.py tests/test_intrablock_concepts.py
  tests/test_mindmap_enrich_key_resolution.py` — **92/92 passed**.
- **Real, targeted re-test of all 13 remaining cases** (reconstructed real single-item groups from
  the real persisted record and real chunk data, real Ollama `qwen2.5:7b-instruct` calls, the
  fixed function):

  | Outcome | Count | Detail |
  |---|---|---|
  | Got a completed response, and it resolved via the fix | **5 of 5 completed cases** | All 5 `enumerated_concept`-type items (short phrases: "intron", "polyadenyl hóa đầu 3'", "ba giai đoạn: khởi đầu", "kết thúc", "có hại") — 11.1s–27.9s each — confirmed via the raw-response mechanism (stripped-prefix key), not just "happened to work" |
  | Timed out (90s budget) before any response was received | **8 of 13** | All 8 `paragraph`-type items (longer input text) — this specific re-test window ran measurably slower on local Ollama than the original runs. **This is a confound, not a result**: these 8 never reached the point where the fix (or anything else) could act on them, so they provide no evidence either for or against the fix — marked inconclusive, not "still broken." Not comparable to the original run's timings. |

  **Honest conclusion, not overclaimed**: this is NOT a "5/13 recovery rate" — that framing would
  wrongly imply 13 comparable trials with a 38% success rate. It is 5 of 5 completed trials
  resolving via the fix (a real, if small, confirmation the mechanism works) and 8 trials that
  produced no result at all, for reasons unrelated to the fix. **Not claiming any specific final
  residual count without a real, uncontended, complete measurement.**

### Why this doesn't (yet) change the P0 numbers

Job `52336ff5`'s reported 13 remains 13 as the last FULL, authoritative end-to-end number — this
fix wasn't re-run through a complete regeneration this pass. The targeted re-test above is real
evidence the fix mechanism works on the cases it could actually reach, and separately, real
evidence that this specific re-test session's environment could not evaluate the rest — it is not
a revision of the authoritative 13 figure, and not a comparable before/after rate, until a real
full run confirms an actual new number.

**Update — that real full run happened.** See "Final Verification" immediately below Part 10 for
the complete, authoritative result: `MISSING_BY_ENRICHMENT` = 0, `hierarchy_violations` = 0, on a
clean, uncontended, complete real regeneration. The "true post-fix number" this section called for
is now measured, not projected.

---

## Final Verification — full real regeneration after the enrichment key-resolution fix

Run specifically to resolve the earlier partial re-test's timeout confound: a complete, real,
uncontended, authoritative end-to-end regeneration, same document (`qa_large_doc.txt`), same
model (`qwen2.5:7b-instruct`), same isolated local config, `force=true` (no cache hit) — job
`71083a43-0c3c-4e21-a9a0-8b64aa308999`.

**Real log output** (`[mindmap] enrichment metrics` / `[mindmap] quality report`, this session's
local server log):
```
enrichment metrics job=71083a43 node_preservation=100.0% hierarchy_preservation=100.0%
  items=51 ok=51 prompt_failures=0 json_failures=0 skipped=0 avg_latency_ms=9671.4
quality report job=71083a43 coverage=100.0% missing_concepts=0 hierarchy_violations=0
  sibling_merge_violations=0 avg_depth=3.47 avg_branching=1.82 collapsed_nodes=0
```

**Real persisted analytics record** (`mindmap_generation_reports.jsonl`, authoritative — this is
the exact same append-only file every earlier real run in this report family wrote to):
```json
{
  "node_count": 94, "coverage_pct": 100.0, "recovered_pct": 0.0,
  "still_unresolved_count": 0, "loss_reasons": {},
  "hierarchy_violations_count": 0, "semantic_groups": 27,
  "avg_depth": 3.47, "avg_branching_factor": 1.82,
  "branch_completeness_pct": 100.0, "generation_time_sec": 509.04
}
```

**Real persisted record's own generator block** — confirms the record itself is not marked
degraded at all: `{"degraded": false, "missing": [], "elapsed_sec": 509.0, "skeleton_method":
"headings"}`. Node count unchanged at 94 (hierarchy fully preserved). Direct count of degraded
enrichment entries across all 94 nodes' own `enrichment` lists: **0**.

**Before / after, across all three real runs on this document**:

| Run | Job | hierarchy_violations | MISSING_BY_ENRICHMENT | Generation time |
|---|---|---|---|---|
| Original audit (pre-fix) | `7f3702c1` | 8 | 17 | 1659.9 s |
| P0's heading_tree.py fix only | `52336ff5` | **0** | 13 | 598.7 s |
| P0.5's key-resolution fix, full regen | `71083a43` | **0** | **0** | 509.0 s |

**Both fixes are now closed with complete, real, uncontended evidence — on this document and
configuration.** Generation time also dropped further (509s vs. 598.7s vs. 1659.9s) — consistent
with fewer wasted retries as degradation dropped, though local-environment speed variance across
runs (noted throughout this report family) means this specific delta isn't claimed as solely
attributable to the fixes.

**What this does NOT establish**: this is still one document. The fixes' effect on documents with
different structure, size, or heading style is not measured — that is exactly what the still-
blocked ≥10-document benchmark would confirm. "Closed" above means closed for this run, not a
general claim about the pipeline across arbitrary real documents.

---

## Blocker #2 (P0.5 numbering) — Real dataset benchmark: still blocked, new evidence

**Still 1/10.** Four new real documents were prepared this sprint specifically for format/heading
diversity:

| Document | Format | Size | Heading style | Result |
|---|---|---|---|---|
| `rh_doc_small.txt` | TXT | Small | Plain numbered list, no markdown headings | Ingest failed |
| `rh_doc_medium.md` | Markdown | Medium (6 sections) | Numbered `#`/`##` headings | Ingest failed |
| `rh_doc_network.docx` | DOCX | Small (4 sections) | Real Word `Heading 1`/`Heading 2` styles (via `python-docx`) | Ingest failed |
| `rh_doc_database.pdf` | PDF | Small (4 sections) | Plain text, no structural markup (via `pymupdf`) | Ingest failed |

**All four failed identically**: `"dịch vụ embedding từ chối xác thực (HTTP 401)"` — the local
FPT embedding credential. This is the exact same failure this session hit earlier when trying a
second document (`docs/RELEASE_CANDIDATE_REPORT.md` Phase 3) — **confirmed reproducible across 5
separate attempts total this session**, on 5 different documents. No local embedding-model
fallback is available (checked: no embedding-capable model is pulled in the local Ollama
instance, and no config override path was found that doesn't require one). This was accepted as a
genuine infrastructure blocker rather than worked around by pulling a new model mid-sprint (a real
setup-time cost with uncertain payoff, per explicit user decision this sprint).

**These 4 documents are ready to run the moment local (or production) embedding credentials are
fixed** — no further preparation needed, just re-upload and generate.

---

## P0.5 — All files changed

- `BE/services/mindmap/pipeline/heading_tree.py` — (P0, unchanged this sprint)
- `BE/services/mindmap/pipeline/enrich.py` — (P0's retry fix, plus P0.5's `_resolve_response_key`
  key-mismatch fallback)
- `BE/services/summary/pipeline/summarize.py` — P0.5: per-section diagnostics (additive)
- `BE/services/summary/pipeline/diagnostics_store.py` — P0.5: new, diagnostics JSONL persistence
- `BE/app/clients/summary_factory.py` — P0.5: `diagnostics_sink` pass-through
- `BE/app/graphs/summary_graph.py` — P0.5: wires diagnostics through the graph, persists after
  the record; introspection-based kwarg passing to avoid breaking pipeline test doubles
- `BE/app/graphs/state.py` — P0.5: `section_diagnostics` added to `SummaryState` (required —
  LangGraph drops undeclared fields between nodes)
- `BE/tests/test_summary_instrumentation.py` — P0.5: new, 7 tests
- `BE/tests/test_mindmap_enrich_key_resolution.py` — P0.5: new, 10 tests

## Final verification pass — full regression + targeted suites

Re-run once more, after the full real regeneration above, as the final gate before any push
decision:

```
Full BE suite:   2370 passed, 21 failed (same pre-existing, unrelated
                 langchain_core.pydantic_v1 cause), 236 skipped
Mindmap tests:   258/258 passed (all test_mindmap*.py plus every reserved-tree
                 quality-instrumentation test file: branch_budget, branch_report,
                 coverage_analyzer, hierarchy_validator, loss_classifier,
                 missing_concepts, node_allocator, quality_report, recovery,
                 pipeline_consistency, adaptive_skeleton, enrichment_validation,
                 node_grouping, intrablock_concepts)
Summary tests:   146/146 passed (all test_summary*.py)
FE build:        clean (vite build succeeds, no code changed this sprint)
FE lint:         73 errors / 8 warnings — identical to the baseline recorded in
                 docs/FINAL_UI_REPORT.md; no FE file was touched this sprint
BE lint:         no lint tool is configured for BE in this repo (no ruff/flake8
                 config found) — nothing to run, not a gap introduced here
```

Stable and identical to every earlier pass in this report family. Zero regressions across all
three checkpoints (P0's fixes, P0.5's fixes, and this final verification run).

---

# Detailed Findings

*(Unchanged from the original engineering report — reproduced in full below for reviewers who want
the complete evidence trail behind Parts 1–10 above.)*

## Blocker #1 — Hierarchy violations (8→0) and MISSING_BY_ENRICHMENT (17→13)

### Root cause, hierarchy violations (8/8, all `level_inversion`)

**File**: `BE/services/mindmap/pipeline/heading_tree.py`, `build_heading_tree()`, the numbered-
ancestor synthesis loop (was line 113).

**Mechanism**: when a numbered heading segment (`"1.1 Màng tế bào"`) needs a missing intermediate
ancestor synthesized (the bare `"1"`), the old code computed that ancestor's `level` purely from
the NUMBER STRING's own dot-count (`anc.count(".") + 1`) — never looking at the level of the node
it was actually being grafted onto (`parent_id`). This is correct only when the numbered chain is
the very first thing in the document. `qa_large_doc.txt`'s real heading shape is `"Chương N: Title
> N.M Sub-heading"` — a non-numbered text heading (`"Chương 1: ..."`, level 1) immediately followed
by a numbered one. The synthesized `"1"` ancestor got level=1 too, colliding with its already-
level-1 parent — `hierarchy_validator.py`'s `level_inversion` check requires child level to be
EXACTLY parent level + 1. This reproduced identically on **every one of the 8 chapters** — fully
deterministic, not document-content noise.

**Evidence** (real run 7f3702c1, full violation list re-derived read-only from the persisted
record + real chunk data, see `docs/RELEASE_CANDIDATE_REPORT.md` Phase 4 for how):
```json
{"type": "level_inversion", "node_id": "h3", "node_level": 1, "parent_id": "h2", "parent_level": 1}
```
...one such entry per chapter (`h3/h9/h14/h19/h24/h29/h34/h39`), all identical in shape.

### Fix applied

**File changed**: `BE/services/mindmap/pipeline/heading_tree.py` — added a `by_id` dict (id →
node) alongside the existing `by_key` dict; changed the level computation for a newly-synthesized
numbered ancestor from `anc.count(".") + 1` to `(by_id[parent_id].level if parent_id else 0) + 1`
— i.e., always exactly the ACTUAL current parent's level + 1, regardless of whether that parent
came from a preceding non-numbered heading or from an earlier ancestor already cached within the
same numbered chain.

**First attempt was wrong, corrected before landing**: an initial fix used a per-segment
`base_level` captured once before the ancestor loop. That passed on `qa_large_doc.txt` (0
violations) but **broke `test_mindmap_golden_regression.py`'s small/medium/large fixtures**
(`level_skip` instead of `level_inversion`) — those fixtures use flat multi-segment numbering
(`"1 Chương 1 > 1.1 Mục 1.1"`, both segments numbered), where the second segment's first ancestor
is a cache-hit from the first segment; `base_level` double-counted that already-represented depth.
The by-id-lookup formula (final version) is correct under both shapes because it never guesses at
depth — it reads the real, current tree.

### Verification

- Real document (`qa_large_doc.txt` chunk data, re-run read-only against the fix):
  **`validate_hierarchy()` → 0 violations** (was 8).
- `pytest tests/test_hierarchy_validator.py tests/test_mindmap_skeleton.py
  tests/test_mindmap_graph.py tests/test_mindmap_golden_regression.py
  tests/test_mindmap_phase1_hierarchy.py tests/test_pipeline_consistency.py` — **39/39 passed**
  (including the golden regression fixtures the first attempt broke).
- Full real end-to-end regeneration (job `52336ff5`, same document, `force=true`): **`quality
  report job=52336ff5 ... hierarchy_violations=0`** — confirmed live in the actual pipeline, not
  just the isolated validator.
- Full BE suite (excluding the 9 pre-existing unrelated collection errors): **2353 passed / 21
  failed (same pre-existing cause, unaffected) / 236 skipped** — identical to the pre-fix baseline.

**Goal met: hierarchy violations 8 → 0, hierarchy unchanged (node count, parent structure
untouched — only `level` values corrected), coverage unchanged at 100%.**

### Root cause, MISSING_BY_ENRICHMENT (17 real entries)

**Not 17 missing nodes.** `enrich_branches()` mutates existing skeleton nodes in place and only
adds an `enrichment` list — node/hierarchy preservation was confirmed 100%/100% by
`enrichment_metrics` in both runs. Every one of the 17 nodes was present in the final tree; only
its own enrichment CONTENT was empty.

**File**: `BE/services/mindmap/pipeline/enrich.py`, `enrich_semantic_group()`. Per-item breakdown
of the original 17 (real data, from the persisted record's own `enrichment[].reason` field):

| Reason | Count | Mechanism |
|---|---|---|
| `llm_omitted` | 14 | LLM call succeeded, returned valid JSON, but the response's `nodes` dict simply didn't include an entry for that specific item id (a batched group call asks for several ids at once; the model can answer some and skip others) — `enrich.py:180-183` (pre-fix line numbers) |
| `llm_failed` | 2 | The call itself raised (connection reset / provider auth failure — local-environment confound, see `MINDMAP_QUALITY_AUDIT.md`) |
| `json_malformed` | 1 | Response wasn't valid/repairable JSON |

Full per-node table (node id / heading / parent / created_by / semantic type / reason) for all 17
is in `docs/MINDMAP_QUALITY_AUDIT.md`'s underlying data; reproduced in full in the terminal
transcript this sprint (all `created_by: "deterministic_extraction"`, `semantic_type` either
`"paragraph"` or `"enumerated_concept"`).

### Fix applied

**File changed**: `BE/services/mindmap/pipeline/enrich.py` — `enrich_semantic_group()`: after the
first pass, collect `omitted_ids` (items with no entry in the response). If non-empty, build a
**second, smaller `SemanticGroup`** containing only those ids, retry with the exact same prompt/
model/temperature contract (`_SYSTEM`, `_build_group_prompt`, same `ask_ai` call shape), **once**,
and merge any newly-successful entries back in — items still omitted after the retry keep their
original `llm_omitted` entry untouched. Added a small `_format_ok_entry()` helper (factored out of
duplicated dict-construction code, used by both the first pass and the retry pass). `llm_failed`
and `json_malformed` (whole-call failures) are **not** retried by this change — only per-item
omissions from an otherwise-successful call, per the authorized scope.

**Guardrails honored** (from explicit user instruction before this fix): retry receives only the
omitted item ids; bounded to exactly one retry; same prompt/model contract; results merged in
original group order (iterating `group.items`, not the retry response's order); items already `ok`
are never re-sent; a still-omitted item after retry keeps its original `llm_omitted` reason and
evidence, never fabricated as something else.

### Verification

- Unit tests: `pytest tests/test_mindmap_enrich.py tests/test_adaptive_skeleton.py
  tests/test_enrichment_validation.py tests/test_node_grouping.py
  tests/test_intrablock_concepts.py` — **82/82 passed**, including
  `test_llm_omitting_one_id_still_produces_an_entry_for_it` — its mock returns the identical
  response on every call, so the retry (now happening) omits the same id again, and the test still
  correctly asserts `reason == "llm_omitted"`: proof the retry never fabricates an entry when the
  model genuinely won't produce one.
- Real partial check (5 of the 17 original cases, real `enrich_semantic_group()` calls against
  reconstructed real groups from the actual chunk data, real Ollama `qwen2.5:7b-instruct`): **4/5
  fully recovered, 1/5 still `llm_omitted` after retry.**
- **Full real end-to-end regeneration (job `52336ff5`, authoritative, `force=true`, same document/
  model/config as the original audit)**:

  | Metric | Before (job `7f3702c1`) | After (job `52336ff5`) |
  |---|---|---|
  | Enrichment items | 51 | 51 |
  | `ok` | 34 | 38 |
  | `llm_failed` (top-level) | 2 | 0 |
  | `json_malformed` (top-level) | 1 | 0 |
  | Still degraded (`collapsed_nodes` / MISSING_BY_ENRICHMENT) | **17** | **13** |
  | Node/hierarchy preservation | 100.0% / 100.0% | 100.0% / 100.0% |
  | Coverage | 100.0% | 100.0% |
  | Node count | 94 | 94 |
  | Avg depth / branching | 3.47 / 1.82 | 3.47 / 1.82 (unchanged) |
  | `enrich_stage` time | 1,635,321.8 ms (27.3 min) | 583,941.7 ms (9.7 min) |
  | Total generation time | 1,659.9 s | 598.7 s |

  **All 13 remaining are `llm_omitted`.** Item-level comparison against the original 17: **4
  recovered** by the retry (the node that was `h1`'s paragraph, `h12`'s paragraph, and the 2 items
  that had been `llm_failed`/`json_malformed` last time — this run had zero top-level call
  failures at all, an environmental difference, not attributable to either fix). **1 new omission
  appeared** (`concept_c63cca776accc1a6bef30ac8`, a `definition_item` under
  `concept_7c1ee7b2aabafb277a8c614a`) that was NOT degraded in the original run — its sibling item
  boundary differs slightly between the two runs (old run had `concept_8ba523ae4d1cc86738d132be`,
  "với sự tham gia của nhiều yếu tố khởi đầu và kéo dài dịch mã"; this run split it differently,
  "ba giai đoạn: khởi đầu" as its own item). **This is an observed run-to-run variance in
  `deterministic_extraction`'s own item boundaries** (a reserved, untouched module) — flagged
  honestly as a separate, out-of-scope-for-this-sprint finding, not fixed or investigated further
  here. Net: 17 → 13 is the real, authoritative number; it is not a perfectly clean "these exact 4
  recovered, nothing else changed" comparison because of that one upstream variance.

  Full per-node evidence for the remaining 13 (node id / heading / parent / created_by / semantic
  type / reason — all `llm_omitted`):
  `concept_d41d834b998bbab2073c5c67`(h4), `concept_b925572046dc6bcf565a7a43`(h6),
  `concept_efbce64ecdd2614cafa9762e`(h10), `concept_d299fe53e421e8bcafffd7bd`(h30),
  `concept_daf40e3a5491ecca903a7295`(h31), `concept_a74e4dd3c3a571ef5552ed95`(h32),
  `concept_f276e4df43787390e0f7d9fe`(h37), `concept_f298140e79d7c952c34d248d`(h40),
  `concept_c5fd6624795900af609abc28`(parent `concept_cb9e9b5bd3c370b4b6f66c85`),
  `concept_cd48ebd6e31eca66fbf7e093`(parent `concept_9a196c0c567d8a7b7de9d64c`),
  `concept_c63cca776accc1a6bef30ac8`(parent `concept_7c1ee7b2aabafb277a8c614a`, new this run),
  `concept_e7ef71ca89d4e7a142ae4c7c`(parent `concept_7c1ee7b2aabafb277a8c614a`),
  `concept_b350df4c25b449699a764fa3`(parent `concept_f276e4df43787390e0f7d9fe`).

### Why MISSING_BY_ENRICHMENT cannot honestly be driven to exactly 0

The retry is, by explicit design and explicit user guardrail, **bounded to one attempt**. A small
local 7B model (`qwen2.5:7b-instruct`) omitting an item from a batched JSON response is a real,
observed model-completion-reliability limitation, not a code defect — the code already does
everything correct-by-construction (never raises, always produces an entry, retries once, reports
honestly). Reaching literal 0 would require either unlimited retries (directly against the
authorized guardrail) or a different/larger model (explicitly forbidden by this sprint's own DO
NOT list: "Do not increase model size"). **This target (0) is not reached; the reduction (17→13,
-23.5%) is real, evidenced, and the reason the remainder can't be eliminated is explained with
evidence, per this sprint's own stop-condition allowance.**

---

## Blocker #2 — Summary per-section diagnostics

**Not built this sprint.** This blocker's implementation (provider/tokens/status/fallback/
failure_reason/retry_count, per section, persisted) was not part of the two fixes explicitly
authorized this turn (heading_tree.py's level fix and enrich.py's retry-on-omit). Building it
means editing `BE/services/summary/pipeline/{sections,summarize}.py` — not on the explicit reserved
list by name, but both are actively "M" modified by the same in-flight Codex/BE workstream this
sprint's ownership boundary protects; touching them needs the same kind of explicit authorization
already used for Blocker #1, which wasn't given for this blocker. **Remains a real, named gap** —
see `docs/SUMMARIES_QUALITY.md` for the exact current state (binary missing/not-missing only, no
reason/token/timing granularity) and what a real fix would need to add.

---

## Blocker #3 — Real dataset benchmark (≥10 documents)

**Still 1 complete real document.** No additional documents were run this sprint — all wall-clock
budget went into the authorized Blocker #1 fixes and their real (not estimated) verification,
including the ~10-minute authoritative full regeneration. See `docs/RELEASE_CANDIDATE_REPORT.md`
Phase 3 for the original honest accounting of why (dead local embedding credentials blocked a
second document's ingest entirely). **This target is not met; not attempted further this sprint
by explicit scope (the user's own instructions for this turn were "run the full end-to-end
regeneration... Update docs/P0_BLOCKER_REPORT.md," not "expand the dataset").**

---

## Blocker #4 — UNKNOWN taxonomy (88.2%)

**No code change made or authorized. Root cause investigated and explained — but the stated
requirement (UNKNOWN < 5%) is still failed, and that is NOT resolved by this investigation.**
Jointly with the BE/Codex workstream: the 88.2% UNKNOWN is caused by a **taxonomy mismatch**, not
a classifier defect. The brief's requested 9-category taxonomy has no category that fits
`json_malformed` or `llm_omitted`/partial-omission (a real LLM response with some items missing,
which is neither `LLM_TIMEOUT` nor `TOKEN_LIMIT` nor `PROMPT_REFUSAL`) — forcing those into any of
the 9 would be exactly the "fabricated reason" this sprint's own rules forbid. The **reserved
taxonomy** (`loss_classifier.py::LossReason`) achieves **0% UNKNOWN** on the same real data because
it was built from the actual code paths, not guessed — but that demonstrates the reserved
taxonomy's own internal coherence, **not** that the brief's specific <5% requirement is satisfied.
Those are two different claims; only the first is proven here. Codex's own independent
investigation (relayed directly, same root-cause conclusion): "88.2% UNKNOWN không tự động là bug
của classifier... taxonomy mismatch/granularity limitation, không được map away UNKNOWN." **No
code change was made or is recommended — correctly, per this sprint's own "improve classification
ONLY if evidence exists" rule: the evidence says the classifier is fine. But "the classifier is
fine" is not the same statement as "the stated requirement is met," and this blocker's status
must reflect the latter: the 88.2%-vs-<5% requirement remains unresolved until a release owner
either accepts the reserved taxonomy as satisfying it, or formally waives the requirement.**

---

## Testing summary

| Suite | Result |
|---|---|
| `tests/test_hierarchy_validator.py` + 5 related mindmap files (39 tests) | 39/39 passed |
| `tests/test_mindmap_enrich.py` + 4 related enrich/grouping files (82 tests) | 82/82 passed |
| Full BE suite (excluding 9 pre-existing, unrelated `langchain_core.pydantic_v1` collection errors) | 2353 passed / 21 failed (same pre-existing cause) / 236 skipped — **identical to pre-fix baseline, zero regressions from either fix** |
| Real document generation (job `52336ff5`, authoritative, full end-to-end, `force=true`) | hierarchy_violations 0, coverage 100%, node count 94 (unchanged), MISSING_BY_ENRICHMENT 17→13 |
| Golden regression fixtures (small/medium/large) | 0 hierarchy diagnostics, as asserted — this is what the first (wrong) fix attempt broke and the corrected fix passes |

**Verified**: hierarchy preserved (node count, parent structure, ids all unchanged — only `level`
values corrected), coverage unchanged (100%→100%), zero new regressions.
**Not verified**: zero enrichment loss (13 remain, explained above with evidence).

---

## Files changed

- `BE/services/mindmap/pipeline/heading_tree.py` — level computation for synthesized numbered
  ancestors, now relative to actual parent level (`by_id` lookup) instead of the number string's
  own dot-count.
- `BE/services/mindmap/pipeline/enrich.py` — `enrich_semantic_group()`: bounded single retry for
  per-item `llm_omitted` entries only; added `_format_ok_entry()` helper.

Both are reserved-workstream files; both edits were made only after explicit, specific user
authorization for each, with Codex notified before either edit began and confirming no active
mid-edit conflict.

## Remaining risks — narrative detail

1. **MISSING_BY_ENRICHMENT is 13, not 0** — a real, evidenced, model-completion-reliability limit
   under the authorized retry-once guardrail, not something further code changes (within this
   sprint's DO NOT list) can close.
2. **Observed non-determinism in `deterministic_extraction`'s item boundaries** across two runs of
   the identical document (the "khởi đầu" item split differently) — not investigated or fixed
   (reserved module, out of authorized scope this sprint); worth a dedicated look.
3. **Summary instrumentation (Blocker #2) and the ≥10-document benchmark (Blocker #3) remain
   unmet** — both real, named gaps, not attempted this sprint by explicit scope.
4. **This run's environment (dead local FPT/Gemini keys) still confounds absolute numbers** — the
   598.7s vs. 1659.9s generation-time difference is *mostly* the absence of connection drops/auth
   failures this run, not proven to be the fixes' own doing; the hierarchy_violations and
   MISSING_BY_ENRICHMENT deltas ARE directly attributable to the two fixes (confirmed via the
   isolated read-only re-derivation before the full run, not just the full run's own numbers).
5. **Production has neither fix** — both live only in this uncommitted local working tree.

No commit. No push. No merge.
