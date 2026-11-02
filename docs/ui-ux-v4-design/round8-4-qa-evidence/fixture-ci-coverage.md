# Fixture regression coverage in CI

| Item | Value |
|---|---|
| Source revision | `origin/main` `2479a32` plus the Round 8.4B branch `fix/studymap-v4-round8-4-qa-hardening` |
| Environment | Local Windows 11, Chromium, Vite fixture harness (`FE/playwright.fixture.config.js`: mocked API, no backend), `--workers=1` |
| Owner | Claude |

## Problem

The fixture suite (32 specs, 448 tests) passed locally in Round 8.3. It was
not part of GitHub CI, so a regression in the header, Library, Export Studio
or MindMap could merge unnoticed.

## Cost and history

Measured per-spec durations come from the Round 8.3 full run (448/448, one
worker, about 1000 s in total). The largest specs are:

| Spec | Tests | Seconds |
|---|---|---|
| `responsive` | 133 | 160 |
| `mobile-header` | 111 | 118 |
| `mindmap-visible-repair-deadline` | 6 | 75 |
| `marker-click-resolution` | 3 | 73 |
| `exact-node-export-v3` | 9 | 58 |
| `export-studio` | 25 | 56 |
| `mindmap-depth-presets` | 17 | 51 |

History of flakiness:

- `multi-branch-export-raster-connectors` was flaky (about 1 in 3) until
  R82-T01 was fixed in Round 8.3; afterwards it passed 15/15.
- `mindmap-depth-presets` failed deterministically (R82-P3-01) until Round
  8.3; afterwards it passed 51/51 over 3 repeats.

## Decision

| Suite | Where | Blocking? | Trigger |
|---|---|---|---|
| **Fixture smoke**: 9 specs listed below | `ci.yml` job `fixture-smoke`, included in `CI / required` | **Yes** | `main` pushes and PRs that change `FE/**`, `package*.json`, `.github/**`, `docker-compose*` or root `*.yml` (the same `detect-changes` rule as the frontend jobs) |
| **Full fixture suite** (448 tests) | `fixture-audit.yml` (workflow name "Fixture Audit") | **No**, periodic verification | Mondays 03:17 UTC, plus manual `workflow_dispatch` |

The full suite lives in its own workflow on purpose. `deploy.yml` triggers on
the workflow named "CI", so a failure in Fixture Audit can never block or
trigger a production deploy.

### Smoke set, mapped to the Round 8.4 requirements

| Requirement | Spec |
|---|---|
| Header boundary regressions | `mobile-header.spec.js` |
| Library Action Matrix | `round6-library-action-matrix.spec.js` |
| Export Studio Preview Bench | `export-studio.spec.js` |
| Exact-node and branch image export | `exact-node-export-v3.spec.js`, `exact-branch-artifact-gates.spec.js`, `post-pr77-exact-selection.spec.js` |
| Raster connectors | `multi-branch-export-connectors.spec.js`, `multi-branch-export-raster-connectors.spec.js` |
| Depth presets | `mindmap-depth-presets.spec.js` |
| Touch selection | `mobile-touch-selection.spec.js` (Round 8.4B, added after Agy's run; see `focus-and-touch-regressions.md`) |
| Destructive dialog focus | **Not a fixture spec.** It is covered by Vitest (`CollectionSidebar.focusRestore.test.jsx`, which `frontend-tests` already runs) and by the real-app probe in `destructive-dialog-matrix.md` |

### Flake policy

The job runs with `--fail-on-flaky-tests`. The fixture config keeps
`retries: 1` in CI, so a test that passes only on retry is reported as
**flaky** and fails the job. A flake can therefore not hide behind a retry.

Limits: `timeout-minutes: 20`, `--workers=1`, Chromium only. On failure the
report and traces are uploaded (`playwright-fixture-report`, 10 days).

## Stability evidence before making it blocking

| Run | Command | Expected | Observed | Result |
|---|---|---|---|---|
| Smoke ×3 (9 specs) | `npx playwright test -c playwright.fixture.config.js --workers=1 --repeat-each=3 --fail-on-flaky-tests <9 specs>` | 0 failures, 0 flaky | **570 passed, 0 failed, 0 skipped, 0 flaky** in 23.5 min (2026-11-02, 08:29Z start) | PASS |

One pass of the smoke set therefore takes about 7.8 minutes locally, inside
the 20-minute job limit.

## Side effect to know about

Some fixture specs write screenshots and metrics into tracked evidence folders
(`docs/ui-ux-v4-design/round6-qa-evidence/`, `round7-qa-evidence/` and
`docs/qa-screenshots/usage-metering/`). In CI this is harmless, because the
checkout is thrown away. Locally, restore those files before committing;
Rounds 8.3 and 8.4 did so every time.

## Not yet verified

- The first GitHub-hosted run of `fixture-smoke`. Its result is recorded in
  `README.md` once the Draft PR's CI finishes.
- Fixture Audit has not run on GitHub yet: it starts on the next Monday
  schedule, or on a manual dispatch by the repository owner.
