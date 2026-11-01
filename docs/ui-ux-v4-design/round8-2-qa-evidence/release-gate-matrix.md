# Release gate matrix

All results are on `c02e2b9` (merged main), from 2026-11-01 16:05Z to 18:15Z.

Evidence categories:

| Category | Meaning |
|---|---|
| CI | GitHub Actions |
| Prod-RO | Read-only production probe |
| Real | Local Chromium against real Flask, disposable Postgres and the production-equivalent build; only the AI provider is stubbed |
| Fixture | Vite harness with mocked data |
| Unit | Vitest or pytest |
| Manual-AT | A human using assistive technology |

## Gates

| # | Gate | Category | Result | Evidence |
|---|---|---|---|---|
| 1 | main HEAD, PR #98 merged, merge tree identical to the PR head | CI / git | PASS | `git-deployment-verification.md` |
| 2 | Post-merge CI: 10/10 jobs; E2E 40, FE 1,798, BE 2,980 + 11 | CI | PASS | same |
| 3 | Backend EC2 on `c02e2b9`, healthy | Prod-RO, deploy log | PASS. The revision is shown by the log only; the service exposes no SHA | `runtime-health-matrix.md` |
| 4 | Frontend serves the `c02e2b9` build | Prod-RO | PASS: 34/34 chunks match after normalisation | `claude/prod-frontend-bundle-compare.txt` |
| 5 | Production Library flag is OFF | Prod-RO | PASS | same |
| 6 | Production unauthenticated surface: no console errors, TLS valid, CORS allow-list, 401 without a token | Prod-RO | PASS | `claude/prod-unauth-browser-probe.json` |
| 7 | Critical real-backend Playwright, CI auth mode | Real | **40/40** PASS. This was BLOCKED in Round 8.1 | `claude/critical-e2e/` |
| 8 | Same suite with `AUTH_PROTECT_APP_APIS=true` | Real | **40/40** PASS | same |
| 9 | 10-question Quiz journey: persistence, autosave barrier, single submit, grading, mastery, review scoping, cross-account 404 | Real | PASS | `quiz-10q-api-e2e.md` |
| 9a | Score hidden during asynchronous grading | Real | NOT VERIFIED: objective quizzes grade synchronously | same |
| 9b | Follow a source reference from the result or review page | Real | NOT VERIFIED: the UI has no navigable reference, only a count | same |
| 9c | Practice-quiz generation | Real | NOT VERIFIED: the E2E server has no AI stub for practice | same |
| 10 | PDF artifacts: 3-tier ×3 scenarios and 4-tier ×2 scenarios, downloaded and validated | Real | PASS | `pdf-artifact-verification.md` |
| 10a | PDF for branch and selected-node scopes | — | NOT VERIFIED as a PDF; membership is verified as SVG and in the fixture | same |
| 11 | Image export: valid file exactly once for the intended map; Escape and Cancel refused mid-export | Real | PASS | `claude/image-export/` |
| 11a | Close in the same JS task as the click still downloads | Real (synthetic) | FINDING **R82-P3-02** | same |
| 12 | The 12 pre-existing fixture failures | Fixture | Triaged: 6 stale, masked assertions 18/18 PASS; 6 are one **P3** drift (R82-P3-01) | `fixture-failures-triage.md` |
| 13 | Round 8.1 fixes R8-001 to R8-006 after merge | Unit / Fixture / Real / CI | PASS | `round8-1-regression.md` |
| 13a | R8-007 raster fixture | Fixture | Flaky about 1 in 3, a test-helper defect (**R82-T01**, P3). Product assertions pass | `claude/r8-007-raster/` |
| 14 | Library OFF and ON: legacy vs matrix, Back restore, per-account state, server 404 across accounts | Real | PASS | `claude/library-flag/` |
| 15 | Backend pytest: export, PDF, quiz, attempt, persistence (36 files) | Unit, real database | 503 passed, 0 failed | `codex1/backend-stack.md` |
| 16 | Literal `npm test` | Unit | 201 files and 1,798 tests PASS, after removing the audit runners from `FE/` | `round8-1-regression.md` |
| 17 | `npm run build` flag OFF and ON; `lint:ratchet` 63 ≤ 67 | Local | PASS | `codex2/regression.md` |
| 18 | Account control: WCAG 2.5.8 AA (24 px) | Fixture | PASS | `accessibility-verification.md` |
| 18a | Account control: project 44 px target | Fixture | NOT MET. **Open P2**; a CSS-only fix is feasible | same |
| 19 | Dark destructive-dialog contrast (SC 1.4.3) | Real and Fixture | PASS: 6.87:1 minimum on the real composited background | same |
| 20 | Escape: 0 DELETE, collection kept | Real | PASS | same |
| 20a | Focus restored after Escape (SC 2.4.3) | Real | **FAIL: R82-A11Y-01 (P2)**. Focus falls to `<body>` | `claude/destructive-dialog/` |
| 20b | Map, summary and chat-history delete dialogs in the real app | — | NOT VERIFIED | same |
| 21 | Screen readers (Narrator, NVDA, VoiceOver) | Manual-AT | NOT VERIFIED | `accessibility-verification.md` §6 |
| 22 | Production isolation: no production writes, no flag change, no merge or deploy | — | PASS. Only GET and OPTIONS were sent to production | this audit |

