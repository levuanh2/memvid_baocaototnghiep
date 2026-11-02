# The 12 pre-existing fixture failures

Owners:

- Triage: Codex2. Full per-test evidence is in `codex2/fixture-failures-triage.md`.
- Masked-assertion summary: Claude, in `claude/masked-assertions-summary.md`.
- R8-007 root cause: Claude, in `claude/r8-007-raster/README.md`.

| Item | Value |
|---|---|
| Tree | `c02e2b9` |
| Environment | Fixture harness (`FE/playwright.fixture.config.js`, Vite dev server, mocked data, Chromium) |
| Run | Each test ×3, 2026-11-01 16:20–16:35Z |
| CI | Does not run this suite |

## Result

| # | Spec | Test | Reproduced | Class | Sev | User impact |
|---|---|---|---|---|---|---|
| 1 | `branch-export-visual` | visual 390×844 light | 3/3 | STALE_TEST_CONTRACT | P3 | None. The PR #84 auto-context model turns the second pre-captured marker into context |
| 2 | `branch-export-visual` | visual 390×844 dark | 3/3 | STALE_TEST_CONTRACT | P3 | None. Same cause as #1 |
| 3 | `exact-node-export-v3` | manual suppression survives navigation | 3/3 timeout | STALE_TEST_CONTRACT | P3 | None. The wizard "Quay lại" button was removed by the Preview Bench (PR #95) |
| 4 | `mindmap-depth-presets` | 1440×1024 light, 5 presets | 3/3 | **PRODUCT_DEFECT** | P3 | Root centre jumps 1.72 px horizontally on a depth change |
| 5 | `mindmap-depth-presets` | 1440×1024 dark | 3/3 | **PRODUCT_DEFECT** | P3 | Same as #4 |
| 6 | `mindmap-depth-presets` | 1024×768 light | 3/3 | **PRODUCT_DEFECT** | P3 | Same as #4 |
| 7 | `mindmap-depth-presets` | 1024×768 dark | 3/3 | **PRODUCT_DEFECT** | P3 | Same as #4 |
| 8 | `mindmap-depth-presets` | 390×844 light | 3/3 | **PRODUCT_DEFECT** | P3 | 1.29 px jump |
| 9 | `mindmap-depth-presets` | 390×844 dark | 3/3 | **PRODUCT_DEFECT** | P3 | 1.29 px jump |
| 10 | `mindmap-depth-presets` | depth ≤ 2 gives 6 nodes; full scope gives 8 | 3/3 timeout | STALE_TEST_CONTRACT | P3 | None. Uses the retired "Quay lại" |
| 11 | `post-pr77-exact-selection` | six pairs at 69% | 3/3 | STALE_TEST_CONTRACT | P3 | None. Old combined summary text (PR #95) |
| 12 | `post-pr77-exact-selection` | offscreen identity | 3/3 | STALE_TEST_CONTRACT | P3 | None. Same stale precondition as #11 |

Round 8.1's JSON listed 11 failure identities, although its text said 12.
Test #10 was the one missing from the list. All 12 reproduce
deterministically. None is NONDETERMINISTIC_TEST or a test-environment
failure.

## Stale tests: proof that nothing is hidden

A stale step could mask a real defect behind it, for example wrong export
membership. Codex2 therefore re-ran tests #1–#3 and #10–#12 with **only** the
stale navigation or text step migrated to the current UI. Every downstream
assertion was left byte-identical (diff: `codex2/masked-assertions/`).

Result: **18/18 PASS** over 3 runs. That covers:

- full scope gives exactly 8 nodes;
- downloaded-SVG membership is exact for all six pairs;
- offscreen node identity is complete;
- manual suppression survives navigation.

The design behind each stale contract:

| Tests | Approved design |
|---|---|
| #1, #2 | `docs/ui-ux-v4-design/05-shared-map-visual-grammar/engine-boundaries-and-export-guardrails.md` §3.2, invariant 2 (PR #84, `302548d`) |
| #3, #10–#12 | Preview Bench (PR #95, `90a959f`; `round5-qa-evidence/`) |

## Product defect: R82-P3-01, depth-preset root-anchor drift

| Field | Detail |
|---|---|
| Where | `FE/src/components/mindmap/MindElixirView.jsx:974-999` (preset application) together with the root box metrics in `FE/src/components/mindmap/mindmap.css:97-127` |
| Introduced by | `a3aabed` (PR #93, root typography and padding), after the 1 px preservation contract added in `91a4a04` |
| Not affected | Node membership, depth membership, counts, connectors, instance identity and scale all pass |
| Severity | P3 cosmetic. Not release-blocking |
| Owner | FE MindMap rendering |
| Fix | Re-anchor the pre-change root screen centre after the final refresh, using the new root box. Keep the 1 px bound |

## Related: R8-007 raster fixture is flaky (R82-T01)

This is not one of the 12, but it was found in the same fixture area.

- `multi-branch-export-raster-connectors` fails about 1 run in 3. The test
  helper's `performance` lookup sometimes picks `MindElixir.css` instead of the
  `mind-elixir.js` module.
- This is a test-only defect, P3. When the module resolves, every connector
  and raster assertion passes.
- Details: `claude/r8-007-raster/README.md`.

## Disposition

- No P0, P1 or P2 failure.
- No wrong export membership, depth handling or corrupted artifact.
- Recommended follow-ups:
  - a test-only PR that migrates the 6 stale specs (same diff as Codex2's) and fixes the R82-T01 helper;
  - a small FE fix for R82-P3-01.
