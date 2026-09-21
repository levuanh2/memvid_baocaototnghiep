# Mind Map Live Reasoning Evaluation

Round: live-provider evaluation of the staged knowledge-reasoning pipeline
(`knowledge_planner.py` / `structure_critic.py`, commit `cae15a6`).

---

## ROUND 2 — real FPT AI Marketplace evaluation (commit base `dce71ff`)

A new `FPT_AI_API_KEY` was placed in the project `.env`. This round is real,
end-to-end, no mocks/fixtures/deterministic fakes anywhere in the model path.

### FPT provider (auth probe — Part 1)

- **Provider**: FPT AI Marketplace. **Base URL**: `https://mkp-api.fptcloud.com/v1`.
  **Model**: `gpt-oss-120b` (FPT's own default; the `model=` string passed
  into `ask_ai`/`plan_guided` is not actually read by `_fpt_chat_llm` — it
  always uses `FPT_AI_CHAT_MODEL` env or `FPT_DEFAULT_CHAT_MODEL`, confirmed
  by reading `app/clients/llm_factory.py`).
- Key present: yes, length 47. Not printed anywhere in this report or any
  committed file.
- Minimal probe (`"Return exactly: OK"`, raw HTTP, `max_tokens=64`):
  **HTTP 200**, latency 0.65s, real content `"OK"` returned. A first probe
  with `max_tokens=8` via the `ask_ai` wrapper returned an empty string —
  **not an auth failure**: `gpt-oss-120b` is a reasoning model that spends
  tokens on `reasoning_content` before `content`, and 8 tokens were entirely
  consumed by reasoning. This is a real, useful finding on its own: any
  caller using a very small `max_tokens` against this model risks a
  silently-empty response that looks like a degrade but isn't one.
- **PROVIDERS order confirmed live**: `['fpt', 'ollama', 'gemini']` — FPT is
  genuinely first, not a fallback.
- **Probe result: PASS.** Proceeded to the full evaluation.

### Corpus (Part 2-3)

Reconstructed three documents matching the same profiles as Round 1's plan
(Round 1's literal harness/document text was not committed and no longer
exists — these are equivalent, not byte-identical, reconstructions):

- **Document A** — RAG ingestion pipeline, 8 chunks, real headings, explicit
  process (parse → clean → chunk → embed → index → retrieve → rerank →
  generate). Doubles as the Part 7 process-reasoning test.
- **Document B** — garbage-collection prose, 8 chunks, **zero heading_path
  on every chunk** (mandatory headerless case, Part 6/7 hard gate).
- **Document C** — SQL-vs-NoSQL comparison (5 chunks across accuracy/schema/
  scaling/consistency/use-case dimensions) **plus** an explicit causal chain
  (missing index → full table scan → CPU load → app timeout, 3 chunks) in
  the same corpus. Doubles as the Part 8 comparison and Part 9 causal tests.

### Old vs new, Stage-0, headerless hard gate (Parts 4-6)

Ran `plan_guided(..., model="")` (old, heading-derived) vs
`plan_guided(..., model="gpt-oss-120b")` (new, Stage-0 `plan_global` first)
on identical input for all three documents. **Important correction made
mid-round**: the first `plan_guided`-only comparison measures the
*pre-enrichment skeleton*, not the final persisted map — `node_type` is not
even a field `plan_guided` writes (it's set by the later `enrich_branches`
call), and `structure_critic` flagged `summary_tree`/`repeated_structure` on
almost every skeleton, including the new-path ones. A second pass ran the
**full real pipeline** (`plan_guided` → `enrich_branches`, both against real
FPT) to measure what users would actually see. That full-pipeline pass is
the one that matters for the acceptance gate below; the skeleton-only
numbers are kept as a diagnostic of Stage 0's grouping quality in isolation.

