# Independent review — P2 AI grading integrity

## Disclosure

I did not author this change. I reviewed commit `db9a818` on
`fix/studymap-v4-quiz-grading-integrity` against `origin/main` at `2479a32`.
The target worktree was kept read-only; this review file is the only output.

## Verdict: REQUEST CHANGES

The core grading correction is sound: an unavailable AI verdict is excluded from
the denominator, blank answers remain incorrect, partial credit remains 0.5,
zero graded answers produce `max_score=0` and `percentage=null`, original learner
text is preserved, and fully graded objective/short-answer attempts retain their
old totals (`BE/app/domains/attempts/grading.py:43-56,71-86,107-143`;
`BE/app/domains/attempts/repository.py:157-201`). The additive API fields and the
three edited result surfaces are directionally compatible, with no migration or
new endpoint.

However, not every downstream progress consumer was updated. A provisional
attempt still advances completion/library progress, which conflicts with the
required exclusion from progress and makes the patch incomplete.

## Findings

### HIGH — Provisional attempts still count as completed progress and as graded Library activity

`overview()` correctly excludes incomplete attempts from `average_percentage`
(`BE/app/domains/progress/service.py:116-121`), but derives `graded` for
`completion_rate` from every row whose status is `graded`, without the new
completion predicate (`BE/app/domains/progress/service.py:110-138`). Because the
patch intentionally keeps a partial/outage attempt at status `graded`, even an
all-AI-failed 0/0 attempt raises completion progress.

The Library aggregation has the same missed consumer: `ai_counts()` counts every
`QuizAttempt.status == "graded"` (`BE/app/domains/documents/repository.py:663-680`).
That value feeds `ai.quiz.graded_attempts` and is used as real
learning activity by the Library/analytics paths (`BE/app/domains/documents/thu_vien.py:392-396`;
`FE/src/utils/thuVienTaiLieu.js:279`; `FE/src/study/learningAnalytics.js:133-134`).
Consequently a grader outage can still promote Library/progress state and can put
a document into the “graded but no review guide” bucket, despite no final grade.

Apply the same `_grading_complete_clause()` (or equivalent) to completion-rate
and Library graded-attempt counting, while retaining genuinely graded question
masteries. Add regression coverage for partial outage and zero-graded attempts in
both projections.

### MEDIUM — DocumentList mislabels every non-graded attempt as a provisional result

`grading_complete` is false for `in_progress` and `submitted` attempts by design
(`BE/app/application/attempts.py:81-95`; `BE/app/domains/progress/service.py:214-222`).
But the history row checks only `a.grading_complete === false`, not
`a.status === "graded" && a.ungraded_count > 0` (`FE/src/pages/study/DocumentList.jsx:887-912`).
An untouched in-progress attempt therefore displays `tạm thời · — / N`, even
though no provisional result exists; a submitted/pending attempt is similarly
conflated with an AI-grading outage. Keep the provisional label restricted to
graded attempts with ungraded answers and preserve pending/in-progress wording.

### MEDIUM (test gap) — Requested backend run executes no assertions; downstream surfaces are untested

Independent execution of the requested backend command produced **15 skipped,
0 passed** because the module-wide autouse fixture skips when
`TEST_DATABASE_URL` is absent (`BE/tests/test_quiz_attempt.py:46-51`). That fixture
also skips the otherwise pure totals tests at lines 25-41. A direct read-only
invocation did confirm `1.5/2 = 75%` and `0/0 -> percentage None`, but the requested
run did not independently exercise persistence, ownership, mastery, or progress.

The added frontend tests cover only QuizResult's partial and zero-graded states
(`FE/src/pages/study/QuizResult.round7.test.jsx:71-99`). There is no new test for
Practice, DocumentList, completion rate, practice comparison, attempt list/history,
or Library aggregation. This is why both consumer regressions above pass the
focused suite. Add focused tests for those paths; retain the existing cross-account
test (`BE/tests/test_quiz_attempt.py:355-370`) and run it with a configured test DB.

### LOW — The branch does not pass `git diff --check`

The authored report contains trailing whitespace at
`docs/ui-ux-v4-design/round8-5-quiz-grading-integrity/grading-integrity-report.md:66`
and `:76`, despite its claim that final `git diff --check` passed. This is hygiene,
not a grading-integrity defect.

## Consumer audit notes

- Correct: totals, blank-answer behavior, partial credit, objective-only attempts,
  zero-graded handling, durable original responses, and fully graded behavior.
- Correct: gap/mastery excludes null verdicts
  (`BE/app/domains/gap_analysis/service.py:38-95`); review-plan wrong sources select
  only incorrect/partial verdicts (`BE/app/domains/review/service.py:158-170`).
- Correct: progress average and latest practice comparison filter incomplete
  attempts (`BE/app/domains/progress/service.py:116-121,231-241`).
- Correct UI for genuinely provisional results: QuizResult
  (`FE/src/pages/study/QuizResult.jsx:88-95,154-177,224-272`) and Practice
  (`FE/src/pages/study/Practice.jsx:79-84,107-130`). DocumentList is correct only
  for graded provisional attempts, not other statuses.
- No quiz score export/report consumer was found beyond the history/library and
  dashboard/analytics projections above.
- Ownership gates and routes are unchanged; no migration or endpoint was added.

## Test evidence

- `cd BE && python -m pytest tests/test_quiz_attempt.py -q` — **15 skipped**, 0
  passed (missing `TEST_DATABASE_URL`).
- `cd FE && npx vitest run src/pages/study/QuizResult.round7.test.jsx` — **1 file,
  6 tests passed**.
- Direct pure-function check — `totals(correct + partial, total_questions=4)`
  returned `score=1.5, max_score=2.0, percentage=75.0`; `totals([], 2)` returned
  `max_score=0.0, percentage=None`.
- `git diff --check origin/main...HEAD` — **failed** on the two report lines noted
  above.
