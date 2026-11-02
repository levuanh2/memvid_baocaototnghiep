# Quiz: 10-question journey through the real API and database

Owner of the run: Codex1. Summary and review: Claude.

Full report: `codex1/quiz-10q-api-e2e.md`. Raw files in `codex1/`:

- `quiz-10q-playwright-report.json`
- `quiz-10q-request-order.json`
- `quiz-10q-postgres-assertions.json`
- runner sources

| Item | Value |
|---|---|
| Git SHA | `c02e2b9` |
| Run time | 2026-11-01T16:58:07Z–16:58:20Z |
| Result | 1 Playwright test: **1 passed**, 0 failed, 0 skipped |
| Tool | Chromium (Playwright) |
| Database checks | `psql` inside the disposable container |

**Environment**

- Disposable Postgres 16 (`r82-pg`, `:55432`).
- Real Flask (`run_e2e_server.py`, `:8080`) with `AUTH_PROTECT_APP_APIS=true`.
- Production-equivalent frontend build of `c02e2b9` (`:4173`).

## What was real and what was replaced

**Real:** registration and auth, attempt open and read, PATCH autosave,
submit, grading, mastery, review plan, ownership checks, and PostgreSQL.

**Replaced:** AI question generation only.

- `seed_quiz_10q.py` writes a deterministic indexed document, its sections and
  chunks, and 10 objective questions through the backend's own
  `quiz.repository`.
- Review prose uses the backend's rule fallback, because `SKIP_MODEL_LOAD=1`.
- No Quiz persistence or submission API was mocked.
- `page.route` only delays or aborts a real PATCH. The delayed PATCH is still
  forwarded to the server.

## Required assertions

| Assertion | Observed (UI, API and Postgres) | Result |
|---|---|---|
| Exactly one active attempt | Mid-flight `active_attempts=1`. Reopen and reload reuse the same attempt ID | PASS |
| All 10 questions linked to the quiz | `question_count=10` | PASS |
| Latest answers stored | Changed while the earlier PATCH was delayed; the later value `Correct 1` persisted. Hard reload restored it | PASS |
| No submit before save acknowledgement | Aborted PATCH: save error shown, 0 submit requests. After retry, PATCH then submit | PASS |
| No duplicate submission | Two synchronous clicks sent 1 POST. A direct second POST returned 409. Postgres has 1 attempt row | PASS |
| Score hidden before submit | Open response `score=null`; results endpoint 409; database score null | PASS |
| Score hidden during asynchronous grading | Objective quizzes grade synchronously, so no pending window exists to observe | NOT VERIFIED |
| Grade matches persisted answers | 10 answer rows; SQL recomputation gives 8, stored score 8/10, UI shows 80% | PASS |
| Mastery uses awarded scores | Core 5/5 = 1.0 (mastered); Advanced 3/5 = 0.6 (light_review) | PASS |
| Wrong-answer feedback and ordinal references | Two wrong answers, each with feedback and "Nguồn: 1 đoạn trong tài liệu" | PASS |
| Review items point to permitted sources | `review_sections_permitted=true`, `review_chunks_permitted=true` | PASS |
| Follow a source reference | The result and review UI shows only a source count; there is no navigable reference | NOT VERIFIED (no UI affordance) |
| Generate a practice quiz | Practice generation needs AI; the E2E server does not stub it | NOT VERIFIED |
| Cross-account rejection | A second learner's GET, PATCH and submit on the first learner's attempt each return **404** | PASS |
| Expired or revoked session | Invalid token redirects to `/login?next=…` | PASS |
| Attempt identity change | Switching quiz opens a separate attempt; returning reuses the original | PASS |

## Verdict

**PASS** for persistence, grading, mastery, review scoping and isolation:

- the real frontend, the real routes and real PostgreSQL meet the contract;
- the Round 8.1 autosave barrier (R8-002) holds end to end.

Three items are NOT VERIFIED and are listed in `release-gate-matrix.md`:

- the asynchronous grading window;
- source-reference navigation;
- practice-quiz generation.

## Backend pytest on the same database

Command and file list: `codex1/backend-stack.md`.

- 36 files: the 26 export/PDF files from Round 8.1, plus 10 quiz, attempt and persistence files.
- Result: **503 passed, 0 failed, 0 skipped**, 4 deprecation warnings.
