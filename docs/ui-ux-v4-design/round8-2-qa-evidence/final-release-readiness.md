# Final release readiness: StudyMap V4 after Round 8.1

**Verdict: CONDITIONAL.**

No P0 or P1 issue was found. No issue blocks the release. Before this becomes
GREEN, the responsible reviewer must explicitly accept the remaining P2
accessibility items and the NOT VERIFIED items listed below.

| Item | Value |
|---|---|
| Audited revision | `c02e2b91ae2207d472756cd34003b5cb6fee1620` (main = PR #98 merge) |
| Audit dates | 2026-11-01 to 2026-11-02 |
| Coordinator | Claude |
| Independent runs | Agy (Chromium and accessibility), Codex1 (backend and Quiz), Codex2 (fixtures and regression) |

## Context the brief did not assume

Round 8.1 is **already live**.

- Merging PR #98 triggered the EC2 backend deploy (run 41321856500).
- It also triggered the Render static-site frontend auto-deploy (`render.yaml`, `autoDeploy: true`).
- Production serves the `c02e2b9` frontend build and runs the `c02e2b9` backend.

So "can the frontend be rolled out" really asks whether the live build should
**stay** or be **rolled back**. Every finding below is already in front of
users.

## A. Git and deployment

| Item | Observed |
|---|---|
| main HEAD | `c02e2b9`; not advanced during the audit |
| PR #98 | MERGED 2026-11-01 15:28:08Z. The merge tree equals the PR head `fb6aaec` |
| CI | Run 41321373798 succeeded on 10/10 jobs: E2E 40, FE 1,798, BE integration 2,980 |
| Backend deployed revision | `c02e2b9`, according to the deploy log. `/health` and `/ready` are healthy. The service exposes no SHA |
| Frontend deployed revision | Content-equal to the `c02e2b9` build: 34/34 chunks |
| Production Library flag | **OFF** (bundle evidence). Not changed |

## B. Functional verification

| Gate | Environment | Method | Result | Evidence |
|---|---|---|---|---|
| Quiz, 10 questions | Real Flask, disposable Postgres, prod-equivalent frontend | Playwright plus psql | PASS | `quiz-10q-api-e2e.md` |
| Autosave persistence | same | Delayed and aborted real PATCH, reload, database read-back | PASS | same |
| Grading | same | SQL recomputation (8) = stored score 8/10 = UI 80% | PASS | same |
| ReviewGuide | same | Review plan scoped to owned sections and chunks; feedback and source count shown | PASS. Navigating a source reference is NOT VERIFIED: the UI has no link | same |
| PDF download | same | Export Studio, then a real job, then download, then PyMuPDF: 5 PDFs, 3-tier and 4-tier | PASS | `pdf-artifact-verification.md` |
| Image export | same | Download count per click, map identity, refused mid-export close | PASS. Synthetic race: R82-P3-02 (P3) | `claude/image-export/` |
| Critical integration | Real (open auth and protected auth) and CI | `FE/playwright.config.js` | 40/40, 40/40, 40 | `claude/critical-e2e/` |
| Account isolation | Real, protected | Cross-account Quiz GET, PATCH and submit; document GET; Library state | 404 every time; no state leak | — |
| Library OFF and ON | Real | Separate builds | PASS | `claude/library-flag/` |

## C. The 12 fixture failures

| # | Test | Classification | Impact | Severity |
|---|---|---|---|---|
| 1–2 | `branch-export-visual` 390 light and dark | STALE_TEST_CONTRACT (PR #84 auto-context) | None | P3 |
| 3 | `exact-node-export-v3` suppression | STALE_TEST_CONTRACT (PR #95 Preview Bench) | None | P3 |
| 4–9 | `mindmap-depth-presets` × 6 viewport and theme combinations | **PRODUCT_DEFECT R82-P3-01**: root centre drifts 1.29–1.72 px on a depth change (PR #93) | Small canvas jump | P3 |
| 10 | depth ≤ 2 then full scope | STALE_TEST_CONTRACT (PR #95) | None | P3 |
| 11–12 | `post-pr77-exact-selection` | STALE_TEST_CONTRACT (PR #95) | None | P3 |

Re-run with only the stale step migrated: the masked assertions passed **18/18**.
These include full scope giving 8 nodes, exact SVG membership for six pairs,
and offscreen identity. There is no export-integrity defect.

## D. Accessibility

| Item | Result |
|---|---|
| Account target | 40×40 px. PASS for WCAG 2.5.8 AA. The project's 44 px target is NOT MET (open P2). A CSS-only fix fits at every width |
| Dark dialog contrast | PASS: real composited ratio 6.87:1 minimum, 11.70:1 for the title |
| Escape focus restoration | **FAIL, R82-A11Y-01 (P2)**. In the real Library collection-delete flow, focus falls to `<body>` because the trigger unmounts. No DELETE is sent. The fixture variant passes |
| Keyboard interaction | PASS: Tab reaches the trigger, Enter opens, focus is trapped, menus close on Escape |
| Screen readers | **NOT VERIFIED.** No audible Narrator, NVDA or VoiceOver run |

## E. Residual risks

| Risk | Owner | Next action |
|---|---|---|
| R82-A11Y-01 focus lost after cancelling a collection delete | FE Library | Correction PR: `CollectionSidebar.jsx:159`, plus a real-browser test |
| Account 44 px target | FE Shell | Correction PR: `index.css:1176`, CSS-only, then re-run the R8-001 geometry suite |
| R82-P3-02 latent export close race | FE Export | Small PR: guard `close()` with `inFlightRef` and clear `attemptKeyRef` |
| R82-P3-01 depth-preset drift | FE MindMap | Small PR: re-anchor the root after the preset refresh |
| R82-T01 and 6 stale fixture specs | FE QA | Test-only PR using Codex2's migration diff and the helper URL fix |
| CI cannot see cross-account leaks (open-auth E2E) | Release engineering | CI PR: add a protected-auth E2E pass |
| Fixture suite is not in CI | Release engineering | CI PR after the stale specs are fixed |
| No runtime build SHA on backend or frontend | Backend and FE | Add a version field to `/health` and a meta tag |
| Screen readers | Human accessibility tester | Narrator or NVDA session on Windows; VoiceOver on macOS or iOS |
| Practice quiz, source navigation, asynchronous grading window | QA and Backend | AI stub for practice in `run_e2e_server.py`; product decision on navigable references |
| Other destructive dialogs (map, summary, chat history) not run in the real app | QA | Extend `claude/destructive-dialog` spec |
| Auto-deploy on merge to main | Release owner | Decide whether to keep auto-deploy for both frontend and backend, or add a manual gate |

## F. Final answers

1. **Is the merged code ready for release review?** Yes. The Round 8.1 fixes
   survived the merge. The Quiz and PDF gates that were missing in Round 8.1
   now pass on the real API and database. No P0, P1 or integrity issue
   remains.
2. **Can the frontend be safely rolled out?** It is already live. No finding
   justifies a rollback. R82-A11Y-01 is a P2 focus-management bug in one
   cancel flow, with no data risk. Recommendation: keep `c02e2b9` in
   production and ship the R82-A11Y-01 fix as a normal correction PR.
3. **Can the Library Action Matrix be considered for a separate rollout?** It
   is eligible for consideration:
   - OFF and ON parity, Back restoration, per-account state and server
     isolation pass on the real stack;
   - R8-004 and R8-005 pass.

   Enabling it is a separate user decision and was not done here. Run a
   screen-reader check of the matrix first.
4. **Which issues need a correction PR?**
   - R82-A11Y-01 (P2)
   - Account 44 px (P2)
   - R82-P3-02, R82-P3-01
   - Test-only: R82-T01 and the 6 stale specs
   - CI: protected-auth E2E pass
5. **Is more independent verification needed?** Yes:
   - an audible screen-reader pass;
   - practice-quiz generation with a deterministic stub;
   - the other real-app destructive dialogs;
   - re-running the R8-001 geometry suite on the Account 44 px PR.

**GREEN requires** the responsible reviewer to explicitly accept the two P2
accessibility items and the NOT VERIFIED items above, or to fix them first.
Neither is done in this audit.

No merge, no deployment, no production data mutation and no Library flag
change were performed.