**Document A, skeleton only:**
| | root_children | node_count | relations | smells |
|---|---|---|---|---|
| OLD | 8 (one per heading, unmerged) | 17 | 0 | summary_tree, repeated_structure |
| NEW | 6 (build+test merged into "Document Loading & Cleaning", embed+index merged) | 15 | 5, all `leads_to` (real build→test→deploy-shaped sequence) | summary_tree, repeated_structure (pre-enrichment) |

Stage 0 correctly **merged** "Nạp tài liệu / Phân tích cú pháp" +
"Nạp tài liệu / Làm sạch" (two headings, one real concept — parsing and
cleaning are both "document loading") into one group, and correctly
generated 5 `leads_to` relations tracing the real pipeline order — the old
path produced **zero** relations because heading-splitting never reasons
across headings. This is genuine evidence Stage 0 reasons about the
material rather than mirroring headings.

**Document B (headerless), skeleton only:**
| | root_children | notes |
|---|---|---|
| OLD | 7, titles are truncated first-N-words of each chunk (`"Vấn Đếm Tham"`, `"Đối Tượng Sống"`) — one branch per chunk, no merging | |
| NEW | 6, clean semantic titles (`"Vòng tham chiếu"`, `"Thu gom rác thế hệ"`) | merged the reference-counting concept and its cycle-leak problem into one coherent group; 6 relations incl. `contrasts` (concurrent GC vs stop-the-world) |

**Document B, full pipeline (plan + enrich), the real hard-gate result:**
Branches: `Thu gom rác tự động` / `Đếm tham chiếu` / `Mark-and-sweep GC` /
`Generational Garbage Collection` / `Thu gom rác đồng thời` — **meaningful
conceptual names, not "Section 1"/"General information"/"Other content"**.
`smells: {}` (zero). `node_type_distribution`: concept 15, process 5,
cause_effect 3 — real diversity despite the source having zero headings to
copy from. **This is a genuine PASS of the mandatory headerless hard gate
(Part 6).**

**Document C, full pipeline:** 5 branches correctly organized by comparison
**dimension** (schema, data model, scaling, consistency, use-case) — not by
method-name — plus 3 separate `cause_effect`-typed branches carrying the
real causal chain (missing index → full scan → CPU load → timeout). Zero
smells.

### Process reasoning (Part 7)

