# Final Release Status — Release Blocker Sprint P0 / P0.5

**Engineering Status: READY FOR REVIEW**

**Release Status: BLOCKED BY**
- Infrastructure (local FPT embedding credential outage)
- Owner decision (UNKNOWN-taxonomy external contract)

---

## What happened this pass

The engineering work is done and verified. Two commits were made and pushed to a **new feature
branch** (`release/p0-p0.5-verification`, pushed to `origin/release/p0-p0.5-verification`) — **not
to `main`**. No PR was opened, nothing was merged, nothing was marked production-ready.

**Branch choice, not a deviation**: this repo's `render.yaml` auto-deploys both the BE (`studymap-
api`) and FE (`studymap-web`) production services on any push to `main`. A "branch-only, no
release" push onto `main` itself would not actually be branch-scoped in this repo — it would
trigger a real production redeploy. Flagged to the user mid-task; explicit choice made to push a
new branch instead, so this stays genuinely reversible and non-production-affecting.

## What got committed — and what deliberately didn't

Two of the four suggested commit groupings shipped. The other two did not, for a specific,
evidenced reason discovered while auditing the diffs before staging anything:

| Suggested commit | Shipped? | Why |
|---|---|---|
| `docs(release): P0 verification reports` | **Yes** — `f08313c` | Fully self-contained, no shared ownership |
| `feat(summary): diagnostics instrumentation` | **Yes** — `e844f76` | Every file audited line-by-line; confirmed 100% this sprint's own work, zero entanglement with any other in-progress change |
| `feat(mindmap): hierarchy fixes` | **No** | `heading_tree.py` is untracked and ~92% authored by a separate, concurrent, in-progress workstream (the reserved MindMap quality-instrumentation tree) — my fix is a small patch inside a much larger file I don't own |
| `feat(mindmap): enrichment retry + key resolution` | **No** | `enrich.py`'s diff is 312 insertions/116 deletions; my retry + key-resolution fix is maybe 80 of those lines, genuinely dependent on that same workstream's own Phase 2B rewrite (the fix calls `SemanticGroup`/`SemanticItem`/`_build_group_prompt` — all part of that rewrite, not separable from it) |

This was checked directly with the owner of that other workstream (via this session's Codex
collaboration) before deciding: **explicitly not approved to ship as-is**. Their read matched
mine — shipping either file whole would push a large, separately-uncommitted rewrite to a shared
remote branch under cover of "just a small verified fix," which neither of us was willing to do
without that workstream's own review.

**One exception, handled precisely**: `BE/app/graphs/state.py` had two unrelated hunks mixed in
one file — my one-line `SummaryState` addition, and a six-line `MindmapState` addition from the
other workstream. Extracted with a hand-built patch (`git apply --cached`) so only my hunk is in
`e844f76`; the `MindmapState` hunk is untouched, still sitting in the working tree for its own
author to commit separately.

**Net effect**: the hierarchy and enrichment fixes are real, complete, and verified (see below) —
they are just not yet committable in isolation without either shipping someone else's unreviewed
work alongside them, or that work being reviewed and committed first. This is a packaging/
ownership constraint, not a defect in the fixes themselves.

## Commits on `release/p0-p0.5-verification`

```
f08313c docs(release): P0 verification reports
e844f76 feat(summary): per-section diagnostics instrumentation
```
(both on top of `dba5665`, the current tip of `origin/main`)

## Final pre-push verification (all green)

```
FE build:      clean
FE lint:       73 errors / 8 warnings — unchanged baseline, no FE file touched
BE full suite: 2370 passed / 21 failed (same pre-existing, unrelated
               langchain_core.pydantic_v1 cause) / 236 skipped
```

Identical to every earlier checkpoint this sprint — no regressions introduced by either commit.

---

## Blocker status (all six)

| # | Blocker | Status | Evidence |
|---|---|---|---|
| 1 | Hierarchy | **Engineering: CLOSED** (verified, not yet shippable in isolation) | Real, complete regeneration (job `71083a43`): 0 hierarchy violations, 94 nodes preserved |
| 2 | Enrichment loss | **Engineering: CLOSED** (verified, not yet shippable in isolation) | Same run: 51/51 items `ok`, 0 degraded, `MISSING_BY_ENRICHMENT` = 0 |
| 3 | Summary diagnostics | **CLOSED and shipped** (`e844f76`) | 9/9 sections verified on a real run; 53 tests pass |
| 4 | UNKNOWN taxonomy | **OPEN — needs an owner decision** | Internal pipeline taxonomy: 0% UNKNOWN on every real run measured. The brief's external 9-category taxonomy, applied to the same real cases, still projects to 88.2% and still fails the stated <5%. Whether internal coherence substitutes for the external contract isn't an engineering call |
| 5 | ≥10-document benchmark | **OPEN — infrastructure blocker** | Still 1/10. 4 real documents prepared and ready; ingest fails on the local FPT embedding credential — 6 failed attempts total this session, identical `HTTP 401` every time |
| 6 | Deployment (to production) | **OPEN, downstream of #4/#5** | Nothing has been merged or deployed; this pass's push was to an isolated feature branch specifically to avoid triggering `render.yaml`'s auto-deploy |

---

## Exact next actions before release

1. **Fix or replace the FPT embedding credential** (or confirm production's own credential differs
   — never checked, this session had no access to it). The 4 prepared documents (`rh_doc_small.txt`,
   `rh_doc_medium.md`, `rh_doc_network.docx`, `rh_doc_database.pdf`) are ready to upload immediately
   once it works.
2. **Run the ≥10-document benchmark for real** — those 4 plus at least 5 more real, varied
   documents, collecting generation time / coverage / node count / hierarchy violations / summary
   completeness / warnings per document, per the original brief.
3. **Get an explicit owner decision on the UNKNOWN-taxonomy question.** A one-conversation
   decision, not more engineering work.
4. **Get the other workstream's hierarchy_tree.py / enrich.py changes reviewed and committed** (by
   its own author) — once that lands, this session's small fixes on top of it become trivially
   committable and can be added to the same branch or a follow-up one.
5. **Once all of the above land**, open a PR from `release/p0-p0.5-verification` (or its successor)
   into `main` for actual review — this status file does not do that, by design.

No merge was performed. No release was created. Nothing was marked production ready.
