# Round 8.1 fixes after merge (`c02e2b9`)

Every check below ran on merged main. The tree is identical to the Round 8.1
PR head `fb6aaec`. Round 8.1 evidence is not rewritten; anything new is filed
under a new ID.

## How to read the evidence categories

| Category | What it means |
|---|---|
| CI | GitHub Actions on `c02e2b9` |
| Unit | Local Vitest |
| Fixture | Local Chromium with the Vite fixture harness and mocked data |
| Real | Local Chromium against real Flask and disposable Postgres |

| Defect | Check | Category | Owner | Result |
|---|---|---|---|---|
| **R8-001** header | 56 px single row and 0 px overflow at 320 and 1024 px, light and dark | Fixture | Agy | PASS |
| | Account reachable: centre hit-test, and the menu opens and stays contained | Fixture | Agy | PASS |
| | Compact theme switch through the StudyTools menu, toggling `.dark` and storage | Fixture | Agy | PASS |
| | `mobile-theme-control` 1100↔1101 boundary, inside critical suite 40/40 | CI, and Real (open auth and protected auth) | CI / Claude | PASS |
| **R8-002** Quiz autosave | `QuizTaking.round7.test.jsx`, 3 isolated runs | Unit | Codex2 | 10/10 ×3, PASS |
| | Deferred PATCH barrier, latest answer persisted, one submit under repeated clicks, 409 on duplicate | Real | Codex1 | PASS (`quiz-10q-api-e2e.md`) |
| **R8-003** stale image export | `ExportStudioDialog.imageCommitBoundary` and `mindmapImageExport` | Unit | Codex2 | 36/36, PASS |
| | Valid export gives exactly 1 file for the intended map; Escape and Cancel are refused mid-export | Real | Claude | PASS |
| | Close in the same task as the click | Real | Claude | New **R82-P3-02** (P3, not reachable by human input) |
| **R8-004** Library readiness | `libraryActionMatrix` and `LibraryActionMatrix` | Unit | Codex2 | 44/44, PASS |
| | `round6-library-action-matrix` | Fixture | Codex2 | 19/19, PASS |
| **R8-005** tablet popover | 768, 820 and 1024 px, light and dark: 11/11 rows at 44 px, flips upward near the bottom, top ≥ 0, bottom ≤ viewport height | Fixture | Agy | PASS |
| **R8-006** Preview Bench selectors | `export-studio` 25/25; `responsive` 133/133 | Fixture | Codex2 | PASS |
| **R8-007** raster fixture | `multi-branch-export-raster-connectors` | Fixture | Codex2 / Claude | **Flaky, about 1 in 3.** The test helper sometimes imports `MindElixir.css`. Product assertions pass whenever the helper resolves the module. New **R82-T01** (test-only, P3). See `claude/r8-007-raster/` |

## Library flag OFF and ON (Part F §12)

| Check | Category | Result |
|---|---|---|
| Production bundle has the flag OFF | Production, read-only | PASS (`git-deployment-verification.md`) |
| OFF build renders the legacy Library | Real | PASS |
| ON build renders the Learning Action Matrix | Real | PASS |
| Back restores Library state (ON) | Real | PASS |
| No cross-account Library state, same tab; server-side 404 on another account's document | Real, protected | PASS |
| Bulk scope uses visible UUIDs only; readiness gates | Unit and Fixture | PASS (44/44, 19/19) |
| OFF and ON builds | Local build | PASS, 2,409 modules each |

Details: `claude/library-flag/README.md`.

## Automated suites on `c02e2b9`

| Suite | Category | Result |
|---|---|---|
| Frontend Vitest (`src`, 201 files) | CI and Unit | 1,798/1,798 |
| Literal `npm test` | Unit | **201 files and 1,798 tests PASS**, after the temporary audit runners were removed from `FE/` at about 18:10Z. While they were present, Vitest collected them and reported `1 failed` (an import of a Playwright spec), not a project test failure |
| `npm run build`, flag OFF and ON | Local | PASS |
| `npm run lint:ratchet` | Local | 63 ≤ 67 |
| Critical real-backend Playwright (`FE/playwright.config.js`) | CI | 40 passed |
| Same suite, open auth (CI mode) | Real | **40/40**. This was BLOCKED in Round 8.1 |
| Same suite, `AUTH_PROTECT_APP_APIS=true` | Real | **40/40** |
| Backend pytest: export, PDF, quiz, attempt and persistence (36 files) | Real database | 503 passed, 0 failed, 0 skipped |
| Backend integration and migrations | CI | 2,980 passed, 8 skipped |
| Fixture specs: `export-studio`, `responsive`, `round6-library`, raster | Fixture | 177/178. The one failure is R82-T01 |

## Verdict

All seven Round 8.1 fixes survived the merge. No P0, P1 or P2 regression was
found. Two new P3 items:

- **R82-T01**: test helper flake.
- **R82-P3-02**: latent close/commit race.
