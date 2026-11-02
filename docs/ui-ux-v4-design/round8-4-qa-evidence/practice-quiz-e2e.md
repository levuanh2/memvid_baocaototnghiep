# Practice Quiz and asynchronous grading (real API and database)

| Item | Value |
|---|---|
| Source revision | `origin/main` `2479a32`. The E2E-only stubs live in this branch's `BE/scripts/run_e2e_server.py` and are off by default |
| Environment | Real Flask `run_e2e_server.py` on `:8280`, `AUTH_PROTECT_APP_APIS=true`. Production build on `:4373`. Disposable Postgres `r82-pg` (`studymap_test`, alembic head). One headless Chromium |
| Owner | Codex2. Claude reviewed and integrated the stub and the report |
| Full report | `codex2/practice-quiz-and-async-grading-report.md`: contract with file:line, request logs and SQL read-backs |
| Runners | `codex2/qa-r84/r84_practice_e2e.py`, `codex2/qa-r84/r84_async_grading_e2e.py`. The original temporary copies were deleted during cleanup. These are **reconstructed**, marked as such in their headers, and were **re-run** on 2026-11-02 15:53 +07:00 (see "Re-run with reconstructed runners" in the report) |

## What is stubbed, and what is not

Two flags in `run_e2e_server.py` are **off by default**:

- `E2E_PRACTICE_AI_STUB` wraps only
  `app.domains.quiz.generator.generate_questions` for `quiz_type == "practice"`.
  Every other quiz type calls the real function.
- `E2E_SHORT_ANSWER_GRADING_STUB` injects a deterministic `ask` into the real
  `grade_short_answer` parser. It has an optional delay
  (`E2E_SHORT_ANSWER_GRADING_DELAY_SEC`) and a failure marker.

Routes, authorisation, jobs, validation, grading orchestration and Postgres all
run for real. This mirrors the existing `QUERY_GRAPH` and `MINDMAP_GRAPH`
substitutions. No product behaviour was added.

## Practice Quiz

| Scenario | Expected | Observed | Status |
|---|---|---|---|
| Generation from ReviewGuide | POST then job then a persisted practice quiz | 202, the job finished, the UI loaded a 5-question quiz | PASS |
| Provenance | Quiz traceable to its review item, source attempt and permitted chunks | SQL: matching `source_review_item_id` and `source_attempt_id`; 5 questions; 5 chunk links | PASS |
| A separate "start attempt" | If supported | Practice opens its attempt inside its one-shot submit (`BE/app/application/practice.py:66-93`) | NOT SUPPORTED (by design) |
| Answers persist before submit (reload) | If supported | Answers live in component state only; `Practice.jsx:20-24,58-64` deliberately saves no drafts | NOT SUPPORTED (by design) |
| Exactly one submission | 1 attempt, 5 answers | One POST; SQL `attempt_count=1`, `answer_count=5` | PASS |
| Scoring | 4 correct + 1 wrong = 4/5, 80% | UI, API and SQL all show 4/5, 80% | PASS |
| Review content | Answers, correct answers, explanations, feedback | The result API returns all 5 with provenance | PASS |
| Per-answer review on the Practice page | If supported | The page shows score and comparison only (`Practice.jsx:102-183`) | NOT SUPPORTED (by design) |
| Before and after comparison | Source attempt vs the latest practice | Mastery 0.0 to 0.8, delta 0.8, "became mastered" | PASS |
| Generation retry | New independent job (no dedupe by design) | Two retries returned two distinct job ids | PASS |
| Retake the same quiz | If supported | No control or endpoint | NOT SUPPORTED (by design) |
| Account isolation | User B cannot read or submit A's practice, or GET, PATCH or submit A's attempt | All 404 | PASS |

## Asynchronous grading (APPLICABLE: a real production contract)

A quiz with any short-answer question takes this path:

- submit returns **202** plus a `short_answer_grading` job
  (`BE/app/main.py:4171-4183`, `BE/app/application/attempts.py:182-215`);
- the UI polls every 3 s while `status == "submitted"`
  (`FE/src/pages/study/QuizResult.jsx:66-86`).

| Scenario | Expected | Observed | Status |
|---|---|---|---|
| Submit contract | 202, `status=submitted`, job id | As expected | PASS |
| No score while pending (API) | `score`, `percentage` and verdicts all null | All null | PASS |
| No score while pending (DOM) | "Đang chấm"; no score and no per-question review | As expected | PASS |
| Reload while pending | Polling resumes and reaches graded | Yes, in both the success and the failure flow | PASS |
| Completion | 2/2 matches SQL | UI, API and SQL all show 2.00/2.00 | PASS |
| Grader failure | An ungraded answer, not a fabricated verdict | `ungraded_count=1`, verdict null, attempt `graded` | PASS (current contract) |
| Failure UI | Partial totals; the answer marked as unresolved | **1 / 2, 50%**, "Chưa chấm" | PASS (current contract). **Product risk: see below** |
| Regrade or retry | If supported | No route; resubmitting returns 409 | NOT SUPPORTED |
| Job isolation | User B cannot poll A's job | 404 | PASS |

**Product risk (Decision, P2).** A grader outage leaves the answer ungraded
for good, and it still counts in the denominator, so the learner's score
drops. Details and options are in `residual-release-gates.md`.
