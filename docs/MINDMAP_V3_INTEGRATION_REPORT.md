# Mind Map V3 — Integration Report

## Correction to the task premise

The originating instructions assumed "PR #16" (`release/guided-mindmap-v3-aws` →
`main`) was still open. It is not: **PR #16 was already merged into `main`**
before this task began, confirmed directly from Git, not assumed:

```
$ git rev-parse origin/main
5b5d2bf...
$ git log --oneline origin/main -1
5b5d2bf Merge pull request #16 from levuanh2/release/guided-mindmap-v3-aws
$ git merge-base --is-ancestor origin/release/guided-mindmap-v3-aws origin/main
$ echo $?
0   # true — release branch IS an ancestor of main
```

`release/guided-mindmap-v3-aws` is therefore closed/stale — fully subsumed by
`main`. It was **not** touched by this task (not pushed to, not merged again).
The real integration target throughout this report is **`main` directly**.

## 1. Branch ancestry (established from Git, not inferred)

```
main                                    5b5d2bf (has PR #16's merge commit)
release/guided-mindmap-v3-aws           878e068 (stale, subsumed by main)
fix/mindmap-semantic-and-loading-audit  08d6168

merge-base(main, release)                    = 878e068
merge-base(main, fix)                        = 878e068
merge-base(release, fix)                     = 878e068

main..release        = 0 commits   (release fully contained in main)
release..main         = many        (main advanced via the PR #16 merge + others)
main..fix             = 6 commits   (a1bf355, 4a17aa6, cae15a6, dce71ff, 4e2cab8, 08d6168)
fix..main              = 1 commit   (5b5d2bf, the merge commit itself — no other divergence)
```

**Classification: none of the five options (A-E) in the original task
literally apply**, because the task's model assumed PR #16 was still an open,
separate branch to integrate *into*. The actual shape is simpler: `fix`
branched cleanly from the exact commit that is `main`'s own merge-base with
the (now-merged) release branch. There is no real divergence to reconcile —
`main` has exactly one commit beyond that point (the merge itself), and `fix`
has exactly six, none of which conflict with it.

## 2. Commit → purpose table

| Commit | Type | Purpose |
|---|---|---|
| `a1bf355` | source (FE) | Loading-bug fix: auto-select most recent map on fresh load, explicit loading/error/empty states |
| `4a17aa6` | source (BE) | Semantic `node_type` field added; enrichment prompt stopped instructing the model to summarize |
| `cae15a6` | source (BE) | Stage-0 global knowledge planning (`knowledge_planner.py`) wired into `guided_planner.py` |
| `dce71ff` | docs only | Live-provider eval round 1 — reported an honest blocker (invalid FPT key), no source change |
| `4e2cab8` | docs only | Live-provider eval round 2 — real FPT results, 9/11 acceptance, 2 P2 defects found |
| `08d6168` | source (BE) | P2 closure: `detail_policy.py` (centralized detail budgets) + `is_redundant_with_hierarchy` relation dedupe in `schema.py` |

3 of 6 commits carry source changes (`a1bf355`, `4a17aa6`, `cae15a6`, `08d6168`
— actually 4); `dce71ff` and `4e2cab8` are evaluation-report-only.

## 3. Overlap check

`git diff --stat origin/main...origin/fix/mindmap-semantic-and-loading-audit`
(run before the merge, against `main`, not the stale release branch):

- **Clean additions** (new files, zero overlap risk): `detail_policy.py`,
  `knowledge_planner.py`, `structure_critic.py`, 9 new test files,
  `docs/MINDMAP_LIVE_REASONING_EVAL.md`.
- **Same-area edits** (files main already had via PR #16, further modified by
  `fix`): `guided_planner.py`, `enrich.py`, `schema.py`,
  `mindmap_factory.py`, `mindmap_graph.py` (BE); `SidebarRight.jsx`,
  `MainLayout.jsx`, `WorkspaceContainer.jsx`, `WorkspaceEmptyState.jsx`,
  `KnowledgeInspector.jsx`, `mindElixirAdapter.js` (FE).
- **Textual conflicts during merge: zero.** The `git merge --no-ff` completed
  with `Merge made by the 'ort' strategy` and no conflict markers, because
  `fix`'s edits to those same-area files are all downstream of what main
  already had (fix branched from the exact pre-merge tip) — nothing in main's
  post-878e068 history (just the merge commit) touched those files
  differently.
