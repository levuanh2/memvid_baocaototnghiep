# Round 8.4 evidence: CI/CD safety and remaining QA closure

| Item | Value |
|---|---|
| Base | `origin/main` `2479a32` (PRs #98, #99 and #100 merged) |
| Track A | `fix/studymap-v4-round8-4-deploy-safety`, Draft PR #101: deploy only the CI-verified SHA; protected-auth proof; Render `checksPass` |
| Track B | `fix/studymap-v4-round8-4-qa-hardening` (this PR): collection focus, mobile touch, fixture CI, runtime revision, Practice Quiz and asynchronous grading, destructive dialogs, screen-reader checklist |
| Merge order | Either order. The two branches merge cleanly (`git merge-tree`). Runtime revision needs both PRs: A exports `APP_BUILD_SHA`, B consumes it |
| Status | **Draft. Not merged, not deployed. The Library flag is untouched. No production data was written** |

Track A evidence is committed on its own branch, in this same folder:

- `deployment-sha-pinning.md`
- `protected-auth-ci.md`
- `track-a-independent-review-round*.md`
- `codex1/R84A-REPORT.md`

## Files (Track B)

| File | Content |
|---|---|
| `focus-and-touch-regressions.md` | Collection focus after delete; mobile touch selection; R84-TOUCH-01 (NOT VERIFIED on a real device) |
| `fixture-ci-coverage.md` | Blocking Fixture Smoke (10 specs) vs the weekly full suite; cost and flake evidence |
| `runtime-version-verification.md` | `/health` `revision` and `<meta name="studymap-build">` |
| `practice-quiz-e2e.md` | Practice Quiz and asynchronous grading on the real API and database. Full report and runners in `codex2/` |
| `destructive-dialog-matrix.md` | Map, summary, chat history and collection dialogs in the real app (Agy) |
| `accessibility-manual-checklist.md` | Screen-reader checklist for a human tester (gate stays NOT VERIFIED) |
| `residual-release-gates.md` | Open decisions and gates; citation-navigation recommendation |

## Who did what

Reviewers state whether they authored what they reviewed. A self-review is
not an independent review.

| Agent | Work |
|---|---|
| Claude | Coordination; collection focus fix; fixture CI; runtime revision; touch-spec integration and R84-TOUCH-01 investigation; investigations for Part C; Track A round-3 fixes (not independent) |
| Codex1 | Track A implementation, rounds 1–2 (ran out of usage) |
| Codex2 | Practice Quiz and asynchronous grading E2E with E2E-only stubs; **independent reviewer of Track A** (not an author) |
| Agy | First mobile touch spec and negative control; real-app collection and chat-history dialogs |
| Codex1 (after its usage reset) | Real-app map and summary dialogs (found them unreachable) |

## Independent reviews

| Track | Reviewer (not the author) | Result |
|---|---|---|
| A | Codex2 | Round 1 BLOCK (11), round 2 BLOCK (3 HIGH), **round 3 APPROVE** |
| B | Codex2 (its own `run_e2e_server.py` stubs excluded) | **REQUEST CHANGES**: 1 MEDIUM, 4 LOW (`track-b-independent-review.md`). All five addressed; **round 2: APPROVE** (`track-b-independent-review-round2.md`). Its one remaining LOW, the `_build_revision` docstring that overclaimed "cannot leak anything", is corrected |
