# R85 — AI short-answer grading integrity

Status: **complete**. No commit, push, production call, or migration.

## 1. Investigation and data flow

### Durable model

- `BE/app/db/models.py:461-498`: `quiz_attempts` owns `score`, `max_score` (non-null), `percentage`, counts, `status`, timestamps, and `metadata_json`. The status CHECK has no provisional enum, so a new status would require a migration.
- `BE/app/db/models.py:501-525`: `quiz_answers` owns the durable `user_answer`, nullable `verdict` / `score`, feedback, and grading timestamp.
- `BE/app/domains/attempts/repository.py:59-98`: result reload reads every persisted answer, including the original response.
- `BE/app/domains/attempts/repository.py:157-202`: `save_grades` updates only successfully graded rows, writes attempt totals atomically, and persists `metadata_json.ungraded_count`. A failed AI grade is absent from the `graded` list, so its existing draft row and `user_answer` are not overwritten or dropped.

### Root cause

- `BE/app/domains/attempts/grading.py:71-116`: infrastructure/model/parse failure deliberately returns `None`, not an incorrect verdict.
- `BE/app/domains/attempts/service.py:44-89`: `grade_attempt` increments `ungraded_count` and omits that question from `graded`.
- Base `2479a32`, `grading.totals` nevertheless used `total_questions` as `max_score`. Thus omitted AI failures contributed 0 earned points but still contributed 1 maximum point: 1 correct objective + 1 unavailable AI grade became 1/2 = 50%.
- The attempt was still persisted as `graded`; resubmit is correctly rejected with 409, and no regrade route exists.

### Downstream consumers and decision

- Attempt/result APIs: `BE/app/application/attempts.py:81-95,237-269`. Add derived `grading_complete`; keep existing status and `ungraded_count`.
- Gap/mastery: `BE/app/domains/gap_analysis/service.py:38-96` already excludes answers whose verdict is null, and concepts with zero graded questions create no row. No formula rewrite; regression coverage locks this.
- Review plans: `BE/app/domains/review/service.py:118-155,158-177` consumes those mastery snapshots and only incorrect/partial answer sources. Therefore null-verdict questions are already excluded rather than treated as wrong. A provisional attempt may yield a plan only from genuinely graded weak answers.
- Progress overview: `BE/app/domains/progress/service.py:97-141` averaged every status=`graded` percentage. Provisional attempts are now excluded from `average_percentage`.
- Practice comparison: `BE/app/domains/progress/service.py:231-241` selected the latest status=`graded` attempt. It now selects the latest fully graded attempt, so an incomplete practice run cannot replace a prior complete comparison.
- Concept progress: `BE/app/domains/progress/service.py:144-191` consumes question-level mastery rows. Keeping valid graded questions is intentional; the genuinely ungraded questions never produce mastery input.
- History/library: `BE/app/domains/progress/service.py:194-228` now returns the additive completion fields; `FE/src/pages/study/DocumentList.jsx:887-912` labels provisional/zero-graded entries instead of displaying a final-looking score.
- Result UI: `FE/src/pages/study/QuizResult.jsx:88-180,224-272` explicitly renders “Kết quả tạm thời”, ungraded count, and provisional denominator. Zero graded questions render “Chưa chấm được” with no 0%.
- Practice UI: `FE/src/pages/study/Practice.jsx:79-126` uses the same provisional/no-score semantics and does not award the mastered seal.
- Dashboard: `FE/src/components/study/LearningDashboard.jsx:50-52` reads `overview.average_percentage`; the backend filter prevents provisional percentages from reaching it.

## 2. Design and implementation

No migration and no new endpoint.

1. `grading.totals` computes score/max/counts only from entries with a valid verdict and non-null score. Blank learner answers still receive an explicit incorrect verdict and remain in the denominator.
2. If zero questions were graded: `score=0`, `max_score=0`, `percentage=null`. This satisfies the existing non-null `max_score` column and avoids division by zero or a false 0%.
3. Public attempt, quiz-attempt list, and progress history add:
   - `ungraded_count: integer` (already present on the main attempt/result projection; now also present on list/history projections)
   - `grading_complete: boolean`
4. Status remains `graded` for backward compatibility and to expose the graded subset. Consumers must use `grading_complete` / `ungraded_count` when presenting finality.
5. Progress average and latest-practice comparison filter out incomplete attempts via existing `metadata_json.ungraded_count`; historical rows without the key are treated as complete.

### Contract additions

Additive only:

