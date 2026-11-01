# P1 closure — R8-001, R8-002, R8-003

Original findings: `docs/ui-ux-v4-design/round8-qa-evidence/defects.md` in the
Round 8 audit worktree (`audit/studymap-v4-round8-final-gate`, uncommitted
evidence, left untouched).

| ID | Original finding | Root cause | Fix commits | Proof | Reviewer | Status |
|---|---|---|---|---|---|---|
| R8-001 | Supported-width header overflow hides a primary account control (320px, 1024px) | Header labels expanded at Tailwind's 1024px breakpoint, but the full control set needs ≈1089px | `4b56a91` fix, `76c1a32` contract tests | Agy Chromium @ `ab6e90c`: 11 widths × light/dark = 22/22 PASS, zero horizontal overflow, single 56px row, Account centre hit-test passes; `mobile-header.spec.js` in the fixture suite | Agy | FIXED |
| R8-002 | Submit can race an already-started autosave | Draft ledger emptied before the PATCH resolved, so emptiness ≠ acknowledgement | `e196bbb`, `21ab319` | `quiz-autosave-race.md`; 10/10 deferred-promise tests, stable ×5 | Codex2 (review + `21ab319` fix), Claude | FIXED |
| R8-003 | Stale image export may download after map/session invalidation | Capture helper performed the download before the dialog validated the attempt | `883b616`, `07fbf82` tests | `export-session-isolation.md`; stale downloads 0, valid downloads 1, mutation-checked | Codex2, Claude | FIXED |

## Source changes after Agy's audit SHA

Agy measured `ab6e90c`. Later commits:

- `21ab319`: `FE/src/pages/study/QuizTaking.jsx` and its test only.
- `07fbf82`, `ef1b3de`: test files only.

None touch the header (`MainLayout.jsx`, `AccountMenu.jsx`, `UsageChip.jsx`,
`StudyToolsMenu.jsx`, `index.css`) or the Library popover
(`DocumentToolsSheet.jsx`, `libraryActionMatrix.css`). Agy's 58 checks
therefore still apply to the final head and were not repeated.
