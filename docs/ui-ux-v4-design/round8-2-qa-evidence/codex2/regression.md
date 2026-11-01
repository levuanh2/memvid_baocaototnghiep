# Round 8.2 frontend regression — codex2

## Metadata

- Git SHA: `c02e2b91ae2207d472756cd34003b5cb6fee1620` (`origin/main`, PR #98 merge).
- Environment: Windows, Node `v22.18.0`, npm `11.12.1`; local Vitest/Vite/Chromium only.
- Data boundary: unit/component tests and fixture-harness mocked data; no real API or database, no credentials, no production host.
- Timestamp: 2026-11-01T23:35:19+07:00 through 2026-11-02T00:01:15+07:00.
- Method: commands requested in the release-gate brief; focused Chromium used `E2E_FIXTURE_PORT=5301` and one worker. Expected: all regression gates pass. Observed/status are recorded per row.

## Results

| Gate | Expected | Observed | Status |
|---|---:|---:|---|
| Literal `npm test` | full Vitest green | 201 project files / 1,798 project tests passed; one foreign temporary Playwright file, `FE/e2e-r82-claude/library-flag-real-backend.spec.js`, was discovered by Vitest and failed during import (`Playwright Test did not expect test.describe() to be called here`) | **TEST_ENVIRONMENT_FAILURE** |
| Complete project corpus, `npx vitest run src` | green | 201 files, 1,798/1,798 passed | **PASS** |
| `QuizTaking.round7.test.jsx`, run 1 | 10 pass | 10/10 | **PASS** |
| `QuizTaking.round7.test.jsx`, run 2 | 10 pass | 10/10 | **PASS** |
| `QuizTaking.round7.test.jsx`, run 3 | 10 pass | 10/10 | **PASS** |
| `ExportStudioDialog.imageCommitBoundary` + `mindmapImageExport.test.js` | 36 pass | 36/36 | **PASS** |
| `libraryActionMatrix.test.js` + `LibraryActionMatrix.test.jsx` | 44 pass | 44/44 | **PASS** |
| `npm run build`, flag OFF | build | 2,409 modules, production build completed in 8.46 s | **PASS** |
| `VITE_LIBRARY_ACTION_MATRIX=true npx vite build --outDir %TEMP%/studymap-r82-codex2-library-on` | separate ON build | 2,409 modules, completed in 8.36 s; normal `FE/dist` remained the OFF build | **PASS** |
| `npm run lint:ratchet` | current ≤ 67 | current 63 = 58 errors + 5 warnings | **PASS** |
| `export-studio.spec.js` | green | 25/25 passed | **PASS** |
| `responsive.spec.js` | green | 133/133 passed | **PASS** |
| `round6-library-action-matrix.spec.js` | green | 19/19 passed | **PASS** |
| `multi-branch-export-raster-connectors.spec.js` | green | 0 passed, 1 failed before connector assertions: `page.evaluate: TypeError: Cannot read properties of undefined (reading 'SIDE')` | **TEST_ENVIRONMENT_FAILURE / BLOCKED** |
| Focused Chromium aggregate | 178 pass | 177 passed, 1 failed, 0 skipped/flaky in 5.3 min | **BLOCKED** |

Raw focused Chromium evidence: `focused-fixtures.raw.json`.

## Library flag OFF proof

- Source default: `FE/src/utils/libraryActionMatrixFlag.js:1-3` enables the matrix only when `VITE_LIBRARY_ACTION_MATRIX` lower-cases exactly to `"true"`; absent/empty is false.
- OFF bundle: `dist/assets/DocumentList-BWsT-fRJ.js` contains environment object `{BASE_URL:"/",DEV:!1,MODE:"production",PROD:!0,SSR:!1}` with **no** `VITE_LIBRARY_ACTION_MATRIX` property; the generated predicate therefore returns false.
- ON comparison bundle: `%TEMP%/studymap-r82-codex2-library-on/assets/DocumentList-DJaATVAg.js` contains the same object plus `VITE_LIBRARY_ACTION_MATRIX:"true"`.
- Expected: Library Action Matrix inactive by default and active only in the isolated ON build. Observed: exact expected compile-time difference. Status: **PASS**.

## Defect survival verdicts

- **R8-002 — PASS:** full corpus green and QuizTaking 10/10 on three isolated runs.
- **R8-003 — PASS:** image commit boundary/export utility 36/36; Export Studio 25/25 includes real fixture downloads/formats.
- **R8-004 — PASS:** focused Library unit/component 44/44 and browser matrix 19/19; OFF/ON builds both complete and default flag remains OFF.
- **R8-006 — PASS:** Export Studio 25/25 and responsive 133/133.
- **R8-007 — BLOCKED / NOT VERIFIED:** its only focused spec fails in the test helper at `FE/e2e-fixture/multi-branch-export-raster-connectors.spec.js:58-67`. Dynamic resource discovery imports a module namespace whose `.default` constructor is undefined, then reads `MindElixir.SIDE`. The helper was introduced by `6b4e8e2`; the failure occurs before node membership, geometry, or raster-pixel assertions, so it is not evidence of a production connector regression. Exact missing dependency/contract: a valid browser module constructor from the helper's dynamic `performance` resource URL. Per brief, no retry or test edit was made.

## Hygiene and open issues

- The focused Round 6 spec regenerated six tracked legacy screenshot/metric outputs outside codex2 evidence. They were immediately restored exactly to `HEAD`; final tracked modifications outside this evidence directory are zero.
- `npm test` cannot be marked green while another agent's Playwright evidence spec remains under Vitest's discovery root. The actual project corpus is independently green at 1,798/1,798.
- Open product issue from the separate fixture triage: one P3 MindMap depth-preset root-anchor drift (1.29–1.72 px); see `fixture-failures-triage.md`.
- Overall frontend regression verdict: **BLOCKED only on R8-007 test-environment verification; no P0/P1/P2 production regression reproduced.**