- attempt/result payload: `grading_complete`
- quiz attempt list and progress history rows: `ungraded_count`, `grading_complete`

Existing fields and routes are unchanged. Fully graded objective and short-answer attempts retain their previous score, maximum, percentage, status, mastery, and UI.

## 3. Test evidence

### Fail-on-main proof — base 2479a32

Command:

```powershell
cd BE
python -m pytest tests/test_quiz_attempt.py::test_totals_exclude_questions_that_could_not_be_graded tests/test_quiz_attempt.py::test_totals_with_no_successfully_graded_question_have_no_percentage -vv
```

Expected: new integrity tests fail on main.  
Observed: **FAIL as expected, 2/2**. Base returned `max_score=4` instead of 2 and returned `max_score=2, percentage=0.0` for zero graded questions.

Command:

```powershell
cd FE
npm test -- --run src/pages/study/QuizResult.round7.test.jsx
```

Expected: new provisional UI tests fail on main.  
Observed: **FAIL as expected, 2 new failures**. Base rendered `100% · điểm thô` and `0 / 0`, with no provisional/incomplete label.

### Passing focused tests after fix

- Backend totals: **PASS, 2/2**.
- `QuizResult.round7.test.jsx`: **PASS, 6/6**.

### Acceptance matrix (live status)

| # | Scenario | Expected | Observed | Status |
|---|---|---|---|---|
| 1 | Fully graded objective | unchanged | real stack 0/1 wrong answer, complete, 0%; full regression green | PASS |
| 2 | Fully graded short answer | unchanged | real stack 1/1, 100%, complete | PASS |
| 3 | Partial outage | 1/1 graded, incomplete, ungraded=1, not 50% | real stack 1/1, 100% provisional, ungraded=1 | PASS |
| 4 | All AI grades fail | no division error, no 0%, incomplete | real stack 0/0, percentage null; browser showed no 0% | PASS |
| 5 | Retry/regrade feasibility | document only | see proposal below | PASS |
| 6 | Score + mastery/gap/progress | null-verdict excluded | only graded-objective mastery persisted; complete-attempt average=50 | PASS |
| 7 | Result reload | same provisional state | Postgres + browser hard reload retained provisional state | PASS |
| 8 | Cross-account isolation | B gets 404 for A attempt/result/job | real stack returned 404/404/404 | PASS |

## 4. Regrade proposal — not implemented

Proposed route: `POST /api/attempts/:id/regrade-ungraded`.

- Ownership: load through the same fail-closed owned-attempt gate; another account receives 404.
- Eligibility: attempt must be `graded` with `metadata_json.ungraded_count > 0`.
- Scope: query only short-answer rows for this attempt whose persisted `verdict IS NULL`; use the already stored `quiz_answers.user_answer`. Never accept replacement answers in the request.
- Idempotency/concurrency: under a transaction/advisory lock, reuse an active regrade job for the same attempt; if none exists, enqueue one. A repeated request returns the active job rather than grading twice.
- Rate limit: account + attempt cooldown, with 429 and retry metadata.
- Job: reuse the short-answer grading job shape, but pass an explicit “null-verdict only” mode. On completion, recompute the entire attempt totals from all now-graded answers, refresh masteries atomically after grade persistence, and update `ungraded_count`.
- Contract: 202 with `job_id`, `attempt_id`, `reused`; existing job polling can be reused. Terminal response remains the normal result payload.
- Migration: likely none for correctness. Strong database-level idempotency/job history may justify a dedicated regrade request table or durable job key; that is a schema/operational decision and requires release-owner approval.

Why approval is required: this introduces a mutating endpoint, rate-limit policy, job idempotency semantics, and concurrent recomputation of durable scores/masteries. It is materially larger than correcting today’s scoring and presentation contract.

## 5. Completed gates

- Focused Flask+Postgres outage integrations: **2 passed**
- Relevant backend regression: **66 passed**
- Full frontend Vitest: **202 files, 1802 tests passed**
- Frontend build with E2E API origin: **PASS**
- `npm run lint:ratchet`: **PASS**, current 63 vs baseline 67
- Real stack (Flask 8280, FE 4373, local `r82-pg`, Track B stub): four
  grading scenarios PASS; progress average 50; isolation 404/404/404; duplicate
  submit 409; hard reload preserved provisional UI.
- Temporary Track B stub and runner were removed after verification.
- The `codex2` heavy lock was deleted after tests. A later final check found the
  lock recreated with owner `agy`; it was left untouched for that active owner.
- Final `git diff --check`: **PASS**. Ports 8280/4373 stopped.
