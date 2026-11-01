# Round 8.2: post-merge release gate evidence

**Verdict: CONDITIONAL.** No P0 or P1 issue. Two P2 accessibility items and
some NOT VERIFIED items need explicit risk acceptance. See
`final-release-readiness.md`.

| Item | Value |
|---|---|
| Audited tree | `c02e2b91ae2207d472756cd34003b5cb6fee1620`, the PR #98 merge (identical to `fb6aaec`) |
| Audit branch | `audit/studymap-v4-round8-2-release-gate`. Documentation only; never merge it, because a merge to main auto-deploys |

## Environments

| Name | What |
|---|---|
| CI | GitHub Actions run 41321373798 |
| Prod-RO | Read-only probes of `studymap.space` and `api.studymap.space`: GET and OPTIONS only, no login |
| Real | Local Chromium against the production-equivalent build of `c02e2b9` (`:4173`; Library-ON build on `:4174`) |
| Fixture | `FE/playwright.fixture.config.js` (Vite harness, mocked data) |

Details of the Real environment:

- Backend: real Flask `BE/scripts/run_e2e_server.py` on `:8080`. Only the AI graphs are stubbed.
- Database: disposable Postgres 16 in Docker (`r82-pg`, `:55432`), migrated to head.
- Auth: open mode for one critical run; `AUTH_PROTECT_APP_APIS=true` for everything else.

## Files

| File | Content |
|---|---|
| `git-deployment-verification.md` | main HEAD, PR #98, CI, EC2 deploy log, frontend bundle provenance, flag OFF |
| `runtime-health-matrix.md` | Revision and health per component |
| `quiz-10q-api-e2e.md` | 10-question journey on the real API and Postgres |
| `pdf-artifact-verification.md` | Downloaded PDFs (3-tier and 4-tier) and image export |
| `fixture-failures-triage.md` | All 12 pre-existing failures, plus the masked-assertion re-run |
| `accessibility-verification.md` | Account target, dialog contrast, Escape focus, keyboard, screen readers |
| `round8-1-regression.md` | R8-001 to R8-007 after merge; Library OFF and ON |
| `release-gate-matrix.md` | Every gate, with category, result and new defects |
| `final-release-readiness.md` | Answers A–F and the verdict |

## Evidence folders (one owner each; nobody overwrites another's files)

| Folder | Owner | Content |
|---|---|---|
| `claude/` | Claude | Production probes and bundle comparison; critical E2E logs (open and protected auth); real-backend PDF artifacts; Library OFF and ON spec; image-export spec; real destructive-dialog spec; R8-007 root cause; masked-assertion summary |
| `codex1/` | Codex1 | Quiz spec, seed, config, Playwright, request-order and psql JSON; backend pytest JUnit |
| `codex2/` | Codex2 | Fixture triage with raw JSON ×3; regression; masked-assertion migrated specs, diff and raw JSON |
| `agy/` | Agy | Account and header geometry (12 configurations); R8-001 and R8-005 regression; 4-tier PDF artifacts and rendered pages; fixture dialog run; protected-stack spec |

## Review notes from the coordinator

- Agy ran the dialog contrast and Escape test on the fixture harness, and its
  report labels that run "Real Backend". Claude re-ran the test in the real
  app, and the real run decides the verdict.
- Agy's image-export "mid-capture dismissal" pressed Escape **before** Export.
  Claude re-ran it properly; see `claude/image-export/`.
- Codex2 hit its usage limit before writing `masked-assertions.md`. Claude
  summarised Codex2's raw output in `claude/masked-assertions-summary.md`.
- Codex2 was the first to report the Round 8.1 raster fixture fix as
  incomplete (R8-007). Claude traced it to a resource-order flake (R82-T01).
- The audit spec runners were placed temporarily under `FE/` so that imports
  resolve, and were removed afterwards. While they were present, Vitest picked
  them up, so literal `npm test` failed. It is green after cleanup:
  201 files, 1,798 tests.