## Defects and risks found in Round 8.2

| ID | Severity | Type | Where | Blocks release? | Owner | Next action |
|---|---|---|---|---|---|---|
| R82-A11Y-01 | P2 | Product, accessibility | `FE/src/components/study/CollectionSidebar.jsx:159` | No | FE Library | One-line fix (keep the form mounted until the dialog resolves) plus a real-browser regression test |
| Account 44 px (carried over from Round 8.1) | P2 | Product, accessibility (project target) | `FE/src/index.css:1176` | No | FE Shell | CSS-only 44×44 px and a 4 px gap at ≤ 340 px; re-run the R8-001 geometry suite |
| R82-P3-02 | P3 | Product hardening | `FE/src/components/mindmap/ExportStudioDialog.jsx:228` | No | FE Export | Guard `close()` with `inFlightRef` and clear `attemptKeyRef`; add a unit test |
| R82-P3-01 | P3 | Product, cosmetic | `MindElixirView.jsx:974-999` with `mindmap.css:97-127` | No | FE MindMap | Re-anchor the root centre after a preset change, keeping the 1 px bound |
| R82-T01 | P3 | Test only | `FE/e2e-fixture/multi-branch-export-raster-connectors.spec.js:58` | No | FE QA | Match only the `.js` module URL |
| Stale fixture contracts (6) | P3 | Test only | 4 specs | No | FE QA | Land Codex2's migration diff |
| CI auth-mode gap | Risk | CI coverage | `.github/workflows/ci.yml` e2e job; `BE/scripts/run_e2e_server.py:51` | No | Release engineering | Add a second E2E pass with `AUTH_PROTECT_APP_APIS=true` (40/40 locally) |
| Fixture suite not in CI | Risk | CI coverage | `FE/playwright.fixture.config.js` | No | Release engineering | Add the fixture suite, or at least the export, Library and header specs, to CI once the stale specs are fixed |
| No runtime build SHA | Risk | Observability | `/health`, frontend `index.html` | No | Backend and frontend | Expose a build SHA (for example a `version` field in `/health` and a meta tag) |
| Screen readers | NOT VERIFIED | Accessibility | — | Needs risk acceptance | Human tester | Narrator or NVDA pass over Quiz, dialogs, Library and status updates |
| Practice quiz, source-reference navigation, asynchronous grading window | NOT VERIFIED | Functional | — | Needs risk acceptance | QA / backend | Add an AI stub for practice to the E2E server; decide whether source references should be navigable |