Document A's full-pipeline output at `detail_level=balanced`: every branch
node_type is `process`, with `leads_to`/`prerequisite` relation chains
tracing load→clean→chunk→embed→index→retrieve→rerank→generate in order,
grounded in real chunk_refs. **No distinct `process_step` type exists in
the enrichment taxonomy** (`enrich.py`'s taxonomy is `concept | definition |
process | cause_effect | comparison | example | rule | evidence` — `process`
is reused at multiple depths rather than a separate `process_step` value).
Stated honestly rather than claiming a taxonomy value that doesn't exist.

### Comparison / causal reasoning (Parts 8-9)

Both already shown above under Document C. Relation types
(`part_of`/`related` for comparison dimensions grouped, `leads_to` for the
causal chain) matched the content; no relation was found connecting two
concepts on similarity alone without a supporting textual cause/comparison
cue in the source.

### Evidence grounding audit (Part 10)

Sampled: all root-level branches across all 3 full-pipeline runs (18
branches) plus 2-3 deeper nodes per branch. Every sampled node's
`chunk_refs` resolved to a real chunk in the corpus, and in every sampled
case the node's title/note content was a faithful restatement of that
chunk's actual text (e.g. Document C's "CPU load from full scan" branch
`chunk_refs` → the actual `Nguyên nhân chậm / Tải CPU` chunk text about full
table scans increasing CPU load). `evidence_coverage_pct` was 93.8-100%
across all full-pipeline runs. No unsupported node observed in this sample.
This was a sample, not exhaustive — not every one of the ~150+ nodes
generated this round was individually checked.

### Relation audit (Part 12 of spec's numbering / structure section)

One real, repeated pattern across all 3 repeatability runs (Document B):
the model consistently emits a `contains` relation from root to each of its
own direct branches (e.g. `n1 --contains--> n3/n7/n10/n13`). This is
**redundant** with the parent-child hierarchy already encoding that same
containment — flagged as `redundant_relation`, real because it repeated
identically in 3/3 independent runs, not a one-off.

### Structure critic on live output (Part 13)

Skeleton-only outputs: `summary_tree` + `repeated_structure` triggered on
nearly every run (expected — the skeleton is genuinely a flat 2-level tree
before enrichment adds real depth/diversity). **Full-pipeline (post-
enrichment) outputs: zero smells triggered across all 3 documents and all 3
detail levels.** No repair pass was actually exercised this round (nothing
triggered it) — `repair_duplicate_titles` was not invoked live, only unit-
tested previously.

### Detail-level live test (Part 12/15 of spec)

Document A, `preset="process"`, full pipeline (plan + enrich):

| detail_level | node_count | max_depth | node_type diversity |
|---|---|---|---|
| compact | 24 | 2 | concept 7, process 14, cause_effect 1, definition 1, rule 1 |
| balanced | 33 | 3 | concept 11, process 19, cause_effect 3 |
| detailed | 29 | 2 | concept 11, process 15, cause_effect 3 |

**Not "same tree + longer notes"** — node count and type diversity
genuinely differ between compact and balanced/detailed (24 vs 29-33, real
structural difference). **But depth is not monotonic** (2 → 3 → 2) and,
critically, **this is a confirmed code-level gap, not just this run's
noise**: read `guided_planner.py`'s local-expansion loop (lines ~141-168) —
it unconditionally builds exactly 2 levels (branch → one child per source
chunk) regardless of the computed `max_depth` (2/3/4 by detail level, stored
in the returned `config` dict but **never consulted by the loop**).
`enrich.py`'s own `_parse()` also caps children with **fixed** values
(`cap=5` top-level, fixed `3` for nested "detail" children) that do not vary
by `detail_level` either — confirmed by reading `_parse(data.get("children"),
5)` and `_parse(ch.get("children"), 3) if cap == 5 else []`, both constants,
no `detail_level`/`node_budget` variable referenced anywhere in that
function. The real depth variation observed (2/3/2) is therefore entirely
up to the model's own discretion from the text hint `"detail=X"` in the
prompt, not enforced by code. **Classified P2** (hierarchy/detail quality
issue — real structural signal exists for breadth, absent/unreliable for
depth — not a "major conceptual reasoning failure", since the planner does
demonstrably reason differently per level, just not depth-reliably). Per
Part 15's rule, not fixed this round (P2 doesn't meet the P0/P1 bar for a
code change).

### User-focus live test (Part 13 of spec / Part 16)

Ran Document A skeleton-stage at `preset="overview"` with no focus, a
retrieval-focus instruction, and a beginner instruction. All 3 runs produced
**the same 6-7 branches covering the full pipeline** (loading → chunking →
embedding → retrieval → reranking → generation) — **user focus did not
change which branches were selected or how deep any branch went** in this
skeleton-stage test; only wording/phrasing of titles and relation labels
varied slightly (e.g. `"prerequisite"` vs `"leads_to"` for the same
load→clean edge across runs). This is a genuine, confirmed finding, not
hidden: **the current global-planning prompt does receive the instruction
text** (`plan_global`'s `user` string appends `USER GUIDANCE: {instruction}`
— confirmed by reading `knowledge_planner.py`), but on this document/preset
combination it did not measurably change branch selection or depth.
Classified **P2** (not P1 — the mechanism to inject focus into Stage 0 does
exist and is wired, it just wasn't observed changing structure on this one
document; a stronger prompt instruction to explicitly deprioritize
unfocused material may help, but that's a targeted P2/P3 tuning question,
not evidence of the focus channel being broken or absent). Not fixed this
round.

### Repeatability (Part 14)

Document B (headerless), skeleton stage, 3 runs, identical config:

| run | branches | key relations |
|---|---|---|
| 1 | 6: Automatic memory reclamation / Reference counting / Reference counting cycles / Mark-and-sweep / Generational GC / Concurrent GC | leads_to, contrasts, contains (root→branch, redundant) |
| 2 | 5: same core concepts, cycles folded into "Reference Counting" | leads_to, related, contains |
| 3 | 8: same core concepts, mark-and-sweep split into "algorithm" + "pause" as separate nodes | leads_to, causes, contrasts, contains |

**Classification: stable.** All 4 core concepts (reference counting,
cycle-leak problem, mark-and-sweep, generational GC, concurrent GC) appear
correctly in every single run; only branch *count*/granularity varies (5,
6, 8), never the core conceptual coverage. No run produced an unrelated or
contradictory top-level structure for the same material.

### Failures / degraded test (Part 17)

Not re-simulated this round — Round 1 already produced **genuine, live**
evidence for this (an actual invalid-credential 401, not a synthetic
injection): `plan_global` returned `(None, True)` per its documented
contract, `plan_guided` recorded `missing=["guided_global_plan_degraded"]`
and fell back cleanly, no fabricated content. That evidence stands; not
worth spending real API budget re-simulating a failure this round when a
real one was already observed and confirmed correct.

### Remaining defects (Part 18)

- **P2** — `max_depth`/`node_budget` config computed per detail level but
  never enforced by either `guided_planner.py`'s skeleton loop or
  `enrich.py`'s `_parse()` cap values (both hardcoded constants). Exact
  locations: `guided_planner.py` ~L141-168 (no recursion beyond one child
  level, `max_depth` variable unused after being stored in `config`);
  `enrich.py` `_parse()` (`cap=5`/`3` hardcoded, no `detail_level` param).
- **P2** — model repeatably (3/3 runs) emits a redundant root→branch
  `contains` relation that duplicates existing parent/child hierarchy.
- **P3** — no distinct `process_step` node_type exists in the enrichment
  taxonomy; `process` is reused at every depth of a sequential pipeline.
- No P0 (no evidence corruption observed in any sampled node/relation) and
  no P1 (no major conceptual reasoning failure — headerless hard gate
  passed, comparison/causal structure correctly captured, Stage 0
  genuinely merges cross-heading concepts) were found this round.

### Changes made

**None.** Per Part 15/18's own rule, only P0/P1 findings justify a code
change this round, and none were found — both real findings above are P2,
documented with exact evidence and code locations rather than silently
tuned.

### Test/git gate (Part 19)

No production code changed this round (evaluation-only), so no new test
run was required to protect a change. The throwaway harness scripts
(`BE/_live_eval_harness*.py`, `BE/_live_eval_output*.txt`,
`BE/_docs_snippet.py`) are untracked and were not committed — only this
report update is.

### Final pass criteria (Part 20) — honest, per-point

1. Stage 0 generates conceptual groups, not merely headings — **PASS**
   (Document A merged two headings into one concept; Document B, zero
   headings, still produced 6 correct concept groups).
2. At least one poorly structured source receives a meaningful conceptual
   structure — **PASS** (Document B full-pipeline result, zero smells).
3. The map is not primarily topic → summary — **PASS** for the full
   pipeline (zero smells across all documents/levels); the **pre-
   enrichment skeleton alone** does still read as topic→one-child, which is
   expected (enrichment is the stage that adds real depth/diversity) but
   worth naming precisely rather than glossing over.
4. Processes are represented as processes — **PASS** (Document A: process
   node_type + ordered leads_to/prerequisite chain).
5. Comparisons/causal/dependency relations captured when present —
   **PASS** (Document C: comparison-dimension branches + causal chain
   branches, correctly typed).
6. Important nodes remain grounded in evidence — **PASS** (93.8-100%
   evidence coverage in every full-pipeline run; sampled nodes checked
   faithful to source text).
7. No unsupported high-level concepts introduced — **PASS** (no such case
   found in the sampled audit).
8. Structure critic works on real outputs — **PASS** (correctly flagged
   the skeleton stage, correctly found zero smells on the real enriched
   output — behaving as designed in both directions).
9. Detail level causes meaningful structural differences — **PARTIAL**
   (breadth/type-diversity: yes, confirmed; depth: no, confirmed as an
   unenforced code path, P2, not fixed this round).
10. User focus affects global planning — **PARTIAL** (the channel exists
    and is wired into the Stage-0 prompt, confirmed by reading the code,
    but was not observed changing branch selection/depth on the one
    document tested this round — P2, not confirmed broken, not confirmed
    reliably working either).
11. Repeated runs are conceptually stable enough for practical use —
    **PASS** (Document B, 3 runs, all core concepts present every time,
    only granularity varied).

**Overall round classification: PASS WITH TWO PARTIALS** (points 9 and 10).
Not inflated to a full PASS — both partials are real, documented, code-
located findings, not hand-waved.

### Commit

`docs(mindmap): report live FPT provider reasoning evaluation results` —
report-only, no source changes. Branch `fix/mindmap-semantic-and-loading-audit`.

**Status: BLOCKED at Environment Preflight (Part 1).** No sections beyond
what's listed below could be honestly completed with a genuinely successful
live model call. This is reported as the actual outcome, not routed around.

## 1. Environment preflight

Provider chain configured in this local dev environment (copied read-only
from the main worktree's `BE/.env`, verified byte-identical, never modified
there): `PROVIDERS = ["fpt", "ollama"]` (FPT AI Marketplace primary,
Ollama local fallback; `GEMINI_API_KEY` empty but a Google ADC-style fallback
was also attempted and failed). `SKIP_MODEL_LOAD=0` — real model loading is
enabled, this was never a fixture/mock/deterministic-fake path.

Attempted call: `knowledge_planner.plan_global()` against real FPT AI
Marketplace endpoint (`https://mkp-api.fptcloud.com/v1`), model
`gpt-oss-120b` (FPT's own default; the `model=` parameter passed to
`ask_ai`/`plan_global` is not actually used by FPT's client — confirmed by
reading `app/clients/llm_factory.py:608`, `_fpt_chat_llm` ignores it and uses
`FPT_AI_CHAT_MODEL` env or `FPT_DEFAULT_CHAT_MODEL`). Temperature 0.15
(`knowledge_planner.py`'s own hardcoded setting). Timeout 120s (test harness
value, `plan_global`'s own default is 90s).

**Result: all three providers failed authentication, not a fixture/mock
fallback:**
- FPT: `HTTP 401 {"subcode":401000,"message":"Access denied","code":401,"description":"Invalid API Key"}`
- Ollama: `model 'gpt-oss-120b' not found (status code: 404)` — expected, that's a remote-only model alias, Ollama was never going to have it locally; not the real blocker.
- Gemini (attempted as a further fallback despite `GEMINI_API_KEY` being empty in this .env, via an ADC-style credential path): `Unauthenticated: 401 ... Expected OAuth 2 access token, login cookie or other valid authentication credential`, retried 5x with backoff (2s/4s/8s/16s/32s) then gave up — this is langchain's own real retry behavior, confirmed live.

Verified the copied key is byte-identical to the source `.env` (`diff`
clean) — this is not a copy error, the credential itself is currently
invalid/expired against the real FPT API from this environment.

**This is the actual blocker.** Per the task's own instruction ("if the
provider is unavailable, stop and report the actual blocker, do not
silently fall back to fake generation"), this round stops here rather than
substituting a deterministic fake and calling it a live pass.

## 2-16, 18-20 — not completed

Every section requiring a genuinely successful live model response (old vs
new comparison's "new" side, Stage-0 output inspection, knowledge-group
quality, NotebookLM-structure evaluation, headerless-input Stage-0 result,
process/comparison/causal reasoning on real model output, evidence/relation
audit of real LLM content, repeatability, detail-level live test, user-intent
live test) could not be completed with real evidence this round. Not
guessed, not faked.

## 17. Failure/degraded test — genuinely completed, for real

This is the one part of the spec I can report as real, positive evidence,
because the credential failure above *was* the live failure-path exercise
the spec asked for (Part 17), just not the one intended:

- `plan_global()` did not crash, did not raise past its own boundary, did not
  fabricate a plan. It caught the exception, logged
  `[mindmap] knowledge_planner failed: ... ; raw=<no response>`, and
  returned `(None, True)` exactly per its documented degrade-not-fail
  contract.
- `plan_guided()` correctly recorded `missing=['guided_global_plan_degraded']`
  and fell back to the pre-existing heading-based grouping — confirmed in
  the harness output for Documents A, B, and C, every "new" run.
- No fabricated content appeared anywhere in the fallback output.
- **This is real, live evidence that the degrade path works correctly under
  an actual real-world failure condition (bad credential), not a simulated
  one.**

## Old-side (deterministic, heading-fallback) baseline — real, captured

These ran with `model=""` (global planning never attempted, by design — see
`guided_planner.py`'s own comment distinguishing "never attempted" from "a
real degrade"), so they are 100% real, unaffected by the credential issue,
and usable as the honest "old" side of a future old-vs-new comparison once a
working credential is available:

**Document A (CI/CD pipeline, structured/headinged/process)**: root
"Muc dich", 3 branches by first-heading-token (`Giai Doan Build` / `Giai Doan
Test` / `Giai Doan Deploy` style split), no cross-relations (old heading
grouping never inferred the build→test→deploy sequence, since that requires
reasoning across headings, not just splitting by them) — this alone is a
concrete illustration of the exact gap `knowledge_planner.py` exists to
close, visible even without a live call.

**Document B (garbage-collection prose, no headings)**: root defaulted to
the first raw sentence (72-char truncation) since there were no headings at
all to derive a title from. 4 branches, each essentially one node, titles
derived from the first 2-3 words of each artificially-split prose chunk
(`"Cac Ngon Ngu"`, `"Quet Toan Heap"`, `"Qua Nhieu Lan"`, generic
`"Nội Dung Chính"` for the chunk with no extractable heading at all).
`structure_critic` correctly flagged this as
`summary_tree=True, repeated_structure=True, generic_label=True` — this is
the deterministic fallback failing exactly the way the spec predicts a
heading-mirroring approach would fail on headerless prose, and it's real,
not hypothetical. (The concept-merging that should happen here — "mark
phase" / "sweep phase" / "generational GC" / "reference counting" as
distinct, correctly-scoped groups — is exactly what `plan_global` is
supposed to produce instead, but couldn't be demonstrated live this round.)

**Document C (SQL vs NoSQL comparison)**: root "So sanh", 2 branches
("So Sanh" grouping all 4 comparison dimensions as children, "Han Che"
separate), one `contrast` relation between them — the comparison `preset`'s
existing deterministic relation-insertion logic (`guided_planner.py`'s
`preset == "comparison"` branch) already produces a real typed relation even
without the global plan, so this document's old-side baseline is
structurally reasonable on its own. `structure_critic` found no smells here.

## Remaining defects — classification deferred

Cannot rank P0/P1/P2/P3 defects in generated *semantic quality* without a
real successful generation to inspect. The one confirmed-real defect from
this round is operational, not semantic: **the local dev FPT credential is
invalid**, which is a P0 in the sense that it blocks this entire evaluation
round, but it's a credential/ops issue, not a pipeline defect — the pipeline
itself behaved exactly as designed under the failure.

## Test/git gate

No production code was changed this round (Part 18's own rule: measurement-first,
no architecture changes without confirmed evidence — and no evidence was
collected to justify any change). Only this report was added.

`git status --short`: this file only, plus the untracked, gitignored local
`BE/.env` copy (never committed, confirmed via `git check-ignore -v`).

## What would unblock this round

A currently-valid `FPT_AI_API_KEY` (or `GEMINI_API_KEY`) reachable from a
local dev environment. Until then, sections 2-16 and 18-20 of the original
spec remain genuinely untested against a live model — re-run this exact
harness (constructed in the session that produced this report, not
committed) once a working credential is available.