- **Behavioral conflicts: none found.** Checked specifically: the merge
  commit `5b5d2bf` is a real two-parent merge (not a squash) that introduced
  no independent content of its own beyond combining what release already
  had with main's then-current tip — confirmed by `main..release` being
  empty (release's content is not a strict subset requiring reconciliation;
  it *is* what main now equals at that point in history).

## 4. Strategy selected

**New integration branch off current `main`, `fix` merged into it with a
normal merge commit (no squash, no rebase).** Chosen because:
- The ancestry is the simplest possible case — nothing to cherry-pick around,
  no divergent release-only content to preserve separately.
- A plain merge preserves the six audit-round commit boundaries, which matter
  for anyone later wanting to see the real order of discovery (loading fix →
  semantic contract → Stage-0 reasoning → live-eval-blocked → live-eval-passed
  → P2 closure).
- Rebasing a published branch (`fix` is on `origin`) was avoided per the
  task's own explicit rule.

**Integration branch:** `integration/guided-mindmap-v3-final`, cut from
`origin/main` at `5b5d2bf`, `fix/mindmap-semantic-and-loading-audit` merged
in via `--no-ff`.

## 5. Release functionality preserved (verified by reading code, not commit count)

| Item | Status | Evidence |
|---|---|---|
| Capability endpoint | present | `GET /mindmaps/capability` logic in `app/main.py`, unchanged by this integration |
| `GUIDED_MINDMAP_V3_ENABLED` | present, defaults `false` | `app/main.py:5075` |
| QA allowlist | present | `GUIDED_MINDMAP_V3_QA_USER_IDS`, `app/main.py:5074` |
| V3 fail-closed / V2 fallback | present | same function, `durable_store_unavailable` / `worker_unhealthy` reasons intact |
| Durable Postgres job ledger | present | `BE/app/domains/jobs/guided_store.py` |
| Supervised worker | present | `BE/app/jobs/guided_worker.py` |
| AWS deployment config | present | `docker-compose.prod.yml`'s `mindmap-worker` service (own container, no public port) |
| Paid Render worker | absent (correctly) | `grep -c "type: worker" render.yaml` = 0 |
| Schema versioning | present | `schema_version` field mechanics unchanged |

## 6. Mind Map fixes preserved (verified by reading code)

All confirmed present **and wired**, not just present as files:
- `knowledge_planner.py` — imported and called (`plan_global`) inside
  `guided_planner.py`.
- `structure_critic.py` — `repair_duplicate_titles` and `compute_diagnostics`
  both imported and called inside `mindmap_graph.py`'s `AssemblePersist` step.
- `detail_policy.py` — `get_detail_policy` imported and called inside
  `enrich.py`, replacing the old hardcoded child-count caps.
- `node_type` field present in `schema.py`'s node model, additive to `kind`.
- `is_redundant_with_hierarchy` present in `schema.py`, used during relation
  validation.
- FE: `SidebarRight.jsx` auto-selects the most recent map on load with a
  `__restoredOnLoad` guard flag (prevents an unwanted forced mode-switch);
  `WorkspaceEmptyState.jsx` has explicit `loading`/`error` branches distinct
  from the generic empty state.

## 7. Real FPT smoke test (post-integration, in the assembled tree)

Ran a standalone script calling the real integrated pipeline functions
directly (`plan_guided` → `enrich_branches` → `repair_duplicate_titles` →
`compute_diagnostics`), against a headerless, no-heading Vietnamese prose
fixture (garbage-collection concepts — same style as the prior evaluation's
mandatory Document B), using the real `FPT_AI_API_KEY` from the local `.env`
(copied read-only from the main worktree for the duration of this one test,
never committed, removed immediately after — confirmed gitignored throughout).

