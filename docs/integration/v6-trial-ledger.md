# V6 integration trial: ledger (`integ/v6-trial`)

Owner decision D1 (2026-11-22): integrate the V6 Draft PRs on a trial branch from `main`
`db005ab`. No PR is merged, rebased or changed. This branch exists so that V9.3 P1b
starts from a verified baseline.

## What went in

- 38 open Draft PRs, #159–#196, at the head commits fetched on 2026-11-22.
- The table lists 17 tips, merged with `git merge --no-ff`. Merging a tip brings in its
  stacked ancestors, so no commit is copied twice and none is cherry-picked.
- Afterwards, every one of the 38 head SHAs is an ancestor of this branch's HEAD
  (checked with `git merge-base --is-ancestor`).

| Order | Tip branch | PR | Brings in |
|---|---|---|---|
| 1 | fix/v6-source-loading-state | #160 | — |
| 2 | fix/v6-double-submit-guards | #162 | — |
| 3 | fix/test-guided-dialog-unmount | #181 | — |
| 4 | fix/devtest-isolation | #187 | — |
| 5 | fix/llm-timeouts | #189 | — |
| 6 | fix/e2e-memory-isolation | #191 | — |
| 7 | test/mindmap-export-contract-slow | #195 | — |
| 8 | design/v6-header | #167 | — |
| 9 | design/v6-profile | #168 | — |
| 10 | ci/v6-fixture-smoke | #170 | — |
| 11 | fix/v6-summary-loading-state | #165 | #164 |
| 12 | design/v6-foundation | #159 | — |
| 13 | design/v6-learning-progress | #186 | #176, #173, #172, #171, #166 |
| 14 | design/v6-mobile-viewport | #184 | #180, #178, #177, #174, #163, #161 |
| 15 | design/v6-quiz-review | #182 | #179, #175, #169 |
| 16 | fix/practice-regrade-background | #193 | #192, #190, #188, #185, #183 |
| 17 | feat/db-role-separation | #196 | #194 |

## Resolutions written by hand

These exist **only on this branch**. When the PRs are merged into `main` for real, the
same conflicts come back and must be resolved the same way. Otherwise the tested
baseline differs from what ships.

To see each resolution exactly: `git show --remerge-diff <merge>`.

| Merge | File | PRs that collide | Resolution |
|---|---|---|---|
| `da001b1` | `BE/scripts/run_e2e_server.py` | #187 (empty provider/Supabase keys and the `kiem_tra_dich` target check) vs #191 (loopback `*_test` check, `SKIP_DOTENV=1`, popped keys) | Both guards kept. The keys are emptied as in #187, which also covers `SUPABASE_*`. #191's loopback `*_test` check and `SKIP_DOTENV=1` stay. #191's three `pop()` calls are dropped, because #187 already empties those keys. |
| `1aad940` | `FE/src/components/Layout/MainLayout.jsx` | #160 (collapsed-panel `/list-indexed` fetch) vs #167 (header: one theme control) | Kept #160's effect. Took #167's `const { isDark, toggleTheme } = useTheme()`; `setLight` and `setDark` have no remaining use. |
| `0926f56` | `FE/src/index.css` (end of file) | #167 (account-menu `@media` one-liner) vs #174/#178 (chat transcript and composer CSS) | Both blocks kept, #167's first. Append-only. |
| `c45389f` | `FE/src/pages/study/QuizResult.jsx` | #175/#182 (compact correct rows; one filled action) vs #193 (review link hidden while a regrade is pending; ungraded tone) | #193's `reviewPlanTo &&` guard and its ungraded `--text-muted` tone. #175's compact block after it. The "Mở kế hoạch ôn tập" link stays `btn-secondary`, following #182's "one filled action". #193 had made it `btn-primary`. |
| `b7168a8` | `FE/src/pages/study/ReviewGuide.jsx` | #182 vs #194 (import order only) | Took #194's sorted `useCallback, useEffect, useRef, useState`. |
| follow-up commit | `BE/scripts/run_e2e_server.py` | #187 test (`exit 2` and `DỪNG`) vs #191's `sys.exit(message)` (exit 1) | Found by the BE regression (2 failures in `test_devtest_isolation`). #191's refusal now prints `DỪNG: ...` to stderr and exits 2, with no password. #191's own test (non-zero, no password) still passes. Red first: 2 failed; green: 54 passed. |
| `8d69ece` (P1a of #197) | `FE/src/index.css` tokens | #159 (`--brand-text` wordmark red; old seal) vs #197 (V9.3 values) | Took the V9.3 values. `--brand-text` is kept as the V9.3 brand-text role: `#765300` light, `#F4D178` dark. |
| `8d69ece` | `FE/src/components/Layout/ChatArea.jsx` | #178 (worded "Huỷ" cancel button, `h-10`) vs #197 (44px icon cancel) | Kept #178's worded button at `h-11` (44px). |
| `b719caf` (adaptation) | `FE/src/index.css`, `FE/src/pages/study/quizJourney.css`, `FE/src/pages/landing.wordmarkContrast.test.js` | V6 CSS vs the #197 contract test | V6's 2px accent rings become the 3px `--focus` ring. The V6 wordmark test pins the V9.3 seal instead of the old red, and keeps its 4.5:1 check. |
| adaptation (CI Fixture Smoke) | `FE/e2e-fixture/landing-wordmark-contrast.spec.js` | #159/#167 spec (wordmark colour must differ from `--seal`) vs #197 (V9.3 uses one brand-text colour for both) | Dropped only the `brand != seal` assertion. The scoping check (wordmark uses `--brand-text`, every other `.text-seal` uses `--seal`) and the 4.5:1 contrast checks stay. Locally: 5 passed. |
| every merge marked `playbook-union` | `.playbook/known-issues.md`, `.playbook/lessons-learned.md` | all | Union of both sides with `git merge-file --union`. These are append-only logs, so no entry is dropped. |

## Regression on this branch

| Check | Result |
|---|---|
| FE vitest | before P1a: 262 files, 2142/2142. With P1a (`b719caf`): 263 files, 2152/2152 |
| FE `vite build` | pass |
| FE lint ratchet | 63 (baseline 67) |
| BE pytest (disposable PostgreSQL 17, owner mode) | 3250 passed, 99 skipped, 8 failed before the follow-up: 6 known baseline (`test_index_khoa_that` ×5, `test_fpt_rerank` ×1) and 2 caused by the merge, fixed in the follow-up (54/54 in both isolation suites). Redis was not running locally. |
| Conflict markers left | none (`git grep`) |
