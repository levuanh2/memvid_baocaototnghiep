# Mind Map Live Reasoning Evaluation

Round: live-provider evaluation of the staged knowledge-reasoning pipeline
(`knowledge_planner.py` / `structure_critic.py`, commit `cae15a6`).

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