**First attempt caught a real mistake in my own test, not in the pipeline**:
calling `plan_guided` alone and inspecting its output directly reproduced the
exact same trap the live-eval fork flagged in an earlier round — `plan_guided`
returns the pre-enrichment skeleton, where `node_type` is unset and smell
detectors correctly flag `summary_tree`/`repeated_structure` (that's the
skeleton's honest, expected shape, not a bug). Fixed the test to run the real
full chain including `enrich_branches`.

**Full-chain result:**
```
provider: fpt (real, HTTP call, not mocked/fixture/ADA)
model: gpt-oss-120b
plan_guided:      7.17s, global_plan_used=True (Stage 0 ran, fallback NOT used)
enrich_branches:  12.04s, degraded=False
repair_duplicate_titles: 0 merges needed
final: 25 nodes, 5 relations
node_type set: cause_effect, concept, definition, process (4 real semantic types)
root: "Garbage Collection"
branches: Thu gom rác tự động / Đếm tham chiếu / Vòng tham chiếu /
          Thuật toán Mark-and-Sweep / Ưu điểm Mark-and-Sweep / Nhược điểm Mark-and-Sweep
structure_critic smells: all False (zero smells)
evidence_coverage_pct: 100.0
total latency: 19.2s
```

Checklist from the task: FPT auth succeeds ✓ · Stage 0 executes ✓ · conceptual
groups returned ✓ · fallback NOT used ✓ (`global_plan_used=True`) · node_type
survives ✓ · detail policy applied ✓ (`node_budget=24, max_depth=3` matches
the `balanced` policy) · relations validate ✓ (5 relations, no crash) ·
structure critic executes ✓ (zero smells) · **map persists successfully —
not directly exercised by this smoke script** (it calls the pipeline
functions in-process, doesn't go through the HTTP route / DB write path);
persistence itself is covered separately by the passing `test_mindmap_graph.py`
/ `test_guided_mindmap_v3.py` suites, not re-proven live here. Noting this
distinction rather than overclaiming.

## 8. Feature-flag / rollout defaults (unchanged by this integration)

- `GUIDED_MINDMAP_V3_ENABLED` — defaults `"false"` when unset. **Not changed
  by this task.**
- QA allowlist (`GUIDED_MINDMAP_V3_QA_USER_IDS`) — empty unless explicitly
  configured. **Not changed.**
- Capability response — fails closed to V2 on any unhealthy dependency.
  **Not changed.**
- No global enablement was performed. Integration correctness and rollout
  activation remain separate decisions, per the task's own instruction.

## 9. Tests

**Focused (71 tests):** `test_knowledge_planner.py`, `test_structure_critic.py`,
`test_detail_policy.py`, `test_detail_level_structural.py`,
`test_relation_redundancy.py`, `test_knowledge_reasoning_fixtures.py`,
`test_mindmap_enrich.py`, `test_mindmap_graph.py`, `test_mindmap_schema_v2.py`,
`test_mindmap_update.py`, `test_guided_mindmap_v3.py` — **71/71 passed**.

**Full BE** (real disposable `postgres:16-alpine`, migrations applied,
`TEST_DATABASE_URL` matching CI's own `studymap_test` convention):
**2498 passed, 11 skipped, 5 failed.** The 5 failures are exactly
`tests/test_index_khoa_that.py`'s pre-existing `fakeredis` lock-isolation
flake — the same 5 test names seen in every round of this entire effort,
confirmed zero diff on that file/module in this branch. No new failures.

**Full FE:** `npx vitest run` — **1090/1090 passed.**

**Build:** `npm run build` — clean, no errors.

**Lint:** `npx eslint src` — **64 problems (58 errors, 6 warnings)** — exact
match to the baseline carried through every round this session, zero new
issues.

**`git diff --check` (origin/main..HEAD):** clean, exit 0.

**`git status --short`:** clean (empty — nothing uncommitted).

## 10. Known baseline failures (unchanged, pre-existing, not from this work)

- `tests/test_index_khoa_that.py` (5 tests) — `fakeredis` lock-isolation
  flake, documented since the RC2 baseline at the start of this whole
  session, confirmed present and unchanged on every branch touched.
- `eslint`: 58 errors / 6 warnings repository-wide baseline, unrelated to
  Mind Map work, unchanged.

## Final state

- **Integration branch:** `integration/guided-mindmap-v3-final`
- **Final SHA:** the merge commit produced by `git merge origin/fix/mindmap-semantic-and-loading-audit --no-ff`
- **`git status --short`:** clean
- **No PR opened. No merge to `main`. No deploy.**
