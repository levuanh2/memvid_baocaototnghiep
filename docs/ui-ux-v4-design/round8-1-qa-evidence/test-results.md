# Test results

Production source is identical from `21ab319` to the final head. Later commits
(`07fbf82`, `ef1b3de`, `e009d38`) change test files only. The correction tree
at `ab6e90c` + the uncommitted Quiz fix is byte-identical in production code to
`21ab319`.

## Frontend unit / component (Vitest)

| Suite | Tree | Passed | Failed | Skipped |
|---|---|---|---|---|
| Full frontend | `ef1b3de` | 1,798 (201 files) | 0 | 0 |
| Full frontend | `21ab319` content | 1,789 (201 files) | 0 | 0 |
| `QuizTaking.round7.test.jsx` | `21ab319` | 10, ×5 consecutive runs | 0 | 0 |
| `ExportStudioDialog.imageCommitBoundary` + `mindmapImageExport` | `07fbf82` | 36 | 0 | 0 |
| `libraryActionMatrix` + `LibraryActionMatrix` | `ef1b3de` | 44 | 0 | 0 |

One Codex1 run reported the StrictMode Quiz test failing while three other
suites were loading the machine. It did not reproduce in the full suite or in
5 isolated repeats; treated as a load artefact, not hidden.

## Build, lint, hygiene

| Gate | Tree | Result |
|---|---|---|
| `npm run build`, Library flag OFF | `21ab319` | PASS, 2,409 modules |
| `npm run build`, `VITE_LIBRARY_ACTION_MATRIX=true` | `21ab319` | PASS, 2,409 modules |
| `npm run lint:ratchet` | `ef1b3de` | PASS, current 63 (58 errors, 5 warnings) ≤ baseline 67 |
| `git diff --check origin/main...HEAD` | `ef1b3de` | clean |

## Backend

| Suite | Tree | Passed | Failed | Skipped | Warnings |
|---|---|---|---|---|---|
| 26 `BE/tests/test_*export*` / `*pdf*` files (list in Codex1 report) | `21ab319` | 328 | 0 | 0 | 4 |

## Chromium fixture suite (`FE/playwright.fixture.config.js`)

Full run by Agy, 20:53–21:24 (Asia/Saigon), tree = `21ab319` production
code: **420 passed, 28 failed, 0 skipped, 0 flaky** of 448.
Raw: `agy/full-suite-results.json`.

| Spec | Passed | Failed | Note |
|---|---|---|---|
| `export-studio.spec.js` (R8-006) | 25 | 0 | ran 20:58–20:59 |
| `multi-branch-export-raster-connectors.spec.js` (R8-007) | 1 | 0 | |
| `mobile-header.spec.js` (R8-001) | 111 | 0 | |
| `mobile-header-visual.spec.js` | 14 | 0 | |
| `round6-library-action-matrix.spec.js` (R8-004/005) | 19 | 0 | |
| `responsive.spec.js` (R8-006) | 117 | 16 | stale wizard selectors; fixed in `e009d38`, rerun **133/133** |
| `branch-export-visual.spec.js` | 4 | 2 | pre-existing on `main`, see below |
| `exact-node-export-v3.spec.js` | 8 | 1 | pre-existing on `main` |
| `mindmap-depth-presets.spec.js` | 10 | 7 | pre-existing on `main` |
| `post-pr77-exact-selection.spec.js` | 1 | 2 | pre-existing on `main` |
| 22 other specs | 110 | 0 | |

### Pre-existing failures outside R8-001 … R8-007

The 12 failures in the four specs above were rerun in isolation:

| Tree | Passed | Failed |
|---|---|---|
| Correction branch HEAD (Agy, `agy/rerun-4-specs-HEAD.json`) | 23 | 12 |
| `origin/main` `16fcc84` (Codex1, temporary detached worktree on port 5299) | 23 | 12 |

The same 12 test names fail on both trees: 390px visual export labels
(`branch-export-visual` ×2), the manual suppression timeout
(`exact-node-export-v3` ×1), depth-preset scale/root-centre bounds and the
depth≤2 scope timeout (`mindmap-depth-presets` ×7), and 69% exact-selection
identity text (`post-pr77-exact-selection` ×2). They are not introduced by
this branch and are not in the Round 8 defect list. They are recorded in
`residual-release-gates.md` and were not changed.

### Run-integrity note

During verification Claude briefly mutated `ExportStudioDialog.jsx` (two
mutation checks, about 21:19–21:21, restored before `07fbf82` at 21:22:01).
Agy's dev server served that tree at the time. By timestamp only
`responsive.spec.js` (21:08–21:23) overlapped; its failures have an
independent cause, and it was rerun clean after `e009d38`. Every other spec,
including `export-studio.spec.js`, finished before the mutation.

## GitHub CI

CI runs only the real-backend `FE/playwright.config.js` suite
(`ci.yml`: `npx playwright test`). The 448-test fixture suite above is not part
of CI, which is why `main` stays green despite the 12 pre-existing fixture
failures.

| Run | Head | Result |
|---|---|---|
| [41317746515](https://github.com/levuanh2/memvid_baocaototnghiep/actions/runs/41317746515) | `a490df5` | FAIL: E2E Critical Flows 37 passed / 4 failed, all in `e2e/mobile-theme-control.spec.js`. Frontend tests, build and static checks passed. |

The 4 failures were a stale R8-001 contract, not a product fault. The spec
still expected the desktop theme toggle at 1024px and a 1023↔1024 boundary.
`4b56a91` keeps the header compact through 1100px, hides `.theme-toggle` there
and shows the theme action in the StudyMap menu, so exactly one theme control
remains reachable at every width. `76c1a32` updated the Vitest and fixture
contracts but missed this real-backend spec, which cannot run locally. The
follow-up commit moves its boundary to 1100↔1101 and adds 1100px to the compact
set; no assertion was removed. The final CI result for the new head is reported
on the pull request.

## Not run

| Gate | Status | Reason |
|---|---|---|
| Critical real-backend Playwright (`FE/playwright.config.js`) | BLOCKED locally | PostgreSQL unreachable; generated `BE/shared/proto/gen` missing; Flask `/health` never answered |
| Agy header/Library geometry (58 checks) | Not repeated | No header or Library source changed after `ab6e90c`; results in `agy/README.md` stand |
