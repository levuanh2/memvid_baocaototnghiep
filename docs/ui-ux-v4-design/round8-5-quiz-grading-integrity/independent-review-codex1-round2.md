# P2 grading integrity — re-review

Disclosure: independent re-review of Claude's `eef6c50`; I authored neither the original change nor this fix. Target worktree remained read-only.

Verdict: **APPROVE**

1. **FIXED — HIGH completion/progress + Library count.** Shared `grading_complete_clause()` is defined at `BE/app/domains/attempts/repository.py:15-20`; progress imports it and filters both complete-count and average at `BE/app/domains/progress/service.py:14-17,110-140`; Library `ai_counts` applies it at `BE/app/domains/documents/repository.py:668-682`.
2. **FIXED — MEDIUM DocumentList label.** `attemptScoreLabel` restricts provisional wording to graded incomplete attempts and returns `—` for other statuses at `FE/src/utils/studyApi.js:232-242`; DocumentList delegates at `FE/src/pages/study/DocumentList.jsx:907`; five cases cover complete, partial, zero-graded, in-progress/submitted, and legacy payloads at `FE/src/utils/attemptScoreLabel.test.js:7-27`.
3. **FIXED — MEDIUM DB regression coverage.** `BE/tests/test_practice_and_progress.py:493-517` proves provisional attempts affect neither `completion_rate`, average, nor Library `graded_attempts`; requested DB-backed run passed **30/30**.
4. **FIXED — LOW whitespace.** `git diff --check origin/main...HEAD` exited 0 with no output.

Additional verification: `npx vitest run src/utils/attemptScoreLabel.test.js` passed **5/5**. No remaining finding from round 1.
