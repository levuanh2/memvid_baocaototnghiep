# Round 6 Library Action Matrix QA evidence

Generated on 2026-10-28 by
`FE/e2e-fixture/round6-library-action-matrix.spec.js` in Chromium through
Playwright. The deterministic, backend-free harness mounts the real Round 6
React presentation components and the production pure projection model. Mounted
`DocumentList.round6.behavior.test.jsx` separately verifies production fetch,
dispatcher, persistence, deletion, and exact bulk request bodies.

## Fixture and measured results

- Provenance: the approved Alternative B 42-document fixture encoded in
  `FE/src/round6LibraryQa.jsx`.
- All: 42 unique UUID rows; Continue: 1; Needs Summary: 36; Needs Quiz: 35.
- `doc-1` is excluded from both missing queues; `doc-2` is included in both.
- Desktop density: 215 visible interactive controls, 210 inside rows, five per
  row, first-row height 82px. See `matrix-density-metrics.json`.
- Browser result: 19/19 Playwright cases passed after correcting the sheet close
  target from 32px to 44px and tokenizing dark-mode focus. Every listed
  viewport/theme measured zero document overflow, zero row overflow, zero
  clipped controls, and mobile targets >=44px.
- Runtime: local Chromium supplied by Playwright; Vite fixture server; no backend
  and no external network requests.

## Evidence index

| Surface | Viewport/theme | Evidence | Result |
|---|---|---|---|
| All | 1440x900 light/dark | `library-1440x900-light.png`, `library-1440x900-dark.png` | PASS |
| All | 1024x768 light/dark | `library-1024x768-light.png`, `library-1024x768-dark.png` | PASS |
| All | 820x1180 light/dark | `library-820x1180-light.png`, `library-820x1180-dark.png` | PASS |
| All | 800x900 light/dark | `library-800x900-light.png`, `library-800x900-dark.png` | PASS |
| All | 768x1024 light/dark | `library-768x1024-light.png`, `library-768x1024-dark.png` | PASS |
| All | 390x844 light/dark | `library-390x844-light.png`, `library-390x844-dark.png` | PASS |
| All | 320x568 light/dark | `library-320x568-light.png`, `library-320x568-dark.png` | PASS |
| Continue | 1440x900 light | `library-view-continue.png` | PASS |
| Needs Summary | 1440x900 light | `library-view-needs_summary.png` | PASS |
| Needs Quiz | 1440x900 light | `library-view-needs_quiz.png` | PASS |
| Composed-filter empty | 1440x900 light | `library-composed-empty.png` | PASS |
| Desktop More | 1440x900 light | `library-desktop-more-menu.png` | PASS |
| Mobile tools sheet | 390x844 light | `library-matrix-mobile-390-tools.png` | PASS |
| Mobile stress sheet | 320x568 dark | `library-mobile-320-tools-dark.png` | PASS |
| Bulk scope before/after task change | 1440x900 light | `library-bulk-before-task-change.png`, `library-bulk-after-task-change.png` | PASS |

## Non-screenshot interaction evidence

- Feature flag OFF/ON, single `/api/library` fetch, account-scoped Back state,
  one-shot scroll restoration, exact dispatcher calls, one `markOpened`, same-
  cycle hidden-ID exclusion, collection delete cancel/failure/UUID behavior, and
  fallback focus are asserted by the mounted integration suite.
- The shared destructive-confirmation visual contract is covered by its Round 7
  component suite; Round 6 verifies the Library caller and failure propagation.
- Destination identity and UUID membership/counts are asserted in pure and
  mounted tests rather than inferred from screenshots.

## Known limitations

- Chromium viewport emulation is not a claim of real-device keyboard or screen-
  reader testing.
- The deterministic evidence harness is intentionally backend-free; production
  API request semantics are covered in jsdom integration tests.
- No rollout percentage or production exposure is enabled by this evidence.
